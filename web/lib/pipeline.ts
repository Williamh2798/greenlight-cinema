import { generateJson } from "./gemini";
import { hitsToText, searchWeb } from "./parallel";
import type {
  CompRow,
  GreenlightBrief,
  PitchRequest,
  Scorecard,
  SourceCitation,
  StepEvent,
} from "./types";

const SYSTEM =
  "You are Greenlight, a studio development analyst. Be specific, cite only provided sources, and avoid inventing URLs. Write for producers and creative executives. Always weigh the pitch against its stated budget band.";

function pitchBlob(pitch: PitchRequest): string {
  const hints = pitch.comparable_hints?.length
    ? pitch.comparable_hints.join(", ")
    : "none";
  return [
    `Title: ${pitch.title}`,
    `Logline: ${pitch.logline}`,
    `Genre: ${pitch.genre || "unspecified"}`,
    `Budget band: ${pitch.budget_band || "unspecified"}`,
    `Format: ${pitch.format || "unspecified"}`,
    `Comparable hints: ${hints}`,
    `Extra context: ${pitch.extra_context || "none"}`,
  ].join("\n");
}

function sourcesFromHits(
  hits: Awaited<ReturnType<typeof searchWeb>>,
  step: string,
): SourceCitation[] {
  return hits.slice(0, 10).map((hit) => ({
    title: hit.title,
    url: hit.url,
    excerpt: hit.excerpts.join(" ").slice(0, 400) || null,
    step,
  }));
}

function clampScore(n: unknown, fallback = 50): number {
  const v = Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.max(0, Math.min(100, v));
}

function parseScorecard(raw: unknown): Scorecard {
  const s = (raw || {}) as Record<string, unknown>;
  return {
    market_timing: clampScore(s.market_timing),
    comp_fit: clampScore(s.comp_fit),
    risk_level: clampScore(s.risk_level),
    originality: clampScore(s.originality),
  };
}

function parseCompTable(raw: unknown): CompRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        title: String(r.title || ""),
        why: String(r.why || ""),
        signal: String(r.signal || ""),
      };
    })
    .filter((r) => r.title);
}

function buildMarkdownPacket(input: {
  title: string;
  recommendation: string;
  confidence: number;
  summary: string;
  scorecard: Scorecard;
  compTable: CompRow[];
  marketSignals: string[];
  riskFlags: string[];
  diligenceQuestions: string[];
  mondayMemo: string;
  sources: SourceCitation[];
}): string {
  const conf = Math.round(
    Math.max(0, Math.min(1, input.confidence || 0)) * 100,
  );
  const comps = input.compTable
    .map((c) => `- **${c.title}** — ${c.why} (${c.signal})`)
    .join("\n");
  const markets = input.marketSignals.map((s) => `- ${s}`).join("\n");
  const risks = input.riskFlags.map((s) => `- ${s}`).join("\n");
  const qs = input.diligenceQuestions.map((s) => `- ${s}`).join("\n");
  const sources = input.sources
    .map((s) => `- [${s.title}](${s.url}) (${s.step})`)
    .join("\n");

  return [
    `# Greenlight Decision Packet — ${input.title}`,
    "",
    `## Recommendation: ${input.recommendation.replace("_", " ")} (${conf}% confidence)`,
    "",
    input.summary,
    "",
    "## Scorecard",
    `- Market timing: ${input.scorecard.market_timing}`,
    `- Comp fit: ${input.scorecard.comp_fit}`,
    `- Risk heat: ${input.scorecard.risk_level}`,
    `- Originality: ${input.scorecard.originality}`,
    "",
    "## Comp table",
    comps || "- n/a",
    "",
    "## Market",
    markets || "- n/a",
    "",
    "## Risks",
    risks || "- n/a",
    "",
    "## Diligence questions",
    qs || "- n/a",
    "",
    "## Monday memo",
    input.mondayMemo,
    "",
    "## Sources",
    sources || "- n/a",
  ].join("\n");
}

