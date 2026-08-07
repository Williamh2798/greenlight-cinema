"""Deterministic multi-step Greenlight research pipeline."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from typing import Any

from .gemini_client import generate_json, generate_text
from .parallel_search import hits_to_text, search_web
from .schemas import GreenlightBrief, PitchRequest, SourceCitation, StepEvent


StepCallback = Callable[[StepEvent], None]


SYSTEM = (
    "You are Greenlight, a studio development analyst. "
    "Be specific, cite only provided sources, and avoid inventing URLs. "
    "Write for producers and creative executives."
)


def _pitch_blob(pitch: PitchRequest) -> str:
    hints = ", ".join(pitch.comparable_hints) if pitch.comparable_hints else "none"
    return (
        f"Title: {pitch.title}\n"
        f"Logline: {pitch.logline}\n"
        f"Genre: {pitch.genre or 'unspecified'}\n"
        f"Budget band: {pitch.budget_band or 'unspecified'}\n"
        f"Format: {pitch.format or 'unspecified'}\n"
        f"Comparable hints: {hints}\n"
        f"Extra context: {pitch.extra_context or 'none'}"
    )


def _emit(cb: StepCallback | None, event: StepEvent) -> StepEvent:
    if cb:
        cb(event)
    return event


def _sources_from_hits(hits: list, step: str) -> list[SourceCitation]:
    out: list[SourceCitation] = []
    for hit in hits[:10]:
        excerpt = " ".join(hit.excerpts)[:400] if hit.excerpts else None
        out.append(
            SourceCitation(
                title=hit.title,
                url=hit.url,
                excerpt=excerpt,
                step=step,
            )
        )
    return out


def run_greenlight_pipeline(
    pitch: PitchRequest,
    *,
    on_step: StepCallback | None = None,
) -> GreenlightBrief:
    all_sources: list[SourceCitation] = []
    pitch_text = _pitch_blob(pitch)

    # --- Step 1: parse / frame the pitch ---
    _emit(
        on_step,
        StepEvent(
            step="parse_pitch",
            status="started",
            message="Framing the pitch for research objectives",
        ),
    )
    framing = generate_json(
        (
            "Extract research objectives for a studio greenlight diligence process.\n"
            f"{pitch_text}\n\n"
            "Return JSON with keys: "
            "themes (string[]), audience (string), "
            "comp_objective (string), market_objective (string), "
            "risk_objective (string), "
            "comp_queries (string[3]), market_queries (string[3]), "
            "risk_queries (string[3])."
        ),
        system=SYSTEM,
    )
    _emit(
        on_step,
        StepEvent(
            step="parse_pitch",
            status="completed",
            message="Pitch framed",
            data={"themes": framing.get("themes", []), "audience": framing.get("audience")},
        ),
    )

    # --- Step 2: comparable titles (Parallel Search) ---
    _emit(
        on_step,
        StepEvent(
            step="research_comps",
            status="started",
            message="Searching comparable titles and franchise analogs via Parallel",
        ),
    )
    comp_hits = search_web(
        objective=framing.get("comp_objective")
        or f"Comparable films/series and box-office/critical performance for: {pitch.title}",
        search_queries=framing.get("comp_queries")
        or [
            f"{pitch.title} similar movies",
            f"{pitch.genre or 'thriller'} film box office comps",
            " ".join(pitch.comparable_hints[:2]) + " box office" if pitch.comparable_hints else f"{pitch.genre} streaming hits",
        ],
    )
    all_sources.extend(_sources_from_hits(comp_hits, "research_comps"))
    _emit(
        on_step,
        StepEvent(
            step="research_comps",
            status="completed",
            message=f"Found {len(comp_hits)} Parallel Search hits for comps",
            data={"hit_count": len(comp_hits), "top": [h.model_dump() for h in comp_hits[:3]]},
        ),
    )

    # --- Step 3: market / timing (Parallel Search) ---
    _emit(
        on_step,
        StepEvent(
            step="research_market",
            status="started",
            message="Searching market and audience timing signals via Parallel",
        ),
    )
    market_hits = search_web(
        objective=framing.get("market_objective")
        or f"Current market demand and audience appetite for {pitch.genre or 'this genre'} features/series",
        search_queries=framing.get("market_queries")
        or [
            f"{pitch.genre or 'sci-fi'} film market 2025 2026",
            f"{pitch.format or 'feature'} streaming trends",
            f"audience demand {framing.get('audience', pitch.genre or 'adult drama')}",
        ],
    )
    all_sources.extend(_sources_from_hits(market_hits, "research_market"))
    _emit(
        on_step,
        StepEvent(
            step="research_market",
            status="completed",
            message=f"Found {len(market_hits)} Parallel Search hits for market",
            data={"hit_count": len(market_hits), "top": [h.model_dump() for h in market_hits[:3]]},
        ),
    )

    # --- Step 4: risk / IP / clearance cues (Parallel Search) ---
    _emit(
        on_step,
        StepEvent(
            step="research_risks",
            status="started",
            message="Searching IP, clearance, and execution risk cues via Parallel",
        ),
    )
    risk_hits = search_web(
        objective=framing.get("risk_objective")
        or (
            f"Potential IP conflicts, similar titles in development, "
            f"and production risk signals related to: {pitch.logline[:240]}"
        ),
        search_queries=framing.get("risk_queries")
        or [
            f"{pitch.title} trademark film",
            f"films like {pitch.comparable_hints[0]}" if pitch.comparable_hints else f"{pitch.genre} saturation",
            "film development slate controversy risk",
        ],
    )
    all_sources.extend(_sources_from_hits(risk_hits, "research_risks"))
    _emit(
        on_step,
        StepEvent(
            step="research_risks",
            status="completed",
            message=f"Found {len(risk_hits)} Parallel Search hits for risks",
            data={"hit_count": len(risk_hits), "top": [h.model_dump() for h in risk_hits[:3]]},
        ),
    )

    # --- Step 5: compose brief with Gemini ---
    _emit(
        on_step,
        StepEvent(
            step="compose_brief",
            status="started",
            message="Synthesizing Greenlight Brief with Gemini",
        ),
    )
    research_pack = (
        f"PITCH\n{pitch_text}\n\n"
        f"FRAMING\n{json.dumps(framing, indent=2)}\n\n"
        f"COMPS RESEARCH (Parallel Search)\n{hits_to_text(comp_hits)}\n\n"
        f"MARKET RESEARCH (Parallel Search)\n{hits_to_text(market_hits)}\n\n"
        f"RISK RESEARCH (Parallel Search)\n{hits_to_text(risk_hits)}\n"
    )

    brief_json = generate_json(
        (
            "Using ONLY the research pack below, produce a studio greenlight brief.\n"
            "Return JSON with keys:\n"
            "recommendation: one of greenlight | develop_further | pass\n"
            "confidence: number 0-1\n"
            "summary: 2-4 sentences\n"
            "comps: string[] (title + why it comps)\n"
            "market_signals: string[]\n"
            "risk_flags: string[]\n"
            "diligence_questions: string[] (3-6 concrete next questions)\n\n"
            f"{research_pack}"
        ),
        system=SYSTEM,
    )

    markdown = generate_text(
        (
            "Write a polished Greenlight Brief in markdown for producers. "
            "Include sections: Recommendation, Why, Comps, Market, Risks, "
            "Diligence Checklist, Sources (use the URLs from research). "
            "Do not invent sources.\n\n"
            f"STRUCTURED BRIEF:\n{json.dumps(brief_json, indent=2)}\n\n"
            f"SOURCES:\n{json.dumps([s.model_dump() for s in all_sources[:18]], indent=2)}"
        ),
        system=SYSTEM,
    )

    recommendation = brief_json.get("recommendation", "develop_further")
    if recommendation not in {"greenlight", "develop_further", "pass"}:
        recommendation = "develop_further"

    try:
        confidence = float(brief_json.get("confidence", 0.5))
    except (TypeError, ValueError):
        confidence = 0.5
    confidence = max(0.0, min(1.0, confidence))

    brief = GreenlightBrief(
        title=pitch.title,
        recommendation=recommendation,
        confidence=confidence,
        summary=str(brief_json.get("summary", "")),
        comps=[str(x) for x in brief_json.get("comps", []) or []],
        market_signals=[str(x) for x in brief_json.get("market_signals", []) or []],
        risk_flags=[str(x) for x in brief_json.get("risk_flags", []) or []],
        diligence_questions=[str(x) for x in brief_json.get("diligence_questions", []) or []],
        sources=all_sources,
        markdown=markdown,
    )

    _emit(
        on_step,
        StepEvent(
            step="compose_brief",
            status="completed",
            message=f"Brief ready — recommendation: {brief.recommendation}",
            data={"recommendation": brief.recommendation, "confidence": brief.confidence},
        ),
    )
    return brief


async def stream_greenlight_pipeline(pitch: PitchRequest) -> AsyncIterator[dict[str, Any]]:
    """Yield SSE-friendly dicts for each step, then the final brief."""
    queue: list[StepEvent] = []

    def on_step(event: StepEvent) -> None:
        queue.append(event)

    # Run sync pipeline in thread-ish fashion by processing after each emit via queue drain.
    # Simpler: run pipeline and yield queued events; for true streaming we yield as we go.
    import asyncio

    loop = asyncio.get_event_loop()
    result_holder: dict[str, Any] = {}

    def _run() -> GreenlightBrief:
        brief = run_greenlight_pipeline(pitch, on_step=on_step)
        result_holder["brief"] = brief
        return brief

    # Interleave by running in executor and polling the queue.
    task = loop.run_in_executor(None, _run)
    last_idx = 0
    while not task.done():
        while last_idx < len(queue):
            yield {"type": "step", "payload": queue[last_idx].model_dump()}
            last_idx += 1
        await asyncio.sleep(0.05)

    # Drain remaining + brief
    await task
    while last_idx < len(queue):
        yield {"type": "step", "payload": queue[last_idx].model_dump()}
        last_idx += 1

    brief: GreenlightBrief = result_holder["brief"]
    yield {"type": "brief", "payload": brief.model_dump()}
