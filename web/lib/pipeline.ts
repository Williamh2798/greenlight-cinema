import { generateJson, generateText } from "./gemini";
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

  const researchPack = [
    `PITCH\n${pitchText}`,
    `BUDGET BAND (must weight recommendation): ${budget}`,
    `FRAMING\n${JSON.stringify(framing, null, 2)}`,
    `COMPS RESEARCH (Parallel Search)\n${hitsToText(compHits)}`,
    `MARKET RESEARCH (Parallel Search)\n${hitsToText(marketHits)}`,
    `RISK RESEARCH (Parallel Search)\n${hitsToText(riskHits)}`,
    `SLATE / IP COLLISION RESEARCH (Parallel Search)\n${hitsToText(slateHits)}`,
  ].join("\n\n");

  const briefJson = await generateJson(
    `Using ONLY the research pack below, produce a studio greenlight Decision Packet.
Weight recommendation against budget band "${budget}".
Return JSON with keys:
recommendation: one of greenlight | develop_further | pass
confidence: number 0-1
summary: 2-4 sentences
comps: string[]
market_signals: string[]
risk_flags: string[]
diligence_questions: string[] (3-6)
scorecard: { market_timing: 0-100, comp_fit: 0-100, risk_level: 0-100 (higher = more risk), originality: 0-100 }
comp_table: [{ title, why, signal }] (3-5 rows; signal is short e.g. "strong theatrical" / "streaming saturated")
monday_memo: 6-8 sentence executive memo a producer would paste into Slack before Monday's greenlight meeting — decisive, cite themes from research, no invented URLs

${researchPack}`,
    SYSTEM,
  );

  const scorecard = parseScorecard(briefJson.scorecard);
  const compTable = parseCompTable(briefJson.comp_table);
  const mondayMemo = String(briefJson.monday_memo || briefJson.summary || "");

  const markdown = await generateText(
    `Write a polished Greenlight Decision Packet in markdown for producers. Include: Recommendation, Scorecard, Why, Comp Table, Market, Risks, Slate/IP, Diligence Checklist, Monday Memo, Sources (use research URLs only). Do not invent sources.\n\nSTRUCTURED:\n${JSON.stringify(briefJson, null, 2)}\n\nSOURCES:\n${JSON.stringify(allSources.slice(0, 24), null, 2)}`,
    SYSTEM,
  );

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
