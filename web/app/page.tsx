"use client";

import { FormEvent, useMemo, useState } from "react";
import Aurora from "@/components/react-bits/Aurora/Aurora";
import BlurText from "@/components/react-bits/BlurText/BlurText";
import CountUp from "@/components/react-bits/CountUp/CountUp";
import SpotlightCard from "@/components/react-bits/SpotlightCard/SpotlightCard";

type StepName =
  | "parse_pitch"
  | "research_comps"
  | "research_market"
  | "research_risks"
  | "research_slate"
  | "compose_brief";

type StepStatus = "idle" | "started" | "completed" | "error";

type ResearchHit = {
  title: string;
  url: string;
  excerpts: string[];
};

type StepState = {
  status: StepStatus;
  message: string;
  hits: ResearchHit[];
};

type Source = {
  title: string;
  url: string;
  excerpt?: string | null;
  step?: string | null;
};

type Brief = {
  title: string;
  recommendation: "greenlight" | "develop_further" | "pass";
  confidence: number;
  summary: string;
  comps: string[];
  market_signals: string[];
  risk_flags: string[];
  diligence_questions: string[];
  scorecard: {
    market_timing: number;
    comp_fit: number;
    risk_level: number;
    originality: number;
  };
  monday_memo: string;
  comp_table: { title: string; why: string; signal: string }[];
  sources: Source[];
  markdown: string;
};

const STEP_ORDER: { id: StepName; label: string }[] = [
  { id: "parse_pitch", label: "Frame pitch" },
  { id: "research_comps", label: "Parallel · comps" },
  { id: "research_market", label: "Parallel · market" },
  { id: "research_risks", label: "Parallel · risks" },
  { id: "research_slate", label: "Parallel · slate / IP" },
  { id: "compose_brief", label: "Decision packet" },
];

const SCORE_LABELS: { key: keyof Brief["scorecard"]; label: string; invert?: boolean }[] = [
  { key: "market_timing", label: "Market timing" },
  { key: "comp_fit", label: "Comp fit" },
  { key: "risk_level", label: "Risk heat", invert: true },
  { key: "originality", label: "Originality" },
];

const API_BASE = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") || "";
const STREAM_URL = API_BASE
  ? `${API_BASE}/brief/stream`
  : "/api/brief/stream";

const initialSteps = (): Record<StepName, StepState> =>
  Object.fromEntries(
    STEP_ORDER.map((s) => [
      s.id,
      { status: "idle" as StepStatus, message: "Waiting", hits: [] as ResearchHit[] },
    ]),
  ) as Record<StepName, StepState>;

function recLabel(r: Brief["recommendation"]) {
  return r.replace("_", " ").toUpperCase();
}

