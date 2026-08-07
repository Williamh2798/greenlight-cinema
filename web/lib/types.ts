export type PitchRequest = {
  title: string;
  logline: string;
  genre?: string | null;
  budget_band?: "micro" | "indie" | "mid" | "studio" | null;
  format?: "feature" | "limited series" | "series" | "short" | null;
  comparable_hints?: string[];
  extra_context?: string | null;
};

export type SourceCitation = {
  title: string;
  url: string;
  excerpt?: string | null;
  step?: string | null;
};

export type ResearchHit = {
  title: string;
  url: string;
  excerpts: string[];
};

export type StepEvent = {
  step: string;
  status: "started" | "completed" | "error";
  message: string;
  data?: Record<string, unknown> | null;
};

export type GreenlightBrief = {
  title: string;
  recommendation: "greenlight" | "develop_further" | "pass";
  confidence: number;
  summary: string;
  comps: string[];
  market_signals: string[];
  risk_flags: string[];
  diligence_questions: string[];
  sources: SourceCitation[];
  markdown: string;
};
