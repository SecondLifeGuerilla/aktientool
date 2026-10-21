// Vergleich: bis zu vier Aktien nebeneinander, mit Kennzahlen und gemeinsamer Wertentwicklung
import { api } from "./api.js";
import * as C from "./charts.js";
import * as F from "./format.js";
import { term } from "./glossary.js";
import { attachSearch } from "./search.js";

const esc = F.escapeHtml;
const MAX = 4;
const RANGES = [["1J", 1], ["3J", 3], ["5J", 5], ["10J", 10]];

const per = (p) => (p.valuation.available ? p.valuation.periods[p.valuation.default_period] : null);
const unrated = (p) => p.valuation.dip_now || p.valuation.short_history;
// [Bezeichnung, Lexikon, Wert, Format, besser: 1 = höher, -1 = niedriger, 0 = kein Vergleich]
const ROWS = [
  ["Allgemein"],
  ["Land", null, (p) => p.facts.country, (v) => esc(v || "–"), 0],
  ["Sektor", "sektor", (p) => p.facts.sector, (v) => esc(v || "–"), 0],
  ["Börsenwert", "boersenwert", (p) => p.facts.market_cap, (v, p) => F.big(v, p.currency), 0],
  ["Bilanzdaten", null, (p) => p.data.fundamental_years, (v) => (v ? `${v[0]}–${v[1]}` : "–"), 0],
  ["Qualität"],
  ["Gewinnstabilität", "gewinnstabilitaet", (p) => p.quality.stability, (v, p) => `${F.stability(v)}${p.quality.short ? ' <span class="muted">(kurz)</span>' : ""}`, 1],
  ["Gewinnwachstum p. a.", "wachstum_pa", (p) => p.quality.growth, (v) => F.pct(v, 1), 1],
  ["Kapitalrendite (ROIC)", "roic", (p) => p.fundamentals?.roic.latest, (v) => F.pct(v, 1), 1],
  ["Piotroski F-Score", "piotroski", (p) => p.fundamentals?.piotroski.score, (v) => (F.isNum(v) ? `${v} / 9` : "–"), 1],
  ["Aktienzahl p. a.", "aktienrueckkauf", (p) => p.fundamentals?.shares.cagr, (v) => F.signedPct(v, 1), -1],
  ["Tilgungsjahre", "tilgungsjahre", (p) => (p.debt.infinite ? Infinity : p.debt.years), (v) => (v === Infinity ? "∞" : F.num(v, 1)), -1],
  ["Bewertung"],
  ["Multiple aktuell", "kgv", (p) => p.valuation.current_multiple, (v, p) => (F.isNum(v) ? `${F.num(v, 1)} <span class="muted">${esc(p.valuation.multiple_label)}</span>` : "–"), 0],
  ["Kurs vs. fairer Wert", "fairer_wert", (p) => (unrated(p) ? null : per(p)?.deviation), (v, p) => (per(p) ? `${F.signedPct(per(p).deviation, 0)}${unrated(p) ? ' <span class="muted">(unsicher)</span>' : ""}` : "–"), -1],
  ["Erwartete Rendite p. a.", "erwartete_rendite", (p) => (unrated(p) ? null : p.valuation.expected?.by_period?.[p.valuation.default_period]), (v) => F.signedPct(v, 1), 1],
  ["Eingepreistes FCF-Wachstum", "reverse_dcf", (p) => p.dcf?.rates?.["0.09"], (v) => F.signedPct(v, 1), -1],
  ["Free-Cashflow-Rendite", "fcf_rendite", (p) => p.fundamentals?.fcf_yield, (v) => F.pct(v, 1), 1],
  ["Dividende"],
  ["Dividendenrendite", "dividendenrendite", (p) => p.facts.dividend_yield, (v) => F.pct(v, 2), 1],
  ["Rendite nach Steuern", "quellensteuer", (p) => (p.tax ? p.facts.dividend_yield * p.tax.net_share : null), (v) => F.pct(v, 2), 1],
  ["Dividendenwachstum p. a.", "dividendenwachstum", (p) => (p.dividends.pays ? p.dividends.growth : null), (v) => F.pct(v, 1), 1],
  ["Steigerungen in Folge", "dividendensteigerungen", (p) => (p.dividends.pays ? p.dividends.increase_streak : null), (v) => (F.isNum(v) ? `${v} J.` : "–"), 1],
  ["Ausschüttungsquote", "ausschuettungsquote", (p) => (p.dividends.pays ? p.dividends.payout_eps : null), (v) => F.pct(v, 0), 0],
  ["Markt & Erwartungen"],
  ["Momentum (200 Tage)", "momentum", (p) => p.price.momentum, (v) => F.signedPct(v, 1), 1],
  ["Momentum 12-1", "momentum_12_1", (p) => p.price.momentum_12_1, (v) => F.signedPct(v, 1), 1],
  ["Schätzungen 90 Tage", "revisionen", (p) => p.analysts.revisions?.change90, (v) => F.signedPct(v, 1), 1],
  ["Analysten-Kursziel", "kursziel", (p) => p.analysts.upside, (v) => F.signedPct(v, 1), 1],
  ["Scorecard"],
  ["Gewinnwachstum", "scorecard", (p) => p.scorecard.find((s) => s.key === "earnings_growth")?.score, (v) => (F.isNum(v) ? `${v} / 10` : "–"), 1],
  ["Dividendenwachstum", "scorecard", (p) => p.scorecard.find((s) => s.key === "dividend_growth")?.score, (v) => (F.isNum(v) ? `${v} / 10` : "–"), 1],
  ["Dividendenertrag", "scorecard", (p) => p.scorecard.find((s) => s.key === "dividend_income")?.score, (v) => (F.isNum(v) ? `${v} / 10` : "–"), 1],
];

