// GET /api/fundamentals?symbol=AAPL
// Company fundamentals via the existing Finnhub key: profile (name, market cap,
// industry), basic financials (P/E, 52-week range, dividend, beta), analyst
// recommendation consensus, and peer companies.
export async function onRequest(context) {
  const env = context.env;
  const key = env.FINNHUB_KEY;
  if (!key) return json({ error: "FINNHUB_KEY not set" }, 500);
  const url = new URL(context.request.url);
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
  if (!symbol) return json({ error: "no symbol" }, 400);
  const fh = (path) => fetch(`https://finnhub.io/api/v1/${path}&token=${key}`).then(r => r.json()).catch(() => null);

  try {
    const [pr, mr, rec, peers] = await Promise.all([
      fh(`stock/profile2?symbol=${symbol}`),
      fh(`stock/metric?symbol=${symbol}&metric=all`),
      fh(`stock/recommendation?symbol=${symbol}`),
      fh(`stock/peers?symbol=${symbol}`),
    ]);
    const p = pr || {}, m = (mr && mr.metric) || {};
    const num = (v) => (typeof v === "number" && isFinite(v)) ? v : null;

    // Analyst consensus from the latest recommendation period
    let analysts = null;
    const r0 = Array.isArray(rec) && rec.length ? rec[0] : null;
    if (r0) {
      const sb = r0.strongBuy || 0, b = r0.buy || 0, h = r0.hold || 0, s = r0.sell || 0, ss = r0.strongSell || 0;
      const total = sb + b + h + s + ss;
      if (total > 0) {
        const score = (sb * 2 + b - s - ss * 2) / total;
        const label = score >= 1 ? "Strong Buy" : score >= 0.3 ? "Buy" : score > -0.3 ? "Hold" : score > -1 ? "Sell" : "Strong Sell";
        analysts = { label, total, buy: sb + b, hold: h, sell: s + ss };
      }
    }

    const fundamentals = {
      name: p.name || null,
      industry: p.finnhubIndustry || null,
      exchange: p.exchange || null,
      marketCap: num(p.marketCapitalization) != null ? p.marketCapitalization * 1e6 : null,
      peRatio: num(m.peNormalizedAnnual) ?? num(m.peBasicExclExtraTTM) ?? num(m.peTTM),
      eps: num(m.epsNormalizedAnnual) ?? num(m.epsTTM),
      week52High: num(m["52WeekHigh"]),
      week52Low: num(m["52WeekLow"]),
      dividendYield: num(m.dividendYieldIndicatedAnnual) ?? num(m.currentDividendYieldTTM),
      beta: num(m.beta),
      analysts,
      peers: (Array.isArray(peers) ? peers : []).filter((x) => x && x !== symbol).slice(0, 6),
    };
    const hasAny = Object.entries(fundamentals).some(([k, v]) => !["name", "exchange", "peers"].includes(k) && v != null) || fundamentals.peers.length > 0;
    return json({ fundamentals, hasAny });
  } catch {
    return json({ error: "fundamentals fetch failed" }, 502);
  }
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
