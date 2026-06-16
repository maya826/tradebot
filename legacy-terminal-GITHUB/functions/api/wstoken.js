// GET /api/wstoken — returns the Finnhub token for browser websocket streaming.
// Prefers FINNHUB_STREAM_KEY (a separate, rotatable key) and falls back to FINNHUB_KEY.
export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  const token = env.FINNHUB_STREAM_KEY || env.FINNHUB_KEY || null;
  return new Response(JSON.stringify({ token }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
};
