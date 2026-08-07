"""Deterministic multi-step Greenlight research pipeline."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from typing import Any

from .gemini_client import generate_json, generate_text
from .parallel_search import hits_to_text, search_web
from .schemas import CompRow, GreenlightBrief, PitchRequest, Scorecard, SourceCitation, StepEvent


StepCallback = Callable[[StepEvent], None]


SYSTEM = (
    "You are Greenlight, a studio development analyst. "
    "Be specific, cite only provided sources, and avoid inventing URLs. "
    "Write for producers and creative executives. "
    "Always weigh the pitch against its stated budget band."
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


def _clamp(n: Any, default: float = 50.0) -> float:
    try:
        v = float(n)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(100.0, v))


def _parse_scorecard(raw: Any) -> Scorecard:
    s = raw if isinstance(raw, dict) else {}
    return Scorecard(
        market_timing=_clamp(s.get("market_timing")),
        comp_fit=_clamp(s.get("comp_fit")),
        risk_level=_clamp(s.get("risk_level")),
        originality=_clamp(s.get("originality")),
    )


def _parse_comp_table(raw: Any) -> list[CompRow]:
    if not isinstance(raw, list):
        return []
    rows: list[CompRow] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "")
        if not title:
            continue
        rows.append(
            CompRow(
                title=title,
                why=str(item.get("why") or ""),
                signal=str(item.get("signal") or ""),
            )
        )
    return rows


def run_greenlight_pipeline(
    pitch: PitchRequest,
    *,
    on_step: StepCallback | None = None,
) -> GreenlightBrief:
    all_sources: list[SourceCitation] = []
    pitch_text = _pitch_blob(pitch)
    budget = pitch.budget_band or "mid"

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
            "risk_objective (string), slate_objective (string), "
            "comp_queries (string[3]), market_queries (string[3]), "
            "risk_queries (string[3]), slate_queries (string[3]). "
            "Slate objectives should target titles in development, "
            "franchise/IP collisions, and overlapping announcements."
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

    _emit(
        on_step,
        StepEvent(
            step="research_comps",
            status="started",
            message="Searching comparable titles via Parallel",
        ),
    )
    comp_hits = search_web(
        objective=framing.get("comp_objective")
        or f"Comparable films/series for a {budget}-budget {pitch.genre or 'feature'}: {pitch.title}",
        search_queries=framing.get("comp_queries")
        or [
            f"{pitch.title} similar movies",
            f"{pitch.genre or 'thriller'} {budget} budget film comps",
            " ".join(pitch.comparable_hints[:2]) + " box office"
            if pitch.comparable_hints
            else f"{pitch.genre} streaming hits",
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

    _emit(
        on_step,
        StepEvent(
            step="research_market",
            status="started",
            message="Searching market and audience timing via Parallel",
        ),
    )
    market_hits = search_web(
        objective=framing.get("market_objective")
        or f"Current market demand for {budget}-budget {pitch.genre or 'this genre'} features/series",
        search_queries=framing.get("market_queries")
        or [
            f"{pitch.genre or 'sci-fi'} film market 2025 2026",
            f"{pitch.format or 'feature'} streaming trends {budget}",
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

    _emit(
        on_step,
        StepEvent(
            step="research_risks",
            status="started",
            message="Searching IP / risk cues via Parallel",
        ),
    )
    risk_hits = search_web(
        objective=framing.get("risk_objective")
        or f"Production and clearance risk signals for: {pitch.logline[:240]}",
        search_queries=framing.get("risk_queries")
        or [
            f"{pitch.title} trademark film",
            f"films like {pitch.comparable_hints[0]}"
            if pitch.comparable_hints
            else f"{pitch.genre} saturation",
            "film production risk budget overrun",
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

    _emit(
        on_step,
        StepEvent(
            step="research_slate",
            status="started",
            message="Searching development slate & IP collisions via Parallel",
        ),
    )
    slate_hits = search_web(
        objective=framing.get("slate_objective")
        or (
            f"Titles in development, franchise/IP collisions, and overlapping announcements "
            f"similar to: {pitch.title} — {pitch.logline[:180]}"
        ),
        search_queries=framing.get("slate_queries")
        or [
            f"{pitch.genre or 'sci-fi'} film in development 2025 2026",
            f"{pitch.comparable_hints[0]} franchise sequel announced"
            if pitch.comparable_hints
            else f"{pitch.genre or 'thriller'} similar movies announced",
            f"{pitch.title} development slate collision",
        ],
    )
    all_sources.extend(_sources_from_hits(slate_hits, "research_slate"))
    _emit(
        on_step,
        StepEvent(
            step="research_slate",
            status="completed",
            message=f"Found {len(slate_hits)} Parallel Search hits for slate/IP",
            data={"hit_count": len(slate_hits), "top": [h.model_dump() for h in slate_hits[:3]]},
        ),
    )

    _emit(
        on_step,
        StepEvent(
            step="compose_brief",
            status="started",
            message="Synthesizing Decision Packet with Gemini",
        ),
    )
    research_pack = (
        f"PITCH\n{pitch_text}\n\n"
        f"BUDGET BAND (must weight recommendation): {budget}\n\n"
        f"FRAMING\n{json.dumps(framing, indent=2)}\n\n"
        f"COMPS RESEARCH (Parallel Search)\n{hits_to_text(comp_hits)}\n\n"
        f"MARKET RESEARCH (Parallel Search)\n{hits_to_text(market_hits)}\n\n"
        f"RISK RESEARCH (Parallel Search)\n{hits_to_text(risk_hits)}\n\n"
        f"SLATE / IP COLLISION RESEARCH (Parallel Search)\n{hits_to_text(slate_hits)}\n"
    )

    brief_json = generate_json(
        (
            "Using ONLY the research pack below, produce a studio greenlight Decision Packet.\n"
            f'Weight recommendation against budget band "{budget}".\n'
            "Return JSON with keys:\n"
            "recommendation: one of greenlight | develop_further | pass\n"
            "confidence: number 0-1\n"
            "summary: 2-4 sentences\n"
            "comps: string[]\n"
            "market_signals: string[]\n"
            "risk_flags: string[]\n"
            "diligence_questions: string[]\n"
            "scorecard: { market_timing, comp_fit, risk_level, originality } each 0-100 "
            "(risk_level higher = more risk)\n"
            "comp_table: [{ title, why, signal }]\n"
            "monday_memo: 6-8 sentence executive memo for Monday greenlight meeting\n\n"
            f"{research_pack}"
        ),
        system=SYSTEM,
    )

    scorecard = _parse_scorecard(brief_json.get("scorecard"))
    comp_table = _parse_comp_table(brief_json.get("comp_table"))
    monday_memo = str(brief_json.get("monday_memo") or brief_json.get("summary") or "")

    markdown = generate_text(
        (
            "Write a polished Greenlight Decision Packet in markdown for producers. "
            "Include: Recommendation, Scorecard, Why, Comp Table, Market, Risks, Slate/IP, "
            "Diligence Checklist, Monday Memo, Sources (use research URLs only). "
            "Do not invent sources.\n\n"
            f"STRUCTURED:\n{json.dumps(brief_json, indent=2)}\n\n"
            f"SOURCES:\n{json.dumps([s.model_dump() for s in all_sources[:24]], indent=2)}"
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
        scorecard=scorecard,
        monday_memo=monday_memo,
        comp_table=comp_table,
        sources=all_sources,
        markdown=markdown,
    )

    _emit(
        on_step,
        StepEvent(
            step="compose_brief",
            status="completed",
            message=f"Decision Packet ready — {brief.recommendation}",
            data={"recommendation": brief.recommendation, "confidence": brief.confidence},
        ),
    )
    return brief


async def stream_greenlight_pipeline(pitch: PitchRequest) -> AsyncIterator[dict[str, Any]]:
    """Yield SSE-friendly dicts for each step, then the final brief."""
    import asyncio

    queue: list[StepEvent] = []

    def on_step(event: StepEvent) -> None:
        queue.append(event)

    loop = asyncio.get_event_loop()
    result_holder: dict[str, Any] = {}

    def _run() -> GreenlightBrief:
        brief = run_greenlight_pipeline(pitch, on_step=on_step)
        result_holder["brief"] = brief
        return brief

    task = loop.run_in_executor(None, _run)
    last_idx = 0
    while not task.done():
        while last_idx < len(queue):
            yield {"type": "step", "payload": queue[last_idx].model_dump()}
            last_idx += 1
        await asyncio.sleep(0.05)

    await task
    while last_idx < len(queue):
        yield {"type": "step", "payload": queue[last_idx].model_dump()}
        last_idx += 1

    brief: GreenlightBrief = result_holder["brief"]
    yield {"type": "brief", "payload": brief.model_dump()}
