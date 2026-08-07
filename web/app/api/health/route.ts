export async function GET() {
  return Response.json({
    ok: true,
    service: "greenlight-web",
    parallel_key_configured: Boolean(process.env.PARALLEL_API_KEY),
    gemini_key_configured: Boolean(
      process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
    ),
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  });
}
