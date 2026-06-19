// GET /api/digest  (add ?fresh=1 to bypass cache and regenerate)
// The daily "what's moving & why" board. Ranks the day's most-active liquid
// names, pulls fresh headlines, and makes ONE Haiku call -> plain-English read
// per stock: what's happening, a ~2-week lean (up/down/unclear), why, risk.
// Result is edge-cached ~10 min so the board loads instantly after the first run.
const SEED = ["NVDA","TSLA","AAPL","AMD","INTC","MSFT","GOOGL","META","AMZN","PLTR","SOFI","NIO","RIVN","COIN","MARA","MSTR","SMCI","AVGO","MU","ARM","DELL","BABA","F","BAC","SNAP","UBER","HOOD","DKNG","NFLX","CRWD"];
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/api/digest`, { method: "GET" });
  if (!url.searchParams.get("fresh")) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const res = await build(context.env);
  if (res.error) return new Response(JSON.stringify({ error: res.error }), { status: res.status || 502, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  const resp = new Response(JSON.stringify({ stocks: res.stocks, asOf: Date.now() }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" } });
  context.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

async function build(env) {
  const fhKey = env.FINNHUB_KEY, aiKey = env.ANTHROPIC_API_KEY;
  if (!aiKey) return { error: "ANTHROPIC_API_KEY missing in environment variables", status: 500 };

  // 1) Rank by today's absolute move. Finnhub first, Yahoo fallback (keyless).
  let movers = [];
  if (fhKey) {
    const q = await Promise.all(SEED.map(async (s) => {
      try { const j = await fetch(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${fhKey}`).then((r) => r.json()); if (j && j.c > 0) return { sym: s, price: j.c, chgPct: j.pc ? ((j.c - j.pc) / j.pc) * 100 : 0 }; } catch {} return null;
    }));
    movers = q.filter(Boolean);
  }
  if (movers.length < 5) {
    const y = await Promise.all(SEED.map(async (s) => {
      try { const m = (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?range=1d&interval=1d`, { headers: UA }).then((r) => r.json()))?.chart?.result?.[0]?.meta; if (m && m.regularMarketPrice > 0) { const pc = m.chartPreviousClose ?? m.previousClose; return { sym: s, price: m.regularMarketPrice, chgPct: pc ? ((m.regularMarketPrice - pc) / pc) * 100 : 0 }; } } catch {} return null;
    }));
    const have = new Set(movers.map((m) => m.sym));
    y.filter(Boolean).forEach((m) => { if (!have.has(m.sym)) movers.push(m); });
  }
  movers = movers.sort((a, b) => Math.abs(b.chgPct) - Math.abs(a.chgPct)).slice(0, 8);
  if (!movers.length) return { error: "couldn't load market movers", status: 502 };

  // 2) Fresh headlines per name (best-effort)
  if (fhKey) {
    const to = new Date(), from = new Date(Date.now() - 4 * 864e5), fmt = (d) => d.toISOString().slice(0, 10);
    await Promise.all(movers.map(async (m) => {
      m.headlines = [];
      try { const all = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${m.sym}&from=${fmt(from)}&to=${fmt(to)}&token=${fhKey}`).then((r) => r.json()); m.headlines = (Array.isArray(all) ? all : []).slice(0, 4).map((n) => n.headline).filter(Boolean); } catch {}
    }));
  }

  // 3) One Haiku call -> structured plain-English digest
  const block = movers.map((m) => `${m.sym} (~$${m.price.toFixed(2)}, ${m.chgPct >= 0 ? "+" : ""}${m.chgPct.toFixed(1)}% today)\nRecent headlines:\n${(m.headlines && m.headlines.length) ? m.headlines.map((h) => `- ${h}`).join("\n") : "- (no fresh headlines — use general knowledge, note lower confidence)"}`).join("\n\n");
  const prompt = `You are writing a plain-English daily stock digest for a BEGINNER who is trading real money and gets overwhelmed by jargon. For each stock below, give a short, clear read with NO technical terms (never RSI, MACD, beta, support/resistance). Be honest and balanced — nobody can predict the future, so give your best-informed lean with the reason and the risk, in everyday language.

Today's most-active stocks:
${block}

Return ONLY a JSON array (no markdown), one object per stock in the same order:
[{"symbol":"TICKER","company":"plain company name","headline":"6-12 word plain summary of what's going on","lean":"up | down | unclear","why":"1-2 plain sentences on why it leans that way over the NEXT ~2 WEEKS, grounded in the headlines/trend","risk":"1 plain sentence on the main thing that could go wrong"}]

"lean" is your honest read for the next couple weeks: "up" if news/momentum leans positive, "down" if negative, "unclear" if genuinely mixed. Don't force a direction. Write like you're explaining to a smart friend with zero finance background.`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 28000);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": aiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1600, messages: [{ role: "user", content: prompt }] }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const raw = await r.text();
    if (!r.ok) { let msg = `Anthropic ${r.status}`; try { msg = JSON.parse(raw).error?.message || msg; } catch {} return { error: msg, status: 502 }; }
    const data = JSON.parse(raw);
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const a = text.indexOf("["), b = text.lastIndexOf("]");
    if (a === -1 || b === -1) return { error: "model returned no list", status: 502 };
    let arr; try { arr = JSON.parse(text.slice(a, b + 1)); } catch { return { error: "could not parse digest", status: 502 }; }
    const bySym = Object.fromEntries(movers.map((m) => [m.sym, m]));
    const stocks = (Array.isArray(arr) ? arr : []).filter((x) => x && x.symbol).map((x) => ({
      symbol: x.symbol, company: x.company || x.symbol, headline: x.headline || "", lean: (x.lean || "unclear").toLowerCase(), why: x.why || "", risk: x.risk || "",
      price: bySym[x.symbol]?.price ?? null, chgPct: bySym[x.symbol]?.chgPct ?? null,
    }));
    if (!stocks.length) return { error: "empty digest", status: 502 };
    return { stocks };
  } catch (e) {
    return { error: e.name === "AbortError" ? "digest timed out" : "digest failed", status: 502 };
  }
}
