from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class PitchRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    logline: str = Field(..., min_length=10, max_length=4000)
    genre: str | None = None
    budget_band: Literal["micro", "indie", "mid", "studio"] | None = None
    format: Literal["feature", "limited series", "series", "short"] | None = None
    comparable_hints: list[str] = Field(default_factory=list)
    extra_context: str | None = None


class SourceCitation(BaseModel):
    title: str
    url: str
    excerpt: str | None = None
    step: str | None = None


class ResearchHit(BaseModel):
    title: str
    url: str
    excerpts: list[str] = Field(default_factory=list)


class StepEvent(BaseModel):
    step: str
    status: Literal["started", "completed", "error"]
    message: str
    data: dict[str, Any] | None = None


class GreenlightBrief(BaseModel):
    title: str
    recommendation: Literal["greenlight", "develop_further", "pass"]
    confidence: float = Field(..., ge=0.0, le=1.0)
    summary: str
    comps: list[str] = Field(default_factory=list)
    market_signals: list[str] = Field(default_factory=list)
    risk_flags: list[str] = Field(default_factory=list)
    diligence_questions: list[str] = Field(default_factory=list)
    sources: list[SourceCitation] = Field(default_factory=list)
    markdown: str
