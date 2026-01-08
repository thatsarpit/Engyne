from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

RECENT_LEADS_URL = "https://seller.indiamart.com/bltxn/?pref=recent"
CONSUMED_LEADS_URL = "https://seller.indiamart.com/blproduct/mypurchasedbl?disp=D"


async def dump_recent(page) -> dict:
    await page.goto(RECENT_LEADS_URL, wait_until="domcontentloaded", timeout=20000)
    if await ensure_logged_in(page):
        await page.goto(RECENT_LEADS_URL, wait_until="domcontentloaded", timeout=20000)
    return await page.evaluate(
        """
      () => {
        const contactButtons = Array.from(document.querySelectorAll('button, a')).filter(
          el => /contact buyer/i.test(el.innerText || '')
        );
        const cards = [];
        for (const btn of contactButtons) {
          const card = btn.closest('article, section, li, div') || btn.parentElement;
          if (!card) continue;
          cards.push({
            lead_id: card.getAttribute('id'),
            button_text: (btn.innerText || '').trim(),
            card_class: (card.className || '').toString(),
            card_text: (card.innerText || '').slice(0, 1500),
            card_html: (card.outerHTML || '').slice(0, 4000),
          });
          if (cards.length >= 3) break;
        }
        return { url: location.href, cards };
      }
    """
    )


async def dump_consumed(page) -> dict:
    await page.goto(CONSUMED_LEADS_URL, wait_until="domcontentloaded", timeout=20000)
    if await ensure_logged_in(page):
        await page.goto(CONSUMED_LEADS_URL, wait_until="domcontentloaded", timeout=20000)
    return await page.evaluate(
        """
      () => {
        const cards = Array.from(document.querySelectorAll('article, section, li, div')).filter(
          el => /consumed on/i.test(el.innerText || '')
        );
        const results = cards.slice(0, 3).map(card => ({
          card_class: (card.className || '').toString(),
          card_text: (card.innerText || '').slice(0, 1500),
          card_html: (card.outerHTML || '').slice(0, 4000),
        }));
        return { url: location.href, cards: results };
      }
    """
    )


def needs_login(url: str) -> bool:
    lower = url.lower()
    return "succ_url=" in lower or "login" in lower


async def ensure_logged_in(page) -> bool:
    if not needs_login(page.url):
        return False
    if sys.stdin.isatty():
        print("Login required. Please complete login in the opened browser window.")
        try:
            input("Press Enter here once logged in to continue...")
        except EOFError:
            pass
    else:
        await page.wait_for_timeout(15000)
    await page.wait_for_timeout(1500)
    return needs_login(page.url)


async def main() -> int:
    parser = argparse.ArgumentParser(description="Dump IndiaMART DOM samples for selector tuning")
    parser.add_argument(
        "--profile-path",
        default=os.environ.get("INDIAMART_PROFILE_PATH", ""),
        help="Chrome profile path used for persistent login",
    )
    parser.add_argument(
        "--output-dir",
        default=os.environ.get("RUNTIME_ROOT", "runtime"),
        help="Directory to write JSON output",
    )
    args = parser.parse_args()
    if not args.profile_path:
        print("Missing --profile-path or INDIAMART_PROFILE_PATH")
        return 2

    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    recent_path = output_dir / "indiamart_dom_recent.json"
    consumed_path = output_dir / "indiamart_dom_consumed.json"

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            channel="chrome",
            user_data_dir=str(Path(args.profile_path).expanduser().resolve()),
            headless=False,
            args=["--disable-features=IsolateOrigins,site-per-process"],
        )
        page = await browser.new_page()
        try:
            recent = await dump_recent(page)
            consumed = await dump_consumed(page)
        finally:
            await browser.close()

    recent_path.write_text(json.dumps(recent, indent=2))
    consumed_path.write_text(json.dumps(consumed, indent=2))
    print(f"Wrote {recent_path}")
    print(f"Wrote {consumed_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
