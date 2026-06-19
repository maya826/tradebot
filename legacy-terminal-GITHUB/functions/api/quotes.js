// GET /api/quotes?symbols=AAPL,MSFT,...
// Primary: Finnhub. Any symbol Finnhub doesn't return is backfilled from
// Yahoo's chart feed (keyless), so a Finnhub miss/limit still shows a price.
export async function onRequest(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const symbols = (url.searchParams.get("symbols") || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 15);
  if (!symbols.length) return json({ error: "no symbols" }, 400);

  const out = {};
  const key = env.FINNHUB_KEY;
  if (key) {
    await Promise.all(symbols.map(async (s) => {
      try {
        const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${key}`);
        const q = await r.json();
        if (q && typeof q.c === "number" && q.c > 0) out[s] = { price: q.c, chgPct: q.dp ?? 0, high: q.h, low: q.l, prevClose: q.pc, source: "finnhub" };
      } catch {}
    }));
  }

  // Backfill misses from Yahoo
  const missing = symbols.filter((s) => !out[s]);
  if (missing.length) {
    await Promise.all(missing.map(async (s) => {
      try {
        const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1d&interval=5m&includePrePost=true`, { headers: UA });
        if (!r.ok) return;
        const m = (await r.json())?.chart?.result?.[0]?.meta;
        if (!m) return;
        const price = m.regularMarketPrice, pc = m.chartPreviousClose ?? m.previousClose;
        if (!(price > 0)) return;
        out[s] = {
          price,
          chgPct: pc ? ((price - pc) / pc) * 100 : 0,
          high: m.regularMarketDayHigh ?? price,
          low: m.regularMarketDayLow ?? price,
          prevClose: pc,
          source: "yahoo",
        };
      } catch {}
    }));
  }

  return json(out);
}
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
