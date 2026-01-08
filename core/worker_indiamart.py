from __future__ import annotations

import asyncio
import json
import os
import re
import signal
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from playwright.async_api import BrowserContext, Page, async_playwright

from core.queues import append_jsonl
from core.quality import quality_mapping

Phase = Literal["BOOT", "INIT", "PARSE_LEADS", "LOGIN_REQUIRED", "COOLDOWN", "STOPPING", "ERROR"]

RECENT_LEADS_URL = "https://seller.indiamart.com/bltxn/?pref=recent"
CONSUMED_LEADS_URL = "https://seller.indiamart.com/blproduct/mypurchasedbl?disp=D"


@dataclass
class WorkerConfig:
    slot_id: str
    slots_root: Path
    run_id: str
    api_base: str
    worker_secret: str
    heartbeat_interval: float
    profile_path: Path
    leads_limit: int = 10
    cooldown_seconds: float = 2.0


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def coerce_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return default


def coerce_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except Exception:
        return default


def normalize_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set, frozenset)):
        items = [str(v).strip().lower() for v in value if str(v).strip()]
        return [v for v in items if v]
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []
        return [v.strip().lower() for v in re.split(r"[,\n;]+", raw) if v.strip()]
    return [str(value).strip().lower()] if str(value).strip() else []


def normalize_method(value: str) -> str:
    v = value.strip().lower()
    if v in {"mobile", "phone", "call"}:
        return "phone"
    if v in {"email", "mail"}:
        return "email"
    if v in {"whatsapp", "wa"}:
        return "whatsapp"
    return v


def text_contains_any(text: str, keywords: list[str]) -> bool:
    haystack = text.lower()
    return any(k in haystack for k in keywords)


def read_slot_config(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        import yaml

        data = yaml.safe_load(path.read_text())
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_state(slot_dir: Path, payload: dict) -> None:
    state_path = slot_dir / "slot_state.json"
    tmp = state_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=2))
    tmp.replace(state_path)


def write_status(slot_dir: Path, payload: dict) -> None:
    status_path = slot_dir / "status.json"
    tmp = status_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=2))
    tmp.replace(status_path)


def parse_age_hours(raw: str | None) -> float | None:
    if not raw:
        return None
    text = raw.lower()
    match = re.search(r"(\d+(?:\.\d+)?)", text)
    if not match:
        return None
    value = float(match.group(1))
    if "min" in text:
        return value / 60.0
    if "hour" in text:
        return value
    if "day" in text:
        return value * 24.0
    return None


def parse_member_months(raw: str | None) -> int | None:
    if not raw:
        return None
    match = re.search(r"member since\s+(\d+)\s+month", raw, flags=re.IGNORECASE)
    if match:
        try:
            return int(match.group(1))
        except Exception:
            return None
    return None


def format_error(exc: Exception) -> str:
    return f"{exc.__class__.__name__}: {exc}"


def extract_email(text: str) -> str | None:
    match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", text, flags=re.IGNORECASE)
    return match.group(0) if match else None


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"[^\d+]", "", raw)
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    return digits


def extract_phone(text: str) -> str | None:
    match = re.search(r"(\+?\d[\d\-\s]{8,}\d)", text)
    if not match:
        return None
    return normalize_phone(match.group(1))


def lead_signature(lead: dict[str, Any]) -> str:
    parts = [
        str(lead.get("lead_id") or "").strip().lower(),
        str(lead.get("title") or "").strip().lower(),
        str(lead.get("country") or "").strip().lower(),
        str(lead.get("time_text") or "").strip().lower(),
    ]
    sig = "|".join(p for p in parts if p)
    return sig[:240]