export async function* streamGreenlightPipeline(
  pitch: PitchRequest,
): AsyncGenerator<{ type: "step" | "brief"; payload: StepEvent | GreenlightBrief }> {
  const allSources: SourceCitation[] = [];
  const pitchText = pitchBlob(pitch);
  const budget = pitch.budget_band || "mid";

  yield {
    type: "step",
    payload: {
      step: "parse_pitch",
      status: "started",
      message: "Framing the pitch for research objectives",
    },
  };

  const framing = await generateJson(
    `Extract research objectives for a studio greenlight diligence process.\n${pitchText}\n\nReturn JSON with keys: themes (string[]), audience (string), comp_objective (string), market_objective (string), risk_objective (string), slate_objective (string), comp_queries (string[3]), market_queries (string[3]), risk_queries (string[3]), slate_queries (string[3]). Slate objectives should target titles in development, franchise/IP collisions, and overlapping announcements.`,
    SYSTEM,
  );

  yield {
    type: "step",
    payload: {
      step: "parse_pitch",
      status: "completed",
      message: "Pitch framed",
      data: {
        themes: framing.themes,
        audience: framing.audience,
      },
    },
  };

  // --- comps ---
  yield {
    type: "step",
    payload: {
      step: "research_comps",
      status: "started",
      message: "Searching comparable titles via Parallel Search API",
    },
  };

  const compQueries = (framing.comp_queries as string[]) || [
    `${pitch.title} similar movies`,
    `${pitch.genre || "thriller"} ${budget} budget film comps`,
    pitch.comparable_hints?.length
      ? `${pitch.comparable_hints.slice(0, 2).join(" ")} box office`
      : `${pitch.genre || "drama"} streaming hits`,
  ];
  const compHits = await searchWeb(
    (framing.comp_objective as string) ||
      `Comparable films/series and box-office/critical performance for a ${budget}-budget ${pitch.genre || "feature"}: ${pitch.title}`,
    compQueries,
  );
  allSources.push(...sourcesFromHits(compHits, "research_comps"));

  yield {
    type: "step",
    payload: {
      step: "research_comps",
      status: "completed",
      message: `Found ${compHits.length} Parallel Search hits for comps`,
      data: { hit_count: compHits.length, top: compHits.slice(0, 3) },
    },
  };

  // --- market ---
  yield {
    type: "step",
    payload: {
      step: "research_market",
      status: "started",
      message: "Searching market and audience timing via Parallel Search API",
    },
  };

  const marketQueries = (framing.market_queries as string[]) || [
    `${pitch.genre || "sci-fi"} film market 2025 2026`,
    `${pitch.format || "feature"} streaming trends ${budget}`,
    `audience demand ${(framing.audience as string) || pitch.genre || "adult drama"}`,
  ];
  const marketHits = await searchWeb(
    (framing.market_objective as string) ||
      `Current market demand and audience appetite for ${budget}-budget ${pitch.genre || "this genre"} features/series`,
    marketQueries,
  );
  allSources.push(...sourcesFromHits(marketHits, "research_market"));

  yield {
    type: "step",
    payload: {
      step: "research_market",
      status: "completed",
      message: `Found ${marketHits.length} Parallel Search hits for market`,
      data: { hit_count: marketHits.length, top: marketHits.slice(0, 3) },
    },
  };

  // --- risks ---
  yield {
    type: "step",
    payload: {
      step: "research_risks",
      status: "started",
      message: "Searching IP / risk cues via Parallel Search API",
    },
  };

  const riskQueries = (framing.risk_queries as string[]) || [
    `${pitch.title} trademark film`,
    pitch.comparable_hints?.[0]
      ? `films like ${pitch.comparable_hints[0]}`
      : `${pitch.genre || "thriller"} saturation`,
    "film production risk budget overrun",
  ];
  const riskHits = await searchWeb(
    (framing.risk_objective as string) ||
      `Production, clearance, and execution risk signals for: ${pitch.logline.slice(0, 240)}`,
    riskQueries,
  );
  allSources.push(...sourcesFromHits(riskHits, "research_risks"));

  yield {
    type: "step",
    payload: {
      step: "research_risks",
      status: "completed",
      message: `Found ${riskHits.length} Parallel Search hits for risks`,
      data: { hit_count: riskHits.length, top: riskHits.slice(0, 3) },
    },
  };

  // --- slate / IP collision ---
  yield {
    type: "step",
    payload: {
      step: "research_slate",
      status: "started",
      message: "Searching development slate & IP collisions via Parallel",
    },
  };

  const slateQueries = (framing.slate_queries as string[]) || [
    `${pitch.genre || "sci-fi"} film in development 2025 2026`,
    pitch.comparable_hints?.[0]
      ? `${pitch.comparable_hints[0]} franchise sequel announced`
      : `${pitch.genre || "thriller"} similar movies announced`,
    `${pitch.title} development slate collision`,
  ];
  const slateHits = await searchWeb(
    (framing.slate_objective as string) ||
      `Titles in development, franchise/IP collisions, and overlapping announcements similar to: ${pitch.title} — ${pitch.logline.slice(0, 180)}`,
    slateQueries,
  );
  allSources.push(...sourcesFromHits(slateHits, "research_slate"));

  yield {
    type: "step",
    payload: {
      step: "research_slate",
      status: "completed",
      message: `Found ${slateHits.length} Parallel Search hits for slate/IP`,
      data: { hit_count: slateHits.length, top: slateHits.slice(0, 3) },
    },
  };

  // --- compose ---
  yield {
    type: "step",
    payload: {
      step: "compose_brief",
      status: "started",
      message: "Synthesizing Decision Packet with Gemini",
    },
  };

  // Keep research pack compact so the JSON response is not truncated.
  const researchPack = [
    `PITCH\n${pitchText}`,
    `BUDGET BAND: ${budget}`,
    `AUDIENCE/THEMES: ${JSON.stringify({
      themes: framing.themes,
      audience: framing.audience,
    })}`,
    `COMPS\n${hitsToText(compHits, 4)}`,
    `MARKET\n${hitsToText(marketHits, 4)}`,
    `RISKS\n${hitsToText(riskHits, 4)}`,
    `SLATE/IP\n${hitsToText(slateHits, 4)}`,
  ].join("\n\n");

  const briefJson = await generateJson(
    `Produce a studio greenlight Decision Packet as ONE complete JSON object.
Weight recommendation against budget band "${budget}".
Keep all strings concise. monday_memo max 4 short sentences.
Required keys:
recommendation: "greenlight"|"develop_further"|"pass"
confidence: number 0-1
summary: string (max 2 sentences)
comps: string[] (max 4)
market_signals: string[] (max 4)
risk_flags: string[] (max 4)
diligence_questions: string[] (max 4)
scorecard: {market_timing,comp_fit,risk_level,originality} numbers 0-100
comp_table: [{title,why,signal}] max 3 rows, short strings
monday_memo: string

Research:
${researchPack}`,
    SYSTEM,
  );

  const scorecard = parseScorecard(briefJson.scorecard);
  const compTable = parseCompTable(briefJson.comp_table);
  const mondayMemo = String(briefJson.monday_memo || briefJson.summary || "");

  const markdown = buildMarkdownPacket({
    title: pitch.title,
    recommendation: String(briefJson.recommendation || "develop_further"),
    confidence: Number(briefJson.confidence ?? 0.5),
    summary: String(briefJson.summary || ""),
    scorecard,
    compTable,
    marketSignals: ((briefJson.market_signals as string[]) || []).map(String),
    riskFlags: ((briefJson.risk_flags as string[]) || []).map(String),
    diligenceQuestions: ((briefJson.diligence_questions as string[]) || []).map(
      String,
    ),
    mondayMemo,
    sources: allSources.slice(0, 16),
  });

  let recommendation = String(briefJson.recommendation || "develop_further");
  if (!["greenlight", "develop_further", "pass"].includes(recommendation)) {
    recommendation = "develop_further";
  }
  let confidence = Number(briefJson.confidence ?? 0.5);
  if (Number.isNaN(confidence)) confidence = 0.5;
  confidence = Math.max(0, Math.min(1, confidence));

  const brief: GreenlightBrief = {
    title: pitch.title,
    recommendation: recommendation as GreenlightBrief["recommendation"],
    confidence,
    summary: String(briefJson.summary || ""),
    comps: ((briefJson.comps as string[]) || []).map(String),
    market_signals: ((briefJson.market_signals as string[]) || []).map(String),
    risk_flags: ((briefJson.risk_flags as string[]) || []).map(String),
    diligence_questions: ((briefJson.diligence_questions as string[]) || []).map(
      String,
    ),
    scorecard,
    monday_memo: mondayMemo,
    comp_table: compTable,
    sources: allSources,
    markdown,
  };

  yield {
    type: "step",
    payload: {
      step: "compose_brief",
      status: "completed",
      message: `Decision Packet ready — ${brief.recommendation}`,
      data: {
        recommendation: brief.recommendation,
        confidence: brief.confidence,
      },
    },
  };

  yield { type: "brief", payload: brief };
}
