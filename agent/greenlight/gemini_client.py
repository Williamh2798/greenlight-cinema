"""Gemini client via Google Gen AI SDK (Vertex or API key)."""

from __future__ import annotations

import json
import os
import re
from typing import Any

from google import genai
from google.genai import types


def get_genai_client() -> genai.Client:
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "tendlife-1af7d")
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
    use_vertex = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "true").lower() in {
        "1",
        "true",
        "yes",
    }

    if use_vertex:
        return genai.Client(vertexai=True, project=project, location=location)

    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        # Fall back to Vertex with ADC even if flag unset.
        return genai.Client(vertexai=True, project=project, location=location)
    return genai.Client(api_key=api_key)


def model_id() -> str:
    return os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")


def generate_json(prompt: str, *, system: str | None = None) -> dict[str, Any]:
    client = get_genai_client()
    contents = prompt
    config = types.GenerateContentConfig(
        temperature=0.3,
        response_mime_type="application/json",
        system_instruction=system,
    )
    response = client.models.generate_content(
        model=model_id(),
        contents=contents,
        config=config,
    )
    text = (response.text or "").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            raise
        return json.loads(match.group(0))


def generate_text(prompt: str, *, system: str | None = None) -> str:
    client = get_genai_client()
    config = types.GenerateContentConfig(
        temperature=0.4,
        system_instruction=system,
    )
    response = client.models.generate_content(
        model=model_id(),
        contents=prompt,
        config=config,
    )
    return (response.text or "").strip()
