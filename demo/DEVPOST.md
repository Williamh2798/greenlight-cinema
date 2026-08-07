# Devpost Submission Draft — Parallel Track

## Project name

**Greenlight**

## Tagline

Cited studio diligence: a Gemini agent that researches comps, market, and risk with Parallel Search before you greenlight.

## Partner track

**Parallel**

## Elevator / description

Pre-greenlight research is still tribal knowledge and browser tabs. Development executives need a defensible brief — comps, audience timing, and IP/execution risk — before a meeting, not after.

**Greenlight** is a web product for producers and creative executives. Paste a pitch. A multi-step Gemini agent (Google ADK / Vertex AI) runs Parallel Search three times for comps, market, and risks, then synthesizes a Greenlight Brief: recommendation, confidence, risk flags, diligence questions, and cited sources.

## Technologies used

- Google Cloud: Vertex AI Gemini, Agent Development Kit (`google-adk`), Cloud Run, Secret Manager
- Parallel: Search API via official `parallel-web` SDK + `parallel-google-adk` tools
- Next.js web UI, FastAPI SSE streaming

## Built with (checklist language)

- Runtime Parallel Search: `from parallel import Parallel` → `client.search(...)` in `agent/greenlight/parallel_search.py`
- Google AI: `google-genai` + `google-adk` (no non-Google AI models)
- Hosted on Cloud Run (web + API)

## Findings / learnings

1. Parallel Search works best when each diligence step has a distinct **objective** and 3 focused queries — not one mega-search.
2. Streaming step events made the product feel production-ready for demos and for producers who want auditability.
3. Constraining synthesis to provided Parallel URLs prevents hallucinated citations — critical for a diligence tool.

## Links to fill at submit time

- Hosted Project URL: _(after `deploy/deploy.sh`)_
- Demo video: _(YouTube/Vimeo)_
- Repo: _(public GitHub with Apache-2.0)_
