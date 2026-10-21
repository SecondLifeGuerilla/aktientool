// Zahlen- und Datumsformate (deutsch)

const cache = new Map();
function nf(min, max) {
  const key = `${min}-${max}`;
  if (!cache.has(key)) cache.set(key, new Intl.NumberFormat("de-DE", { minimumFractionDigits: min, maximumFractionDigits: max }));
  return cache.get(key);
}

export const isNum = (x) => typeof x === "number" && Number.isFinite(x);

export function num(x, digits = 2, fallback = "–") {
  return isNum(x) ? nf(digits, digits).format(x) : fallback;
}

export function pct(x, digits = 1, fallback = "–") {
  return isNum(x) ? `${nf(digits, digits).format(x * 100)} %` : fallback;
}

export function signedPct(x, digits = 1, fallback = "–") {
  if (!isNum(x)) return fallback;
  const s = nf(digits, digits).format(Math.abs(x * 100));
  return `${x > 0 ? "+" : x < 0 ? "−" : "±"} ${s} %`;
}

export function money(x, ccy, digits = 2) {
  return isNum(x) ? `${nf(digits, digits).format(x)} ${ccy || ""}`.trim() : "–";
}

export function big(x, ccy) {
  if (!isNum(x)) return "–";
  const abs = Math.abs(x);
  if (abs >= 1e12) return `${nf(2, 2).format(x / 1e12)} Bio. ${ccy || ""}`.trim();
  if (abs >= 1e9) return `${nf(1, 1).format(x / 1e9)} Mrd. ${ccy || ""}`.trim();
  if (abs >= 1e6) return `${nf(1, 1).format(x / 1e6)} Mio. ${ccy || ""}`.trim();
  return `${nf(0, 0).format(x)} ${ccy || ""}`.trim();
}

export function int(x) {
  return isNum(x) ? nf(0, 0).format(x) : "–";
}

export function date(s) {
  if (!s) return "–";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

export function stability(x) {
  return isNum(x) ? nf(2, 2).format(x) : "–";
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Axis ticks: compact, ohne Nachkommastellen bei großen Werten
export function axisNum(x) {
  if (!isNum(x)) return "";
  const abs = Math.abs(x);
  if (abs >= 1e9) return `${nf(0, 1).format(x / 1e9)} Mrd.`;
  if (abs >= 1e6) return `${nf(0, 1).format(x / 1e6)} Mio.`;
  if (abs >= 1000) return nf(0, 0).format(x);
  if (abs >= 10) return nf(0, 1).format(x);
  return nf(0, 2).format(x);
}
