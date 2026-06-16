// Alpaca PAPER trading proxy (fake money, real prices).
// GET  /api/alpaca?action=account   -> { equity, buying_power, status }
// GET  /api/alpaca?action=positions -> { positions: [...] }
// POST /api/alpaca { symbol, qty, side } -> market order result
const BASE = "https://paper-api.alpaca.markets/v2";

export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  const key = env.ALPACA_KEY, secret = env.ALPACA_SECRET;
  if (!key || !secret) return json({ notConfigured: true }, 200);
  const headers = { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, "Content-Type": "application/json" };

  try {
    if (req.method === "POST") {
      const body = await req.json();
      const symbol = (body.symbol || "").toUpperCase();
      const qty = parseFloat(body.qty);
      const side = body.side === "sell" ? "sell" : "buy";
      if (!/^[A-Z.]{1,6}$/.test(symbol) || !qty || qty <= 0 || qty > 10000) return json({ error: "invalid order" }, 400);
      const r = await fetch(`${BASE}/orders`, {
        method: "POST", headers,
        body: JSON.stringify({ symbol, qty: String(qty), side, type: "market", time_in_force: "day" }),
      });
      const data = await r.json();
      if (!r.ok) return json({ error: data.message || "order rejected" }, 422);
      return json({ ok: true, id: data.id, status: data.status, symbol, qty, side });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "account";
    if (action === "positions") {
      const r = await fetch(`${BASE}/positions`, { headers });
      const data = await r.json();
      const positions = (Array.isArray(data) ? data : []).map(p => ({
        symbol: p.symbol, qty: parseFloat(p.qty), avgCost: parseFloat(p.avg_entry_price),
        value: parseFloat(p.market_value), gain: parseFloat(p.unrealized_pl), gainPct: parseFloat(p.unrealized_plpc) * 100,
      }));
      return json({ positions });
    }
    const r = await fetch(`${BASE}/account`, { headers });
    const data = await r.json();
    if (data.code) return json({ error: data.message || "auth failed" }, 401);
    return json({ equity: parseFloat(data.equity), buyingPower: parseFloat(data.buying_power), status: data.status });
  } catch {
    return json({ error: "alpaca request failed" }, 502);
  }
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
