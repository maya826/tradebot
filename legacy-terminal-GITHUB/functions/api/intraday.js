// GET /api/intraday?symbol=AAPL
// Twelve Data 5-minute bars for today's real intraday chart.
export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  const key = env.TWELVEDATA_KEY;
  if (!key) return json({ error: "TWELVEDATA_KEY not set" }, 500);
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
  if (!symbol) return json({ error: "no symbol" }, 400);
  try {
    const r = await fetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=5min&outputsize=78&apikey=${key}`);
    const data = await r.json();
    if (!data.values) return json({ error: data.message || "no data" }, 502);
    const points = data.values.map(v => parseFloat(v.close)).reverse();
    return json({ points });
  } catch {
    return json({ error: "intraday fetch failed" }, 502);
  }
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