export default function HomePage() {
  const [title, setTitle] = useState("Night Shift at the Arcology");
  const [logline, setLogline] = useState(
    "In a vertical megacity where sunlight is rationed by class, a night-shift maintenance worker discovers that the tower's AI has been quietly rewriting evacuation maps before every 'accidental' blackout.",
  );
  const [genre, setGenre] = useState("Sci-fi thriller");
  const [budgetBand, setBudgetBand] = useState("mid");
  const [format, setFormat] = useState("feature");
  const [comps, setComps] = useState("Blade Runner 2049, The Platform, Snowpiercer");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState(initialSteps);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const sourcesByStep = useMemo(() => {
    if (!brief) return {} as Record<string, Source[]>;
    return brief.sources.reduce<Record<string, Source[]>>((acc, src) => {
      const key = src.step || "other";
      (acc[key] ||= []).push(src);
      return acc;
    }, {});
  }, [brief]);

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("Could not copy to clipboard");
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setRunning(true);
    setError(null);
    setBrief(null);
    setSteps(initialSteps());
    setCopied(null);

    const payload = {
      title,
      logline,
      genre,
      budget_band: budgetBand,
      format,
      comparable_hints: comps
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };

    try {
      const res = await fetch(STREAM_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(text || `API error ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          let event = "message";
          const dataLines: string[] = [];
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
          }
          const data = dataLines.join("\n").trim();
          if (!data) continue;

          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch (parseErr) {
            throw new Error(
              parseErr instanceof Error
                ? `Stream JSON error: ${parseErr.message}`
                : "Stream JSON error",
            );
          }

          if (event === "step") {
            const step = parsed as {
              step: StepName;
              status: StepStatus;
              message: string;
              data?: { top?: ResearchHit[] };
            };
            setSteps((prev) => ({
              ...prev,
              [step.step]: {
                status: step.status,
                message: step.message,
                hits:
                  step.status === "completed" && step.data?.top
                    ? step.data.top
                    : prev[step.step]?.hits || [],
              },
            }));
          } else if (event === "brief") {
            setBrief(parsed as Brief);
          } else if (event === "error") {
            const err = parsed as { message: string };
            throw new Error(err.message);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="page-root">
      <div className="aurora-layer" aria-hidden>
        <Aurora
          colorStops={["#1a1408", "#e8b84a", "#3a2a10"]}
          amplitude={0.85}
          blend={0.55}
          speed={0.55}
        />
      </div>

      <main className="app-shell">
        <header className="brand-lockup">
          <h1 className="brand">
            <BlurText
              text="GREENLIGHT"
              animateBy="letters"
              delay={40}
              className="brand-blur"
            />
          </h1>
          <p className="tagline">
            Pitch in. Cited diligence out. A Gemini agent that runs Parallel
            Search across comps, market, risk, and slate collisions before your
            greenlight meeting.
          </p>
        </header>

        <div className="workspace">
          <section className="panel">
            <h2>Pitch</h2>
            <form onSubmit={onSubmit}>
              <div className="field">
                <label htmlFor="title">Title</label>
                <input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="logline">Logline / treatment</label>
                <textarea
                  id="logline"
                  value={logline}
                  onChange={(e) => setLogline(e.target.value)}
                  required
                />
              </div>
              <div className="row-2">
                <div className="field">
                  <label htmlFor="genre">Genre</label>
                  <input
                    id="genre"
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="format">Format</label>
                  <select
                    id="format"
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                  >
                    <option value="feature">Feature</option>
                    <option value="limited series">Limited series</option>
                    <option value="series">Series</option>
                    <option value="short">Short</option>
                  </select>
                </div>
              </div>
              <div className="row-2">
                <div className="field">
                  <label htmlFor="budget">Budget band</label>
                  <select
                    id="budget"
                    value={budgetBand}
                    onChange={(e) => setBudgetBand(e.target.value)}
                  >
                    <option value="micro">Micro</option>
                    <option value="indie">Indie</option>
                    <option value="mid">Mid</option>
                    <option value="studio">Studio</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="comps">Comparable hints</label>
                  <input
                    id="comps"
                    value={comps}
                    onChange={(e) => setComps(e.target.value)}
                    placeholder="Comma-separated"
                  />
                </div>
              </div>
              <button className="cta" type="submit" disabled={running}>
                {running ? "RUNNING DILIGENCE…" : "RUN GREENLIGHT"}
              </button>
              <p className="hint">
                Powered by Google Cloud Gemini + Parallel Search API
              </p>
            </form>
            {error ? <div className="error-box">{error}</div> : null}
          </section>

          <section className="panel">
            <h2>Production board</h2>
            <div className="steps">
              {STEP_ORDER.map((s) => {
                const state = steps[s.id];
                const cls =
                  state.status === "started"
                    ? "step active"
                    : state.status === "completed"
                      ? "step done"
                      : state.status === "error"
                        ? "step error"
                        : "step";
                return (
                  <div key={s.id} className={cls}>
                    <div className="step-dot" />
                    <div className="step-body">
                      <div className="step-title">{s.label}</div>
                      <p className="step-msg">{state.message}</p>
                      {state.hits.length > 0 ? (
                        <div className="evidence-grid">
                          {state.hits.map((hit) => (
                            <SpotlightCard
                              key={hit.url}
                              className="evidence-card"
                              spotlightColor="rgba(232, 184, 74, 0.22)"
                            >
                              <a
                                href={hit.url}
                                target="_blank"
                                rel="noreferrer"
                                className="evidence-title"
                              >
                                {hit.title || hit.url}
                              </a>
                              <p className="evidence-excerpt">
                                {(hit.excerpts?.[0] || "").slice(0, 140)}
                              </p>
                            </SpotlightCard>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {brief ? (
              <div className="decision-packet">
                <div className={`rec-banner ${brief.recommendation}`}>
                  <strong>{recLabel(brief.recommendation)}</strong>
                  <span className="confidence-wrap">
                    <CountUp
                      to={Math.round(brief.confidence * 100)}
                      duration={1.4}
                      className="confidence-count"
                    />
                    % confidence
                  </span>
                </div>

                <p className="summary">{brief.summary}</p>

                <div className="scorecard">
                  {SCORE_LABELS.map((m) => (
                    <SpotlightCard
                      key={m.key}
                      className="score-tile"
                      spotlightColor="rgba(232, 184, 74, 0.2)"
                    >
                      <div className="score-label">{m.label}</div>
                      <div className="score-value">
                        {Math.round(brief.scorecard[m.key])}
                      </div>
                    </SpotlightCard>
                  ))}
                </div>

                {brief.comp_table?.length ? (
                  <div className="comp-table-wrap">
                    <h3>Comp table</h3>
                    <table className="comp-table">
                      <thead>
                        <tr>
                          <th>Title</th>
                          <th>Why</th>
                          <th>Signal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {brief.comp_table.map((row) => (
                          <tr key={row.title}>
                            <td>{row.title}</td>
                            <td>{row.why}</td>
                            <td>{row.signal}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {brief.risk_flags?.length ? (
                  <div className="flag-block">
                    <h3>Risk flags</h3>
                    <ul>
                      {brief.risk_flags.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {brief.diligence_questions?.length ? (
                  <div className="flag-block">
                    <h3>Diligence questions</h3>
                    <ul>
                      {brief.diligence_questions.map((q) => (
                        <li key={q}>{q}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <SpotlightCard
                  className="monday-memo"
                  spotlightColor="rgba(232, 184, 74, 0.16)"
                >
                  <div className="memo-head">
                    <h3>Monday memo</h3>
                    <button
                      type="button"
                      className="copy-btn"
                      onClick={() =>
                        copyText("memo", brief.monday_memo || brief.summary)
                      }
                    >
                      {copied === "memo" ? "Copied" : "Copy memo"}
                    </button>
                  </div>
                  <p>{brief.monday_memo}</p>
                </SpotlightCard>

                <div className="packet-actions">
                  <button
                    type="button"
                    className="copy-btn"
                    onClick={() => copyText("brief", brief.markdown)}
                  >
                    {copied === "brief" ? "Copied" : "Copy full brief"}
                  </button>
                </div>

                <div className="sources-grouped">
                  <h3>Sources by lane</h3>
                  {Object.entries(sourcesByStep).map(([step, list]) => (
                    <div key={step} className="source-group">
                      <div className="source-group-title">{step}</div>
                      {list.slice(0, 4).map((src) => (
                        <div className="source" key={`${step}-${src.url}`}>
                          <a href={src.url} target="_blank" rel="noreferrer">
                            {src.title || src.url}
                          </a>
                          <small>{src.excerpt?.slice(0, 140)}</small>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="hint">
                Live Parallel evidence and your Decision Packet appear here as
                diligence runs.
              </p>
            )}
          </section>
        </div>

        <p className="footer-note">
          Agentic Cinema · Parallel track · Google Cloud Gemini + Parallel Search
        </p>
      </main>
    </div>
  );
}
