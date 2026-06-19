// GET /api/screen?symbols=AAPL,NVDA,...
// Compact signal bundle per symbol for the Daily Watch board:
// price + day move + 52-week position (Yahoo, keyless) and analyst consensus
// (Finnhub). The client turns these into tags + an attention ranking.
export async function onRequest(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const symbols = (url.searchParams.get("symbols") || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 20);
  if (!symbols.length) return json({ error: "no symbols" }, 400);
  const key = env.FINNHUB_KEY;

  const rows = await Promise.all(symbols.map(async (s) => {
    const row = { sym: s };
    // Yahoo: price, day move, 52w range (keyless)
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1d&interval=5m&includePrePost=true`, { headers: UA });
      if (r.ok) {
        const m = (await r.json())?.chart?.result?.[0]?.meta;
        if (m && m.regularMarketPrice > 0) {
          const pc = m.chartPreviousClose ?? m.previousClose;
          row.price = m.regularMarketPrice;
          row.dayPct = pc ? ((m.regularMarketPrice - pc) / pc) * 100 : null;
          row.w52High = m.fiftyTwoWeekHigh ?? null;
          row.w52Low = m.fiftyTwoWeekLow ?? null;
          if (row.w52High && row.w52Low && row.w52High > row.w52Low) {
            row.pos52 = Math.min(Math.max((row.price - row.w52Low) / (row.w52High - row.w52Low), 0), 1);
          }
        }
      }
    } catch {}
    // Finnhub: analyst consensus (best-effort)
    if (key) {
      try {
        const rec = await fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${s}&token=${key}`).then(r => r.json());
        const r0 = Array.isArray(rec) && rec.length ? rec[0] : null;
        if (r0) {
          const sb = r0.strongBuy || 0, b = r0.buy || 0, h = r0.hold || 0, se = r0.sell || 0, ss = r0.strongSell || 0;
          const total = sb + b + h + se + ss;
          if (total > 0) {
            const score = (sb * 2 + b - se - ss * 2) / total;
            row.analyst = score >= 1 ? "Strong Buy" : score >= 0.3 ? "Buy" : score > -0.3 ? "Hold" : score > -1 ? "Sell" : "Strong Sell";
            row.analystN = total;
          }
        }
      } catch {}
    }
    return row;
  }));

  return json({ rows, asOf: Date.now() });
}
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
