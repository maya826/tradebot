// GET /api/extended?symbols=AAPL,INTC,...
// Extended-hours (pre-market + after-hours) prices via Yahoo Finance's
// unofficial chart endpoint — the standard hobbyist approach. Free, keyless,
// but unofficial: if Yahoo changes it, this returns empty and the UI falls
// back to official closing prices automatically.
export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  const url = new URL(req.url);
  const symbols = (url.searchParams.get("symbols") || "").split(",").map(s => s.trim().toUpperCase()).filter(s => /^[A-Z.\-]{1,8}$/.test(s)).slice(0, 14);
  if (!symbols.length) return json({});
  const out = {};
  await Promise.all(symbols.map(async (s) => {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1d&interval=1m&includePrePost=true`, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" },
      });
      if (!r.ok) return;
      const data = await r.json();
      const res = data?.chart?.result?.[0];
      if (!res) return;
      const prevClose = res.meta?.chartPreviousClose;
      const closes = res.indicators?.quote?.[0]?.close || [];
      let last = null;
      for (let i = closes.length - 1; i >= 0; i--) {
        if (closes[i] != null) { last = closes[i]; break; }
      }
      if (last == null) last = res.meta?.regularMarketPrice;
      if (last > 0) out[s] = { price: last, chgPct: prevClose ? ((last / prevClose) - 1) * 100 : null };
    } catch {}
  }));
  return json(out);
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
