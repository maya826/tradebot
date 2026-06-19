// GET /api/market — market-wide context for the daily routine:
// major indices + VIX (Yahoo, keyless) and CNN's Fear & Greed index.
export async function onRequest() {
  const idx = [
    { sym: "^GSPC", name: "S&P 500" },
    { sym: "^IXIC", name: "Nasdaq" },
    { sym: "^DJI", name: "Dow" },
    { sym: "^RUT", name: "Russell 2K" },
    { sym: "^VIX", name: "VIX" },
  ];
  const indices = await Promise.all(idx.map(async ({ sym, name }) => {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=5m`, { headers: UA });
      if (!r.ok) return null;
      const m = (await r.json())?.chart?.result?.[0]?.meta;
      if (!m || !(m.regularMarketPrice > 0)) return null;
      const pc = m.chartPreviousClose ?? m.previousClose;
      return { name, price: m.regularMarketPrice, chgPct: pc ? ((m.regularMarketPrice - pc) / pc) * 100 : 0 };
    } catch { return null; }
  }));

  let fearGreed = null;
  try {
    const r = await fetch("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", { headers: UA });
    if (r.ok) {
      const d = await r.json();
      const fg = d?.fear_and_greed;
      if (fg && typeof fg.score === "number") fearGreed = { score: Math.round(fg.score), rating: fg.rating || null };
    }
  } catch {}

  return json({ indices: indices.filter(Boolean), fearGreed, asOf: Date.now() });
}
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
