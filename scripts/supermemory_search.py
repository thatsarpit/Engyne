#!/usr/bin/env python3
from __future__ import annotations

import json
import sys

from engyne_api.settings import get_settings
from engyne_api.supermemory import search_documents


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: supermemory_search.py <query>")
        return 2
    query = " ".join(sys.argv[1:]).strip()
    if not query:
        print("Query cannot be empty.")
        return 2
    settings = get_settings()
    results = search_documents(settings, query=query, limit=5)
    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
