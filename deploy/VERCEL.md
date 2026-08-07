# Vercel deploy notes

Hosted URL: https://greenlight-cinema.vercel.app

Project: `leadraa/greenlight-cinema` (linked from `web/`)

## Required env vars

| Name | Purpose |
|------|---------|
| `GOOGLE_API_KEY` | Gemini API (Google AI / Cloud) |
| `PARALLEL_API_KEY` | Parallel Search API |
| `GEMINI_MODEL` | optional, default `gemini-2.5-flash` |

```bash
cd web
printf '%s' "$PARALLEL_API_KEY" | vercel env add PARALLEL_API_KEY production
printf '%s' "$PARALLEL_API_KEY" | vercel env add PARALLEL_API_KEY preview --yes
vercel --prod
```

## Cloud Run

Blocked on `williamh2798@gmail.com` until a GCP billing account is linked. Use `deploy/deploy.sh` once billing is enabled on a project you own.
