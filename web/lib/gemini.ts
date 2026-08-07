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
  const text = (response.text || "").trim();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Gemini did not return JSON");
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
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