export async function renderCompare(root, params, isCurrent) {
  document.title = "Vergleich – Aktientool";
  const symbols = [...new Set((params.get("s") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, MAX);
  const setSymbols = (list) => { location.hash = `#/vergleich?s=${encodeURIComponent(list.join(","))}`; };
  root.innerHTML = `
    <h1>Aktien vergleichen</h1>
    <p class="secondary" style="max-width:860px;margin-top:6px">Bis zu ${MAX} Aktien nebeneinander. Fett ist jeweils der beste Wert der Zeile.</p>
    <div class="card" style="margin-top:14px">
      <form class="filters" id="c-form" autocomplete="off">
        <div class="field search" style="max-width:300px"><label for="c-symbol">Aktie hinzufügen</label>
          <input id="c-symbol" class="wide" placeholder="Name oder Ticker" ${symbols.length >= MAX ? "disabled" : ""}>
          <ul id="c-results" class="search-results" role="listbox" hidden></ul></div>
        <div class="preset-row small" id="c-chips">${symbols.map((s) => `<span class="tag">${esc(s)} <button class="linklike" data-rm="${esc(s)}" type="button" aria-label="${esc(s)} entfernen">×</button></span>`).join("")}</div>
      </form>
    </div>
    <div id="c-body" style="margin-top:12px"></div>`;
  const $ = (s) => root.querySelector(s);
  const add = (sym) => { if (sym && !symbols.includes(sym) && symbols.length < MAX) setSymbols([...symbols, sym]); };
  attachSearch($("#c-symbol"), $("#c-results"), add);
  $("#c-form").addEventListener("submit", (e) => { e.preventDefault(); add($("#c-symbol").value.trim().toUpperCase()); });
  $("#c-chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (b) setSymbols(symbols.filter((s) => s !== b.dataset.rm));
  });
  if (!symbols.length) {
    $("#c-body").innerHTML = '<div class="card"><p class="muted">Fügen Sie oben Aktien hinzu, z. B. Coca-Cola (KO), PepsiCo (PEP) und Nestlé (NESN.SW).</p></div>';
    return;
  }
  $("#c-body").innerHTML = '<div class="loading-block"><div class="spinner"></div>Lade Profile …</div>';
  const results = await Promise.all(symbols.map((s) => api.profile(s).then((p) => ({ ok: true, p }), (e) => ({ ok: false, s, e }))));
  if (!isCurrent()) return;
  const profiles = results.filter((r) => r.ok).map((r) => r.p);
  const failed = results.filter((r) => !r.ok).map((r) => `${esc(r.s)}: ${esc(r.e.message)}`);
  const head = profiles.map((p) => `<th><a href="#/aktie/${encodeURIComponent(p.symbol)}">${esc(p.name)}</a><div class="muted" style="font-size:12px;font-weight:400">${esc(p.symbol)}</div></th>`).join("");
  const body = ROWS.map(([label, t, get, fmt, better]) => {
    if (!get) return `<tr class="group"><td colspan="${profiles.length + 1}">${esc(label)}</td></tr>`;
    const values = profiles.map((p) => { try { return get(p); } catch (e) { return null; } });
    const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
    const best = better && nums.length > 1 ? (better > 0 ? Math.max(...nums) : Math.min(...nums)) : null;
    return `<tr><td>${t ? term(t, esc(label)) : esc(label)}</td>${profiles.map((p, i) => `<td${values[i] === best ? ' class="best"' : ""}>${fmt(values[i], p)}</td>`).join("")}</tr>`;
  }).join("");
  $("#c-body").innerHTML = `
    ${failed.length ? `<div class="notice"><ul>${failed.map((f) => `<li class="warn">${f}</li>`).join("")}</ul></div>` : ""}
    <div class="card">
      <div class="toolbar"><h3>Wertentwicklung inkl. Dividenden</h3><span class="spacer"></span>
        <div class="segmented" id="c-range" role="group" aria-label="Zeitraum">${RANGES.map(([l]) => `<button type="button" data-r="${l}">${l}</button>`).join("")}</div></div>
      <div class="chart" id="ch-compare"></div>
    </div>
    <div class="card table-scroll" style="margin-top:12px"><table class="data compare"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  let range = "5J";
  const years = () => RANGES.find(([l]) => l === range)[1];
  const chart = C.mount($("#ch-compare"), (t) => {
    const from = Date.now() - years() * 365.25 * 86400000;
    const series = profiles.map((p, i) => {
      const pts = p.price.series.map(([d, , a]) => [Date.parse(d), a]).filter(([d]) => d >= from);
      const base = pts.length ? pts[0][1] : 1;
      return C.line(p.name, pts.map(([d, a]) => [d, (a / base - 1)]), t.series[i]);
    });
    return {
      ...C.base(t),
      tooltip: { ...C.base(t).tooltip, formatter: C.timeTooltip((v) => F.signedPct(v, 1)) },
      xAxis: C.timeAxis(t, years()),
      yAxis: C.valueAxis(t, { axisLabel: { color: t.muted, formatter: (v) => `${F.num(v * 100, 0)} %` } }),
      series,
    };
  });
  const seg = $("#c-range");
  const paintSeg = () => seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.r === range)));
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-r]");
    if (b) { range = b.dataset.r; paintSeg(); chart.update(); }
  });
  paintSeg();
}
