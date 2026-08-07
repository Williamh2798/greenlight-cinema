"""Runtime Parallel Search API integration (required for Parallel track)."""

from __future__ import annotations

import os
from typing import Any

from parallel import Parallel

from .schemas import ResearchHit


def get_parallel_client() -> Parallel:
    api_key = os.environ.get("PARALLEL_API_KEY")
    if not api_key:
        raise RuntimeError(
            "PARALLEL_API_KEY is not set. Create a key at https://platform.parallel.ai"
        )
    return Parallel(api_key=api_key)


def search_web(
    objective: str,
    search_queries: list[str] | None = None,
    *,
    mode: str = "advanced",
) -> list[ResearchHit]:
    """Call Parallel Search API and normalize results.

    This function imports and invokes the official `parallel-web` SDK at runtime.
    """
    client = get_parallel_client()
    kwargs: dict[str, Any] = {"objective": objective, "mode": mode}
    if search_queries:
        kwargs["search_queries"] = search_queries

    # Official Parallel Search API call — required by hackathon rules.
    response = client.search(**kwargs)

    hits: list[ResearchHit] = []
    for result in getattr(response, "results", []) or []:
        excerpts = list(getattr(result, "excerpts", None) or [])
        hits.append(
            ResearchHit(
                title=getattr(result, "title", "") or "Untitled",
                url=getattr(result, "url", "") or "",
                excerpts=[e for e in excerpts if e],
            )
        )
    return hits


def hits_to_text(hits: list[ResearchHit], *, limit: int = 8) -> str:
    blocks: list[str] = []
    for hit in hits[:limit]:
        excerpt = " ".join(hit.excerpts)[:600] if hit.excerpts else ""
        blocks.append(f"- {hit.title}\n  URL: {hit.url}\n  Excerpt: {excerpt}")
    return "\n".join(blocks) if blocks else "(no results)"