async def scrape_recent_leads(page: Page, max_items: int) -> list[dict[str, Any]]:
    try:
        await page.wait_for_selector("div.bl_grid.PrD_Enq", timeout=8000)
    except Exception:
        try:
            await page.wait_for_selector("body", timeout=5000)
        except Exception:
            return []
    script = """
    (maxItems) => {
      const results = [];
      const cards = Array.from(document.querySelectorAll('div.bl_grid.PrD_Enq'));
      const seen = new Set();
      const extractMemberSince = (text) => {
        const match = text.match(/member since[^\\n]*/i);
        return match ? match[0].trim() : null;
      };
      const extractCategory = (card) => {
        const parent = card.querySelector('input[name="parent_mcatname"]')?.value;
        const child = card.querySelector('input[name="mcatname"]')?.value;
        if (parent && child) return `${parent} > ${child}`;
        return child || parent || null;
      };
      const extractTime = (text) => {
        const match = text.match(/\\b\\d+\\s*(min|mins|minute|minutes|hour|hours|day|days)\\s*ago\\b/i);
        return match ? match[0] : null;
      };
      for (const card of cards) {
        const text = (card.innerText || '').trim();
        if (!text) continue;
        const ofrid = card.querySelector('input[name="ofrid"]')?.value || null;
        const cardId = card.getAttribute('id') || null;
        const leadId = ofrid || cardId || `lead-${results.length}-${Date.now()}`;
        if (seen.has(leadId)) continue;
        seen.add(leadId);
        const title =
          card.querySelector('input[name="ofrtitle"]')?.value ||
          card.querySelector('h2')?.innerText?.trim() ||
          null;
        const country =
          card.querySelector('input[id^="card_country_"]')?.value ||
          card.querySelector('.coutry_click')?.innerText?.trim() ||
          null;
        const timeText = extractTime(text);
        const memberSince = extractMemberSince(text);
        const availability = new Set();
        const iconEls = Array.from(card.querySelectorAll('img, svg, i, span, a, button') || []);
        for (const el of iconEls) {
          const label = [
            el.getAttribute?.('title'),
            el.getAttribute?.('aria-label'),
            el.getAttribute?.('data-tooltip'),
            el.getAttribute?.('data-original-title'),
            el.getAttribute?.('alt'),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          const className = (el.className || '').toString().toLowerCase();
          const textLabel = (el.textContent || '').toLowerCase();
          const blob = `${label} ${className} ${textLabel}`;
          if (blob.includes('email')) availability.add('email');
          if (blob.includes('phone') || blob.includes('call') || blob.includes('mobile')) availability.add('phone');
          if (blob.includes('whatsapp')) availability.add('whatsapp');
        }
        results.push({
          lead_id: leadId,
          card_id: cardId,
          text,
          time_text: timeText,
          country,
          title,
          member_since_text: memberSince,
          category_text: extractCategory(card),
          availability: Array.from(availability),
        });
        if (results.length >= maxItems) break;
      }
      return results;
    }
    """
    try:
        leads = await page.evaluate(script, max_items)
        return leads or []
    except Exception:
        return []


async def attempt_click(page: Page, lead: dict[str, Any]) -> bool:
    """Try to click the 'Contact Buyer' button inside the lead card."""
    try:
        card_id = lead.get("card_id")
        if card_id:
            card = page.locator(f"#{card_id}")
            btn = card.get_by_text(re.compile("contact buyer", re.IGNORECASE)).first
            await btn.click(timeout=4000)
            return True
    except Exception:
        pass
    try:
        btn = page.get_by_role("button", name=re.compile("contact buyer", re.IGNORECASE))
        if await btn.count() == 0:
            btn = page.get_by_text(re.compile("contact buyer", re.IGNORECASE)).first
        await btn.first.click(timeout=3000)
        return True
    except Exception:
        return False


async def attempt_verify(page: Page) -> bool:
    """Heuristic verification after click; best-effort without hard selectors."""
    try:
        await page.wait_for_timeout(1200)
        for pattern in (
            re.compile("contacted", re.IGNORECASE),
            re.compile("message sent", re.IGNORECASE),
            re.compile("interested", re.IGNORECASE),
        ):
            loc = page.get_by_text(pattern)
            if await loc.count() > 0 and await loc.first.is_visible():
                return True
    except Exception:
        pass
    return False


async def safe_body_text(page: Page) -> str | None:
    try:
        return await page.inner_text("body")
    except Exception:
        return None


