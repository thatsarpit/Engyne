from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from playwright.async_api import async_playwright, BrowserContext

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
        pass


async def worker_main(cfg: WorkerConfig) -> int:
    slot_dir = cfg.slots_root / cfg.slot_id
    slot_dir.mkdir(parents=True, exist_ok=True)
    slot_config_path = slot_dir / "slot_config.yml"

    phase: Phase = "BOOT"
    pid = os.getpid()
    stop_event = asyncio.Event()

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

        try:
            while not stop_event.is_set():
                cfg_data = read_slot_config(slot_config_path)
                quality_level = int(cfg_data.get("quality_level", 0)) if isinstance(cfg_data.get("quality_level"), (int, float)) else 0
                policy = quality_mapping(quality_level)
                heartbeat_extra = {"config_version": cfg_data.get("version"), **policy}

                # Navigate to Recent Leads
                try:
                    await page.goto("https://seller.indiamart.com/bltxn/?pref=recent", wait_until="domcontentloaded", timeout=15000)
                    phase = "PARSE_LEADS"
                except Exception:
                    phase = "LOGIN_REQUIRED"

                # Append synthetic leads (placeholder until real parsing)
                leads_found = []
                for i in range(cfg.leads_limit):
                    lead_id = f"{cfg.slot_id}-{cfg.run_id}-{int(time.time())}-{i}"
                    lead = {
                        "lead_id": lead_id,
                        "observed_at": utc_now(),
                        "meta": {"quality_level": quality_level, **policy},
                    }
                    leads_found.append(lead)
                    append_jsonl(slot_dir / "leads.jsonl", lead)
                    await emit_verified(cfg, lead_id=lead_id, payload=lead["meta"])

                await heartbeat(phase, extra=heartbeat_extra)
                sleep_for = max(cfg.cooldown_seconds, cfg.heartbeat_interval)
                await asyncio.sleep(sleep_for)
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
