// GET /api/quotes?symbols=AAPL,MSFT,...
// Proxies Finnhub real-time quotes so the API key stays server-side.
export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  const key = env.FINNHUB_KEY;
  if (!key) return json({ error: "FINNHUB_KEY not set in environment variables" }, 500);
  const url = new URL(req.url);
  const symbols = (url.searchParams.get("symbols") || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 15);
  if (!symbols.length) return json({ error: "no symbols" }, 400);
  const out = {};
  await Promise.all(symbols.map(async (s) => {
    try {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${key}`);
      const q = await r.json();
      // c=current, dp=percent change, h/l=day range, pc=prev close
      if (q && typeof q.c === "number" && q.c > 0) out[s] = { price: q.c, chgPct: q.dp ?? 0, high: q.h, low: q.l, prevClose: q.pc };
    } catch {}
  }));
  return json(out);
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