async def verify_in_consumed(
    context: BrowserContext, lead_id: str, title: str | None
) -> tuple[bool, dict[str, str | None]]:
    page = await context.new_page()
    contact: dict[str, str | None] = {"email": None, "phone": None}
    try:
        await page.goto(CONSUMED_LEADS_URL, wait_until="domcontentloaded", timeout=20000)
        if "seller.indiamart.com" not in page.url:
            return False, contact
        content = await page.content()
        if lead_id and lead_id in content:
            body_text = await safe_body_text(page)
            if body_text:
                contact["email"] = extract_email(body_text) or contact["email"]
                contact["phone"] = extract_phone(body_text) or contact["phone"]
            return True, contact
        if title and len(title) >= 6 and title.lower() in content.lower():
            body_text = await safe_body_text(page)
            if body_text:
                contact["email"] = extract_email(body_text) or contact["email"]
                contact["phone"] = extract_phone(body_text) or contact["phone"]
            return True, contact
        body_text = await safe_body_text(page)
        if lead_id and body_text and lead_id in body_text:
            contact["email"] = extract_email(body_text) or contact["email"]
            contact["phone"] = extract_phone(body_text) or contact["phone"]
            return True, contact
        if title and body_text and title.lower() in body_text.lower():
            contact["email"] = extract_email(body_text) or contact["email"]
            contact["phone"] = extract_phone(body_text) or contact["phone"]
            return True, contact
    except Exception:
        return False, contact
    finally:
        await page.close()
    return False, contact


async def emit_verified(cfg: WorkerConfig, lead_id: str, payload: dict | None = None) -> None:
    import aiohttp

    url = f"{cfg.api_base}/events/verified"
    headers = {
        "Content-Type": "application/json",
        "X-Engyne-Worker-Secret": cfg.worker_secret,
    }
    body = {
        "slot_id": cfg.slot_id,
        "lead_id": lead_id,
        "observed_at": utc_now(),
        "payload": payload or {},
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json=body, timeout=5) as resp:
                await resp.text()
    except Exception:
        # Intentionally swallow to avoid crashing the worker
        pass


