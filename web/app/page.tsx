"use client";

import { FormEvent, useMemo, useState } from "react";

type StepName =
  | "parse_pitch"
  | "research_comps"
  | "research_market"
  | "research_risks"
  | "compose_brief";

type StepStatus = "idle" | "started" | "completed" | "error";

type StepState = {
  status: StepStatus;
  message: string;
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
  sources: Source[];
  markdown: string;
};

const STEP_ORDER: { id: StepName; label: string }[] = [
  { id: "parse_pitch", label: "Frame pitch" },
  { id: "research_comps", label: "Parallel · comps" },
  { id: "research_market", label: "Parallel · market" },
  { id: "research_risks", label: "Parallel · risks" },
  { id: "compose_brief", label: "Compose brief" },
];

const API_BASE = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") || "";
const STREAM_URL = API_BASE
  ? `${API_BASE}/brief/stream`
  : "/api/brief/stream";

const initialSteps = (): Record<StepName, StepState> =>
  Object.fromEntries(
    STEP_ORDER.map((s) => [s.id, { status: "idle", message: "Waiting" }]),
  ) as Record<StepName, StepState>;

function markdownToHtml(md: string): string {
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/^(?:- |\* )(.+)$/gm, "<li>$1</li>")
    .replace(/(?:<li>.*<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`)
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/^(?!<[hul])/gm, "")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>");
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

  const briefHtml = useMemo(
    () => (brief ? markdownToHtml(brief.markdown) : ""),
    [brief],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setRunning(true);
    setError(null);
    setBrief(null);
    setSteps(initialSteps());

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
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
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
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!data) continue;

          if (event === "step") {
            const step = JSON.parse(data) as {
              step: StepName;
              status: StepStatus;
              message: string;
            };
            setSteps((prev) => ({
              ...prev,
              [step.step]: { status: step.status, message: step.message },
            }));
          } else if (event === "brief") {
            setBrief(JSON.parse(data) as Brief);
          } else if (event === "error") {
            const err = JSON.parse(data) as { message: string };
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
    <main className="app-shell">
      <header className="brand-lockup">
        <h1 className="brand">
          GREEN<span>LIGHT</span>
        </h1>
        <p className="tagline">
          Pitch in. Cited diligence out. A Gemini agent that runs Parallel Search
          across comps, market, and risk before your greenlight meeting.
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
              {API_BASE ? ` · ${API_BASE}` : " · edge API"}
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
                  <div>
                    <div className="step-title">{s.label}</div>
                    <p className="step-msg">{state.message}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {brief ? (
            <>
              <div className={`rec-banner ${brief.recommendation}`}>
                <strong>{brief.recommendation.replace("_", " ").toUpperCase()}</strong>
                <span>{Math.round(brief.confidence * 100)}% confidence</span>
              </div>
              <div
                className="brief-body"
                dangerouslySetInnerHTML={{ __html: briefHtml }}
              />
              <div className="sources">
                {brief.sources.slice(0, 10).map((src) => (
                  <div className="source" key={`${src.step}-${src.url}`}>
                    <a href={src.url} target="_blank" rel="noreferrer">
                      {src.title || src.url}
                    </a>
                    <small>
                      {src.step} · {src.excerpt?.slice(0, 160)}
                    </small>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="hint">
              Your cited Greenlight Brief appears here after Parallel research
              completes.
            </p>
          )}
        </section>
      </div>

      <p className="footer-note">
        Agentic Cinema · Parallel track · Google Cloud Agent Development Kit
      </p>
    </main>
  );
}
