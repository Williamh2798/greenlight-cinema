# Devpost Submission Draft — Parallel Track

## Project name

**Greenlight**

## Tagline

Cited studio diligence: a Gemini agent that researches comps, market, risk, and slate collisions with Parallel Search — then ships a Monday-ready Decision Packet.

## Partner track

**Parallel**

## Elevator / description

Pre-greenlight research is still tribal knowledge and browser tabs. Development executives need a **defensible decision packet** — not a chat transcript — before a greenlight meeting.

**Greenlight** is a web product for producers and creative executives. Paste a pitch and budget band. A multi-step Gemini agent (Google Cloud) runs Parallel Search across four lanes:

1. Comparable titles  
2. Market / audience timing  
3. Production & clearance risk  
4. **Development slate / franchise-IP collisions** (the entertainment-specific lane)

It returns a Decision Packet: recommendation, confidence, scorecard (market timing, comp fit, risk heat, originality), comp table, diligence questions, a paste-ready **Monday Memo**, and sources grouped by lane. Live Parallel evidence cards stream in as each step completes.

## Technologies used

- Google Cloud: Gemini (`@google/genai` / `google-genai`) + ADK agent path (`google-adk`, `parallel-google-adk`)
- Parallel: Search API via official `parallel-web` SDK at runtime
- Next.js Decision Packet UI + React Bits motion (Aurora, BlurText, SpotlightCard, CountUp)
- FastAPI SSE pipeline (Python) aligned with the hosted web API

## Built with (checklist language)

- Runtime Parallel Search: `client.search(...)` in `web/lib/parallel.ts` and `agent/greenlight/parallel_search.py`
- Google AI only — no OpenAI / Anthropic
- Hosted: https://greenlight-cinema.vercel.app

## Findings / learnings

1. Separate Parallel objectives per diligence lane beat one mega-search for citation quality.
2. Budget-band-aware synthesis changes recommendations for indie vs studio economics.
3. Streaming evidence + a Monday Memo makes the product feel like a studio tool, not a research chatbot.

## Links

- Hosted Project URL: https://greenlight-cinema.vercel.app
- Health: https://greenlight-cinema.vercel.app/api/health
- Repo: https://github.com/Williamh2798/greenlight-cinema (Apache-2.0)
- Demo video: _(record using demo/DEMO_SCRIPT.md)_
