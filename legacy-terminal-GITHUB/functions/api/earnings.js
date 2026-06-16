// GET /api/earnings?symbol=AAPL
// Finnhub earnings calendar — next report date within 21 days, if any.
export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  const key = env.FINNHUB_KEY;
  if (!key) return json({ error: "FINNHUB_KEY not set" }, 500);
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
  if (!symbol) return json({ error: "no symbol" }, 400);
  try {
    const from = new Date(), to = new Date(Date.now() + 21 * 864e5);
    const fmt = (d) => d.toISOString().slice(0, 10);
    const r = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${fmt(from)}&to=${fmt(to)}&symbol=${symbol}&token=${key}`);
    const data = await r.json();
    const next = (data.earningsCalendar || [])[0];
    return json(next ? { date: next.date, hour: next.hour || "" } : {});
  } catch {
    return json({ error: "earnings fetch failed" }, 502);
  }
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
