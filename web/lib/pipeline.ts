import { generateJson, generateText } from "./gemini";
import { hitsToText, searchWeb } from "./parallel";
import type {
  GreenlightBrief,
  PitchRequest,
  SourceCitation,
  StepEvent,
} from "./types";

const SYSTEM =
  "You are Greenlight, a studio development analyst. Be specific, cite only provided sources, and avoid inventing URLs. Write for producers and creative executives.";

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

export async function* streamGreenlightPipeline(
  pitch: PitchRequest,
): AsyncGenerator<{ type: "step" | "brief"; payload: StepEvent | GreenlightBrief }> {
  const allSources: SourceCitation[] = [];
  const pitchText = pitchBlob(pitch);

  yield {
    type: "step",
    payload: {
      step: "parse_pitch",
      status: "started",
      message: "Framing the pitch for research objectives",
    },
  };

  const framing = await generateJson(
    `Extract research objectives for a studio greenlight diligence process.\n${pitchText}\n\nReturn JSON with keys: themes (string[]), audience (string), comp_objective (string), market_objective (string), risk_objective (string), comp_queries (string[3]), market_queries (string[3]), risk_queries (string[3]).`,
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
    `${pitch.genre || "thriller"} film box office comps`,
    pitch.comparable_hints?.length
      ? `${pitch.comparable_hints.slice(0, 2).join(" ")} box office`
      : `${pitch.genre || "drama"} streaming hits`,
  ];
  const compHits = await searchWeb(
    (framing.comp_objective as string) ||
      `Comparable films/series and box-office/critical performance for: ${pitch.title}`,
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
    `${pitch.format || "feature"} streaming trends`,
    `audience demand ${(framing.audience as string) || pitch.genre || "adult drama"}`,
  ];
  const marketHits = await searchWeb(
    (framing.market_objective as string) ||
      `Current market demand and audience appetite for ${pitch.genre || "this genre"} features/series`,
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
    "film development slate controversy risk",
  ];
  const riskHits = await searchWeb(
    (framing.risk_objective as string) ||
      `Potential IP conflicts, similar titles in development, and production risk signals related to: ${pitch.logline.slice(0, 240)}`,
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

  yield {
    type: "step",
    payload: {
      step: "compose_brief",
      status: "started",
      message: "Synthesizing Greenlight Brief with Gemini",
    },
  };

  const researchPack = [
    `PITCH\n${pitchText}`,
    `FRAMING\n${JSON.stringify(framing, null, 2)}`,
    `COMPS RESEARCH (Parallel Search)\n${hitsToText(compHits)}`,
    `MARKET RESEARCH (Parallel Search)\n${hitsToText(marketHits)}`,
    `RISK RESEARCH (Parallel Search)\n${hitsToText(riskHits)}`,
  ].join("\n\n");

  const briefJson = await generateJson(
    `Using ONLY the research pack below, produce a studio greenlight brief.\nReturn JSON with keys:\nrecommendation: one of greenlight | develop_further | pass\nconfidence: number 0-1\nsummary: 2-4 sentences\ncomps: string[]\nmarket_signals: string[]\nrisk_flags: string[]\ndiligence_questions: string[]\n\n${researchPack}`,
    SYSTEM,
  );

  const markdown = await generateText(
    `Write a polished Greenlight Brief in markdown for producers. Include sections: Recommendation, Why, Comps, Market, Risks, Diligence Checklist, Sources (use the URLs from research). Do not invent sources.\n\nSTRUCTURED BRIEF:\n${JSON.stringify(briefJson, null, 2)}\n\nSOURCES:\n${JSON.stringify(allSources.slice(0, 18), null, 2)}`,
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
    sources: allSources,
    markdown,
  };

  yield {
    type: "step",
    payload: {
      step: "compose_brief",
      status: "completed",
      message: `Brief ready — recommendation: ${brief.recommendation}`,
      data: {
        recommendation: brief.recommendation,
        confidence: brief.confidence,
      },
    },
  };

  yield { type: "brief", payload: brief };
}
