// GET /api/news?symbol=AAPL&type=stock  |  ?symbol=BTC&type=crypto
// Strict filtering: only headlines that actually mention the company/coin.
export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  const key = env.FINNHUB_KEY;
  if (!key) return json({ error: "FINNHUB_KEY not set" }, 500);
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
  const type = url.searchParams.get("type") || "stock";
  if (!symbol) return json({ error: "no symbol" }, 400);

  const mentions = (item, terms) => {
    const text = `${item.headline || ""} ${item.summary || ""}`.toLowerCase();
    return terms.some((t) => t && text.includes(t));
  };

  try {
    let items = [];
    if (type === "crypto") {
      const names = { BTC: ["bitcoin", "btc"], ETH: ["ethereum"], SOL: ["solana"], DOGE: ["dogecoin"] };
      const terms = names[symbol] || [symbol.toLowerCase()];
      const r = await fetch(`https://finnhub.io/api/v1/news?category=crypto&token=${key}`);
      const all = await r.json();
      items = (Array.isArray(all) ? all : []).filter((n) => mentions(n, terms));
    } else {
      // get the real company name so we can filter strictly
      let nameTerms = [` ${symbol.toLowerCase()} `, `(${symbol.toLowerCase()})`, `${symbol.toLowerCase()} stock`];
      try {
        const pr = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${key}`);
        const prof = await pr.json();
        if (prof.name) {
          // first distinctive word of the company name, e.g. "Intel" from "Intel Corp"
          const first = prof.name.split(/[\s,]/)[0].toLowerCase();
          if (first.length >= 3) nameTerms.push(first);
        }
      } catch {}
      const to = new Date(), from = new Date(Date.now() - 7 * 864e5);
      const fmt = (d) => d.toISOString().slice(0, 10);
      const r = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${fmt(from)}&to=${fmt(to)}&token=${key}`);
      const all = await r.json();
      items = (Array.isArray(all) ? all : []).filter((n) => mentions(n, nameTerms));
    }

    // dedupe by headline, newest first
    const seen = new Set();
    items = items
      .sort((a, b) => (b.datetime || 0) - (a.datetime || 0))
      .filter((n) => {
        const h = (n.headline || "").trim();
        if (!h || seen.has(h)) return false;
        seen.add(h);
        return true;
      });

    const news = items.slice(0, 6).map((n) => ({
      h: n.headline,
      src: `${n.source || "—"} · ${new Date((n.datetime || 0) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      url: n.url,
    }));
    return json({ news });
  } catch {
    return json({ error: "news fetch failed" }, 502);
  }
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
