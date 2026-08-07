"""Greenlight FastAPI service — Gemini ADK pipeline + Parallel Search."""

from __future__ import annotations

import json
import os
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from greenlight.pipeline import run_greenlight_pipeline, stream_greenlight_pipeline
from greenlight.schemas import PitchRequest

load_dotenv()

app = FastAPI(
    title="Greenlight",
    description=(
        "Studio greenlight research agent powered by Gemini (Google ADK / Gen AI) "
        "and Parallel Search API."
    ),
    version="0.1.0",
)

origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "greenlight",
        "parallel_key_configured": bool(os.environ.get("PARALLEL_API_KEY")),
        "project": os.environ.get("GOOGLE_CLOUD_PROJECT"),
        "model": os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
    }


@app.post("/brief")
def create_brief(pitch: PitchRequest) -> JSONResponse:
    try:
        brief = run_greenlight_pipeline(pitch)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Brief generation failed: {exc}") from exc
    return JSONResponse(brief.model_dump())


@app.post("/brief/stream")
async def create_brief_stream(pitch: PitchRequest) -> EventSourceResponse:
    async def event_generator():
        try:
            async for item in stream_greenlight_pipeline(pitch):
                yield {
                    "event": item["type"],
                    "data": json.dumps(item["payload"]),
                }
        except Exception as exc:  # noqa: BLE001
            yield {
                "event": "error",
                "data": json.dumps({"message": str(exc)}),
            }

    return EventSourceResponse(event_generator())


@app.get("/")
def root() -> dict[str, str]:
    return {
        "name": "Greenlight API",
        "docs": "/docs",
        "health": "/health",
        "brief": "POST /brief",
        "stream": "POST /brief/stream",
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