async def worker_main(cfg: WorkerConfig) -> int:
    slot_dir = cfg.slots_root / cfg.slot_id
    slot_dir.mkdir(parents=True, exist_ok=True)
    slot_config_path = slot_dir / "slot_config.yml"

    pid = os.getpid()
    stop_event = asyncio.Event()
    seen_leads: set[str] = set()
    seen_signatures: set[str] = set()
    clicked_leads: set[str] = set()

    loop = asyncio.get_event_loop()

    def handle_stop(signum, frame):
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, handle_stop, sig, None)
        except NotImplementedError:
            signal.signal(sig, handle_stop)  # type: ignore

    async def heartbeat(context_phase: Phase, extra: dict | None = None):
        payload = {
            "slot_id": cfg.slot_id,
            "phase": context_phase,
            "run_id": cfg.run_id,
            "pid": pid,
            "heartbeat_ts": utc_now(),
        }
        if extra:
            payload.update(extra)
        write_state(slot_dir, payload)

    await heartbeat("BOOT")
    write_status(
        slot_dir,
        {
            "slot_id": cfg.slot_id,
            "phase": "BOOT",
            "run_id": cfg.run_id,
            "pid": pid,
            "heartbeat_ts": utc_now(),
        },
    )
    await asyncio.sleep(0.5)
    await heartbeat("INIT")
    write_status(
        slot_dir,
        {
            "slot_id": cfg.slot_id,
            "phase": "INIT",
            "run_id": cfg.run_id,
            "pid": pid,
            "heartbeat_ts": utc_now(),
        },
    )

    async with async_playwright() as p:
        launch_kwargs = {
            "user_data_dir": str(cfg.profile_path),
            "headless": False,
            "args": ["--disable-features=IsolateOrigins,site-per-process"],
        }
        try:
            browser: BrowserContext = await p.chromium.launch_persistent_context(channel="chrome", **launch_kwargs)
        except Exception:
            print("[worker] chrome channel unavailable, falling back to bundled chromium", file=sys.stderr)
            browser = await p.chromium.launch_persistent_context(**launch_kwargs)
        page = await browser.new_page()
        page.set_default_navigation_timeout(20000)
        page.set_default_timeout(10000)

        try:
            while not stop_event.is_set():
                last_error: str | None = None
                leads_raw: list[dict[str, Any]] = []
                leads_kept = 0
                clicks_sent = 0
                verifies = 0
                phase: Phase = "PARSE_LEADS"

                cfg_data = read_slot_config(slot_config_path)
                quality_level = coerce_int(cfg_data.get("quality_level", 0), default=0)
                policy = quality_mapping(quality_level)
                auto_buy = coerce_bool(cfg_data.get("auto_buy"), default=False)
                dry_run = coerce_bool(cfg_data.get("dry_run"), default=True)
                max_per_cycle = coerce_int(cfg_data.get("max_leads_per_cycle", cfg.leads_limit), default=cfg.leads_limit)
                max_clicks = coerce_int(cfg_data.get("max_clicks_per_cycle", 1), default=1)
                allowed_countries = normalize_list(cfg_data.get("allowed_countries"))
                blocked_countries = normalize_list(cfg_data.get("blocked_countries"))
                keywords = normalize_list(cfg_data.get("keywords"))
                keywords_exclude = normalize_list(cfg_data.get("keywords_exclude"))
                required_methods = [normalize_method(v) for v in normalize_list(cfg_data.get("required_contact_methods"))]
                heartbeat_extra = {
                    "config_version": cfg_data.get("version"),
                    "quality_level": quality_level,
                    "auto_buy": auto_buy,
                    "dry_run": dry_run,
                    **policy,
                }

                try:
                    await page.goto(RECENT_LEADS_URL, wait_until="domcontentloaded")

                    # Simple login check: ensure we stayed on seller.indiamart.com
                    if "seller.indiamart.com" not in page.url:
                        phase = "LOGIN_REQUIRED"
                        await heartbeat(phase, extra=heartbeat_extra)
                        write_status(
                            slot_dir,
                            {
                                "slot_id": cfg.slot_id,
                                "phase": phase,
                                "run_id": cfg.run_id,
                                "pid": pid,
                                "heartbeat_ts": utc_now(),
                                **heartbeat_extra,
                            },
                        )
                        await asyncio.sleep(cfg.heartbeat_interval)
                        continue

                    leads_raw = await scrape_recent_leads(page, max_items=max_per_cycle)
                    for lead in leads_raw:
                        lead_id_raw = str(lead.get("lead_id") or "").strip()
                        signature = lead_signature(lead) or lead_id_raw.lower()
                        if signature and signature in seen_signatures:
                            continue
                        lead_id = lead_id_raw or f"{cfg.slot_id}-{cfg.run_id}-{uuid.uuid4()}"
                        if lead_id in seen_leads:
                            continue
                        text_blob = str(lead.get("text") or "")
                        email = extract_email(text_blob)
                        phone = extract_phone(text_blob)
                        contact = phone or email
                        availability = {str(v).strip().lower() for v in (lead.get("availability") or []) if str(v).strip()}
                        time_text = lead.get("time_text")
                        age_hours = parse_age_hours(time_text or text_blob)
                        member_since_text = lead.get("member_since_text")
                        member_months = parse_member_months(member_since_text or text_blob)
                        category_text = lead.get("category_text")

                        if policy["max_age_hours"] is not None and age_hours is not None and age_hours > policy["max_age_hours"]:
                            continue
                        if policy["min_member_months"] is not None and member_months is not None and member_months < policy["min_member_months"]:
                            continue

                        if blocked_countries:
                            country_blob = f"{lead.get('country') or ''} {text_blob}".lower()
                            if text_contains_any(country_blob, blocked_countries):
                                continue
                        if allowed_countries:
                            country_blob = f"{lead.get('country') or ''} {text_blob}".lower()
                            if not text_contains_any(country_blob, allowed_countries):
                                continue

                        text_for_keywords = " ".join(
                            [
                                str(lead.get("title") or ""),
                                str(category_text or ""),
                                text_blob,
                            ]
                        )
                        if keywords and not text_contains_any(text_for_keywords, keywords):
                            continue
                        if keywords_exclude and text_contains_any(text_for_keywords, keywords_exclude):
                            continue

                        has_email = bool(email) or "email" in availability
                        has_phone = bool(phone) or "phone" in availability
                        has_whatsapp = "whatsapp" in availability
                        if required_methods:
                            required_ok = True
                            for method in required_methods:
                                if method == "email" and not has_email:
                                    required_ok = False
                                if method == "phone" and not has_phone:
                                    required_ok = False
                                if method == "whatsapp" and not has_whatsapp:
                                    required_ok = False
                            if not required_ok:
                                continue

                        clicked = False
                        verified = False
                        verify_source: str | None = None

                        if auto_buy and not dry_run and clicks_sent < max_clicks and signature not in clicked_leads:
                            clicked = await attempt_click(page, lead)
                            if clicked:
                                clicks_sent += 1
                                clicked_leads.add(signature or lead_id)
                                detail_text = await safe_body_text(page)
                                if detail_text:
                                    email = email or extract_email(detail_text)
                                    phone = phone or extract_phone(detail_text)
                                    contact = contact or phone or email
                                verified = await attempt_verify(page)
                                if verified:
                                    verify_source = "inline"
                                else:
                                    verified, consumed_contact = await verify_in_consumed(
                                        page.context, lead_id_raw or lead_id, lead.get("title")
                                    )
                                    if verified:
                                        verify_source = "consumed"
                                        email = email or consumed_contact.get("email")
                                        phone = phone or consumed_contact.get("phone")
                                        contact = contact or phone or email
                                if verified:
                                    verifies += 1

                        record = {
                            "slot_id": cfg.slot_id,
                            "run_id": cfg.run_id,
                            "lead_id": lead_id,
                            "observed_at": utc_now(),
                            "title": lead.get("title"),
                            "country": lead.get("country"),
                            "time_text": time_text,
                            "age_hours": age_hours,
                            "member_months": member_months,
                            "text": text_blob[:2000],
                            "member_since_text": member_since_text,
                            "category_text": category_text,
                            "contact": contact,
                            "email": email,
                            "phone": phone,
                            "availability": sorted(availability),
                            "quality_level": quality_level,
                            "policy": policy,
                            "auto_buy": auto_buy,
                            "dry_run": dry_run,
                            "clicked": clicked,
                            "verified": verified,
                            "verification_source": verify_source,
                        }
                        append_jsonl(slot_dir / "leads.jsonl", record)
                        seen_leads.add(lead_id)
                        if signature:
                            seen_signatures.add(signature)
                        leads_kept += 1
                        if leads_kept >= max_per_cycle:
                            break
                        if verified:
                            await emit_verified(
                                cfg,
                                lead_id=lead_id,
                                payload={
                                    "quality_level": quality_level,
                                    **policy,
                                    "contact": contact,
                                    "email": email,
                                    "phone": phone,
                                    "title": lead.get("title"),
                                    "country": lead.get("country"),
                                    "age_hours": age_hours,
                                    "member_months": member_months,
                                    "member_since_text": member_since_text,
                                    "category_text": category_text,
                                    "availability": sorted(availability),
                                },
                            )
                except Exception as exc:
                    last_error = format_error(exc)
                    phase = "ERROR"

                heartbeat_extra.update(
                    {
                        "leads_found": len(leads_raw),
                        "leads_kept": leads_kept,
                        "clicks_sent": clicks_sent,
                        "verified": verifies,
                        "last_error": last_error,
                    }
                )
                await heartbeat(phase, extra=heartbeat_extra)
                write_status(
                    slot_dir,
                    {
                        "slot_id": cfg.slot_id,
                        "phase": phase,
                        "run_id": cfg.run_id,
                        "pid": pid,
                        "heartbeat_ts": utc_now(),
                        **heartbeat_extra,
                    },
                )

                sleep_for = max(cfg.cooldown_seconds, cfg.heartbeat_interval)
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=sleep_for)
                except asyncio.TimeoutError:
                    pass
        finally:
            await heartbeat("STOPPING")
            write_status(
                slot_dir,
                {
                    "slot_id": cfg.slot_id,
                    "phase": "STOPPING",
                    "run_id": cfg.run_id,
                    "pid": pid,
                    "heartbeat_ts": utc_now(),
                },
            )
            await browser.close()

    return 0


def main() -> int:
    if len(sys.argv) < 7:
        print(
            "Usage: worker_indiamart.py <slots_root> <slot_id> <run_id> <api_base> <worker_secret> <profile_path> [heartbeat_interval]",
            file=sys.stderr,
        )
        return 2
    slots_root = Path(sys.argv[1]).expanduser().resolve()
    slot_id = sys.argv[2]
    run_id = sys.argv[3] if len(sys.argv) > 3 else str(uuid.uuid4())
    api_base = sys.argv[4].rstrip("/")
    worker_secret = sys.argv[5]
    profile_path = Path(sys.argv[6]).expanduser().resolve()
    heartbeat = float(sys.argv[7]) if len(sys.argv) > 7 else 2.0

    cfg = WorkerConfig(
        slot_id=slot_id,
        slots_root=slots_root,
        run_id=run_id,
        api_base=api_base,
        worker_secret=worker_secret,
        heartbeat_interval=heartbeat,
        profile_path=profile_path,
    )
    return asyncio.run(worker_main(cfg))


if __name__ == "__main__":
    raise SystemExit(main())
