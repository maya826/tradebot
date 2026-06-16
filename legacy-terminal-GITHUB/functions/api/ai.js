// POST /api/ai  { prompt: string }
// Proxies the Anthropic API so the key stays server-side. Returns { text }.
export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: "ANTHROPIC_API_KEY not set in environment variables" }, 500);
  let prompt;
  try { prompt = (await req.json()).prompt; } catch { return json({ error: "bad body" }, 400); }
  if (!prompt || typeof prompt !== "string" || prompt.length > 8000) return json({ error: "invalid prompt" }, 400);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    if (data.error) return json({ error: data.error.message || "API error" }, 502);
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    return json({ text });
  } catch {
    return json({ error: "AI request failed" }, 502);
  }
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
