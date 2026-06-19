// GET /api/digest — the daily "what's moving & why" board.
// Ranks the day's most-active liquid names, pulls their fresh headlines, and
// makes ONE Anthropic call to produce a plain-English, beginner-friendly read
// per stock: what's happening, a ~2-week lean (up/down/unclear), why, and the
// main risk. Honest, jargon-free, balanced — not a prediction or advice.
const SEED = ["NVDA","TSLA","AAPL","AMD","INTC","MSFT","GOOGL","META","AMZN","PLTR","SOFI","NIO","RIVN","COIN","MARA","MSTR","SMCI","AVGO","MU","ARM","DELL","BABA","F","BAC","SNAP","UBER","HOOD","DKNG","NFLX","CRWD"];

export async function onRequest(context) {
  const env = context.env;
  const fhKey = env.FINNHUB_KEY;
  const aiKey = env.ANTHROPIC_API_KEY;
  if (!aiKey) return json({ error: "ANTHROPIC_API_KEY missing in environment variables" }, 500);
  if (!fhKey) return json({ error: "FINNHUB_KEY missing in environment variables" }, 500);

  // 1) Rank the universe by today's absolute move (proxy for "in the news / in talks")
  const quotes = await Promise.all(SEED.map(async (s) => {
    try {
      const q = await fetch(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${fhKey}`).then((r) => r.json());
      if (q && typeof q.c === "number" && q.c > 0) return { sym: s, price: q.c, chgPct: q.pc ? ((q.c - q.pc) / q.pc) * 100 : 0 };
    } catch {}
    return null;
  }));
  const movers = quotes.filter(Boolean).sort((a, b) => Math.abs(b.chgPct) - Math.abs(a.chgPct)).slice(0, 8);
  if (!movers.length) return json({ error: "couldn't load market movers" }, 502);

  // 2) Fresh headlines per name (best-effort, last 4 days)
  const to = new Date(), from = new Date(Date.now() - 4 * 864e5);
  const fmt = (d) => d.toISOString().slice(0, 10);
  await Promise.all(movers.map(async (m) => {
    m.headlines = [];
    try {
      const all = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${m.sym}&from=${fmt(from)}&to=${fmt(to)}&token=${fhKey}`).then((r) => r.json());
      m.headlines = (Array.isArray(all) ? all : []).slice(0, 4).map((n) => n.headline).filter(Boolean);
    } catch {}
  }));

  // 3) One Anthropic call -> structured plain-English digest
  const block = movers.map((m) => `${m.sym} (~$${m.price.toFixed(2)}, ${m.chgPct >= 0 ? "+" : ""}${m.chgPct.toFixed(1)}% today)\nRecent headlines:\n${m.headlines.length ? m.headlines.map((h) => `- ${h}`).join("\n") : "- (no fresh headlines — use general knowledge, note lower confidence)"}`).join("\n\n");
  const prompt = `You are writing a plain-English daily stock digest for a BEGINNER who is trading real money and gets overwhelmed by jargon. For each stock below, give a short, clear read with NO technical terms (never use RSI, MACD, beta, support/resistance, etc.). Be honest and balanced — nobody can predict the future, so give your best-informed lean with the reason and the risk, in everyday language.

Today's most-active stocks:
${block}

Return ONLY a JSON array (no markdown, no preamble), one object per stock in the same order:
[{"symbol":"TICKER","company":"plain company name","headline":"6-12 word plain-English summary of what's going on","lean":"up | down | unclear","why":"1-2 plain sentences on why it leans that way over the NEXT ~2 WEEKS, grounded in the headlines/trend","risk":"1 plain sentence on the main thing that could go wrong"}]

Rules:
- "lean" is your honest read for the next couple weeks: "up" if news/momentum leans positive, "down" if it leans negative, "unclear" if it's genuinely a toss-up. Don't force a direction — use "unclear" when it's mixed.
- Write like you're explaining to a smart friend with zero finance background. Short words. No hype, no certainty.`;

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
    if (!r.ok) { let msg = `Anthropic ${r.status}`; try { msg = JSON.parse(raw).error?.message || msg; } catch {} return json({ error: msg }, 502); }
    const data = JSON.parse(raw);
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const a = text.indexOf("["), b = text.lastIndexOf("]");
    if (a === -1 || b === -1) return json({ error: "model returned no list" }, 502);
    let arr;
    try { arr = JSON.parse(text.slice(a, b + 1)); } catch { return json({ error: "could not parse digest" }, 502); }
    const bySym = Object.fromEntries(movers.map((m) => [m.sym, m]));
    const stocks = (Array.isArray(arr) ? arr : []).filter((x) => x && x.symbol).map((x) => ({
      symbol: x.symbol, company: x.company || x.symbol, headline: x.headline || "", lean: (x.lean || "unclear").toLowerCase(), why: x.why || "", risk: x.risk || "",
      price: bySym[x.symbol]?.price ?? null, chgPct: bySym[x.symbol]?.chgPct ?? null,
    }));
    return json({ stocks, asOf: Date.now() });
  } catch (e) {
    return json({ error: e.name === "AbortError" ? "digest timed out" : "digest failed" }, 502);
  }
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
