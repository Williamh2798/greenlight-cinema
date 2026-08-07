import { GoogleGenAI } from "@google/genai";

export function getGenAI() {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY (or GEMINI_API_KEY) is not set");
  }
  return new GoogleGenAI({ apiKey });
}

function modelId() {
  return process.env.GEMINI_MODEL || "gemini-3.5-flash";
}

function extractText(response: {
  text?: string;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}): string {
  if (response.text) return response.text;
  const parts = response.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("");
}

function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  return t.trim();
}

/** Extract the first balanced JSON object from model output (handles trailing junk). */
export function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = stripFences(text);
  if (!trimmed) throw new Error("Gemini returned empty JSON");

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through — often truncated or trailing prose.
  }

  const start = trimmed.indexOf("{");
  if (start === -1) throw new Error("Gemini did not return JSON");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const slice = trimmed.slice(start, i + 1);
        return JSON.parse(slice) as Record<string, unknown>;
      }
    }
  }

  throw new Error(
    `Gemini returned incomplete JSON (${trimmed.length} chars, unclosed braces)`,
  );
}

export async function generateJson(
  prompt: string,
  system?: string,
  opts?: { retries?: number },
): Promise<Record<string, unknown>> {
  const ai = getGenAI();
  const retries = opts?.retries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: modelId(),
        contents:
          attempt === 0
            ? prompt
            : `${prompt}\n\nIMPORTANT: Reply with one complete JSON object only. Keep strings short. Do not truncate.`,
        config: {
          temperature: attempt === 0 ? 0.25 : 0.1,
          responseMimeType: "application/json",
          systemInstruction: system,
          maxOutputTokens: 8192,
        },
      });
      return parseJsonObject(extractText(response));
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("incomplete JSON") && !msg.includes("JSON")) {
        throw err;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini JSON generation failed");
}

export async function generateText(
  prompt: string,
  system?: string,
): Promise<string> {
  const ai = getGenAI();
  const response = await ai.models.generateContent({
    model: modelId(),
    contents: prompt,
    config: {
      temperature: 0.4,
      systemInstruction: system,
      maxOutputTokens: 4096,
    },
  });
  return extractText(response).trim();
}
