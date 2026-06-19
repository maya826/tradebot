import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { rsi14, macd, supportResistance } from "./indicators.js";

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY TERMINAL — live build
// Stocks: Finnhub real-time quotes via /api/quotes (15s poll)
// Crypto: CoinGecko public API, direct from browser (30s poll)
// Indicators: RSI(14)/MACD computed from Twelve Data daily candles (/api/candles)
// News: Finnhub via /api/news · AI: Claude via /api/ai (keys server-side only)
// ─────────────────────────────────────────────────────────────────────────────

const T = {
  bg: "#0B0709", panel: "#110C10", panel2: "#181117", border: "#2A1F27",
  text: "#EFE6EA", dim: "#8F7E88", faint: "#4A3D45",
  green: "#2EE6A8", red: "#FF5470", amber: "#D9A06B", blue: "#6FAFFF", ai: "#B98AFF",
};
const MONO = "'JetBrains Mono','SF Mono',ui-monospace,Menlo,monospace";
const SANS = "'Inter','Helvetica Neue',system-ui,sans-serif";

const DEFAULT_STOCKS = ["AAPL", "NVDA", "TSLA", "MSFT", "AMD", "GOOGL", "META", "AMZN"];
const DEFAULT_CRYPTO = [
  { sym: "BTC", id: "bitcoin" }, { sym: "ETH", id: "ethereum" },
  { sym: "SOL", id: "solana" }, { sym: "DOGE", id: "dogecoin" },
];
const NAMES = {
  AAPL: "Apple", NVDA: "NVIDIA", TSLA: "Tesla", MSFT: "Microsoft", AMD: "Adv. Micro Devices",
  GOOGL: "Alphabet A", META: "Meta Platforms", AMZN: "Amazon",
  BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", DOGE: "Dogecoin",
};

// Persisted watchlist (survives refresh/restart)
function loadSaved() {
  try {
    const raw = localStorage.getItem("lt-watchlist-v1");
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (Array.isArray(s.stocks) && Array.isArray(s.crypto) && Array.isArray(s.order)) return s;
  } catch {}
  return null;
}

// Lightweight keyword tilt for headline badges. The AI analysis reads the raw
// headlines itself, so this only colors the cards — it never feeds the model.
const BULL_KW = ["beat", "beats", "surge", "soar", "rally", "record", "upgrade", "raises target", "raised target", "bullish", "jumps", "gains", "wins", "deal", "partnership", "approval", "buyback", "all-time high"];
const BEAR_KW = ["miss", "misses", "fall", "falls", "drop", "plunge", "sink", "slide", "downgrade", "cuts", "lawsuit", "probe", "layoff", "recall", "bearish", "warning", "fears", "selloff", "tumble"];
function tagSentiment(h) {
  const t = (h || "").toLowerCase();
  const bull = BULL_KW.some(k => t.includes(k)), bear = BEAR_KW.some(k => t.includes(k));
  if (bull && !bear) return "bullish";
  if (bear && !bull) return "bearish";
  return "neutral";
}

function fmtPrice(p) {
  if (p == null) return "—";
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

const SENT = {
  bullish: { c: T.green, label: "BULLISH" },
  bearish: { c: T.red, label: "BEARISH" },
  neutral: { c: T.amber, label: "NEUTRAL" },
};

function Sparkline({ data, color, w = 92, h = 26, id = "s" }) {
  if (!data || data.length < 2) return <svg width={w} height={h} />;
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 2 - ((v - min) / span) * (h - 4)}`);
  const line = pts.join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.30" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#sg-${id})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function BigChart({ data, color }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const w = 600, h = 150;
  const ok = data && data.length >= 2;
  const min = ok ? Math.min(...data) : 0, max = ok ? Math.max(...data) : 1, span = (max - min) || 1;
  const toXY = (v, i) => [(i / (data.length - 1)) * w, h - 6 - ((v - min) / span) * (h - 14)];
  const onMove = (e) => {
    if (!ok || !ref.current || !e) return;
    const rect = ref.current.getBoundingClientRect();
    const frac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    const i = Math.round(frac * (data.length - 1));
    const [x, y] = toXY(data[i], i);
    setHover({ i, x, y, v: data[i] });
  };
  if (!ok) {
    return <div style={{ height: 170, display: "flex", alignItems: "center", justifyContent: "center", color: T.faint, fontFamily: MONO, fontSize: 11 }}>Loading today's chart…</div>;
  }
  const pts = data.map((v, i) => toXY(v, i).join(","));
  const line = pts.join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  const tipLeft = hover && hover.x > w * 0.7;
  return (
    <svg ref={ref} viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 170, display: "block", cursor: "crosshair", touchAction: "none" }} preserveAspectRatio="none"
      onMouseMove={onMove} onMouseLeave={() => setHover(null)}
      onTouchMove={(e) => onMove(e.touches[0])} onTouchEnd={() => setHover(null)}>
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} stroke={T.border} strokeWidth="1" strokeDasharray="2 6" />
      ))}
      <polygon points={area} fill="url(#fade)" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <text x={w - 4} y={12} textAnchor="end" fill={T.faint} fontSize="10" fontFamily={MONO}>{fmtPrice(max)}</text>
      <text x={4} y={h - 4} textAnchor="start" fill={T.faint} fontSize="10" fontFamily={MONO}>{fmtPrice(min)}</text>
      {hover && (
        <g>
          <line x1={hover.x} x2={hover.x} y1="0" y2={h} stroke={T.dim} strokeWidth="1" strokeDasharray="3 3" />
          <circle cx={hover.x} cy={hover.y} r="3.5" fill={color} stroke={T.bg} strokeWidth="1.5" />
          <g transform={`translate(${tipLeft ? hover.x - 86 : hover.x + 8}, 6)`}>
            <rect width="78" height="22" rx="5" fill={T.panel2} stroke={T.border} />
            <text x="39" y="15" textAnchor="middle" fill={T.text} fontSize="11" fontWeight="700" fontFamily={MONO}>${fmtPrice(hover.v)}</text>
          </g>
        </g>
      )}
    </svg>
  );
}

function RsiGauge({ rsi }) {
  if (rsi == null) return null;
  const color = rsi >= 70 ? T.red : rsi <= 30 ? T.green : T.text;
  return (
    <div>
      <div style={{ position: "relative", height: 6, borderRadius: 3, background: `linear-gradient(90deg, ${T.green}33 0%, ${T.green}33 30%, ${T.faint}33 30%, ${T.faint}33 70%, ${T.red}33 70%, ${T.red}33 100%)` }}>
        <div style={{ position: "absolute", left: `${Math.min(rsi, 100)}%`, top: -3, width: 2, height: 12, background: color, transform: "translateX(-1px)" }} />
      </div>
      <div className="flex justify-between" style={{ fontSize: 9, color: T.faint, fontFamily: MONO, marginTop: 3 }}>
        <span>0</span><span>30 oversold</span><span>70 overbought</span><span>100</span>
      </div>
    </div>
  );
}

// Forgiving number parser — accepts "$115.07", "1,200.50", " 4.5 "
const num = (v) => parseFloat(String(v ?? "").replace(/[$,\s]/g, ""));

// US market session, computed in Eastern Time
function marketStatus(now) {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay(); // 0 Sun .. 6 Sat
  const mins = et.getHours() * 60 + et.getMinutes();
  if (day === 6) return { label: "MARKET CLOSED · WEEKEND", color: "faint", open: false, ext: false };
  if (day === 0) {
    if (mins >= 1200) return { label: "OVERNIGHT SESSION", color: "amber", open: false, ext: true };
    return { label: "MARKET CLOSED · WEEKEND", color: "faint", open: false, ext: false };
  }
  if (mins >= 570 && mins < 960) return { label: "MARKET OPEN · STREAMING", color: "green", open: true, ext: false };
  if (mins >= 240 && mins < 570) return { label: "PRE-MARKET · LIVE", color: "amber", open: false, ext: true };
  if (mins >= 960 && mins < 1200) return { label: "AFTER HOURS · LIVE", color: "amber", open: false, ext: true };
  if (mins >= 1200) return { label: "OVERNIGHT SESSION", color: "amber", open: false, ext: true };
  return { label: "OVERNIGHT · QUIET HOURS", color: "faint", open: false, ext: false };
}

// Plain-English verdicts so anyone can read the board at a glance
function momentumVerdict(rsi) {
  if (rsi == null) return { word: "Loading…", color: null };
  if (rsi >= 70) return { word: "Overbought", color: "red", hint: "price has run hot — risk of a pullback" };
  if (rsi >= 55) return { word: "Strong", color: "green", hint: "buyers in control" };
  if (rsi > 45) return { word: "Neutral", color: null, hint: "no clear edge either way" };
  if (rsi > 30) return { word: "Weak", color: "red", hint: "sellers have the edge" };
  return { word: "Oversold", color: "green", hint: "beaten down — bounce potential" };
}
function trendVerdict(macd, signal) {
  if (macd == null || signal == null) return { word: "Loading…", color: null };
  const diff = macd - signal;
  if (macd > 0 && diff > 0) return { word: "Rising", color: "green", hint: "uptrend with momentum building" };
  if (diff > 0) return { word: "Turning up", color: "green", hint: "early signs of recovery" };
  if (macd > 0) return { word: "Cooling off", color: "red", hint: "uptrend losing steam" };
  return { word: "Falling", color: "red", hint: "downtrend in control" };
}
function activityVerdict(volRatio) {
  if (volRatio == null) return { word: "—", color: null, hint: "" };
  if (volRatio >= 1.5) return { word: "Very busy", color: "amber", hint: "way more trading than usual — something's up" };
  if (volRatio >= 1.1) return { word: "Busy", color: "amber", hint: "more trading than usual" };
  if (volRatio >= 0.6) return { word: "Normal", color: null, hint: "typical trading volume" };
  return { word: "Quiet", color: null, hint: "lighter trading than usual" };
}

function rsiPlainEnglish(rsi, sym) {
  if (rsi == null) return "RSI loading from daily candles…";
  if (rsi >= 75) return `RSI at ${rsi} — heavily overbought. Chasing here is paying top tick; watch for a pullback or wait for a reset toward 60.`;
  if (rsi >= 70) return `RSI at ${rsi} — overbought. Momentum is strong but stretched; tighten stops rather than add.`;
  if (rsi >= 55) return `RSI at ${rsi} — bullish momentum with room to run before overbought territory.`;
  if (rsi > 45) return `RSI at ${rsi} — neutral. ${sym} has no momentum edge either way right now; let price pick a direction first.`;
  if (rsi > 30) return `RSI at ${rsi} — soft momentum. Sellers have the edge but it's not washed out yet.`;
  return `RSI at ${rsi} — oversold. Bounce risk is high for shorts; mean-reversion longs get interesting if support holds.`;
}

function TVChart({ symbol, crypto, cryptoId }) {
  const tvSymbol = crypto
    ? ({ bitcoin: "BINANCE:BTCUSDT", ethereum: "BINANCE:ETHUSDT", solana: "BINANCE:SOLUSDT", dogecoin: "BINANCE:DOGEUSDT" }[cryptoId] || `BINANCE:${symbol}USDT`)
    : symbol;
  const params = new URLSearchParams({
    symbol: tvSymbol, interval: "15", theme: "dark", style: "1",
    timezone: "America/New_York", withdateranges: "1", hide_side_toolbar: "0",
    allow_symbol_change: "0", save_image: "0", backgroundColor: "rgba(10,7,8,1)",
    studies: "RSI@tv-basicstudies",
  });
  return (
    <iframe
      key={tvSymbol}
      title={`TradingView chart for ${symbol}`}
      src={`https://s.tradingview.com/widgetembed/?${params.toString()}`}
      style={{ width: "100%", height: 440, border: "none", borderRadius: 8, display: "block", background: "#0A0708" }}
      allowFullScreen
    />
  );
}

