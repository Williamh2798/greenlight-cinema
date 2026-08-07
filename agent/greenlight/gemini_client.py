"""Gemini client via Google Gen AI SDK (Vertex or API key)."""

from __future__ import annotations

import json
import os
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


def parse_json_object(text: str) -> dict[str, Any]:
    """Parse the first balanced JSON object; tolerate trailing model junk."""
    trimmed = (text or "").strip()
    if not trimmed:
        raise ValueError("Gemini returned empty JSON")

    try:
        data = json.loads(trimmed)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass

    start = trimmed.find("{")
    if start < 0:
        raise ValueError("Gemini did not return JSON")

    depth = 0
    in_string = False
    escaped = False
    for i in range(start, len(trimmed)):
        ch = trimmed[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                data = json.loads(trimmed[start : i + 1])
                if not isinstance(data, dict):
                    raise ValueError("Gemini JSON was not an object")
                return data

    raise ValueError("Gemini returned incomplete JSON")


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
    return parse_json_object(response.text or "")


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
