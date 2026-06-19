// GET /api/fundamentals?symbol=AAPL
// Company fundamentals via the existing Finnhub key: profile (name, market
// cap, industry) + basic financials (P/E, 52-week range, dividend yield, beta).
export async function onRequest(context) {
  const env = context.env;
  const key = env.FINNHUB_KEY;
  if (!key) return json({ error: "FINNHUB_KEY not set" }, 500);
  const url = new URL(context.request.url);
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
  if (!symbol) return json({ error: "no symbol" }, 400);

  try {
    const [pr, mr] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${key}`).then(r => r.json()).catch(() => ({})),
      fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${key}`).then(r => r.json()).catch(() => ({})),
    ]);
    const m = (mr && mr.metric) || {};
    const num = (v) => (typeof v === "number" && isFinite(v)) ? v : null;

    const fundamentals = {
      name: pr.name || null,
      industry: pr.finnhubIndustry || null,
      exchange: pr.exchange || null,
      // marketCapitalization is in millions USD
      marketCap: num(pr.marketCapitalization) != null ? pr.marketCapitalization * 1e6 : null,
      peRatio: num(m.peNormalizedAnnual) ?? num(m.peBasicExclExtraTTM) ?? num(m.peTTM),
      eps: num(m.epsNormalizedAnnual) ?? num(m.epsTTM),
      week52High: num(m["52WeekHigh"]),
      week52Low: num(m["52WeekLow"]),
      dividendYield: num(m.dividendYieldIndicatedAnnual) ?? num(m.currentDividendYieldTTM),
      beta: num(m.beta),
      profitMargin: num(m.netProfitMarginTTM),
    };
    const hasAny = Object.entries(fundamentals).some(([k, v]) => k !== "name" && k !== "exchange" && v != null);
    return json({ fundamentals, hasAny });
  } catch {
    return json({ error: "fundamentals fetch failed" }, 502);
  }
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
