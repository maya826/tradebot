// POST /api/scan { symbol, price, chgPct }
// Returns structured swing analysis. Surfaces real error reasons (no silent fails).
export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const aiKey = env.ANTHROPIC_API_KEY;
  const fhKey = env.FINNHUB_KEY;
  if (!aiKey) return json({ error: "ANTHROPIC_API_KEY missing in environment variables" }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad request body" }, 400); }
  const symbol = (body.symbol || "").toUpperCase().replace(/[^A-Z.]/g, "").slice(0, 6);
  if (!symbol) return json({ error: "no symbol provided" }, 400);
  const price = Number(body.price) || null;
  const chgPct = Number(body.chgPct);

  // 1) Try to gather news context, but never let it block (3s cap, failures ignored)
  let headlines = [], companyName = symbol;
  if (fhKey) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const to = new Date(), from = new Date(Date.now() - 7 * 864e5);
      const fmt = (d) => d.toISOString().slice(0, 10);
      const [nr, pr] = await Promise.all([
        fetch(`https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${fmt(from)}&to=${fmt(to)}&token=${fhKey}`, { signal: ctrl.signal }).catch(() => null),
        fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${fhKey}`, { signal: ctrl.signal }).catch(() => null),
      ]);
      clearTimeout(t);
      if (pr && pr.ok) { const p = await pr.json().catch(() => ({})); if (p && p.name) companyName = p.name; }
      if (nr && nr.ok) {
        const all = await nr.json().catch(() => []);
        headlines = (Array.isArray(all) ? all : []).slice(0, 8).map((n) => `- ${n.headline} (${n.source})`);
      }
    } catch { /* news is optional; proceed without it */ }
  }
  const newsBlock = headlines.length ? headlines.join("\n") : "(No recent headlines available — reason from general knowledge and note lower confidence.)";

  const prompt = `You are a trading research assistant for someone who swing-trades (holds days, sells into profit). Analyze ${companyName} (${symbol})${price ? `, ~$${price}, ${chgPct >= 0 ? "+" : ""}${isFinite(chgPct) ? chgPct.toFixed(1) : "?"}% today` : ""}.

Recent headlines:
${newsBlock}

Return ONLY a JSON object, no markdown, no preamble:
{"symbol":"${symbol}","catalyst":"1-2 sentences on why it's likely moving","social":"1-2 sentences on how retail likely frames this + a skeptical read (organic or hype/FOMO?)","bull":"strongest bull case, 1 sentence","bear":"strongest risk, 1 sentence","setup":{"entry":"price/condition","target":"realistic target + why","stop":"stop level","timeframe":"e.g. 2-5 days"},"conviction":"Watch | Speculative | Constructive","caution":"one specific risk reminder"}

Be honest; if the move already happened and risk/reward is poor, say so and set conviction to "Watch". Never imply certainty.`;

  // 2) Call Anthropic with a hard 8s cap so we always return something useful
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": aiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 900, messages: [{ role: "user", content: prompt }] }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const raw = await r.text();
    if (!r.ok) {
      let msg = `Anthropic ${r.status}`;
      try { const e = JSON.parse(raw); msg = e.error?.message || msg; } catch {}
      return json({ error: msg }, 502);
    }
    let data;
    try { data = JSON.parse(raw); } catch { return json({ error: "bad API response" }, 502); }
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return json({ error: "model returned no JSON" }, 502);
    let parsed;
    try { parsed = JSON.parse(text.slice(start, end + 1)); }
    catch { return json({ error: "could not parse analysis JSON" }, 502); }
    return json({ analysis: parsed });
  } catch (e) {
    const reason = e.name === "AbortError" ? "analysis timed out (8s)" : "network error reaching Anthropic";
    return json({ error: reason }, 502);
  }
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
