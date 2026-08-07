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
        return genai.Client(vertexai=True, project=project, location=location)
    return genai.Client(api_key=api_key)


def model_id() -> str:
    return os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")


def _strip_fences(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.removeprefix("```json").removeprefix("```JSON").removeprefix("```")
        t = t.removesuffix("```").strip()
    return t.strip()


def parse_json_object(text: str) -> dict[str, Any]:
    """Parse the first balanced JSON object; tolerate trailing/truncated junk."""
    trimmed = _strip_fences(text)
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

    raise ValueError(
        f"Gemini returned incomplete JSON ({len(trimmed)} chars, unclosed braces)"
    )


def generate_json(prompt: str, *, system: str | None = None, retries: int = 2) -> dict[str, Any]:
    client = get_genai_client()
    last_error: Exception | None = None

    for attempt in range(retries + 1):
        contents = prompt
        if attempt > 0:
            contents = (
                f"{prompt}\n\nIMPORTANT: Reply with one complete JSON object only. "
                "Keep strings short. Do not truncate."
            )
        config = types.GenerateContentConfig(
            temperature=0.25 if attempt == 0 else 0.1,
            response_mime_type="application/json",
            system_instruction=system,
            max_output_tokens=8192,
        )
        try:
            response = client.models.generate_content(
                model=model_id(),
                contents=contents,
                config=config,
            )
            return parse_json_object(response.text or "")
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            msg = str(exc)
            if "incomplete JSON" not in msg and "JSON" not in msg:
                raise

    assert last_error is not None
    raise last_error


def generate_text(prompt: str, *, system: str | None = None) -> str:
    client = get_genai_client()
    config = types.GenerateContentConfig(
        temperature=0.4,
        system_instruction=system,
        max_output_tokens=4096,
    )
    response = client.models.generate_content(
        model=model_id(),
        contents=prompt,
        config=config,
    )
    return (response.text or "").strip()
