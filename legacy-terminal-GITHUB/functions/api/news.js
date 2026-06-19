// GET /api/news?symbol=AAPL&type=stock  |  ?symbol=BTC&type=crypto
// Merges Finnhub + Yahoo RSS (keyless), both filtered to headlines that
// actually mention the company/coin, deduped, newest first.
export async function onRequest(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
  const type = url.searchParams.get("type") || "stock";
  if (!symbol) return json({ error: "no symbol" }, 400);
  const key = env.FINNHUB_KEY;

  // Build the relevance terms (company name / coin name / ticker)
  let terms;
  if (type === "crypto") {
    const names = { BTC: ["bitcoin", "btc"], ETH: ["ethereum", "eth"], SOL: ["solana", "sol"], DOGE: ["dogecoin", "doge"] };
    terms = names[symbol] || [symbol.toLowerCase()];
  } else {
    terms = [symbol.toLowerCase()];
    if (key) {
      try {
        const prof = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${key}`).then(r => r.json());
        if (prof && prof.name) { const first = prof.name.split(/[\s,]/)[0].toLowerCase(); if (first.length >= 3) terms.push(first); }
      } catch {}
    }
  }
  const mentions = (text) => { const t = (text || "").toLowerCase(); return terms.some((w) => w && t.includes(w)); };

  const items = [];
  const fmtDate = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // ---- Source 1: Finnhub ----
  if (key) {
    try {
      if (type === "crypto") {
        const all = await fetch(`https://finnhub.io/api/v1/news?category=crypto&token=${key}`).then(r => r.json()).catch(() => []);
        (Array.isArray(all) ? all : []).filter((n) => mentions(`${n.headline} ${n.summary}`)).forEach((n) => items.push({ h: n.headline, url: n.url, ts: (n.datetime || 0) * 1000, src: n.source || "Finnhub" }));
      } else {
        const to = new Date(), from = new Date(Date.now() - 7 * 864e5);
        const fmt = (d) => d.toISOString().slice(0, 10);
        const all = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${fmt(from)}&to=${fmt(to)}&token=${key}`).then(r => r.json()).catch(() => []);
        (Array.isArray(all) ? all : []).filter((n) => mentions(`${n.headline} ${n.summary}`)).forEach((n) => items.push({ h: n.headline, url: n.url, ts: (n.datetime || 0) * 1000, src: n.source || "Finnhub" }));
      }
    } catch {}
  }

  // ---- Source 2: Yahoo RSS (keyless), filtered by mention ----
  try {
    const ysym = type === "crypto" ? `${symbol}-USD` : symbol;
    const r = await fetch(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ysym)}&region=US&lang=en-US`, { headers: UA });
    if (r.ok) {
      const xml = await r.text();
      const clean = (s) => (s || "").replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
      for (const b of xml.split(/<item>/i).slice(1)) {
        const h = clean((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
        const link = clean((b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1]);
        const pd = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1];
        if (!h || !mentions(h)) continue;
        items.push({ h, url: link, ts: pd ? (Date.parse(pd) || Date.now()) : Date.now(), src: "Yahoo" });
      }
    }
  } catch {}

  const seen = new Set();
  const merged = items
    .filter((n) => n.h && n.h.trim())
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .filter((n) => { const k = n.h.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 8)
    .map((n) => ({ h: n.h, src: `${n.src} · ${fmtDate(n.ts)}`, url: n.url }));

  return json({ news: merged });
}
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
