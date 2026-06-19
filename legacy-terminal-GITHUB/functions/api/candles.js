// GET /api/candles?symbol=AAPL&type=stock  |  ?symbol=BTC&type=crypto
// Daily closes/volumes (~60 bars) for client-side RSI/MACD.
// Primary: Twelve Data. Fallback: Yahoo chart (keyless) so a rate-limit
// on Twelve Data doesn't drop the indicators.
export async function onRequest(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const raw = (url.searchParams.get("symbol") || "").toUpperCase();
  const type = url.searchParams.get("type") || "stock";
  if (!raw) return json({ error: "no symbol" }, 400);

  // ---- Primary: Twelve Data ----
  const key = env.TWELVEDATA_KEY;
  if (key) {
    try {
      const symbol = type === "crypto" ? `${raw}/USD` : raw;
      const r = await fetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=60&apikey=${key}`);
      const data = await r.json();
      if (data.values && data.values.length) {
        const closes = data.values.map(v => parseFloat(v.close)).reverse();
        const volumes = data.values.map(v => parseFloat(v.volume || 0)).reverse();
        return json({ closes, volumes, source: "twelvedata" });
      }
    } catch {}
  }

  // ---- Fallback: Yahoo daily bars (keyless) ----
  try {
    const ysym = type === "crypto" ? `${raw}-USD` : raw;
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?range=4mo&interval=1d`, { headers: UA });
    if (r.ok) {
      const d = await r.json();
      const res = d?.chart?.result?.[0];
      const q = res?.indicators?.quote?.[0];
      if (q && Array.isArray(q.close)) {
        const closes = [], volumes = [];
        for (let i = 0; i < q.close.length; i++) {
          if (q.close[i] != null) { closes.push(q.close[i]); volumes.push(q.volume?.[i] || 0); }
        }
        if (closes.length) return json({ closes: closes.slice(-60), volumes: volumes.slice(-60), source: "yahoo" });
      }
    }
  } catch {}

  return json({ error: "no candle data from any source" }, 502);
}
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
