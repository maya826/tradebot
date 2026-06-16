// GET /api/search?q=apple
// Finnhub symbol search — find tickers by company name or symbol.
export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  const key = env.FINNHUB_KEY;
  if (!key) return json({ error: "FINNHUB_KEY not set" }, 500);
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 1) return json({ results: [] });
  try {
    const r = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${key}`);
    const data = await r.json();
    // keep common US listings only: plain symbols, no dots/colons (skips foreign listings)
    const OK_TYPES = new Set(["Common Stock", "ETP", "ETF", "ADR", "REIT"]);
    const qUpper = q.toUpperCase();
    const all = (data.result || []).filter(x => x.symbol && /^[A-Z]{1,6}$/.test(x.symbol));
    const exact = all.filter(x => x.symbol === qUpper);
    const rest = all.filter(x => x.symbol !== qUpper && OK_TYPES.has(x.type));
    const results = [...exact, ...rest].slice(0, 6).map(x => ({ symbol: x.symbol, name: x.description }));
    return json({ results });
  } catch {
    return json({ error: "search failed" }, 502);
  }
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