const LESSONS = [
  ["What's a stock?", "A tiny piece of ownership in a company. If the company does well over time, your piece tends to become worth more. The price moves every second based on what buyers and sellers agree on."],
  ["Watchlist vs. portfolio", "Your watchlist is stocks you're keeping an eye on. Your portfolio is what you actually own. Watch first, buy later — most good traders watch a stock for days or weeks before touching it."],
  ["Momentum (RSI)", "Measures whether a stock has been bought or sold too hard recently, on a 0–100 scale. Above 70 = overbought (ran up fast, may cool off). Below 30 = oversold (beaten down, may bounce). The middle = no strong signal."],
  ["Trend (MACD)", "Compares the recent average price to a longer average to show direction. Rising = the stock has been gaining steam. Falling = losing steam. Trends can last a while, but they always end eventually."],
  ["Volume", "How many shares traded. Big news = busy volume. A price move on heavy volume means lots of people agree; a move on quiet volume is easier to distrust."],
  ["Floor & ceiling", "Support (floor) is a price where buyers have repeatedly stepped in. Resistance (ceiling) is where sellers have repeatedly stepped in. Prices often bounce between them — until they don't, which is when big moves happen."],
  ["Earnings reports", "Four times a year companies reveal their results. Stocks often jump or drop 5–10%+ overnight on earnings. The gold badge here warns you when one is coming — beginners often sit those days out."],
  ["The 1–2% rule", "Never risk more than 1–2% of your account on a single trade. It means no single mistake can hurt you badly — and everyone makes mistakes. The calculator on the left does this math for you."],
  ["Paper trading", "Practicing with pretend money and real prices. Do this for at least a month before real money. If you can't make pretend money grow, real money won't go better — it'll go worse, because emotions kick in."],
  ["What AI can and can't do", "The AI here reads the same numbers and headlines you see and gives an organized opinion fast. What it cannot do is predict prices — nobody can, reliably. Use it to check your thinking, never to replace it."],
  ["Diversification", "Don't put everything in one stock, one sector, or one idea. Spreading out means one bad surprise can't sink you. Boring, but it's how people stay in the game long enough to get good."],
  ["Only invest what you can lose", "Money for rent, emergencies, or family doesn't belong in the market. The market rewards patience and punishes desperation — trading money you need makes every decision worse."],
];

function Lessons() {
  const [open, setOpen] = useState(null);
  return (
    <div>
      {LESSONS.map(([q, a], i) => (
        <div key={i} style={{ borderBottom: i < LESSONS.length - 1 ? "1px solid #2A1F2755" : "none" }}>
          <div className="cursor-pointer flex items-center" onClick={() => setOpen(open === i ? null : i)} style={{ padding: "8px 2px", fontSize: 12, fontWeight: 600 }}>
            <span style={{ color: open === i ? T.amber : T.text }}>{q}</span>
            <span className="ml-auto" style={{ color: T.faint, fontSize: 10 }}>{open === i ? "▲" : "▼"}</span>
          </div>
          {open === i && <div className="fade-up" style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.65, paddingBottom: 10 }}>{a}</div>}
        </div>
      ))}
    </div>
  );
}

function ScanRow({ label, color, text }) {
  return (
    <div>
      <div className="overline" style={{ color, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "#E8DDD5" }}>{text}</div>
    </div>
  );
}

function RiskCalc({ livePrice, sym }) {
  const [acct, setAcct] = useState("");
  const [riskPct, setRiskPct] = useState("1");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const e = num(entry) || livePrice || 0;
  const s = num(stop) || 0;
  const a = num(acct) || 0;
  const rp = num(riskPct) || 0;
  const perShare = e && s && e > s ? e - s : 0;
  const riskDollars = a * (rp / 100);
  const shares = perShare > 0 ? Math.floor(riskDollars / perShare) : 0;
  const cost = shares * e;
  const inp = { background: "#0B0709", border: "1px solid #2A1F27", borderRadius: 6, padding: "7px 9px", color: "#EFE6EA", fontFamily: MONO, fontSize: 11.5, width: "100%" };
  return (
    <div>
      <div className="grid grid-4 gap-2">
        <div><div style={{ fontSize: 9.5, color: T.dim, marginBottom: 3, fontFamily: MONO }}>ACCOUNT SIZE $</div><input value={acct} onChange={(ev) => setAcct(ev.target.value)} placeholder="10000" inputMode="decimal" style={inp} /></div>
        <div><div style={{ fontSize: 9.5, color: T.dim, marginBottom: 3, fontFamily: MONO }}>RISK % PER TRADE</div><input value={riskPct} onChange={(ev) => setRiskPct(ev.target.value)} placeholder="1" inputMode="decimal" style={inp} /></div>
        <div><div style={{ fontSize: 9.5, color: T.dim, marginBottom: 3, fontFamily: MONO }}>BUY PRICE $</div><input value={entry} onChange={(ev) => setEntry(ev.target.value)} placeholder={livePrice ? fmtPrice(livePrice) : "0"} inputMode="decimal" style={inp} /></div>
        <div><div style={{ fontSize: 9.5, color: T.dim, marginBottom: 3, fontFamily: MONO }}>EXIT IF IT DROPS TO $</div><input value={stop} onChange={(ev) => setStop(ev.target.value)} placeholder="your stop" inputMode="decimal" style={inp} /></div>
      </div>
      {a > 0 && perShare > 0 ? (
        <div className="mt-3" style={{ fontFamily: MONO, fontSize: 12.5, lineHeight: 1.7 }}>
          You'd be risking <span style={{ color: T.amber, fontWeight: 700 }}>${fmtPrice(riskDollars)}</span> ({rp}% of your account).
          At ${fmtPrice(perShare)} of risk per share, that means at most <span style={{ color: T.green, fontWeight: 700 }}>{shares} shares of {sym}</span> (≈ ${fmtPrice(cost)} total).
          If the price hits your exit, you lose ${fmtPrice(riskDollars)} — painful but survivable. That's the point.
        </div>
      ) : (
        <div className="mt-3" style={{ fontSize: 11, color: T.faint }}>Fill in all four boxes and the calculator shows the maximum shares to buy so a loss stays small.</div>
      )}
    </div>
  );
}

