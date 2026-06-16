// GET /api/movers — the day's most active / biggest-moving US stocks.
// Uses Finnhub. Returns a deduped candidate list the scanner then analyzes.
const SEED = ["NVDA","TSLA","AAPL","AMD","INTC","MSFT","GOOGL","META","AMZN","PLTR","SOFI","NIO","RIVN","COIN","MARA","MSTR","SMCI","AVGO","MU","ARM","DELL","BABA","F","BAC","SNAP","UBER","HOOD","DKNG","CCL","AAL"];

export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  const key = env.FINNHUB_KEY;
  if (!key) return json({ error: "FINNHUB_KEY not set" }, 500);
  try {
    // Pull quotes for the seed universe, rank by absolute % move and by volume.
    const quotes = await Promise.all(SEED.map(async (sym) => {
      try {
        const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${key}`);
        const q = await r.json();
        if (!q || !q.c) return null;
        const chgPct = q.pc ? ((q.c - q.pc) / q.pc) * 100 : 0;
        return { sym, price: q.c, chgPct, high: q.h, low: q.l, prevClose: q.pc };
      } catch { return null; }
    }));
    const valid = quotes.filter(Boolean);
    // score = absolute move (proxy for "something's happening"); volume proxy via intraday range
    const ranked = valid
      .map((q) => ({ ...q, rangePct: q.prevClose ? ((q.high - q.low) / q.prevClose) * 100 : 0 }))
      .sort((a, b) => (Math.abs(b.chgPct) + b.rangePct) - (Math.abs(a.chgPct) + a.rangePct))
      .slice(0, 12);
    return json({ movers: ranked, asOf: Date.now() });
  } catch {
    return json({ error: "movers fetch failed" }, 502);
  }
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
