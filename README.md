# Greenlight

**Agentic Cinema · Parallel Track**

Turn a film/TV pitch into a cited go/no-go **Greenlight Brief** using **Gemini on Google Cloud** and **Parallel Search** at runtime.

Producers paste a logline. A multi-step agent:

1. Frames the pitch  
2. Searches comparable titles (Parallel Search API)  
3. Searches market / audience timing (Parallel Search API)  
4. Searches IP / risk cues (Parallel Search API)  
5. Synthesizes a recommendation with sources via Gemini  

## Stack (rules-compliant)

| Layer | Tech |
|-------|------|
| AI | Vertex AI Gemini via `google-genai` + Google ADK (`google-adk`, `parallel-google-adk`) |
| Partner | Parallel Search via official `parallel-web` SDK (`client.search(...)`) |
| API | FastAPI + SSE step streaming |
| Web | Next.js |
| Hosting | Cloud Run + Secret Manager |

No non-Google AI models or agent frameworks are used.

## Repository layout

```
agent/          FastAPI + pipeline + ADK agent
web/            Next.js producer UI
deploy/         Docker + Cloud Run deploy scripts
demo/           Sample pitches, demo script, Devpost draft
LICENSE         Apache-2.0
```

## Quick start (local)

### Prerequisites

- Python 3.11+
- Node 20+
- `PARALLEL_API_KEY` from [platform.parallel.ai](https://platform.parallel.ai)
- Google Cloud auth: `gcloud auth application-default login`
- Project with Vertex AI enabled (default: `tendlife-1af7d`)

### API

```bash
cp .env.example .env
# fill PARALLEL_API_KEY and project settings

cd agent
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Prove Parallel Search is called at runtime
python smoke_parallel.py

uvicorn main:app --reload --port 8080
```

### Web

```bash
cd web
npm install
export NEXT_PUBLIC_API_BASE=http://localhost:8080
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

### Hosted web (Vercel) — recommended when Cloud Billing is unavailable

The Next.js app includes `/api/brief/stream` that calls **Gemini** (`@google/genai`) and **Parallel Search** (`parallel-web`) at runtime.

```bash
cd web
vercel link   # once
vercel env add GOOGLE_API_KEY
vercel env add PARALLEL_API_KEY
vercel --prod
```

Python FastAPI + ADK under `agent/` remains the Cloud Run path and smoke-testable locally.

### Cloud Run (requires GCP billing)

```bash
export PARALLEL_API_KEY=...
export GOOGLE_CLOUD_PROJECT=your-project
export GOOGLE_CLOUD_LOCATION=us-central1
chmod +x deploy/deploy.sh
./deploy/deploy.sh
```

## Runtime Parallel usage (judging)

```python
# agent/greenlight/parallel_search.py
from parallel import Parallel
client = Parallel(api_key=os.environ["PARALLEL_API_KEY"])
response = client.search(objective=..., search_queries=...)
```

ADK tools from `parallel_google_adk` (`web_search`, `deep_research`, …) are also attached in `agent/greenlight/agent.py`.

## Demo & submission

- Demo script: [`demo/DEMO_SCRIPT.md`](demo/DEMO_SCRIPT.md)  
- Devpost draft: [`demo/DEVPOST.md`](demo/DEVPOST.md)  
- Sample pitches: [`demo/sample-pitches.json`](demo/sample-pitches.json)

## License

Apache License 2.0 — see [`LICENSE`](LICENSE).
