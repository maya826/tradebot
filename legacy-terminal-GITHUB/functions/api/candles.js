// GET /api/candles?symbol=AAPL&type=stock  |  ?symbol=BTC&type=crypto
// Twelve Data daily time series (60 bars) for client-side RSI/MACD calc.
export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  const key = env.TWELVEDATA_KEY;
  if (!key) return json({ error: "TWELVEDATA_KEY not set in environment variables" }, 500);
  const url = new URL(req.url);
  const raw = (url.searchParams.get("symbol") || "").toUpperCase();
  const type = url.searchParams.get("type") || "stock";
  if (!raw) return json({ error: "no symbol" }, 400);
  const symbol = type === "crypto" ? `${raw}/USD` : raw;
  try {
    const r = await fetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=60&apikey=${key}`);
    const data = await r.json();
    if (!data.values) return json({ error: data.message || "no data" }, 502);
    // Twelve Data returns newest-first; flip to oldest-first
    const closes = data.values.map(v => parseFloat(v.close)).reverse();
    const volumes = data.values.map(v => parseFloat(v.volume || 0)).reverse();
    return json({ closes, volumes });
  } catch {
    return json({ error: "candles fetch failed" }, 502);
  }
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
