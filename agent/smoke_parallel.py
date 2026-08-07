#!/usr/bin/env python3
"""Smoke test: prove Parallel Search API is imported and called at runtime."""

from __future__ import annotations

import os
import sys

from dotenv import load_dotenv

load_dotenv()


def main() -> int:
    if not os.environ.get("PARALLEL_API_KEY"):
        print("SKIP: PARALLEL_API_KEY not set", file=sys.stderr)
        return 2

    # Direct SDK import + call (hackathon requirement).
    from parallel import Parallel

    client = Parallel(api_key=os.environ["PARALLEL_API_KEY"])
    search = client.search(
        objective="Find recent box office performance for original sci-fi thrillers.",
        search_queries=["sci-fi thriller box office", "original sci-fi film market"],
        mode="turbo",
    )
    results = list(getattr(search, "results", []) or [])
    print(f"OK: Parallel Search returned {len(results)} results")
    for r in results[:3]:
        print(f" - {getattr(r, 'title', '')}: {getattr(r, 'url', '')}")
    return 0 if results else 1


if __name__ == "__main__":
    raise SystemExit(main())
