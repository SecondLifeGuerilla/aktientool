// ECharts-Helfer: Farben kommen aus den CSS-Variablen, damit Hell/Dunkel automatisch passt.
/* global echarts */
import { axisNum, escapeHtml } from "./format.js";

const registry = new Set();
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

export function theme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return {
    surface: v("--surface-1"), text: v("--text-primary"), secondary: v("--text-secondary"), muted: v("--text-muted"),
    grid: v("--grid"), baseline: v("--baseline"),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--series-${i}`)),
    good: v("--status-good"), critical: v("--status-critical"),
  };
}

// Hängt einen Chart an ein Element. `build(theme)` liefert die ECharts-Option.
export function mount(el, build) {
  const chart = echarts.getInstanceByDom(el) || echarts.init(el, null, { renderer: "canvas" });
  const entry = { el, chart, build };
  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(el);
  entry.ro = ro;
  registry.add(entry);
  render(entry);
  return {
    chart,
    update(nextBuild) { if (nextBuild) entry.build = nextBuild; render(entry); },
  };
}

function render(entry) {
  entry.chart.setOption(entry.build(theme()), { notMerge: true });
}

// Charts in einem Bereich entfernen, der gleich aus der Seite verschwindet (z. B. zugeklappte Tabellenzeile)
export function unmountWithin(root) {
  for (const e of [...registry]) {
    if (root.contains(e.el)) { e.ro.disconnect(); e.chart.dispose(); registry.delete(e); }
  }
}

export function rerenderAll() {
  for (const e of registry) render(e);
}

export function disposeAll() {
  for (const e of registry) { e.ro.disconnect(); e.chart.dispose(); }
  registry.clear();
}

export function dateLabel(ms, spanYears) {
  const d = new Date(ms);
  if (spanYears > 3) return String(d.getFullYear());
  return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

export function dateDE(ms) {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

export function base(t) {
  return {
    backgroundColor: "transparent",
    animationDuration: 300,
    textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: t.secondary },
    grid: { left: 4, right: 12, top: 40, bottom: 4, containLabel: true },
    legend: {
      top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 4, itemGap: 16,
      textStyle: { color: t.secondary, fontSize: 13 }, inactiveColor: t.muted,
    },
    tooltip: {
      trigger: "axis", confine: true,
      backgroundColor: t.surface, borderColor: t.grid, borderWidth: 1,
      textStyle: { color: t.text, fontSize: 13 },
      axisPointer: { type: "line", lineStyle: { color: t.baseline, width: 1 } },
    },
  };
}

export function timeAxis(t, spanYears) {
  return {
    type: "time",
    // Beschriftung nur mit Jahreszahl: dann auch höchstens ein Strich pro Jahr, sonst steht „2024“ doppelt da
    minInterval: spanYears > 3 ? 365 * 24 * 3600 * 1000 : undefined,
    axisLine: { lineStyle: { color: t.baseline } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, hideOverlap: true, formatter: (v) => dateLabel(v, spanYears) },
    splitLine: { show: false },
  };
}

export function valueAxis(t, extra = {}) {
  return {
    type: "value", scale: true,
    axisLine: { show: false }, axisTick: { show: false },
    axisLabel: { color: t.muted, formatter: axisNum },
    splitLine: { lineStyle: { color: t.grid, width: 1, type: "solid" } },
    ...extra,
  };
}

export function categoryAxis(t, data) {
  return {
    type: "category", data,
    axisLine: { lineStyle: { color: t.baseline } }, axisTick: { show: false },
    axisLabel: { color: t.muted, hideOverlap: true },
  };
}

export function line(name, data, color, extra = {}) {
  return {
    name, type: "line", data, showSymbol: false, sampling: "lttb", connectNulls: false,
    lineStyle: { width: 2, color, cap: "round", join: "round" }, itemStyle: { color },
    emphasis: { focus: "none", lineStyle: { width: 2 } },
    ...extra,
  };
}

// Tooltip für Zeitreihen: Datum oben, darunter je Serie Marker + Wert
export function timeTooltip(fmt) {
  return (params) => {
    const list = Array.isArray(params) ? params : [params];
    if (!list.length) return "";
    const head = dateDE(list[0].axisValue ?? list[0].value[0]);
    const rows = list
      .filter((p) => p.value && p.value[1] != null && !p.seriesName.startsWith("_"))
      .map((p) => `<div style="display:flex;gap:12px;justify-content:space-between"><span>${p.marker}${escapeHtml(p.seriesName)}</span><b>${fmt(p.value[1], p.seriesName)}</b></div>`);
    return `<div style="min-width:180px"><div style="margin-bottom:4px;opacity:.7">${head}</div>${rows.join("")}</div>`;
  };
}
