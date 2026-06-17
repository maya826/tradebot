// GET /api/aftermovers — biggest extended-hours (after-hours / pre-market) movers
// across the same liquid universe as /api/movers. Pulls Yahoo's chart endpoint
// (includePrePost) server-side and ranks by the move of the latest extended-hours
// price vs the regular-session close, so you can see what's reacting to after-bell
// news and know what to watch when the market next opens.
const SEED = ["NVDA","TSLA","AAPL","AMD","INTC","MSFT","GOOGL","META","AMZN","PLTR","SOFI","NIO","RIVN","COIN","MARA","MSTR","SMCI","AVGO","MU","ARM","DELL","BABA","F","BAC","SNAP","UBER","HOOD","DKNG","CCL","AAL"];

export async function onRequest(context) {
  // Label the current session from US Eastern time (EDT = UTC-4 in summer).
  const now = new Date();
  const etHour = ((now.getUTCHours() - 4 + 24) % 24) + now.getUTCMinutes() / 60;
  let session = "after-hours";
  if (etHour >= 4 && etHour < 9.5) session = "pre-market";
  else if (etHour >= 9.5 && etHour < 16) session = "live";

  const results = await Promise.all(SEED.map(async (sym) => {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=1d&interval=1m&includePrePost=true`, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" },
      });
      if (!r.ok) return null;
      const data = await r.json();
      const res = data?.chart?.result?.[0];
      if (!res) return null;
      const meta = res.meta || {};
      const regClose = meta.regularMarketPrice;
      const closes = res.indicators?.quote?.[0]?.close || [];
      let last = null;
      for (let i = closes.length - 1; i >= 0; i--) { if (closes[i] != null) { last = closes[i]; break; } }
      if (last == null) last = meta.postMarketPrice ?? meta.regularMarketPrice;
      if (!(regClose > 0) || !(last > 0)) return null;
      const extPct = ((last - regClose) / regClose) * 100;
      const prev = meta.chartPreviousClose;
      const dayPct = prev ? ((regClose - prev) / prev) * 100 : null;
      return { sym, price: last, regClose, chgPct: extPct, dayPct, session };
    } catch { return null; }
  }));

  const ranked = results
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.chgPct) - Math.abs(a.chgPct))
    .slice(0, 12);
  return json({ session, movers: ranked, asOf: Date.now() });
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
