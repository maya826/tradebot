// RSI(14) — Wilder smoothing — and MACD(12,26,9), computed from daily closes.
export function rsi14(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 10) / 10;
}

function ema(values, period) {
  const k = 2 / (period + 1);
  const out = [values.slice(0, period).reduce((a, b) => a + b, 0) / period];
  for (let i = period; i < values.length; i++) out.push(values[i] * k + out[out.length - 1] * (1 - k));
  return out;
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  if (!closes || closes.length < slow + signal) return null;
  const emaFast = ema(closes, fast), emaSlow = ema(closes, slow);
  const offset = emaFast.length - emaSlow.length;
  const line = emaSlow.map((v, i) => emaFast[i + offset] - v);
  const sig = ema(line, signal);
  const round = (x) => Math.round(x * 100) / 100;
  return { macd: round(line[line.length - 1]), signal: round(sig[sig.length - 1]) };
}

export function supportResistance(closes) {
  if (!closes || closes.length < 20) return null;
  const recent = closes.slice(-20);
  return { support: Math.min(...recent), resistance: Math.max(...recent) };
}
