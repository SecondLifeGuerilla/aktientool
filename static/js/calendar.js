// Termine: Quartalszahlen, Ex-Tage und Dividendenzahlungen der Aktien aus Watchlist und Depot
import { api, getWatchlist, loadSummaries } from "./api.js";
import * as F from "./format.js";

const esc = F.escapeHtml;
const KINDS = {
  earnings: ["Zahlen", "Quartals- bzw. Jahreszahlen"],
  ex: ["Ex-Tag", "Wer die Aktie am Vortag besitzt, erhält die Dividende"],
  pay: ["Zahltag", "Auszahlung der Dividende"],
};

export async function renderCalendar(root, isCurrent) {
  document.title = "Termine – Aktientool";
  root.innerHTML = `
    <h1>Termine</h1>
    <p class="secondary" style="max-width:860px;margin-top:6px">Anstehende Quartalszahlen, Ex-Tage und Dividendenzahlungen aller Aktien aus
      Watchlist und Depot (laut Yahoo Finance; Termine können sich verschieben).</p>
    <div class="progress"><div id="k-bar"></div></div>
    <div id="k-body" style="margin-top:12px"><div class="loading-block"><div class="spinner"></div>Lade …</div></div>`;
  let symbols;
  let depotSyms;
  try {
    const [watch, depot] = await Promise.all([getWatchlist(), api.depot()]);
    depotSyms = new Set(depot.map((p) => p.symbol));
    symbols = [...new Set([...watch, ...depotSyms])];
  } catch (e) {
    if (isCurrent()) root.querySelector("#k-body").innerHTML = `<div class="error-block">${esc(e.message)}</div>`;
    return;
  }
  if (!isCurrent()) return;
  if (!symbols.length) {
    root.querySelector("#k-body").innerHTML = '<div class="card"><p class="muted">Watchlist und Depot sind leer.</p></div>';
    return;
  }
  const rows = [];
  let done = 0;
  await loadSummaries(symbols, (sym, r) => {
    done += 1;
    root.querySelector("#k-bar").style.width = `${(done / symbols.length) * 100}%`;
    if (r.status === "ok") rows.push(r.data);
  }, isCurrent);
  if (!isCurrent()) return;
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const events = [];
  for (const d of rows) {
    const perPayment = d.div_ttm && d.div_payment_months?.length ? d.div_ttm / d.div_payment_months.length : null;
    if (d.earnings_date) events.push({ day: d.earnings_date, kind: "earnings", d });
    if (d.ex_dividend_date) events.push({ day: d.ex_dividend_date, kind: "ex", d, amount: perPayment });
    if (d.dividend_pay_date) events.push({ day: d.dividend_pay_date, kind: "pay", d, amount: perPayment });
  }
  const upcoming = events.filter((e) => e.day >= from).sort((a, b) => a.day.localeCompare(b.day));
  const fmtMonth = (day) => new Date(`${day}T12:00:00`).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  let month = null;
  const html = upcoming.map((e) => {
    const m = fmtMonth(e.day);
    const headRow = m !== month ? `<tr class="group"><td colspan="5">${esc(m)}</td></tr>` : "";
    month = m;
    return `${headRow}<tr class="${e.day < today ? "muted" : ""}"><td>${F.date(e.day)}</td>
      <td style="text-align:left"><span class="badge ${e.kind === "earnings" ? "neutral" : "good"}" title="${esc(KINDS[e.kind][1])}">${KINDS[e.kind][0]}</span></td>
      <td class="name" style="text-align:left"><a href="#/aktie/${encodeURIComponent(e.d.symbol)}">${esc(e.d.name)}</a><span class="sym">${esc(e.d.symbol)}</span>
        ${depotSyms.has(e.d.symbol) ? '<span class="tag">Depot</span>' : ""}</td>
      <td>${e.amount ? `ca. ${F.money(e.amount, e.d.currency, 3)} je Aktie` : ""}</td>
      <td>${e.kind === "earnings" && F.isNum(e.d.revisions_90d) ? `Schätzung 90 T.: ${F.signedPct(e.d.revisions_90d, 1)}` : ""}</td></tr>`;
  }).join("");
  root.querySelector("#k-body").innerHTML = upcoming.length
    ? `<div class="card table-scroll"><table class="data"><thead><tr><th>Datum</th><th style="text-align:left">Termin</th><th style="text-align:left">Aktie</th>
        <th>Dividende</th><th>Analysten</th></tr></thead><tbody>${html}</tbody></table></div>`
    : '<div class="card"><p class="muted">Keine bekannten Termine.</p></div>';
}
