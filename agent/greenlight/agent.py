"""Google ADK agent wired to Parallel Search tools (Parallel track compliance)."""

from __future__ import annotations

from google.adk.agents import LlmAgent

from parallel_google_adk import deep_research, extract, web_fetch, web_search

from .parallel_search import search_web


def parallel_comp_search(objective: str, query_a: str, query_b: str, query_c: str) -> str:
    """ADK tool: Parallel Search API for comparable-title research."""
    hits = search_web(objective, [query_a, query_b, query_c])
    lines = []
    for h in hits[:8]:
        excerpt = " ".join(h.excerpts)[:400]
        lines.append(f"{h.title} | {h.url} | {excerpt}")
    return "\n".join(lines) or "No Parallel Search results."


INSTRUCTION = """
You are Greenlight, a studio development research agent for filmmakers and producers.

For every pitch:
1) Clarify themes, audience, and research objectives.
2) Use Parallel web_search / parallel_comp_search to gather comparable titles.
3) Use Parallel tools again for market timing and audience demand.
4) Use Parallel tools for IP / clearance / execution risk signals.
5) Produce a Greenlight Brief with: recommendation (greenlight | develop_further | pass),
   confidence, comps, market signals, risk flags, diligence questions, and cited URLs.

Never invent URLs. Prefer Parallel Search results as your evidence base.
"""


def build_greenlight_agent(model: str = "gemini-2.5-flash") -> LlmAgent:
    """Create the ADK LlmAgent with Parallel tools imported and attached."""
    return LlmAgent(
        model=model,
        name="greenlight_agent",
        description=(
            "Multi-step greenlight diligence agent using Gemini and Parallel Search "
            "for comps, market, and risk research."
        ),
        instruction=INSTRUCTION.strip(),
        tools=[
            web_search,
            web_fetch,
            extract,
            deep_research,
            parallel_comp_search,
        ],
    )


# Default root agent for `adk` CLI / Agent Engine packaging.
root_agent = build_greenlight_agent()
