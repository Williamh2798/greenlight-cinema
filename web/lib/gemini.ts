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

/** Extract the first balanced JSON object from model output (handles trailing junk). */
export function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Gemini returned empty JSON");

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Fall through — often valid JSON followed by extra prose/markdown.
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

  throw new Error("Gemini returned incomplete JSON");
}

export async function generateJson(
  prompt: string,
  system?: string,
): Promise<Record<string, unknown>> {
  const ai = getGenAI();
  const response = await ai.models.generateContent({
    model: modelId(),
    contents: prompt,
    config: {
      temperature: 0.3,
      responseMimeType: "application/json",
      systemInstruction: system,
    },
  });
  return parseJsonObject(response.text || "");
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
    },
  });
  return (response.text || "").trim();
}
