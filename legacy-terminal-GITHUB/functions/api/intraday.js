// GET /api/intraday?symbol=AAPL
// Today's 5-minute closes for the 1D chart.
// Primary: Twelve Data. Fallback: Yahoo chart (keyless).
export async function onRequest(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
  if (!symbol) return json({ error: "no symbol" }, 400);

  const key = env.TWELVEDATA_KEY;
  if (key) {
    try {
      const r = await fetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=5min&outputsize=78&apikey=${key}`);
      const data = await r.json();
      if (data.values && data.values.length) {
        const points = data.values.map(v => parseFloat(v.close)).reverse();
        return json({ points, source: "twelvedata" });
      }
    } catch {}
  }

  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`, { headers: UA });
    if (r.ok) {
      const d = await r.json();
      const closes = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
      if (Array.isArray(closes)) {
        const points = closes.filter(c => c != null);
        if (points.length) return json({ points, source: "yahoo" });
      }
    }
  } catch {}

  return json({ error: "no intraday data from any source" }, 502);
}
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
