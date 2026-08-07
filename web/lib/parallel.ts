import Parallel from "parallel-web";
import type { ResearchHit } from "./types";

export function getParallelClient() {
  const apiKey = process.env.PARALLEL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "PARALLEL_API_KEY is not set. Create a key at https://platform.parallel.ai",
    );
  }
  return new Parallel({ apiKey });
}

/** Runtime Parallel Search API call — required for Parallel track. */
export async function searchWeb(
  objective: string,
  searchQueries: string[],
  mode: "turbo" | "basic" | "advanced" = "advanced",
): Promise<ResearchHit[]> {
  const client = getParallelClient();
  // Official Parallel Search API via parallel-web SDK
  const response = await client.search({
    objective,
    search_queries: searchQueries,
    mode,
  });

  return (response.results || []).map((result) => ({
    title: result.title || "Untitled",
    url: result.url || "",
    excerpts: (result.excerpts || []).filter(Boolean) as string[],
  }));
}

export function hitsToText(hits: ResearchHit[], limit = 8): string {
  return hits
    .slice(0, limit)
    .map((hit) => {
      const excerpt = hit.excerpts.join(" ").slice(0, 600);
      return `- ${hit.title}\n  URL: ${hit.url}\n  Excerpt: ${excerpt}`;
    })
    .join("\n");
}