export default function App() {
  const saved = useMemo(() => loadSaved(), []);
  const [showWelcome, setShowWelcome] = useState(() => {
    try { return localStorage.getItem("lt-welcome-v1") !== "seen"; } catch { return true; }
  });
  const [stockList, setStockList] = useState(saved?.stocks || DEFAULT_STOCKS);
  const [cryptoList, setCryptoList] = useState(saved?.crypto || DEFAULT_CRYPTO);
  const [watchlist, setWatchlist] = useState(saved?.order || [...DEFAULT_STOCKS, ...DEFAULT_CRYPTO.map(c => c.sym)]);
  const isCrypto = useCallback((s) => cryptoList.some(c => c.sym === s), [cryptoList]);
  const [adding, setAdding] = useState(false);

  // persist watchlist
  useEffect(() => {
    try { localStorage.setItem("lt-watchlist-v1", JSON.stringify({ stocks: stockList, crypto: cryptoList, order: watchlist })); } catch {}
  }, [stockList, cryptoList, watchlist]);

  const [selected, setSelected] = useState("NVDA");
  const [prices, setPrices] = useState({});          // {SYM: {price, chgPct, hist:[]}}
  const [tech, setTech] = useState({});              // {SYM: {rsi, macd, signal, support, resistance, volume}}
  const [newsBySym, setNewsBySym] = useState({});    // {SYM: [{h, s, src, url}]}
  const [newsStatus, setNewsStatus] = useState("idle");
  const [alerts, setAlerts] = useState(() => {
    try { return JSON.parse(localStorage.getItem("lt-alerts-v1") || "[]"); } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem("lt-alerts-v1", JSON.stringify(alerts)); } catch {}
  }, [alerts]);
  const [toasts, setToasts] = useState([]);
  const [alertForm, setAlertForm] = useState({ ticker: "BTC", dir: "ABOVE", target: "" });
  const [addInput, setAddInput] = useState("");
  const [ai, setAi] = useState({ status: "idle", data: null, error: null });
  const [clock, setClock] = useState(new Date());
  const [feed, setFeed] = useState({ stocks: "connecting", crypto: "connecting" });

  const alertsRef = useRef(alerts); alertsRef.current = alerts;
  const pricesRef = useRef(prices); pricesRef.current = prices;
  const toastId = useRef(10);

  // Pause polling when the tab is hidden — saves Netlify function quota
  const [visible, setVisible] = useState(typeof document !== "undefined" ? !document.hidden : true);
  useEffect(() => {
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const pushToast = useCallback((msg, color) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, color }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const mergePrices = useCallback((incoming) => {
    setPrices((prev) => {
      const next = { ...prev };
      for (const [sym, q] of Object.entries(incoming)) {
        const old = prev[sym] || { hist: [] };
        const hist = q.price !== old.price ? [...(old.hist || []), q.price].slice(-60) : old.hist;
        // baseline for % change when streamed trades arrive
        const prevClose = q.prevClose ?? (q.chgPct != null && q.price ? q.price / (1 + q.chgPct / 100) : old.prevClose);
        next[sym] = { ...old, ...q, prevClose, hist };
      }
      return next;
    });
    // alert checks against real prices
    const armed = alertsRef.current.filter((a) => !a.triggered);
    const fired = armed.filter((a) => {
      const p = incoming[a.ticker]?.price;
      if (p == null) return false;
      return (a.dir === "ABOVE" && p >= a.target) || (a.dir === "BELOW" && p <= a.target);
    });
    if (fired.length) {
      const ids = fired.map((a) => a.id);
      setAlerts((as) => as.map((a) => (ids.includes(a.id) ? { ...a, triggered: true } : a)));
      fired.forEach((a) => pushToast(`ALERT · ${a.ticker} ${a.dir} ${fmtPrice(a.target)} — now ${fmtPrice(incoming[a.ticker].price)}`, T.amber));
    }
  }, [pushToast]);

  // ── Stocks: Finnhub via serverless proxy, every 15s ──
  useEffect(() => {
    if (!stockList.length) return;
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`/api/quotes?symbols=${stockList.join(",")}`);
        const data = await r.json();
        if (!alive) return;
        if (data.error) { setFeed((f) => ({ ...f, stocks: "error" })); return; }
        if (Object.keys(data).length) { mergePrices(data); setFeed((f) => ({ ...f, stocks: "live" })); }
      } catch { if (alive) setFeed((f) => ({ ...f, stocks: "error" })); }
    };
    poll();
    const iv = setInterval(() => { if (!document.hidden) poll(); }, 30000);
    const onBack = () => { if (!document.hidden) poll(); };
    document.addEventListener("visibilitychange", onBack);
    return () => { alive = false; clearInterval(iv); document.removeEventListener("visibilitychange", onBack); };
  }, [mergePrices, stockList, visible]);

  // ── Crypto: CoinGecko direct, every 30s ──
  useEffect(() => {
    if (!cryptoList.length) return;
    let alive = true;
    const ids = cryptoList.map((c) => c.id).join(",");
    const poll = async () => {
      try {
        const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
        const data = await r.json();
        if (!alive) return;
        const incoming = {};
        for (const c of cryptoList) {
          const d = data[c.id];
          if (d?.usd) incoming[c.sym] = { price: d.usd, chgPct: d.usd_24h_change ?? 0 };
        }
        if (Object.keys(incoming).length) { mergePrices(incoming); setFeed((f) => ({ ...f, crypto: "live" })); }
      } catch { if (alive) setFeed((f) => ({ ...f, crypto: "error" })); }
    };
    poll();
    const iv = setInterval(() => { if (!document.hidden) poll(); }, 60000);
    const onBack = () => { if (!document.hidden) poll(); };
    document.addEventListener("visibilitychange", onBack);
    return () => { alive = false; clearInterval(iv); document.removeEventListener("visibilitychange", onBack); };
  }, [mergePrices, cryptoList, visible]);

  // ── Extended hours: Yahoo's public feed fills the 4–9:30 AM and 4–8 PM gaps ──
  useEffect(() => {
    const poll = async () => {
      const ms = marketStatus(new Date());
      if (!ms.ext || !stockList.length) return;
      try {
        const r = await fetch(`/api/extended?symbols=${stockList.join(",")}`);
        const data = await r.json();
        const incoming = {};
        for (const [s, q] of Object.entries(data || {})) {
          if (q?.price > 0) incoming[s] = { price: q.price, chgPct: q.chgPct ?? undefined };
        }
        if (Object.keys(incoming).length) mergePrices(incoming);
      } catch {}
    };
    poll();
    const iv = setInterval(() => { if (!document.hidden) poll(); }, 60000);
    return () => clearInterval(iv);
  }, [stockList, mergePrices]);

  // ── TRUE STREAMING: Finnhub websocket pushes every trade instantly ──
  const [stream, setStream] = useState("connecting"); // connecting | live | off
  const BINANCE = { BTC: "BINANCE:BTCUSDT", ETH: "BINANCE:ETHUSDT", SOL: "BINANCE:SOLUSDT", DOGE: "BINANCE:DOGEUSDT" };
  const wlKey = watchlist.join(",");
  useEffect(() => {
    let ws = null, alive = true, retry = 0, flushIv = null;
    const buffer = {};
    const symFor = (tk) => (isCrypto(tk) ? BINANCE[tk] || null : tk);
    const tkFor = (s) => {
      if (s.startsWith("BINANCE:")) return Object.keys(BINANCE).find((k) => BINANCE[k] === s) || null;
      return watchlist.includes(s) ? s : null;
    };
    const connect = async () => {
      if (!alive || document.hidden) return;
      try {
        const r = await fetch("/api/wstoken");
        const { token } = await r.json();
        if (!token || !alive) { setStream("off"); return; }
        ws = new WebSocket(`wss://ws.finnhub.io?token=${token}`);
        ws.onopen = () => {
          if (!alive) return;
          retry = 0;
          setStream("live");
          watchlist.forEach((tk) => {
            const s = symFor(tk);
            if (s) ws.send(JSON.stringify({ type: "subscribe", symbol: s }));
          });
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === "trade" && Array.isArray(msg.data)) {
              for (const t of msg.data) {
                const tk = tkFor(t.s);
                if (tk && t.p > 0) buffer[tk] = t.p;
              }
            }
          } catch {}
        };
        ws.onclose = () => {
          if (!alive) return;
          setStream("off");
          if (!document.hidden) setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
        };
        ws.onerror = () => { try { ws.close(); } catch {} };
      } catch { setStream("off"); }
    };
    // flush buffered trades to the UI ~once a second (smooth, render-friendly)
    flushIv = setInterval(() => {
      const entries = Object.entries(buffer);
      if (!entries.length) return;
      setPrices((prev) => {
        const next = { ...prev };
        for (const [tk, p] of entries) {
          const old = prev[tk];
          if (!old) continue;
          const chgPct = old.prevClose ? ((p / old.prevClose) - 1) * 100 : old.chgPct;
          const hist = p !== old.price ? [...(old.hist || []), p].slice(-60) : old.hist;
          next[tk] = { ...old, price: p, chgPct, hist };
        }
        return next;
      });
      // alerts against streamed prices too
      const armed = alertsRef.current.filter((a) => !a.triggered);
      const fired = armed.filter((a) => {
        const p = buffer[a.ticker];
        if (p == null) return false;
        return (a.dir === "ABOVE" && p >= a.target) || (a.dir === "BELOW" && p <= a.target);
      });
      if (fired.length) {
        const ids = fired.map((a) => a.id);
        setAlerts((as) => as.map((a) => (ids.includes(a.id) ? { ...a, triggered: true } : a)));
        fired.forEach((a) => pushToast(`ALERT · ${a.ticker} ${a.dir} ${fmtPrice(a.target)} — now ${fmtPrice(buffer[a.ticker])}`, T.amber));
      }
      for (const k of Object.keys(buffer)) delete buffer[k];
    }, 1000);
    const onVis = () => {
      if (document.hidden) { try { ws && ws.close(); } catch {} }
      else if (!ws || ws.readyState !== 1) connect();
    };
    document.addEventListener("visibilitychange", onVis);
    connect();
    return () => {
      alive = false;
      clearInterval(flushIv);
      document.removeEventListener("visibilitychange", onVis);
      try { ws && ws.close(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wlKey]);

  // ── Indicators: fetch daily candles for the selected ticker (cached) ──
  useEffect(() => {
    if (tech[selected]) return;
    let alive = true;
    let timer = null;
    const load = async (attempt = 0) => {
      try {
        const r = await fetch(`/api/candles?symbol=${selected}&type=${isCrypto(selected) ? "crypto" : "stock"}`);
        const data = await r.json();
        if (!alive) return;
        if (!data.closes) {
          // Transient failure (e.g. Twelve Data rate limit) — retry a few times so the indicators never hang on "Loading…".
          if (attempt < 6) timer = setTimeout(() => load(attempt + 1), 5000);
          return;
        }
        const m = macd(data.closes);
        const sr = supportResistance(data.closes);
        const lastVol = data.volumes?.[data.volumes.length - 1] || 0;
        const avgVol = data.volumes?.length ? data.volumes.reduce((a, b) => a + b, 0) / data.volumes.length : 0;
        setTech((t) => ({ ...t, [selected]: {
          rsi: rsi14(data.closes), macd: m?.macd ?? null, signal: m?.signal ?? null,
          support: sr?.support, resistance: sr?.resistance,
          volume: lastVol, volRatio: avgVol ? Math.round((lastVol / avgVol) * 100) / 100 : null,
          closes: data.closes,
        }}));
      } catch {
        if (alive && attempt < 6) timer = setTimeout(() => load(attempt + 1), 5000);
      }
    };
    load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [selected, tech]);

  // ── Real chart data: intraday on selection (cached), plus range toggle ──
  const [chartRange, setChartRange] = useState("1D");
  const [chartMode, setChartMode] = useState(() => {
    try { return localStorage.getItem("lt-chartmode-v1") || "simple"; } catch { return "simple"; }
  });
  useEffect(() => { try { localStorage.setItem("lt-chartmode-v1", chartMode); } catch {} }, [chartMode]);

  // ── SCANNER: daily idea engine (movers + AI news/social analysis) ──
  const [scanOpen, setScanOpen] = useState(false);
  const [movers, setMovers] = useState({ status: "idle", list: [] });
  const [scans, setScans] = useState({}); // sym -> { status, data }
  const [scanMode, setScanMode] = useState("today"); // "today" | "ext"
  const [extSession, setExtSession] = useState("after-hours");
  const loadMovers = useCallback(async (mode = "today") => {
    setMovers({ status: "loading", list: [] });
    setScans({});
    try {
      const r = await fetch(mode === "ext" ? "/api/aftermovers" : "/api/movers");
      const d = await r.json();
      if (d.error || !Array.isArray(d.movers)) { setMovers({ status: "error", list: [] }); return; }
      if (d.session) setExtSession(d.session);
      setMovers({ status: "done", list: d.movers });
    } catch { setMovers({ status: "error", list: [] }); }
  }, []);
  const switchScanMode = useCallback((mode) => { setScanMode(mode); loadMovers(mode); }, [loadMovers]);
  const runScan = useCallback(async (m) => {
    setScans((s) => ({ ...s, [m.sym]: { status: "loading", data: null } }));
    try {
      const r = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: m.sym, price: m.price, chgPct: m.chgPct, session: m.session || null }) });
      const d = await r.json();
      if (d.error || !d.analysis) { setScans((s) => ({ ...s, [m.sym]: { status: "error", data: null, reason: d.error || "no analysis returned", expanded: (s[m.sym] || {}).expanded } })); return; }
      setScans((s) => ({ ...s, [m.sym]: { status: "done", data: d.analysis, expanded: (s[m.sym] || {}).expanded } }));
    } catch (e) { setScans((s) => ({ ...s, [m.sym]: { status: "error", data: null, reason: "couldn't reach the server", expanded: (s[m.sym] || {}).expanded } })); }
  }, []);
  const openScanner = () => { setScanOpen(true); if (movers.status === "idle") loadMovers(scanMode); };
  const CONV_COLOR = { Watch: T.dim, Speculative: T.amber, Constructive: T.green };
  const [intra, setIntra] = useState({}); // {SYM: [prices]}
  useEffect(() => {
    if (intra[selected]) return;
    let alive = true;
    let timer = null;
    const load = async (attempt = 0) => {
      const retry = () => { if (alive && attempt < 6) timer = setTimeout(() => load(attempt + 1), 5000); };
      try {
        if (isCrypto(selected)) {
          const coin = cryptoList.find((c) => c.sym === selected);
          if (!coin) return;
          const r = await fetch(`https://api.coingecko.com/api/v3/coins/${coin.id}/market_chart?vs_currency=usd&days=1`);
          const data = await r.json();
          if (!alive) return;
          if (!data.prices) { retry(); return; }
          setIntra((m) => ({ ...m, [selected]: data.prices.map((p) => p[1]) }));
        } else {
          const r = await fetch(`/api/intraday?symbol=${selected}`);
          const data = await r.json();
          if (!alive) return;
          // Transient failure (Twelve Data rate limit) — retry so the chart loads real intraday instead of the sparse fallback.
          if (!data.points) { retry(); return; }
          setIntra((m) => ({ ...m, [selected]: data.points }));
        }
      } catch { retry(); }
    };
    load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [selected, intra, isCrypto, cryptoList]);

  // pick the data for the active range; live ticks extend the 1D line
  const chartData = useMemo(() => {
    const closes = tech[selected]?.closes;
    if (chartRange === "1M" && closes?.length) return closes.slice(-22);
    if (chartRange === "3M" && closes?.length) return closes;
    const base = intra[selected];
    const live = prices[selected]?.price;
    if (base?.length) return live ? [...base, live] : base;
    return prices[selected]?.hist || [];
  }, [chartRange, tech, intra, prices, selected]);


  // ── Portfolio: manual positions with live P&L (SnapTrade auto-sync = phase 2) ──
  const [positions, setPositions] = useState(() => {
    try { return JSON.parse(localStorage.getItem("lt-portfolio-v1") || "[]"); } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem("lt-portfolio-v1", JSON.stringify(positions)); } catch {}
  }, [positions]);
  const [posForm, setPosForm] = useState({ sym: "", shares: "", cost: "" });
  const portfolio = useMemo(() => {
    let total = 0, totalCost = 0, dayChg = 0;
    const rows = positions.map((p) => {
      const live = prices[p.sym];
      const price = live?.price ?? 0;
      const value = price * p.shares;
      const cost = p.cost * p.shares;
      const gain = value - cost;
      const prevPrice = live?.chgPct != null ? price / (1 + live.chgPct / 100) : price;
      const day = (price - prevPrice) * p.shares;
      total += value; totalCost += cost; dayChg += day;
      return { ...p, price, value, gain, gainPct: cost ? (gain / cost) * 100 : 0, day };
    });
    return { rows, total, gain: total - totalCost, gainPct: totalCost ? ((total - totalCost) / totalCost) * 100 : 0, dayChg };
  }, [positions, prices]);

  const addPosition = async () => {
    const sym = posForm.sym.trim().toUpperCase();
    const shares = num(posForm.shares), cost = num(posForm.cost);
    if (!sym || !shares || shares <= 0 || !cost || cost <= 0) { pushToast("Fill in ticker, shares, and what you paid per share", T.red); return; }
    if (!watchlist.includes(sym)) {
      setAdding(true);
      try {
        let ok = await addStock(sym);
        if (!ok) {
          const cg = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(sym)}`);
          const found = await cg.json();
          const coin = (found.coins || []).find((c) => c.symbol?.toUpperCase() === sym);
          if (coin) ok = await addCoin(sym, coin.id, coin.name);
        }
        if (!ok) { pushToast(`Couldn't find a live quote for ${sym}`, T.red); return; }
      } finally { setAdding(false); }
    }
    setPositions((p) => [...p, { sym, shares, cost, id: Date.now() }]);
    setPosForm({ sym: "", shares: "", cost: "" });
    pushToast(`Position added: ${shares} ${sym} @ $${cost}`, T.green);
  };

  // ── Earnings: next report date for selected stock ──
  const [earn, setEarn] = useState({});
  useEffect(() => {
    if (isCrypto(selected) || earn[selected] !== undefined) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/earnings?symbol=${selected}`);
        const data = await r.json();
        if (alive) setEarn((e) => ({ ...e, [selected]: data.date || null }));
      } catch { if (alive) setEarn((e) => ({ ...e, [selected]: null })); }
    })();
    return () => { alive = false; };
  }, [selected, earn, isCrypto]);

  // ── Fundamentals (market cap, P/E, 52wk range) via existing Finnhub key ──
  const [fund, setFund] = useState({});
  useEffect(() => {
    if (isCrypto(selected) || fund[selected] !== undefined) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/fundamentals?symbol=${selected}`);
        const data = await r.json();
        if (alive) setFund((f) => ({ ...f, [selected]: data.hasAny ? data.fundamentals : null }));
      } catch { if (alive) setFund((f) => ({ ...f, [selected]: null })); }
    })();
    return () => { alive = false; };
  }, [selected, fund, isCrypto]);

  // ── AI Morning Briefing across the whole watchlist ──
  const [brief, setBrief] = useState({ status: "idle", text: "" });
  const getBriefing = async () => {
    if (brief.status === "loading") return;
    setBrief({ status: "loading", text: "" });
    const lines = watchlist.map((s) => {
      const p = prices[s];
      return p ? `${s}: $${fmtPrice(p.price)} (${(p.chgPct ?? 0) >= 0 ? "+" : ""}${(p.chgPct ?? 0).toFixed(2)}%)` : null;
    }).filter(Boolean).join("\n");
    const port = positions.length ? `\nTheir portfolio: ${positions.map(p => `${p.shares} shares ${p.sym} @ $${p.cost}`).join(", ")}. Current total value $${fmtPrice(portfolio.total)}, today ${portfolio.dayChg >= 0 ? "+" : ""}$${fmtPrice(Math.abs(portfolio.dayChg))}.` : "";
    const prompt = `You are a friendly market analyst writing a quick briefing for a regular person (not a professional trader). Date: ${new Date().toDateString()}.

Their watchlist right now:
${lines}${port}

Write a "Morning Briefing" in plain, everyday English: 1) one short paragraph on the overall picture across these names, 2) the 2-3 most notable movers and the likely why (only if you can infer it from the moves; don't invent news), 3) one thing worth keeping an eye on. Keep it under 160 words, warm but not salesy, no jargon without explaining it, no investment commands (use "worth watching" not "buy"). Plain text only, no markdown.`;
    try {
      const res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const data = await res.json();
      if (data.error || !data.text) throw new Error();
      setBrief({ status: "done", text: data.text.trim() });
    } catch {
      setBrief({ status: "error", text: "Briefing didn't come through — try again in a moment." });
    }
  };

  // ── Alpaca paper trading (fake money, real prices) ──
  const [alp, setAlp] = useState({ status: "loading", account: null, positions: [] });
  const [orderQty, setOrderQty] = useState("1");
  const [placing, setPlacing] = useState(false);
  const loadAlpaca = useCallback(async () => {
    try {
      const [acct, pos] = await Promise.all([
        fetch("/api/alpaca?action=account").then(r => r.json()),
        fetch("/api/alpaca?action=positions").then(r => r.json()),
      ]);
      if (acct.notConfigured) { setAlp({ status: "unconfigured", account: null, positions: [] }); return; }
      if (acct.error) { setAlp({ status: "error", account: null, positions: [] }); return; }
      setAlp({ status: "ready", account: acct, positions: pos.positions || [] });
    } catch { setAlp({ status: "error", account: null, positions: [] }); }
  }, []);
  useEffect(() => { loadAlpaca(); }, [loadAlpaca]);

  const placeOrder = async (side) => {
    const qty = num(orderQty);
    if (!qty || qty <= 0) { pushToast("Enter how many shares", T.red); return; }
    if (placing) return;
    setPlacing(true);
    try {
      const r = await fetch("/api/alpaca", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: selected, qty, side }) });
      const data = await r.json();
      if (data.error) { pushToast(`Order rejected: ${data.error}`, T.red); return; }
      pushToast(`PAPER ${side.toUpperCase()} placed: ${qty} ${selected} (${data.status})`, side === "buy" ? T.green : T.red);
      setTimeout(loadAlpaca, 1500);
    } catch { pushToast("Order didn't go through — try again", T.red); }
    finally { setPlacing(false); }
  };

  const loadNews = useCallback(async (sym) => {
    setNewsStatus("loading");
    try {
      const r = await fetch(`/api/news?symbol=${sym}&type=${isCrypto(sym) ? "crypto" : "stock"}`);
      const data = await r.json();
      if (data.news?.length) {
        setNewsBySym((n) => ({ ...n, [sym]: data.news.map((x) => ({ ...x, s: tagSentiment(x.h) })) }));
        setNewsStatus("done");
      } else setNewsStatus("empty");
    } catch { setNewsStatus("error"); }
  }, []);

  useEffect(() => { if (!newsBySym[selected]) loadNews(selected); }, [selected, newsBySym, loadNews]);

  useEffect(() => {
    const iv = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  const selLive = prices[selected];
  const selTech = tech[selected];
  const selNews = newsBySym[selected] || [];
  const removable = watchlist.length > 1;

  // ── Add helpers: used by both direct entry and search results ──
  const addStock = async (sym) => {
    const t = sym.toUpperCase();
    if (watchlist.includes(t)) { pushToast(`${t} is already on the watchlist`, T.dim); return false; }
    const r = await fetch(`/api/quotes?symbols=${t}`);
    const data = await r.json();
    if (!data[t]?.price) return false;
    setStockList((s) => [...s, t]);
    setWatchlist((w) => [...w, t]);
    mergePrices({ [t]: data[t] });
    setSelected(t);
    pushToast(`${t} added — live quote ${fmtPrice(data[t].price)}`, T.green);
    return true;
  };
  const addCoin = async (sym, id, name) => {
    const t = sym.toUpperCase();
    if (watchlist.includes(t)) { pushToast(`${t} is already on the watchlist`, T.dim); return false; }
    const pr = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`);
    const pd = await pr.json();
    if (!pd[id]?.usd) return false;
    setCryptoList((c) => [...c, { sym: t, id }]);
    setWatchlist((w) => [...w, t]);
    mergePrices({ [t]: { price: pd[id].usd, chgPct: pd[id].usd_24h_change ?? 0 } });
    setSelected(t);
    pushToast(`${t} (${name}) added — live ${fmtPrice(pd[id].usd)}`, T.green);
    return true;
  };

  // ── Live search-as-you-type: company names AND symbols, stocks AND crypto ──
  const [results, setResults] = useState([]);
  useEffect(() => {
    const q = addInput.trim();
    if (q.length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const [stockRes, cryptoRes] = await Promise.all([
          fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => ({ results: [] })),
          fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => ({ coins: [] })),
        ]);
        const stocks = (stockRes.results || []).map(x => ({ kind: "stock", symbol: x.symbol, name: x.name }));
        const coins = (cryptoRes.coins || []).slice(0, 3).map(c => ({ kind: "crypto", symbol: c.symbol?.toUpperCase(), name: c.name, id: c.id }));
        setResults([...stocks, ...coins].slice(0, 8));
      } catch { setResults([]); }
    }, 350);
    return () => clearTimeout(timer);
  }, [addInput]);

  const pickResult = async (res) => {
    if (adding) return;
    setAdding(true);
    try {
      const ok = res.kind === "crypto" ? await addCoin(res.symbol, res.id, res.name) : await addStock(res.symbol);
      if (ok) { setAddInput(""); setResults([]); }
      else if (!watchlist.includes(res.symbol)) pushToast(`No live quote available for ${res.symbol}`, T.red);
    } finally { setAdding(false); }
  };

  // Direct entry (Enter key / ADD button): exact symbol first, then top search hit
  const addTicker = async () => {
    const t = addInput.trim().toUpperCase();
    if (!t || adding) return;
    setAdding(true);
    try {
      if (/^[A-Z.\-]{1,10}$/.test(t)) {
        if (await addStock(t)) { setAddInput(""); setResults([]); return; }
        const cg = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(t)}`);
        const found = await cg.json();
        const coin = (found.coins || []).find((c) => c.symbol?.toUpperCase() === t);
        if (coin && await addCoin(t, coin.id, coin.name)) { setAddInput(""); setResults([]); return; }
      }
      if (results.length) { setAdding(false); return pickResult(results[0]); }
      pushToast(`Couldn't find "${addInput.trim()}" — try the company name or ticker symbol`, T.red);
    } catch {
      pushToast(`Lookup failed — try again in a moment`, T.red);
    } finally { setAdding(false); }
  };

  const addAlert = () => {
    const target = num(alertForm.target);
    if (!target || target <= 0) { pushToast("Enter a valid alert price", T.red); return; }
    setAlerts((a) => [...a, { id: Date.now(), ticker: alertForm.ticker, dir: alertForm.dir, target, triggered: false }]);
    pushToast(`Alert set: ${alertForm.ticker} ${alertForm.dir} ${fmtPrice(target)}`, T.green);
    setAlertForm((f) => ({ ...f, target: "" }));
  };

  const askAI = async () => {
    if (!selLive) return;
    setAi({ status: "loading", data: null, error: null });
    const t = selTech || {};
    const newsBlock = selNews.slice(0, 5).map((n) => `- ${n.h} (${n.src})`).join("\n") || "- (no recent headlines loaded)";
    const prompt = `You are a disciplined trading analyst. Analyze ${selected} (${NAMES[selected] || selected}) using ONLY the live data below. Today's date: ${new Date().toDateString()}.

Live price: ${fmtPrice(selLive.price)} (${selLive.chgPct >= 0 ? "+" : ""}${(selLive.chgPct ?? 0).toFixed(2)}% on the day)
RSI(14): ${t.rsi ?? "n/a"} | MACD: ${t.macd ?? "n/a"} vs signal ${t.signal ?? "n/a"}
20-day support: ${fmtPrice(t.support)} | 20-day resistance: ${fmtPrice(t.resistance)}
Latest daily volume: ${t.volume ? t.volume.toLocaleString() : "n/a"}${t.volRatio ? ` (${t.volRatio}x 60-day avg)` : ""}

Recent real headlines (judge their sentiment yourself from content):
${newsBlock}

Respond ONLY with raw JSON, no markdown fences, no preamble, exactly this shape:
{"action":"BUY|SELL|HOLD|WATCH","confidence":<0-100 integer>,"reasoning":"<3-4 sentences grounded in the technicals and headlines above>","entry":<number>,"target":<number>,"stopLoss":<number>,"timeframe":"<e.g. 1-2 weeks>"}`;
    try {
      const res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const clean = (data.text || "").replace(/```json|```/g, "").trim();
      const a = clean.indexOf("{"), b = clean.lastIndexOf("}");
      const parsed = JSON.parse(clean.slice(a, b + 1));
      setAi({ status: "done", data: parsed, error: null });
    } catch (e) {
      setAi({ status: "error", data: null, error: "The analysis didn't come through — usually a hiccup. Try once more; if it keeps failing, check ANTHROPIC_API_KEY in Netlify." });
    }
  };

  // "Explain like I'm new" — teaching walkthrough instead of a trade call
  const [teach, setTeach] = useState({ status: "idle", text: "" });
  const explainForBeginner = async () => {
    if (!selLive || teach.status === "loading") return;
    setTeach({ status: "loading", text: "" });
    const t = selTech || {};
    const prompt = `You are a patient teacher helping a complete beginner understand a stock screen. Asset: ${selected} (${NAMES[selected] || selected}). Live price $${fmtPrice(selLive.price)} (${(selLive.chgPct ?? 0).toFixed(2)}% today). RSI(14): ${t.rsi ?? "n/a"}. MACD ${t.macd ?? "n/a"} vs signal ${t.signal ?? "n/a"}. 20-day support ${fmtPrice(t.support)} / resistance ${fmtPrice(t.resistance)}. Volume ratio ${t.volRatio ?? "n/a"}x normal.

Walk them through what each of these numbers means using THIS stock as the example, in plain everyday English with a quick definition of each term as you go. Then one short paragraph: what a careful beginner would consider before acting (mention position sizing and that nobody can predict prices). Under 200 words, plain text, no markdown, warm and encouraging, no buy/sell commands.`;
    try {
      const res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const data = await res.json();
      if (data.error || !data.text) throw new Error();
      setTeach({ status: "done", text: data.text.trim() });
    } catch { setTeach({ status: "error", text: "Lesson didn't load — try again in a moment." }); }
  };

  const ACTION_COLORS = { BUY: T.green, SELL: T.red, HOLD: T.amber, WATCH: T.blue };
  const Label = ({ children }) => <div className="overline">{children}</div>;
  const feedDot = (s) => s === "live" ? T.green : s === "error" ? T.red : T.amber;

  return (
    <div style={{ background: T.bg, minHeight: "100vh", color: T.text, fontFamily: SANS, fontSize: 13 }}>
      {/* ── Top bar ── */}
      <div className="topbar flex items-center gap-4 px-4" style={{ height: 54, borderBottom: `1px solid ${T.border}` }}>
        <div className="flex items-baseline gap-2">
          <span style={{ color: T.amber, fontSize: 13 }}>◆</span>
          <span className="brand-serif" style={{ fontSize: 21, color: T.text }}>Legacy</span>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.24em", color: T.faint, textTransform: "uppercase" }}>Terminal</span>
        </div>
        <div className="hidden-sm items-center gap-2">
          {stream === "live" ? (
            <span className="pill" title="Open websocket — every trade arrives the instant it happens, no polling delay"
              style={{ background: `${T.green}14`, color: T.green, border: `1px solid ${T.green}55`, fontWeight: 700 }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: T.green, display: "inline-block", animation: "pulse 1.4s infinite" }} />
              STREAMING LIVE
            </span>
          ) : (
            <span className="pill" title="Live stream reconnecting — prices still refresh on the polling fallback"
              style={{ background: `${T.amber}14`, color: T.amber, border: `1px solid ${T.amber}44` }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: T.amber, display: "inline-block" }} />
              POLLING {feed.stocks === "error" ? "· STOCKS ERR" : ""}
            </span>
          )}
        </div>
        <button className="term-btn btn-gold scan-btn" onClick={openScanner}
          style={{ borderRadius: 8, cursor: "pointer", fontFamily: MONO, alignItems: "center", gap: 6 }}>
          ⚡ SCANNER
        </button>
        <div className="ml-auto flex items-center gap-3">
          {(() => {
            const ms = marketStatus(clock);
            const c = ms.color === "green" ? T.green : ms.color === "amber" ? T.amber : T.faint;
            return (
              <span className="pill hidden-sm" title={ms.open ? "Every trade streams in the instant it happens" : ms.ext ? "Off-session prices update every minute via Yahoo’s public 24-hour feed. Coverage depends on what each venue reports — the Pro Chart is the deepest overnight view." : "Quiet hours — prices hold at the last covered trade until the next session. Crypto streams 24/7 regardless."}
                style={{ background: `${c}14`, color: c, border: `1px solid ${c}44`, cursor: "help" }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: c, display: "inline-block", animation: ms.open ? "pulse 2.5s infinite" : "none" }} />
                {ms.label}
              </span>
            );
          })()}
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: T.dim }}>
            {clock.toLocaleTimeString("en-US", { hour12: false })}<span className="date-sm"> · {clock.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase()}</span>
          </span>
        </div>
      </div>

      {/* ── SCANNER overlay ── */}
      {scanOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(8,5,7,0.97)", backdropFilter: "blur(8px)", overflowY: "auto" }}>
          <div style={{ maxWidth: 920, margin: "0 auto", padding: "22px 18px 60px" }}>
            <div className="flex items-center gap-3 mb-2">
              <span style={{ color: T.amber, fontSize: 15 }}>⚡</span>
              <span className="brand-serif" style={{ fontSize: 24, color: T.text }}>Daily Scanner</span>
              <button className="term-btn x-btn ml-auto" onClick={() => setScanOpen(false)} style={{ fontSize: 22 }}>×</button>
            </div>
            <div style={{ fontSize: 12.5, color: T.dim, lineHeight: 1.6, marginBottom: 14, maxWidth: 680 }}>{scanMode === "ext" ? `The biggest movers in ${extSession} trading \u2014 names reacting to earnings or news after the bell, so you know what to watch when the market next opens. Tap any one for the AI read on the catalyst and a setup for the next session. Research starting points, never advice.` : "The biggest-moving names today, ranked by how much is happening. Tap any one and the AI reads its recent headlines, frames the likely catalyst and bull/bear case, and sketches a swing-trade setup. These are research starting points, never advice."}</div>
            <div className="flex items-center gap-2 mb-3" style={{ flexWrap: "wrap" }}>
              <div className="flex" style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
                <button className="term-btn" onClick={() => switchScanMode("today")} disabled={movers.status === "loading"}
                  style={{ padding: "8px 15px", cursor: "pointer", fontFamily: MONO, fontSize: 11, border: "none", background: scanMode === "today" ? T.amber : "transparent", color: scanMode === "today" ? T.bg : T.dim, fontWeight: scanMode === "today" ? 700 : 400 }}>
                  TODAY
                </button>
                <button className="term-btn" onClick={() => switchScanMode("ext")} disabled={movers.status === "loading"}
                  style={{ padding: "8px 15px", cursor: "pointer", fontFamily: MONO, fontSize: 11, border: "none", background: scanMode === "ext" ? T.amber : "transparent", color: scanMode === "ext" ? T.bg : T.dim, fontWeight: scanMode === "ext" ? 700 : 400 }}>
                  AFTER-HOURS
                </button>
              </div>
              <button className="term-btn btn-gold" onClick={() => loadMovers(scanMode)} disabled={movers.status === "loading"}
                style={{ borderRadius: 8, padding: "8px 18px", cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>
                {movers.status === "loading" ? "SCANNING…" : "↻ REFRESH"}
              </button>
              <span style={{ fontFamily: MONO, fontSize: 10, color: T.faint }}>
                {movers.status === "done" ? `${movers.list.length} candidates · ${scanMode === "ext" ? "by " + extSession + " move" : "ranked by activity"}` : ""}
              </span>
            </div>
            {movers.status === "error" && <div style={{ color: T.red, fontSize: 12 }}>Couldn’t load movers — check FINNHUB_KEY in Netlify.</div>}
            {movers.status === "loading" && <div style={{ color: T.dim, fontSize: 12, padding: 20 }}>Pulling the day’s most active names…</div>}
            <div className="flex flex-col gap-2">
              {movers.list.map((m, i) => {
                const sc = scans[m.sym] || { status: "idle" };
                const up = (m.chgPct ?? 0) >= 0;
                const a = sc.data;
                return (
                  <div key={m.sym} className="card" style={{ padding: 0, overflow: "hidden" }}>
                    <div className="flex items-center gap-3 cursor-pointer" style={{ padding: "13px 16px" }}
                      onClick={() => { const cur = scans[m.sym]; if (!cur || cur.status === "idle") runScan(m); setScans((s) => ({ ...s, [m.sym]: { ...(s[m.sym] || {}), expanded: !(s[m.sym] && s[m.sym].expanded) } })); }}>
                      <span style={{ fontFamily: MONO, fontSize: 11, color: T.faint, width: 18 }}>{i + 1}</span>
                      <div style={{ minWidth: 64 }}>
                        <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 14 }}>{m.sym}</div>
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 13 }}>${fmtPrice(m.price)}</div>
                      <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: up ? T.green : T.red }}>
                        {up ? "▲" : "▼"} {Math.abs(m.chgPct ?? 0).toFixed(2)}%
                      </div>
                      {a && a.conviction && (
                        <span className="pill" style={{ background: `${CONV_COLOR[a.conviction] || T.dim}1f`, color: CONV_COLOR[a.conviction] || T.dim, border: `1px solid ${CONV_COLOR[a.conviction] || T.dim}55`, fontSize: 9.5, fontWeight: 700 }}>
                          {a.conviction.toUpperCase()}
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-2">
                        <button className="term-btn btn-ghost" onClick={(e) => { e.stopPropagation(); setSelected(m.sym); if (!watchlist.includes(m.sym)) { setWatchlist((w) => [...w, m.sym]); setStockList((s) => s.includes(m.sym) ? s : [...s, m.sym]); } setScanOpen(false); }}
                          style={{ borderRadius: 6, padding: "5px 11px", cursor: "pointer", fontFamily: MONO, fontSize: 10 }}>
                          OPEN ↗
                        </button>
                        <span style={{ color: T.faint, fontSize: 11 }}>{sc.status === "loading" ? "⋯" : sc.expanded ? "▲" : "▼"}</span>
                      </div>
                    </div>
                    {sc.status === "loading" && <div style={{ padding: "0 16px 14px 52px", fontSize: 12, color: T.dim }}>Reading the headlines and sizing up the setup…</div>}
                    {sc.status === "error" && <div style={{ padding: "0 16px 14px 52px", fontSize: 12, color: T.red }}>Analysis failed: {sc.reason || "unknown"} — tap to retry.</div>}
                    {sc.status === "done" && sc.expanded && a && (
                      <div className="fade-up" style={{ padding: "4px 16px 18px 52px", display: "flex", flexDirection: "column", gap: 12 }}>
                        <ScanRow label="CATALYST" color={T.amber} text={a.catalyst} />
                        <ScanRow label="THE HYPE · READ SKEPTICALLY" color={T.blue} text={a.social} />
                        <div className="grid grid-4" style={{ gap: 10 }}>
                          <ScanRow label="BULL CASE" color={T.green} text={a.bull} />
                          <ScanRow label="BEAR · RISK" color={T.red} text={a.bear} />
                        </div>
                        {a.setup && (
                          <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, background: T.bg }}>
                            <div className="overline" style={{ marginBottom: 8 }}>THE SETUP · a framework, not a promise</div>
                            <div className="grid grid-4" style={{ gap: 10, fontFamily: MONO, fontSize: 11.5 }}>
                              <div><div style={{ color: T.faint, fontSize: 9, marginBottom: 3 }}>ENTRY</div>{a.setup.entry}</div>
                              <div><div style={{ color: T.green, fontSize: 9, marginBottom: 3 }}>TARGET</div>{a.setup.target}</div>
                              <div><div style={{ color: T.red, fontSize: 9, marginBottom: 3 }}>STOP</div>{a.setup.stop}</div>
                              <div><div style={{ color: T.faint, fontSize: 9, marginBottom: 3 }}>HOLD</div>{a.setup.timeframe}</div>
                            </div>
                          </div>
                        )}
                        {a.caution && <div style={{ fontSize: 11.5, color: T.amber, lineHeight: 1.5 }}>⚠ {a.caution}</div>}
                        <div style={{ fontSize: 10, color: T.faint }}>AI-generated from live web search. Verify before risking money. Not financial advice.</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {movers.status === "done" && (
              <div style={{ marginTop: 24, padding: 14, border: `1px solid ${T.border}`, borderRadius: 10, fontSize: 11.5, color: T.dim, lineHeight: 1.6 }}>
                <span style={{ color: T.text, fontWeight: 600 }}>How to use this well:</span> the scanner finds what’s moving and explains why — it does not know the future. Treat every idea as a question to investigate, size positions with the risk calculator so no single trade can hurt you, and remember that loud social buzz often means the easy money already left. The traders who last are the ones who pass on most ideas.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Live ticker tape ── */}
      <div className="tape-wrap">
        <div className="tape-track" style={{ fontFamily: MONO, fontSize: 11 }}>
          {[0, 1].map((rep) => (
            <div key={rep} className="flex items-center">
              {watchlist.map((tk) => {
                const p = prices[tk];
                if (!p) return null;
                const up = (p.chgPct ?? 0) >= 0;
                return (
                  <span key={`${rep}-${tk}`} className="cursor-pointer" onClick={() => setSelected(tk)} style={{ padding: "0 18px" }}>
                    <span style={{ fontWeight: 700 }}>{tk}</span>
                    <span style={{ color: T.dim, margin: "0 6px" }}>${fmtPrice(p.price)}</span>
                    <span style={{ color: up ? T.green : T.red }}>{up ? "▲" : "▼"}{Math.abs(p.chgPct ?? 0).toFixed(2)}%</span>
                    <span style={{ color: T.faint, marginLeft: 18 }}>·</span>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ── Main grid ── */}
      <div className="flex flex-col lg-row">
        {/* LEFT: Watchlist */}
        <div className="w-full lg-w-72 shrink-0" style={{ borderRight: `1px solid ${T.border}`, background: T.panel }}>
          <div className="px-3 pt-3 pb-2"><Label>Watchlist · live quotes</Label></div>
          <div style={{ maxHeight: 480, overflowY: "auto" }}>
            {watchlist.map((tk) => {
              const p = prices[tk];
              const up = (p?.chgPct ?? 0) >= 0, c = up ? T.green : T.red;
              return (
                <div key={tk} className={`wl-row flex items-center gap-2 px-3 cursor-pointer${selected === tk ? " sel" : ""}`} onClick={() => { setSelected(tk); setAi({ status: "idle", data: null, error: null }); setTeach({ status: "idle", text: "" }); }}>
                  <div style={{ width: 58 }}>
                    <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, letterSpacing: "0.02em" }}>{tk}</div>
                    <div style={{ fontFamily: MONO, fontSize: 8.5, color: T.faint, letterSpacing: "0.16em", marginTop: 2 }}>{isCrypto(tk) ? "CRYPTO" : "NASDAQ"}</div>
                  </div>
                  <Sparkline data={p?.hist} color={c} id={tk} w={76} h={24} />
                  <div className="ml-auto text-right" style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p ? `$${fmtPrice(p.price)}` : "…"}</div>
                    <div style={{ fontSize: 10.5, color: c, marginTop: 2 }}>{p ? `${up ? "▲" : "▼"} ${Math.abs(p.chgPct ?? 0).toFixed(2)}%` : ""}</div>
                  </div>
                  {removable && (
                    <button className="term-btn x-btn" title={`Remove ${tk}`} onClick={(e) => { e.stopPropagation(); const held = positions.some((q) => q.sym === tk); setWatchlist((w) => w.filter((x) => x !== tk)); if (!held) { setStockList((s) => s.filter((x) => x !== tk)); setCryptoList((cl) => cl.filter((x) => x.sym !== tk)); } if (selected === tk) setSelected(watchlist.find((x) => x !== tk)); }}>×</button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="p-3" style={{ borderTop: `1px solid ${T.border}` }}>
            <div style={{ position: "relative" }}>
              <div className="flex gap-2">
                <input value={addInput} onChange={(e) => setAddInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTicker()} placeholder="Search any stock or coin… e.g. Palantir"
                  style={{ flex: 1, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 4, padding: "6px 8px", color: T.text, fontFamily: MONO, fontSize: 11, minWidth: 0 }} />
                <button className="term-btn" onClick={addTicker} disabled={adding} style={{ background: T.panel2, border: `1px solid ${T.border}`, color: T.text, borderRadius: 4, padding: "6px 12px", cursor: adding ? "wait" : "pointer", fontFamily: MONO, fontSize: 11 }}>{adding ? "…" : "ADD"}</button>
              </div>
              {results.length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: T.panel2, border: `1px solid ${T.border}`, borderRadius: 6, zIndex: 40, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", maxHeight: 260, overflowY: "auto" }}>
                  {results.map((res, i) => (
                    <div key={`${res.kind}-${res.symbol}-${i}`} onClick={() => pickResult(res)} className="cursor-pointer wl-row flex items-center gap-2"
                      style={{ padding: "8px 10px", borderBottom: i < results.length - 1 ? `1px solid ${T.border}55` : "none" }}>
                      <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 12, minWidth: 52 }}>{res.symbol}</span>
                      <span style={{ fontSize: 11, color: T.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{res.name}</span>
                      <span style={{ fontFamily: MONO, fontSize: 9, color: res.kind === "crypto" ? T.amber : T.blue, letterSpacing: "0.1em" }}>{res.kind === "crypto" ? "CRYPTO" : "STOCK"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Portfolio */}
          <div className="p-3" style={{ borderTop: `1px solid ${T.border}` }}>
            <Label>My portfolio · live P&L</Label>
            {portfolio.rows.length > 0 && (
              <div className="card" style={{ padding: "10px 12px", marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: T.dim, letterSpacing: "0.1em", fontFamily: MONO }}>TOTAL VALUE</div>
                <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 800 }}>${fmtPrice(portfolio.total)}</div>
                <div className="flex gap-3" style={{ fontFamily: MONO, fontSize: 11, marginTop: 2 }}>
                  <span style={{ color: portfolio.dayChg >= 0 ? T.green : T.red }}>{portfolio.dayChg >= 0 ? "▲" : "▼"} ${fmtPrice(Math.abs(portfolio.dayChg))} today</span>
                  <span style={{ color: portfolio.gain >= 0 ? T.green : T.red }}>{portfolio.gain >= 0 ? "+" : "−"}${fmtPrice(Math.abs(portfolio.gain))} ({portfolio.gainPct.toFixed(1)}%) all time</span>
                </div>
              </div>
            )}
            {portfolio.rows.map((p) => (
              <div key={p.id} className="flex items-center gap-2 py-1 cursor-pointer" onClick={() => setSelected(p.sym)} style={{ fontFamily: MONO, fontSize: 11 }}>
                <span style={{ fontWeight: 700, minWidth: 44 }}>{p.sym}</span>
                <span style={{ color: T.dim }}>{p.shares} sh</span>
                <span className="ml-auto">${fmtPrice(p.value)}</span>
                <span style={{ color: p.gain >= 0 ? T.green : T.red, minWidth: 64, textAlign: "right" }}>{p.gain >= 0 ? "+" : "−"}${fmtPrice(Math.abs(p.gain))}</span>
                <button onClick={(e) => { e.stopPropagation(); setPositions((ps) => ps.filter((x) => x.id !== p.id)); }} className="x-btn">×</button>
              </div>
            ))}
            {portfolio.rows.length === 0 && <div style={{ fontSize: 11, color: T.faint, marginBottom: 8 }}>Track what you own: enter a ticker, how many shares, and what you paid. Live profit/loss from then on.</div>}
            <div className="flex gap-1 mt-2">
              <input value={posForm.sym} onChange={(e) => setPosForm((f) => ({ ...f, sym: e.target.value }))} placeholder="AAPL"
                style={{ width: 64, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 4, padding: "5px 6px", color: T.text, fontFamily: MONO, fontSize: 11 }} />
              <input value={posForm.shares} onChange={(e) => setPosForm((f) => ({ ...f, shares: e.target.value }))} placeholder="shares" inputMode="decimal"
                style={{ flex: 1, minWidth: 0, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 4, padding: "5px 6px", color: T.text, fontFamily: MONO, fontSize: 11 }} />
              <input value={posForm.cost} onChange={(e) => setPosForm((f) => ({ ...f, cost: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && addPosition()} placeholder="$ paid" inputMode="decimal"
                style={{ flex: 1, minWidth: 0, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 4, padding: "5px 6px", color: T.text, fontFamily: MONO, fontSize: 11 }} />
              <button className="term-btn" onClick={addPosition} style={{ background: `${T.green}1a`, border: `1px solid ${T.green}66`, color: T.green, borderRadius: 4, padding: "5px 9px", cursor: "pointer", fontFamily: MONO, fontSize: 11, fontWeight: 700 }}>ADD</button>
            </div>
          </div>

          {/* Alerts */}
          <div className="p-3" style={{ borderTop: `1px solid ${T.border}` }}>
            <Label>Price alerts · checked against live feed</Label>
            <div className="flex gap-1 mb-2">
              <select value={alertForm.ticker} onChange={(e) => setAlertForm((f) => ({ ...f, ticker: e.target.value }))}
                style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 4, color: T.text, fontFamily: MONO, fontSize: 11, padding: "5px 4px" }}>
                {watchlist.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <select value={alertForm.dir} onChange={(e) => setAlertForm((f) => ({ ...f, dir: e.target.value }))}
                style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 4, color: T.text, fontFamily: MONO, fontSize: 11, padding: "5px 4px" }}>
                <option>ABOVE</option><option>BELOW</option>
              </select>
              <input value={alertForm.target} onChange={(e) => setAlertForm((f) => ({ ...f, target: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && addAlert()} placeholder="price" inputMode="decimal"
                style={{ width: 70, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 4, padding: "5px 6px", color: T.text, fontFamily: MONO, fontSize: 11 }} />
              <button className="term-btn" onClick={addAlert} style={{ background: `${T.amber}22`, border: `1px solid ${T.amber}66`, color: T.amber, borderRadius: 4, padding: "5px 8px", cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>SET</button>
            </div>
            {alerts.length === 0 && <div style={{ fontSize: 11, color: T.faint }}>No alerts yet. These check the real feed — stocks every 30s, crypto every 60s — while this tab is open and visible.</div>}
            {alerts.map((a) => (
              <div key={a.id} className="flex items-center gap-2 py-1" style={{ fontFamily: MONO, fontSize: 11, color: a.triggered ? T.faint : T.text }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: a.triggered ? T.faint : T.amber, display: "inline-block" }} />
                <span>{a.ticker} {a.dir} {fmtPrice(a.target)}</span>
                {a.triggered && <span style={{ color: T.amber }}>· FIRED</span>}
                <button onClick={() => setAlerts((as) => as.filter((x) => x.id !== a.id))} className="x-btn" style={{ marginLeft: "auto" }}>×</button>
              </div>
            ))}
          </div>
        </div>

        {/* CENTER: selected asset */}
        <div className="flex-1 min-w-0 p-4" style={{ background: T.bg }}>
          {showWelcome && (
            <div className="card fade-up" style={{ padding: 16, marginBottom: 14, border: `1px solid ${T.amber}55` }}>
              <div className="flex items-center justify-between">
                <Label>Welcome — here's the whole workflow</Label>
                <button className="x-btn" onClick={() => { setShowWelcome(false); try { localStorage.setItem("lt-welcome-v1", "seen"); } catch {} }} style={{ fontSize: 16 }}>×</button>
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.8 }}>
                <span style={{ color: T.amber, fontWeight: 700 }}>1.</span> Pick or search a stock on the left →&nbsp;
                <span style={{ color: T.amber, fontWeight: 700 }}>2.</span> Read its chart, signals, and news →&nbsp;
                <span style={{ color: T.amber, fontWeight: 700 }}>3.</span> Get the AI's opinion (or the beginner walkthrough) →&nbsp;
                <span style={{ color: T.amber, fontWeight: 700 }}>4.</span> Practice the trade with pretend money before ever using real dollars.
              </div>
              <div style={{ fontSize: 11, color: T.dim, marginTop: 6 }}>New to all of it? The <span style={{ color: T.text }}>Trading 101</span> lessons are on the right, and the risk calculator below tells you how much is safe to buy. Nothing here is financial advice — it's a place to learn and watch.</div>
            </div>
          )}

          <div className="fade-up">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="hero-name" style={{ fontSize: 26 }}>{NAMES[selected] || selected}</span>
              <span style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.18em", color: T.dim }}>{selected} · {isCrypto(selected) ? "CRYPTO" : "NASDAQ"}</span>
              {earn[selected] && (
                <span className="pill" style={{ fontSize: 10, fontWeight: 700, background: `${T.amber}14`, color: T.amber, border: `1px solid ${T.amber}44` }}>
                  EARNINGS {new Date(earn[selected] + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-4 flex-wrap" style={{ marginTop: 6 }}>
              <span className="hero-price" style={{ fontSize: 58, lineHeight: 1 }}>{selLive ? `$${fmtPrice(selLive.price)}` : "…"}</span>
              {selLive && (
                <span style={{ fontFamily: MONO, fontSize: 17, fontWeight: 700, color: (selLive.chgPct ?? 0) >= 0 ? T.green : T.red }}>
                  {(selLive.chgPct ?? 0) >= 0 ? "▲" : "▼"} {Math.abs(selLive.chgPct ?? 0).toFixed(2)}%<span style={{ fontSize: 11, color: T.dim, fontWeight: 400, marginLeft: 6 }}>{!isCrypto(selected) && marketStatus(clock).ext ? "incl. extended hours" : "today"}</span>
                </span>
              )}
              {selLive?.high && selLive?.low && selLive.high > selLive.low && (
                <div className="ml-auto hidden-sm flex-col" style={{ alignItems: "flex-end", gap: 6, display: "flex" }}>
                  <div className="range-track">
                    <div className="range-dot" style={{ left: `${Math.min(Math.max(((selLive.price - selLive.low) / (selLive.high - selLive.low)) * 100, 0), 100)}%` }} />
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 9.5, color: T.faint, letterSpacing: "0.1em" }}>${fmtPrice(selLive.low)} · TODAY · ${fmtPrice(selLive.high)}</div>
                </div>
              )}
            </div>
          </div>

          {!isCrypto(selected) && fund[selected] && (() => {
            const f = fund[selected];
            const fmtCap = (n) => n == null ? null : (n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${Math.round(n)}`);
            const stats = [
              ["MKT CAP", fmtCap(f.marketCap)],
              ["P/E", f.peRatio != null ? f.peRatio.toFixed(1) : null],
              ["EPS", f.eps != null ? `$${f.eps.toFixed(2)}` : null],
              ["52W RANGE", (f.week52Low != null && f.week52High != null) ? `$${fmtPrice(f.week52Low)} \u2013 $${fmtPrice(f.week52High)}` : null],
              ["DIV YIELD", f.dividendYield != null ? `${f.dividendYield.toFixed(2)}%` : null],
              ["BETA", f.beta != null ? f.beta.toFixed(2) : null],
              ["ANALYSTS", f.analysts ? `${f.analysts.label} \u00b7 ${f.analysts.total}` : null],
            ].filter(([, v]) => v != null);
            if (!stats.length) return null;
            return (
              <div className="card mt-3 fade-up" style={{ padding: "12px 14px" }}>
                <Label>Key stats{f.industry ? ` \u00b7 ${f.industry}` : ""}</Label>
                <div className="flex flex-wrap" style={{ gap: "10px 26px", marginTop: 8 }}>
                  {stats.map(([k, v]) => (
                    <div key={k}>
                      <div style={{ fontFamily: MONO, fontSize: 9.5, color: T.faint, letterSpacing: "0.08em" }}>{k}</div>
                      <div style={{ fontFamily: MONO, fontSize: 14, color: T.text, fontWeight: 700 }}>{v}</div>
                    </div>
                  ))}
                </div>
                {Array.isArray(f.peers) && f.peers.length > 0 && (
                  <div className="flex flex-wrap items-center" style={{ gap: 6, marginTop: 12 }}>
                    <span style={{ fontFamily: MONO, fontSize: 9.5, color: T.faint, letterSpacing: "0.08em" }}>PEERS</span>
                    {f.peers.map((pp) => (
                      <button key={pp} className="term-btn" onClick={() => { setSelected(pp); if (!watchlist.includes(pp)) { setWatchlist((w) => [...w, pp]); setStockList((st) => st.includes(pp) ? st : [...st, pp]); } }}
                        style={{ fontFamily: MONO, fontSize: 10, padding: "3px 9px", borderRadius: 6, cursor: "pointer", background: "transparent", border: `1px solid ${T.border}`, color: T.dim }}>{pp}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          <div className="card mt-3 fade-up" style={{ padding: "12px 14px" }}>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {chartMode === "simple" && ["1D", "1M", "3M"].map((r) => (
                <button key={r} className="term-btn" onClick={() => setChartRange(r)}
                  style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, padding: "4px 14px", borderRadius: 99, cursor: "pointer", background: chartRange === r ? `${T.amber}22` : "transparent", color: chartRange === r ? T.amber : T.dim, border: `1px solid ${chartRange === r ? T.amber : T.border}` }}>
                  {r}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1" style={{ border: `1px solid ${T.border}`, borderRadius: 99, padding: 2 }}>
                {[["simple", "SIMPLE"], ["pro", "PRO CHART"]].map(([mode, label]) => (
                  <button key={mode} className="term-btn" onClick={() => setChartMode(mode)}
                    style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, padding: "4px 12px", borderRadius: 99, cursor: "pointer", border: "none", background: chartMode === mode ? `${T.amber}22` : "transparent", color: chartMode === mode ? T.amber : T.dim }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {chartMode === "pro" ? (
              <>
                <TVChart symbol={selected} crypto={isCrypto(selected)} cryptoId={cryptoList.find((c) => c.sym === selected)?.id} />
                <div style={{ fontFamily: MONO, fontSize: 9, color: T.faint, marginTop: 6 }}>Pro chart by TradingView — candlesticks, indicators, drawing tools, extended hours. Alerts and AI here still run on the terminal's own live feed.</div>
              </>
            ) : (
              <BigChart data={chartData} color={chartData.length > 1 && chartData[chartData.length - 1] >= chartData[0] ? T.green : T.red} />
            )}
          </div>

          {/* Technicals — plain-English first, trader numbers second */}
          <div className="grid grid-3 mt-3">
            {(() => {
              const mo = momentumVerdict(selTech?.rsi);
              const tr = trendVerdict(selTech?.macd, selTech?.signal);
              const ac = activityVerdict(selTech?.volRatio);
              const vc = (v) => v.color === "green" ? T.green : v.color === "red" ? T.red : v.color === "amber" ? T.amber : T.text;
              return (
                <>
                  <div className="card fade-up" style={{ padding: 16 }}>
                    <Label>Momentum</Label>
                    <div style={{ fontSize: 22, fontWeight: 700, color: vc(mo), marginBottom: 4 }}>{mo.word}</div>
                    {mo.hint && <div style={{ fontSize: 11.5, color: T.dim, marginBottom: 10 }}>{mo.hint}</div>}
                    <RsiGauge rsi={selTech?.rsi} />
                    <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint, marginTop: 6 }}>RSI(14): {selTech?.rsi ?? "…"}</div>
                  </div>
                  <div className="card fade-up" style={{ padding: 16 }}>
                    <Label>Trend</Label>
                    <div style={{ fontSize: 22, fontWeight: 700, color: vc(tr), marginBottom: 4 }}>{tr.word}</div>
                    {tr.hint && <div style={{ fontSize: 11.5, color: T.dim, marginBottom: 10 }}>{tr.hint}</div>}
                    <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint, marginTop: "auto" }}>MACD {selTech?.macd ?? "…"} vs signal {selTech?.signal ?? "…"}</div>
                  </div>
                  <div className="card fade-up" style={{ padding: 16 }}>
                    <Label>Trading activity</Label>
                    <div style={{ fontSize: 22, fontWeight: 700, color: vc(ac), marginBottom: 4 }}>{ac.word}</div>
                    {ac.hint && <div style={{ fontSize: 11.5, color: T.dim, marginBottom: 10 }}>{ac.hint}</div>}
                    <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint }}>{selTech?.volume ? `${Intl.NumberFormat("en", { notation: "compact" }).format(selTech.volume)} shares · ${selTech?.volRatio ?? "—"}x normal` : "loading volume…"}</div>
                  </div>
                </>
              );
            })()}
          </div>

          <div className="card mt-3 fade-up" style={{ borderLeft: `3px solid ${T.amber}`, padding: 16 }}>
            <Label>What this means</Label>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>{rsiPlainEnglish(selTech?.rsi, selected)}</div>
            {selTech?.support != null && (
              <div className="flex gap-4 flex-wrap mt-2" style={{ fontFamily: MONO, fontSize: 11 }}>
                <span style={{ color: T.green }}>FLOOR (support) ${fmtPrice(selTech.support)}</span>
                <span style={{ color: T.red }}>CEILING (resistance) ${fmtPrice(selTech.resistance)}</span>
              </div>
            )}
          </div>

          {/* AI suggestion */}
          <div className="card mt-3 fade-up" style={{ border: `1px solid ${T.ai}55`, padding: 16, background: `linear-gradient(180deg, ${T.ai}0d, transparent)` }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <Label>AI second opinion · powered by Claude</Label>
              <button className="term-btn btn-gold" onClick={askAI} disabled={ai.status === "loading" || !selLive}
                style={{ borderRadius: 8, padding: "9px 18px", cursor: ai.status === "loading" ? "wait" : "pointer", fontFamily: MONO, fontSize: 12 }}>
                {ai.status === "loading" ? "THINKING…" : `GET AI OPINION ON ${selected}`}
              </button>
            </div>
            {ai.status === "idle" && <div style={{ fontSize: 12, color: T.dim, marginTop: 8 }}>One click: the AI reads the live price, momentum, trend, volume, and today's headlines — then gives a clear Buy / Sell / Hold / Watch call with its reasoning, in plain English.</div>}
            <div className="flex mt-2">
              <button className="term-btn" onClick={explainForBeginner} disabled={teach.status === "loading" || !selLive}
                style={{ background: "transparent", border: `1px solid ${T.blue}66`, color: T.blue, borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontFamily: MONO, fontSize: 11, fontWeight: 700 }}>
                {teach.status === "loading" ? "TEACHING…" : "🎓 NEW TO THIS? EXPLAIN THIS SCREEN"}
              </button>
            </div>
            {teach.status === "error" && <div style={{ fontSize: 12, color: T.red, marginTop: 8 }}>{teach.text}</div>}
            {teach.status === "done" && (
              <div className="mt-3" style={{ fontSize: 12.5, lineHeight: 1.7, whiteSpace: "pre-wrap", borderLeft: `2px solid ${T.blue}`, paddingLeft: 12, color: T.text }}>{teach.text}</div>
            )}
            {ai.status === "error" && <div style={{ fontSize: 12, color: T.red, marginTop: 8 }}>{ai.error}</div>}
            {ai.status === "done" && ai.data && (
              <div className="mt-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 800, color: ACTION_COLORS[ai.data.action] || T.text, border: `1px solid ${ACTION_COLORS[ai.data.action] || T.border}`, borderRadius: 4, padding: "4px 14px" }}>
                    {ai.data.action}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 12, color: T.dim }}>CONFIDENCE</div>
                  <div style={{ flex: 1, minWidth: 120, height: 6, background: T.border, borderRadius: 3 }}>
                    <div style={{ width: `${Math.min(ai.data.confidence, 100)}%`, height: 6, background: ACTION_COLORS[ai.data.action] || T.blue, borderRadius: 3 }} />
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 13 }}>{ai.data.confidence}%</div>
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 10 }}>{ai.data.reasoning}</div>
                <div className="grid grid-4 gap-2 mt-3" style={{ fontFamily: MONO, fontSize: 12 }}>
                  {[["ENTRY", ai.data.entry, T.text], ["TARGET", ai.data.target, T.green], ["STOP", ai.data.stopLoss, T.red], ["HORIZON", ai.data.timeframe, T.blue]].map(([l, v, c]) => (
                    <div key={l} style={{ background: T.panel2, border: `1px solid ${T.border}`, borderRadius: 4, padding: "8px 10px" }}>
                      <div style={{ fontSize: 9.5, color: T.dim, letterSpacing: "0.1em" }}>{l}</div>
                      <div style={{ color: c, marginTop: 2 }}>{typeof v === "number" ? fmtPrice(v) : v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10.5, color: T.faint, marginTop: 8 }}>Model output for research and education — not investment advice. Markets can invalidate any setup.</div>
              </div>
            )}
          </div>

          {/* Paper trading */}
          <div className="card mt-3 fade-up" style={{ padding: 16 }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <Label>Practice trading · fake money, real prices</Label>
              {alp.status === "ready" && (
                <span style={{ fontFamily: MONO, fontSize: 11, color: T.dim }}>
                  Practice account: <span style={{ color: T.text, fontWeight: 700 }}>${fmtPrice(alp.account.equity)}</span> · ${fmtPrice(alp.account.buyingPower)} to spend
                </span>
              )}
            </div>
            {alp.status === "unconfigured" && (
              <div style={{ fontSize: 12, color: T.dim, lineHeight: 1.6, marginTop: 6 }}>
                Practice buying and selling with $100K of pretend money — a safe way to test ideas before using real dollars.
                <span style={{ color: T.text }}> To turn it on:</span> sign up free at <span style={{ color: T.amber }}>alpaca.markets</span>, open the Paper Trading dashboard, generate API keys, then add <span style={{ fontFamily: MONO }}>ALPACA_KEY</span> and <span style={{ fontFamily: MONO }}>ALPACA_SECRET</span> in Netlify environment variables and redeploy.
              </div>
            )}
            {alp.status === "error" && <div style={{ fontSize: 12, color: T.red, marginTop: 6 }}>Couldn't reach the practice account — double-check ALPACA_KEY and ALPACA_SECRET in Netlify.</div>}
            {alp.status === "ready" && (
              <>
                {isCrypto(selected) ? (
                  <div style={{ fontSize: 12, color: T.dim, marginTop: 6 }}>Practice trading covers US stocks — pick a stock from the watchlist to place a paper trade.</div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap mt-2">
                    <input value={orderQty} onChange={(e) => setOrderQty(e.target.value)} inputMode="decimal" placeholder="shares"
                      style={{ width: 90, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 10px", color: T.text, fontFamily: MONO, fontSize: 12 }} />
                    <span style={{ fontFamily: MONO, fontSize: 11, color: T.dim }}>shares of {selected}</span>
                    <button className="term-btn" onClick={() => placeOrder("buy")} disabled={placing}
                      style={{ background: `${T.green}1f`, border: `1px solid ${T.green}`, color: T.green, borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontFamily: MONO, fontSize: 12, fontWeight: 800 }}>
                      {placing ? "…" : "PAPER BUY"}
                    </button>
                    <button className="term-btn" onClick={() => placeOrder("sell")} disabled={placing}
                      style={{ background: `${T.red}1f`, border: `1px solid ${T.red}`, color: T.red, borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontFamily: MONO, fontSize: 12, fontWeight: 800 }}>
                      {placing ? "…" : "PAPER SELL"}
                    </button>
                  </div>
                )}
                {alp.positions.length > 0 && (
                  <div className="mt-3">
                    <div style={{ fontSize: 10, color: T.dim, letterSpacing: "0.12em", fontFamily: MONO, marginBottom: 6 }}>PRACTICE POSITIONS</div>
                    {alp.positions.map((p) => (
                      <div key={p.symbol} className="flex items-center gap-3 py-1" style={{ fontFamily: MONO, fontSize: 11.5 }}>
                        <span style={{ fontWeight: 700, minWidth: 50 }}>{p.symbol}</span>
                        <span style={{ color: T.dim }}>{p.qty} sh @ ${fmtPrice(p.avgCost)}</span>
                        <span className="ml-auto">${fmtPrice(p.value)}</span>
                        <span style={{ color: p.gain >= 0 ? T.green : T.red, minWidth: 90, textAlign: "right" }}>{p.gain >= 0 ? "+" : "−"}${fmtPrice(Math.abs(p.gain))} ({p.gainPct.toFixed(1)}%)</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 10, color: T.faint, marginTop: 8 }}>Paper trades use pretend money on Alpaca's simulator. Practice results don't guarantee real-market results — fills, fees, and emotions all differ with real dollars.</div>
              </>
            )}
          </div>

          {/* Risk calculator */}
          <div className="card mt-3 fade-up" style={{ padding: 16 }}>
            <Label>How much should I buy? · risk calculator</Label>
            <div style={{ fontSize: 11.5, color: T.dim, marginBottom: 10, lineHeight: 1.55 }}>
              The #1 habit that separates careful traders from gamblers: decide how much you're willing to lose <i>before</i> you buy. Most professionals risk only 1–2% of their account on any single trade.
            </div>
            <RiskCalc livePrice={selLive?.price} sym={selected} />
          </div>
        </div>

        {/* RIGHT: news + broker note */}
        <div className="w-full lg-w-80 shrink-0 p-4" style={{ borderLeft: `1px solid ${T.border}`, background: T.panel }}>
          <div className="card fade-up" style={{ padding: 14, marginBottom: 14, border: `1px solid ${T.amber}44`, background: `linear-gradient(180deg, ${T.amber}0d, transparent)` }}>
            <div className="flex items-center justify-between">
              <Label>AI morning briefing</Label>
              <button className="term-btn" onClick={getBriefing} disabled={brief.status === "loading"}
                style={{ background: `${T.amber}1f`, border: `1px solid ${T.amber}`, color: T.amber, borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontFamily: MONO, fontSize: 10.5, fontWeight: 700, marginBottom: 6 }}>
                {brief.status === "loading" ? "WRITING…" : brief.status === "done" ? "⟳ REFRESH" : "GET BRIEFING"}
              </button>
            </div>
            {brief.status === "idle" && <div style={{ fontSize: 11.5, color: T.dim }}>One tap: a plain-English summary of what's moving across your whole watchlist right now.</div>}
            {brief.status === "error" && <div style={{ fontSize: 11.5, color: T.red }}>{brief.text}</div>}
            {brief.status === "done" && <div style={{ fontSize: 12.5, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{brief.text}</div>}
          </div>

          <div className="flex items-center justify-between">
            <Label>Latest news · {selected}</Label>
            <button className="term-btn" onClick={() => loadNews(selected)} disabled={newsStatus === "loading"}
              style={{ background: "none", border: `1px solid ${T.blue}66`, color: T.blue, borderRadius: 4, padding: "3px 10px", cursor: "pointer", fontFamily: MONO, fontSize: 10, marginBottom: 6 }}>
              {newsStatus === "loading" ? "LOADING…" : "⟳ REFRESH"}
            </button>
          </div>
          {newsStatus === "error" && <div style={{ fontSize: 11, color: T.red }}>News feed unavailable — check FINNHUB_KEY in Netlify env vars.</div>}
          {newsStatus === "empty" && <div style={{ fontSize: 11, color: T.faint }}>No headlines in the last 5 days for {selected}.</div>}
          <div className="flex flex-col gap-2">
            {selNews.map((n, i) => (
              <a key={i} href={n.url} target="_blank" rel="noreferrer" className="card" style={{ textDecoration: "none", color: "inherit", padding: "11px 13px", display: "block" }}>
                <div className="flex items-center gap-2 mb-1">
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: SENT[n.s].c, display: "inline-block" }} />
                  <span style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: "0.18em", color: SENT[n.s].c }}>{SENT[n.s].label}</span>
                  <span style={{ fontFamily: MONO, fontSize: 9, color: T.faint, marginLeft: "auto", letterSpacing: "0.06em" }}>{n.src}</span>
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.5, fontWeight: 500 }}>{n.h}</div>
              </a>
            ))}
          </div>
          <div style={{ fontSize: 9.5, color: T.faint, marginTop: 6 }}>Badges are keyword-based at a glance; the AI analysis judges each headline's actual content.</div>

          <div className="card mt-4" style={{ padding: 14 }}>
            <Label>Trading 101 · tap to learn</Label>
            <Lessons />
          </div>

          <div className="card mt-4" style={{ padding: 14 }}>
            <Label>Brokerage connectivity</Label>
            <div style={{ fontSize: 11.5, lineHeight: 1.6, color: T.dim }}>
              <span style={{ color: T.text }}>Robinhood can't connect here</span> — its API requires backend OAuth token custody beyond what this app does.
              <div style={{ marginTop: 8 }}>
                <span style={{ color: T.blue }}>Next phase:</span> <span style={{ color: T.text }}>Alpaca Markets</span> paper trading. Free API, simulated fills — a clean way to wire BUY/SELL buttons to real order flow without risking capital. The serverless layer here is already built for it.
              </div>
            </div>
          </div>

          <div className="mt-4" style={{ fontSize: 10, color: T.faint, lineHeight: 1.6 }}>
            Live data: Finnhub (stock quotes + news), CoinGecko (crypto), Twelve Data (daily candles → RSI/MACD). Quotes may be a few seconds to minutes delayed depending on provider tier.
          </div>
        </div>
      </div>

      {/* Toasts */}
      <div style={{ position: "fixed", bottom: 16, right: 16, display: "flex", flexDirection: "column", gap: 8, zIndex: 50, maxWidth: 360 }}>
        {toasts.map((t) => (
          <div key={t.id} style={{ background: T.panel2, border: `1px solid ${t.color}`, borderRadius: 6, padding: "10px 14px", fontFamily: MONO, fontSize: 12, color: T.text, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", animation: "toastIn 0.18s ease-out" }}>
            <span style={{ color: t.color }}>●</span> {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
