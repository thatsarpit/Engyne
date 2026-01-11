#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

from engyne_api.settings import get_settings
from engyne_api.supermemory import push_document


def main() -> int:
    settings = get_settings()
    context_path = Path("ENGYNE_CONTEXT.md")
    if not context_path.exists():
        print("ENGYNE_CONTEXT.md not found.")
        return 1
    content = context_path.read_text()
    ok = push_document(
        settings,
        content=content,
        metadata={"source": "engyne_context", "path": str(context_path)},
    )
    if not ok:
        print("Supermemory push failed (missing key or request error).")
        return 2
    print("Supermemory push succeeded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
