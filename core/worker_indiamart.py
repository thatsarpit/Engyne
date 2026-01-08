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


async def scrape_recent_leads(page: Page, max_items: int) -> list[dict[str, Any]]:
    try:
        await page.wait_for_selector("body", timeout=5000)
    except Exception:
        return []

    script = """
    (maxItems) => {
      const results = [];
      const contactButtons = Array.from(document.querySelectorAll('button, a')).filter(
        el => /contact buyer/i.test(el.innerText || '')
      );
      const seen = new Set();
      for (const btn of contactButtons) {
        const card = btn.closest('article, section, li, div') || btn.parentElement;
        const text = (card?.innerText || btn.innerText || '').trim();
        if (!text) continue;
        const leadId =
          card?.getAttribute('id') ||
          btn.getAttribute('data-bltxn-id') ||
          btn.getAttribute('data-lead-id') ||
          btn.getAttribute('data-id') ||
          `lead-${results.length}-${Date.now()}`;
        if (seen.has(leadId)) continue;
        seen.add(leadId);
        const timeEl =
          card?.querySelector('[class*="time"], [data-label*="time"], .time') || null;
        const countryEl =
          card?.querySelector('[class*="country"], [data-label*="country"]') || null;
        const titleEl =
          card?.querySelector('h1,h2,h3,.p_title,.heading') || null;
        results.push({
          lead_id: leadId,
          text,
          time_text: timeEl?.textContent?.trim() || null,
          country: countryEl?.textContent?.trim() || null,
          title: titleEl?.textContent?.trim() || null,
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
    await asyncio.sleep(0.5)
    await heartbeat("INIT")

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
                cfg_data = read_slot_config(slot_config_path)
                quality_level = coerce_int(cfg_data.get("quality_level", 0), default=0)
                policy = quality_mapping(quality_level)
                auto_buy = coerce_bool(cfg_data.get("auto_buy"), default=False)
                dry_run = coerce_bool(cfg_data.get("dry_run"), default=True)
                max_per_cycle = coerce_int(cfg_data.get("max_leads_per_cycle", cfg.leads_limit), default=cfg.leads_limit)
                heartbeat_extra = {
                    "config_version": cfg_data.get("version"),
                    "quality_level": quality_level,
                    "auto_buy": auto_buy,
                    "dry_run": dry_run,
                    **policy,
                }

                phase: Phase = "PARSE_LEADS"
                try:
                    await page.goto("https://seller.indiamart.com/bltxn/?pref=recent", wait_until="domcontentloaded")
                except Exception:
                    phase = "LOGIN_REQUIRED"
                    await heartbeat(phase, extra=heartbeat_extra)
                    await asyncio.sleep(cfg.heartbeat_interval)
                    continue

                # Simple login check: ensure we stayed on seller.indiamart.com
                if "seller.indiamart.com" not in page.url:
                    phase = "LOGIN_REQUIRED"
                    await heartbeat(phase, extra=heartbeat_extra)
                    await asyncio.sleep(cfg.heartbeat_interval)
                    continue

                leads_raw = await scrape_recent_leads(page, max_items=max_per_cycle)
                leads_kept = 0
                for lead in leads_raw:
                    lead_id = str(lead.get("lead_id") or f"{cfg.slot_id}-{cfg.run_id}-{uuid.uuid4()}")
                    if lead_id in seen_leads:
                        continue
                    text_blob = str(lead.get("text") or "")
                    time_text = lead.get("time_text")
                    age_hours = parse_age_hours(time_text or text_blob)
                    member_months = parse_member_months(text_blob)

                    if policy["max_age_hours"] is not None and age_hours is not None and age_hours > policy["max_age_hours"]:
                        continue
                    if policy["min_member_months"] is not None and member_months is not None and member_months < policy["min_member_months"]:
                        continue

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
                        "quality_level": quality_level,
                        "policy": policy,
                        "auto_buy": auto_buy,
                        "dry_run": dry_run,
                    }
                    append_jsonl(slot_dir / "leads.jsonl", record)
                    seen_leads.add(lead_id)
                    leads_kept += 1

                    # For now, we do NOT auto-click; verified events require explicit click+verify logic.
                    # This is a safe observe-only path.

                heartbeat_extra.update({"leads_found": len(leads_raw), "leads_kept": leads_kept})
                await heartbeat(phase, extra=heartbeat_extra)

                sleep_for = max(cfg.cooldown_seconds, cfg.heartbeat_interval)
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=sleep_for)
                except asyncio.TimeoutError:
                    pass
        finally:
            await heartbeat("STOPPING")
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
