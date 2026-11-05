// Trusts & Holdings: Firmen, die selbst in Aktien und andere Firmen investieren, mit Abschlag zum inneren Wert (NAV).
// Holdings rechnet der Server aus ihren Beteiligungen mit aktuellen Kursen; Fonds kommen täglich von Morningstar/AIC.
import { api, getWatchlist } from "./api.js";
import { trackBrowse } from "./browse.js";
import { NOT_TR_TAG, setTrOnly, trOnly } from "./broker.js";
import * as C from "./charts.js";
import * as F from "./format.js";
import { term } from "./glossary.js";
import { isBasic } from "./mode.js";
import { attachSearch } from "./search.js";
import { toast } from "./toast.js";
import { flipWatch } from "./watch.js";

const esc = F.escapeHtml;
const DAY = 86400000;
const PAGE = 150;
const COUNTRIES = {
  GB: "Großbritannien", US: "USA", AU: "Australien", CH: "Schweiz", CA: "Kanada", NL: "Niederlande", NZ: "Neuseeland",
  FR: "Frankreich", IT: "Italien", IE: "Irland", DE: "Deutschland", SE: "Schweden", BE: "Belgien", JP: "Japan",
};
const GROUPS = ["Aktien", "Private Equity", "Immobilien", "Infrastruktur & Energie", "Rohstoffe", "Anleihen & Kredite", "Mischanlage & Alternativ"];

// ---------------------------------------------------------------- Bausteine, auch fürs Aktienprofil

const ageDays = (day) => (day ? Math.floor((Date.now() - Date.parse(`${day.slice(0, 10)}T12:00:00`)) / DAY) : null);

// Datum mit Ampel: grün bis okDays, gelb bis warnDays, danach rot; `what` erklärt im Tooltip, was das Datum bedeutet
export function freshness(day, okDays, warnDays, what) {
  if (!day) return '<span class="badge neutral">unbekannt</span>';
  const age = ageDays(day);
  const cls = age <= okDays ? "good" : age <= warnDays ? "warning" : "serious";
  const ago = age <= 0 ? "heute" : age === 1 ? "gestern" : `vor ${age} Tagen`;
  return `<span class="badge ${cls} fresh" title="${esc(`${what}: ${F.date(day)} (${ago})`)}">${F.date(day)}</span>`;
}

// Stichtag eines Holding-Berichts: nach gut drei Monaten ist meist schon der nächste Bericht erschienen
export const reportFreshness = (day) => freshness(day, 100, 190, "Beteiligungen laut Bericht vom");
export const reportOld = (day) => ageDays(day) > 100;
const reportHint = (day) => (reportOld(day)
  ? "Der Bericht ist älter als drei Monate; wahrscheinlich gibt es schon einen neueren. Stückzahlen, Schulden und nicht börsennotierte Werte dann unter „Angaben ändern“ aktualisieren."
  : "");

export function discText(d, digits = 1) {
  if (!F.isNum(d)) return "–";
  const word = d < 0 ? "Abschlag" : d > 0 ? "Aufschlag" : "";
  return `<span class="${d < 0 ? "good" : d > 0 ? "bad" : ""}" title="${word}">${F.signedPct(d, digits)}</span>`;
}

// Heutiger Abschlag im Vergleich zum üblichen: negativ = größerer Abschlag als sonst = günstiger als üblich
// (kurz: ohne „als üblich“, für die Tabelle)
export function usualBadge(disc, usual, short = false) {
  if (!F.isNum(disc) || !F.isNum(usual)) return "";
  const diff = disc - usual;
  const [label, cls] = diff <= -0.05 ? ["deutlich günstiger", "good"] : diff <= -0.02 ? ["günstiger", "good"]
    : diff < 0.02 ? ["wie üblich", "neutral"] : diff < 0.05 ? ["teurer", "warning"] : ["deutlich teurer", "serious"];
  const text = short ? label.replace("deutlich ", "viel ") : label === "wie üblich" ? label : `${label} als üblich`;
  return `<span class="badge ${cls}" title="Heute ${F.signedPct(disc, 1)}, üblich ${F.signedPct(usual, 1)}: ${F.num(Math.abs(diff) * 100, 1)} Prozentpunkte ${diff < 0 ? "mehr Abschlag" : "weniger Abschlag"} als sonst">${text}</span>`;
}

// Satz für Einsteiger: „Für 100 € Vermögen zahlen Sie derzeit 91 €.“
export const per100 = (disc) => (F.isNum(disc) ? `Für 100 € Vermögen zahlen Sie derzeit ${F.num(100 * (1 + disc), 0)} €.` : "");

const countryName = (c) => COUNTRIES[c] || c || "–";

// ---------------------------------------------------------------- Verlauf des Abschlags (Diagramm und Kennzahlen)

const RANGES = [["1", "1 J."], ["3", "3 J."], ["5", "5 J."], ["10", "10 J."], ["max", "Gesamt"]];
const pctAxis = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${F.num(Math.abs(v) * 100, 0)} %`;

// Wo liegt der heutige Abschlag im Zeitraum? share = Anteil der Tage mit größerem Abschlag als heute
function positionBadge(share) {
  if (!F.isNum(share)) return "–";
  if (share <= 0.35) return `<span class="badge good">günstiger als an ${F.num((1 - share) * 100, 0)} % der Tage</span>`;
  if (share >= 0.65) return `<span class="badge warning">teurer als an ${F.num(share * 100, 0)} % der Tage</span>`;
  return '<span class="badge neutral">im mittleren Bereich</span>';
}

const rangeLabel = (s) => (s ? `${F.date(s.from)} – ${F.date(s.to)}` : "");

export async function renderHistory(el, symbol, isCurrent = () => true) {
  el.innerHTML = '<p class="muted" style="margin:8px 0">Lade Verlauf des Abschlags …</p>';
  let h;
  try { h = await api.trustHistory(symbol); } catch (e) {
    if (el.isConnected) el.innerHTML = `<p class="muted">Verlauf nicht verfügbar: ${esc(e.message)}</p>`;
    return;
  }
  if (!isCurrent() || !el.isConnected) return;
  if (!h.points.length) {
    el.innerHTML = `<p class="muted">Kein Verlauf verfügbar${h.missing?.length ? ` (keine Kurse für ${esc(h.missing.join(", "))})` : ""}.</p>`;
    return;
  }
  const holding = h.kind === "holding";
  // Zeiträume, die die Daten (fast) ganz abdecken; „Gesamt“ immer
  const ranges = RANGES.filter(([k]) => h.stats[k] && (k === "max" || h.stats[k].complete));
  const keys = ranges.map(([k]) => k);
  let key = holding ? "max" : keys.includes("5") ? "5" : keys[keys.length - 1];
  const points = h.points.map(([d, v]) => [Date.parse(`${d}T12:00:00`), v]);
  const asOf = holding ? Date.parse(`${h.as_of}T12:00:00`) : null;
  const recorded = h.recorded_from ? Date.parse(`${h.recorded_from}T12:00:00`) : null;
  el.innerHTML = `<div class="hist">
      <div class="chart-title"><h3 style="font-size:15px;margin:0">Verlauf des Abschlags</h3>
        <div class="segmented" role="group" aria-label="Zeitraum">${ranges.map(([k, l]) => `<button type="button" data-range="${k}">${l}</button>`).join("")}</div></div>
      <div class="grid tiles hist-tiles"></div>
      <div class="hist-chart"></div>
      <p class="muted hist-note">${holding
        ? `Holdings veröffentlichen ihren NAV nur quartalsweise. Der Verlauf ist deshalb rückgerechnet: Beteiligungen laut Bericht vom ${F.date(h.as_of)}
           zu den Tageskursen (Yahoo). Vor dem Stichtag (gestrichelt) wird er ungenauer, weil Käufe,
           Verkäufe und Schulden damals anders waren.${h.recorded_from ? ` Seit ${F.date(h.recorded_from)} speichert das Tool den täglich berechneten Abschlag; diese Werte gehen vor.` : " Ab jetzt speichert das Tool den täglich berechneten Abschlag mit."}`
        : `${esc(h.source || "")}. Bei Private Equity, Immobilien und Infrastruktur gilt der NAV bis zur nächsten Bewertung (höchstens 100 Tage).`}</p>
      ${isBasic() ? "" : `<details class="hist-table"><summary>Alle Zeiträume als Tabelle</summary>
        <table class="data inner"><thead><tr><th>Zeitraum</th><th>Ø Abschlag</th><th>günstigster Stand</th><th>teuerster Stand</th><th>Tage mit größerem Abschlag als heute</th></tr></thead>
        <tbody>${ranges.map(([k, l]) => { const s = h.stats[k]; return `<tr><td class="name">${l} <span class="sym">${rangeLabel(s)}</span></td>
          <td>${F.signedPct(s.avg, 1)}</td><td>${F.signedPct(s.min, 1)} <span class="muted">${F.date(s.min_date)}</span></td>
          <td>${F.signedPct(s.max, 1)} <span class="muted">${F.date(s.max_date)}</span></td><td>${F.pct(s.share_larger, 0)}</td></tr>`; }).join("")}</tbody></table></details>`}
    </div>`;
  const tilesEl = el.querySelector(".hist-tiles");
  const chartEl = el.querySelector(".hist-chart");
  let view = null;

  function build(t) {
    const s = h.stats[key];
    const from = Date.parse(`${s.from}T00:00:00`);
    const shown = points.filter((p) => p[0] >= from);
    const span = (shown[shown.length - 1][0] - shown[0][0]) / (365.25 * 86400000);
    // Holding: vor dem Stichtag rückgerechnet (hell), danach mit der Zusammensetzung laut Bericht bzw. aufgezeichnet
    const split = asOf && shown[0][0] < asOf ? asOf : null;
    const older = split ? shown.filter((p) => p[0] <= split) : [];
    const newer = split ? shown.filter((p) => p[0] >= split) : shown;
    const avgLine = {
      silent: true, symbol: "none",
      data: [
        { yAxis: s.avg, lineStyle: { color: t.secondary, type: "dashed", width: 1 }, label: { formatter: `Ø ${F.signedPct(s.avg, 1)}`, color: t.secondary, position: "insideStartTop", backgroundColor: t.surface, padding: [1, 4] } },
        { yAxis: 0, lineStyle: { color: t.baseline, type: "solid", width: 1 }, label: { formatter: "= NAV", color: t.muted, position: "insideEndBottom" } },
        ...(split ? [{ xAxis: split, lineStyle: { color: t.muted, type: "dotted", width: 1 }, label: { formatter: "Stichtag Bericht", color: t.muted, position: "end", fontSize: 11 } }] : []),
        ...(recorded && recorded >= shown[0][0] ? [{ xAxis: recorded, lineStyle: { color: t.muted, type: "dotted", width: 1 }, label: { formatter: "aufgezeichnet", color: t.muted, position: "start", fontSize: 11 } }] : []),
      ],
    };
    const series = [C.line(holding ? "Abschlag" : "Abschlag zum NAV", newer, t.series[0], { markLine: avgLine })];
    if (older.length) series.unshift(C.line("rückgerechnet", older, t.muted, { lineStyle: { width: 1.5, type: "dashed", color: t.muted } }));
    return {
      ...C.base(t),
      legend: { show: false },
      grid: { left: 4, right: 16, top: 26, bottom: 4, containLabel: true },
      tooltip: { ...C.base(t).tooltip, formatter: C.timeTooltip((v) => F.signedPct(v, 1)) },
      xAxis: C.timeAxis(t, span),
      yAxis: C.valueAxis(t, { axisLabel: { color: t.muted, formatter: pctAxis } }),
      series,
    };
  }

  function paint() {
    const s = h.stats[key];
    const now = h.points[h.points.length - 1][1];
    el.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === key)));
    tilesEl.innerHTML = [
      tileHtml("Letzter Wert", discText(now), `Schlusskurs vom ${F.date(h.points[h.points.length - 1][0])}`),
      tileHtml(`Ø ${ranges.find(([k]) => k === key)[1]}`, F.signedPct(s.avg, 1), rangeLabel(s)),
      tileHtml("Günstigster Stand", F.signedPct(s.min, 1), `größter Abschlag am ${F.date(s.min_date)}`),
      tileHtml("Teuerster Stand", F.signedPct(s.max, 1), `${s.max > 0 ? "größter Aufschlag" : "kleinster Abschlag"} am ${F.date(s.max_date)}`),
      tileHtml("Heute im Vergleich", positionBadge(s.share_larger), `An ${F.pct(s.share_larger, 0)} der Tage war der Abschlag größer als heute`),
    ].join("");
    if (view) view.update(build);
    else view = C.mount(chartEl, build);
  }

  el.querySelector(".segmented").addEventListener("click", (e) => {
    const b = e.target.closest("[data-range]");
    if (!b) return;
    key = b.dataset.range;
    paint();
  });
  paint();
}

const tileHtml = (label, value, sub) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;

// ---------------------------------------------------------------- Seite

export async function renderTrusts(root, params, isCurrent) {
  document.title = "Trusts & Holdings – Aktientool";
  const basic = isBasic();
  const S = {
    q: "", group: "", country: "", minCap: 1e8, tr: trOnly(), onlyDisc: true, cheaper: false,
    sort: "disc", dir: 1, limit: PAGE, open: new Set(),
  };
  let data = null;
  let watch = new Set();
  root.innerHTML = `
    <div class="page-head"><h1>Trusts & Holdings</h1><p class="muted" id="t-status"></p></div>
    <p class="secondary" style="max-width:900px;margin-top:6px">Firmen, die selbst in Aktien und andere Firmen investieren: Investment Trusts,
      Closed-End-Fonds und Beteiligungsgesellschaften. Verglichen wird der Börsenkurs mit dem ${term("nav", "inneren Wert (NAV)")}, also dem,
      was die Beteiligungen abzüglich Schulden je Aktie wert sind. Ein ${term("abschlag_nav", "Abschlag")} heißt: Sie kaufen das Vermögen billiger, als es wert ist.</p>
    <details class="card explain" id="t-explain" style="margin-top:12px">
      <summary><b>So lesen Sie den Abschlag</b> <span class="muted">– warum 10 % Abschlag nicht automatisch ein Schnäppchen sind</span></summary>
      <ul>
        <li><b>Abschlag −10 %:</b> Für 90 € bekommen Sie Beteiligungen im Wert von 100 €. Dividenden und Wertzuwachs fließen auf die vollen 100 €.</li>
        <li><b>Entscheidend ist der Vergleich mit dem üblichen Abschlag.</b> Notiert ein Trust seit Jahren 10 % unter dem NAV, verkaufen Sie später
          voraussichtlich auch mit Abschlag. Zusätzlicher Gewinn entsteht nur, wenn der Abschlag kleiner wird. Die Spalte „Einordnung“ zeigt, ob er
          gerade größer (günstiger) oder kleiner (teurer) als sonst ist.</li>
        <li><b>Ungewöhnlich hohe Abschläge haben oft Gründe:</b> Zweifel an der Bewertung nicht börsennotierter Beteiligungen, hohe Kosten oder Schulden,
          schwache Wertentwicklung, Verwaltung im Interesse eines Großaktionärs. Aktienrückkäufe unter NAV, Übernahmeangebote oder eine Auflösung können
          den Abschlag dagegen schließen.</li>
        <li><b>NAV bei Private Equity, Immobilien und Infrastruktur</b> wird nur alle drei oder sechs Monate geschätzt; der Abschlag bezieht sich dann auf einen
          älteren Wert (Kennzeichen „NAV geschätzt“).</li>
        <li><b>Holdings</b> (z. B. Exor, Porsche SE) veröffentlichen ihren NAV nur mit den Quartalsberichten. Das Tool rechnet ihn deshalb selbst:
          börsennotierte Beteiligungen zum aktuellen Kurs, alles andere mit den Werten aus dem letzten Bericht.</li>
      </ul>
    </details>
    <section class="card" id="t-fresh" style="margin-top:12px"></section>
    <section style="margin-top:22px">
      <div class="chart-title"><h2>Holdings <small class="muted">innerer Wert selbst gerechnet, Kurse aktuell</small></h2>
        <button class="btn small" type="button" id="h-add">＋ Holding hinzufügen</button></div>
      <div id="h-form-new"></div>
      <div class="card table-scroll" style="padding:8px 8px 4px;margin-top:8px" id="h-body"><div class="loading-block"><div class="spinner"></div>Lade …</div></div>
    </section>
    <section style="margin-top:26px">
      <h2>Fonds & Trusts weltweit <small class="muted">${term("closed_end_fonds", "Closed-End-Fonds")} aus London, New York, Zürich, Sydney, Toronto u. a.</small></h2>
      <div class="card filter-card">
        <div class="filters">
          <div class="field"><label for="f-q">Suche</label><input id="f-q" class="wide" placeholder="Name, Ticker, ISIN"></div>
          <div class="field"><label for="f-group">Schwerpunkt</label><select id="f-group"><option value="">alle</option>${GROUPS.map((g) => `<option>${g}</option>`).join("")}</select></div>
          <div class="field"><label for="f-country">Börse</label><select id="f-country"><option value="">alle</option></select></div>
          <div class="field"><label for="f-cap">Börsenwert</label><select id="f-cap">
            <option value="0">alle</option><option value="1e8" selected>ab 100 Mio. €</option><option value="5e8">ab 500 Mio. €</option><option value="1e9">ab 1 Mrd. €</option></select></div>
          <label class="check"><input type="checkbox" id="f-tr" ${S.tr ? "checked" : ""}> nur bei Trade Republic handelbar</label>
          <label class="check"><input type="checkbox" id="f-disc" checked> nur mit Abschlag</label>
          <label class="check" title="Abschlag heute mindestens 2 Prozentpunkte größer als im Durchschnitt (nur wo es einen Durchschnitt gibt)"><input type="checkbox" id="f-cheaper"> nur günstiger als üblich</label>
        </div>
      </div>
      <p class="muted results-bar" id="f-count"></p>
      <div class="card table-scroll" style="padding:6px 2px 4px" id="f-body"><div class="loading-block"><div class="spinner"></div>Lade …</div></div>
    </section>`;
  const $ = (s) => root.querySelector(s);

  // ---- Laden (die Fonds baut der Server beim ersten Mal im Hintergrund auf: so lange alle 3 Sekunden nachfragen)
  async function load() {
    try {
      const [d, w] = await Promise.all([api.trusts(), getWatchlist().catch(() => new Set())]);
      data = d;
      watch = w;
    } catch (e) {
      if (isCurrent()) $("#h-body").innerHTML = `<div class="error-block">${esc(e.message)}</div>`;
      return;
    }
    if (!isCurrent()) return;
    const countries = [...new Set(data.funds.map((r) => r.country).filter(Boolean))].sort((a, b) => countryName(a).localeCompare(countryName(b)));
    $("#f-country").innerHTML = `<option value="">alle</option>${countries.map((c) => `<option value="${c}" ${c === S.country ? "selected" : ""}>${esc(countryName(c))}</option>`).join("")}`;
    paintFresh();
    paintHoldings();
    paintFunds();
    if (!data.ready && (data.loading || !data.error)) setTimeout(() => { if (isCurrent()) load(); }, 3000);
  }

  // ---- Datenstand
  function paintFresh() {
    const lastNews = data.holdings.map((h) => h.date).filter(Boolean).sort()[0];
    const fundsLine = data.ready
      ? `Schlusskurse vom ${freshness(data.date, 4, 10, "Kurse und NAV der Fonds vom")}${data.aic_date ? `, britische Trusts (AIC) ${freshness(data.aic_date, 4, 10, "Daten der AIC vom")}` : ""}`
      : data.error ? `<span class="badge serious">nicht geladen</span> ${esc(data.error)}` : '<span class="badge neutral">wird geladen …</span> das dauert beim ersten Mal rund 20 Sekunden';
    $("#t-status").innerHTML = data.loading && data.ready ? "Fonds werden aktualisiert …" : "";
    $("#t-fresh").innerHTML = `<h2 style="font-size:16px;margin:0 0 6px">Wie aktuell sind die Daten?</h2>
      <ul class="fresh-list">
        <li><b>Fonds & Trusts:</b> ${fundsLine}. <span class="muted">Automatisch alle 12 Stunden (Morningstar, für britische Trusts zusätzlich AIC).</span></li>
        <li><b>Holdings:</b> Kurse aktuell (Yahoo, rund 15 Minuten verzögert), automatisch. Die Beteiligungen selbst (Stückzahlen, nicht börsennotierte Werte, Schulden)
          stammen aus dem jeweils letzten Bericht${lastNews ? `, ältester Stichtag ${reportFreshness(lastNews)}` : ""}. <span class="muted">Dafür gibt es keine kostenlose Schnittstelle:
          nach einem neuen Quartalsbericht über „Angaben ändern“ aktualisieren. Gelb = älter als drei Monate, rot = älter als ein halbes Jahr.</span></li>
        <li><b>Positionen der Fonds:</b> London von Morningstar (monatlich, rund einen Monat Verzug), USA aus den Meldungen an die SEC (vierteljährlich, bis zu
          zwei Monate Verzug), automatisch; für andere Börsen gibt es keine kostenlose Quelle. Das Datum steht beim Aufklappen.</li>
      </ul>`;
  }

  // ---------------------------------------------------------------- Holdings
  // Detailzeile unter einer Tabellenzeile entfernen, samt ihrer Diagramme
  function removeDetail(tr) {
    const next = tr.nextElementSibling;
    if (!next?.classList.contains("detail-row")) return;
    C.unmountWithin(next);
    next.remove();
  }

  function paintHoldings() {
    C.unmountWithin($("#h-body"));
    const rows = [...data.holdings].sort((a, b) => (a.disc ?? 9) - (b.disc ?? 9));
    holdingList = rows.map((h) => [h.symbol, h.name]);
    if (!rows.length) {
      $("#h-body").innerHTML = '<p class="muted" style="padding:8px">Noch keine Holdings. Über „＋ Holding hinzufügen“ lassen sich eigene anlegen.</p>';
      return;
    }
    $("#h-body").innerHTML = `<table class="data screener trusts"><thead><tr>
        <th scope="col"><span class="visually-hidden">Aufklappen</span></th><th scope="col" class="name">Holding</th><th>Kurs</th>
        <th>${term("nav", "NAV je Aktie")}</th><th>${term("abschlag_nav", "Abschlag")}</th>
        ${basic ? "" : `<th title="NAV je Aktie laut letztem Bericht, zum heutigen Wechselkurs">NAV laut Bericht</th>`}
        <th>Stichtag</th><th class="txt">Größte Beteiligungen</th>${basic ? "" : "<th>Börsennotiert</th>"}<th>Börsenwert</th><th></th></tr></thead>
      <tbody>${rows.map(holdingRow).join("")}</tbody></table>`;
    for (const sym of S.open) if (data.holdings.some((h) => h.symbol === sym)) openHolding(sym);
  }

  function holdingRow(h) {
    const notTr = h.tr === 0 ? NOT_TR_TAG : "";
    const own = h.custom ? '<span class="tag" title="Angaben selbst eingetragen bzw. geändert">eigene Angaben</span>' : "";
    const stale = h.stale?.length ? `<span class="tag off" title="Kein aktueller Kurs für: ${esc(h.stale.join(", "))}; dafür gilt der Wert aus dem Bericht">Kurs fehlt</span>` : "";
    const open = S.open.has(h.symbol);
    return `<tr data-holding="${esc(h.symbol)}">
      <td><button class="expander" type="button" data-toggle="${esc(h.symbol)}" aria-expanded="${open}" title="Beteiligungen zeigen">${open ? "▾" : "▸"}</button></td>
      <td class="name"><a href="#/aktie/${encodeURIComponent(h.symbol)}">${esc(h.name)}</a><span class="sym">${esc(h.symbol)}</span>
        ${notTr || own || stale ? `<div class="tags">${notTr}${own}${stale}</div>` : ""}</td>
      <td>${F.money(h.price_eur, "€")}</td><td>${F.money(h.nav_eur, "€")}</td><td><b>${discText(h.disc)}</b></td>
      ${basic ? "" : `<td>${F.money(h.nav_report_eur, "€")}</td>`}
      <td title="${esc(reportHint(h.date))}">${reportFreshness(h.date)}</td>
      <td class="txt top">${esc((h.top || []).join(", ")) || "–"}</td>
      ${basic ? "" : `<td>${F.pct(h.listed_share, 0)}</td>`}
      <td>${F.big(h.cap_eur, "€")}</td>
      <td>${starButton(h.symbol)}</td></tr>`;
  }

  async function openHolding(sym) {
    const tr = root.querySelector(`tr[data-holding="${CSS.escape(sym)}"]`);
    if (!tr) return;
    removeDetail(tr);
    const cols = tr.children.length;
    tr.insertAdjacentHTML("afterend", `<tr class="detail-row"><td colspan="${cols}"><div class="muted">Lade Beteiligungen …</div></td></tr>`);
    const cell = tr.nextElementSibling.firstElementChild;
    let d;
    try { d = await api.trust(sym); } catch (e) { cell.innerHTML = `<div class="error-block">${esc(e.message)}</div>`; return; }
    if (!isCurrent()) return;
    cell.innerHTML = holdingDetail(d);
    renderHistory(cell.querySelector(".hist-slot"), sym, isCurrent);
    cell.querySelector("[data-edit]")?.addEventListener("click", () => showForm(cell.querySelector(".h-form-slot"), d));
    cell.querySelector("[data-reset]")?.addEventListener("click", async () => {
      if (!confirm(d.replaces_default ? "Eigene Änderungen verwerfen und wieder die mitgelieferten Werte verwenden?" : `${d.name} aus der Liste löschen?`)) return;
      await api.trustRemove(sym);
      S.open.delete(sym);
      load();
    });
  }

  function holdingDetail(d) {
    const pos = d.positions.map((p) => `<tr><td class="name">${p.symbol ? `<a href="#/aktie/${encodeURIComponent(p.symbol)}">${esc(p.name)}</a><span class="sym">${esc(p.symbol)}</span>` : esc(p.name)}</td>
        <td>${F.isNum(p.shares) ? F.int(p.shares) : "–"}</td><td>${F.money(p.price_eur, "€")}</td>
        <td class="${(p.change ?? 0) >= 0 ? "good" : "bad"}">${F.signedPct(p.change, 1)}</td>
        <td>${F.big(p.value_eur, "€")}</td><td>${F.pct(p.weight, 1)}</td></tr>`).join("");
    const other = d.other.map((o) => `<tr class="muted-row"><td class="name">${esc(o.name)}</td><td colspan="3" class="muted">Wert laut Bericht</td>
        <td class="${(o.value_eur ?? 0) < 0 ? "bad" : ""}">${F.big(o.value_eur, "€")}</td><td>${F.pct(o.weight, 1)}</td></tr>`).join("");
    const hint = reportHint(d.date);
    return `<div class="detail-box">
      <p style="margin:0 0 8px"><b>${per100(d.disc)}</b> ${F.isNum(d.disc) ? `Innerer Wert ${F.big(d.nav_eur_total, "€")}, Börsenwert ${F.big(d.cap_eur, "€")}.` : ""}</p>
      <div class="hist-slot"></div>
      <table class="data inner"><thead><tr><th>Beteiligung</th><th>Stück</th><th>Kurs</th><th>heute</th><th>Wert</th><th>Anteil am NAV</th></tr></thead>
        <tbody>${pos}${other}<tr class="total"><td class="name"><b>Innerer Wert (NAV)</b></td><td colspan="3" class="muted">${F.int(d.shares)} Aktien</td>
          <td><b>${F.big(d.nav_eur_total, "€")}</b></td><td>${F.money(d.nav_eur, "€")} je Aktie</td></tr></tbody></table>
      <p class="muted" style="font-size:13px;margin:8px 0 0">Quelle: ${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.source || "Bericht")}</a>` : esc(d.source || "eigene Angaben")},
        Stichtag ${reportFreshness(d.date)}. Börsennotierte Beteiligungen zum aktuellen Kurs (umgerechnet in €), übrige Posten zum Wert laut Bericht.
        ${d.note ? esc(d.note) : ""}</p>
      ${hint ? `<p class="notice" style="margin-top:8px">${esc(hint)}</p>` : ""}
      <div class="preset-row small" style="margin-top:10px"><button class="btn small" type="button" data-edit>Angaben ändern</button>
        ${d.custom ? `<button class="btn small" type="button" data-reset>${d.replaces_default ? "Eigene Änderungen verwerfen" : "Holding löschen"}</button>` : ""}</div>
      <div class="h-form-slot"></div></div>`;
  }

  // ---- Formular: Holding anlegen oder ändern (Werte der übrigen Posten in Millionen der Holding-Währung)
  function showForm(slot, d) {
    const def = d?.definition || { currency: "EUR", positions: [], other: [] };
    const posText = def.positions.map((p) => `${p.symbol}; ${p.shares ?? ""}; ${p.name}`).join("\n");
    const otherText = def.other.map((o) => `${o.name}; ${F.num(o.value / 1e6, 0).replace(/\./g, "")}`).join("\n");
    slot.innerHTML = `<form class="h-form" autocomplete="off">
      <div class="filters">
        ${d ? "" : `<div class="field search" style="max-width:220px"><label for="hf-sym">Ticker der Holding</label><input id="hf-sym" class="wide" required placeholder="z. B. LUND-B.ST">
          <ul id="hf-results" class="search-results" role="listbox" hidden></ul></div>`}
        <div class="field"><label for="hf-name">Name</label><input id="hf-name" class="wide" value="${esc(def.name || "")}"></div>
        <div class="field"><label for="hf-ccy">Währung des Berichts</label><input id="hf-ccy" value="${esc(def.currency || "EUR")}" maxlength="3" style="width:70px"></div>
        <div class="field"><label for="hf-asof">Stichtag</label><input id="hf-asof" type="date" value="${esc(def.as_of || "")}" required style="width:150px"></div>
        <div class="field"><label for="hf-shares">Aktienzahl (ohne eigene Aktien)</label><input id="hf-shares" value="${def.shares ?? ""}" required style="width:160px"></div>
        <div class="field"><label for="hf-navps">NAV je Aktie laut Bericht (optional)</label><input id="hf-navps" value="${def.nav_ps_reported ?? ""}" style="width:120px"></div>
      </div>
      <div class="grid two" style="margin-top:10px">
        <div class="field"><label for="hf-pos">Börsennotierte Beteiligungen: je Zeile Ticker; Stückzahl; Name</label>
          <textarea id="hf-pos" rows="8" placeholder="VOW.DE; 157000000; Volkswagen">${esc(posText)}</textarea></div>
        <div class="field"><label for="hf-other">Übrige Posten: je Zeile Name; Wert in Mio. (Schulden negativ)</label>
          <textarea id="hf-other" rows="8" placeholder="Nicht börsennotierte Beteiligungen; 1200&#10;Nettoverschuldung; -4980">${esc(otherText)}</textarea></div>
      </div>
      <div class="filters" style="margin-top:10px">
        <div class="field"><label for="hf-src">Quelle</label><input id="hf-src" class="wide" value="${esc(def.source || "")}" placeholder="z. B. Quartalsbericht Q3 2026"></div>
        <div class="field"><label for="hf-url">Link zum Bericht</label><input id="hf-url" class="wide" value="${esc(def.url || "")}" style="width:340px"></div>
        <button class="btn primary" type="submit">Speichern</button><button class="btn" type="button" data-cancel>Abbrechen</button>
        <span class="muted" data-msg style="font-size:13px"></span>
      </div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">Ticker wie bei Yahoo (z. B. VOW.DE, SAND.ST, RACE.MI). Bei mehreren Aktiengattungen je Gattung eine Zeile.
        Die Aktienzahl der Holding steht im Bericht meist unter „Shares outstanding“ bzw. „ausstehende Aktien“.</p></form>`;
    const f = slot.querySelector("form");
    const q = (s) => f.querySelector(s);
    if (!d) attachSearch(q("#hf-sym"), q("#hf-results"), (sym) => { q("#hf-sym").value = sym; q("#hf-name").focus(); });
    q("[data-cancel]").addEventListener("click", () => { slot.innerHTML = ""; });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const sym = d ? d.symbol : q("#hf-sym").value.trim().toUpperCase();
      const lines = (s) => s.split("\n").map((l) => l.split(";").map((x) => x.trim())).filter((p) => p[0]);
      const num = (s) => (s || "").replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
      const body = {
        name: q("#hf-name").value, currency: q("#hf-ccy").value, as_of: q("#hf-asof").value, shares: num(q("#hf-shares").value),
        nav_ps_reported: num(q("#hf-navps").value), source: q("#hf-src").value, url: q("#hf-url").value, aliases: def.aliases || [],
        positions: lines(q("#hf-pos").value).map(([symbol, shares, name]) => ({ symbol, shares: num(shares), name: name || symbol })),
        other: lines(q("#hf-other").value).map(([name, value]) => ({ name, value: String(parseFloat(num(value)) * 1e6) })),
      };
      q("[data-msg]").textContent = "Speichere …";
      try {
        await api.trustSave(sym, body);
        S.open.add(sym);
        slot.innerHTML = "";
        load();
      } catch (err) { q("[data-msg]").textContent = err.message; }
    });
  }

  // ---------------------------------------------------------------- Fonds
  const FUND_COLS = [
    // [Schlüssel, Überschrift, Glossar, nur Profi]
    ["name", "Fonds"], ["group", "Schwerpunkt"], ["price_eur", "Kurs"], ["nav_eur", "NAV", "nav"],
    ["disc", "Abschlag", "abschlag_nav"], ["disc_usual", "üblich", "ueblicher_abschlag"], ["vs", "vs. üblich", "ueblicher_abschlag"],
    ["range", "Spanne 1 J.", null, true], ["ocf", "Kosten", "laufende_kosten", true],
    ["nav_ret5", "NAV 5 J. p. a.", null, true], ["cap_eur", "Börsenwert", "boersenwert"], ["top", "Größte Positionen"],
  ].filter(([, , , adv]) => !(basic && adv));
  const SORT_VALUE = {
    vs: (r) => (F.isNum(r.disc) && F.isNum(r.disc_usual) ? r.disc - r.disc_usual : null),
    range: (r) => r.disc_range1?.[0] ?? null,
    name: (r) => r.name?.toLowerCase(), group: (r) => r.sector || r.group,
    top: (r) => (r.top || [])[0]?.toLowerCase() ?? null,
  };
  const sortValue = (r, k) => (SORT_VALUE[k] ? SORT_VALUE[k](r) : r[k]);

  function filtered() {
    const q = S.q.trim().toLowerCase();
    return data.funds.filter((r) => (!S.tr || r.tr === 1)
      && (!S.group || r.group === S.group) && (!S.country || r.country === S.country)
      && (!S.minCap || (r.cap_eur ?? 0) >= S.minCap) && (!S.onlyDisc || (r.disc ?? 0) < 0)
      && (!S.cheaper || (F.isNum(r.disc_usual) && r.disc - r.disc_usual <= -0.02))
      && (!q || [r.name, r.symbol, r.isin].some((x) => x && x.toLowerCase().includes(q))));
  }

  function paintFunds() {
    C.unmountWithin($("#f-body"));
    if (!data.ready) {
      $("#f-body").innerHTML = data.error
        ? `<div class="error-block">Die Fonds konnten nicht geladen werden: ${esc(data.error)}. Das Tool versucht es in 20 Minuten erneut.</div>`
        : '<div class="loading-block"><div class="spinner"></div>Fonds werden geladen (rund 20 Sekunden) …</div>';
      $("#f-count").textContent = "";
      return;
    }
    const rows = filtered().sort((a, b) => {
      const va = sortValue(a, S.sort), vb = sortValue(b, S.sort);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * S.dir;
    });
    const trNote = S.tr && data.trade_republic?.ready === false ? " · Handelsliste für Trade Republic wird noch geladen" : "";
    $("#f-count").textContent = `${F.int(rows.length)} von ${F.int(data.funds.length)} Fonds${trNote}`;
    const shown = rows.slice(0, S.limit);
    fundList = rows.filter((r) => r.symbol).map((r) => [r.symbol, r.name]);
    $("#f-body").innerHTML = `<table class="data screener trusts funds"><thead><tr><th scope="col"><span class="visually-hidden">Aufklappen</span></th>
        ${FUND_COLS.map(([k, label, t]) => `<th scope="col" data-key="${k}" class="${["name", "country", "group", "top"].includes(k) ? "txt" : ""}"
          aria-sort="${S.sort === k ? (S.dir > 0 ? "ascending" : "descending") : "none"}">${t ? term(t, label) : label}</th>`).join("")}
        <th scope="col"><span class="visually-hidden">Watchlist</span></th></tr></thead>
      <tbody>${shown.map(fundRow).join("") || `<tr><td colspan="${FUND_COLS.length + 2}" class="muted" style="text-align:left">Keine Fonds für diese Filter.</td></tr>`}</tbody></table>
      ${rows.length > shown.length ? `<div class="more"><button class="btn" type="button" id="f-more">Weitere ${F.int(Math.min(PAGE, rows.length - shown.length))} zeigen</button></div>` : ""}`;
    for (const sym of S.open) if (shown.some((r) => r.symbol === sym)) openFund(sym);
  }

  function fundRow(r) {
    const tags = [r.tr === 0 && !S.tr ? NOT_TR_TAG : "",
      r.appraised ? '<span class="tag" title="Nicht börsennotiertes Vermögen: Der NAV wird nur alle drei bis sechs Monate geschätzt">NAV geschätzt</span>' : ""].join("");
    const open = S.open.has(r.symbol);
    const name = r.symbol ? `<a href="#/aktie/${encodeURIComponent(r.symbol)}">${esc(r.name)}</a>` : esc(r.name);
    const sub = `<span class="sym">${esc([r.symbol, countryName(r.country)].filter(Boolean).join(" · "))}</span>`;
    const cells = {
      name: `<td class="name" title="${esc(r.name)}">${name}<div class="tags">${sub}${tags}</div></td>`,
      group: `<td class="txt cat" title="${esc(r.category || "")}">${esc(r.sector || r.group)}</td>`,
      price_eur: `<td>${F.money(r.price_eur, "€")}</td>`, nav_eur: `<td>${F.money(r.nav_eur, "€")}</td>`,
      disc: `<td><b>${discText(r.disc)}</b></td>`,
      disc_usual: `<td title="${r.usual_basis ? `Durchschnittlicher Abschlag der letzten ${esc(r.usual_basis.replace("J.", "Jahre").replace("Mon.", "Monate"))}` : "Kein Durchschnitt verfügbar (nur für Londoner Fonds)"}">${F.isNum(r.disc_usual) ? F.signedPct(r.disc_usual, 1) : "–"}</td>`,
      vs: `<td>${usualBadge(r.disc, r.disc_usual, true) || "–"}</td>`,
      range: `<td>${r.disc_range1 ? rangeBar(r.disc, r.disc_range1) : "–"}</td>`,
      ocf: `<td>${F.pct(r.ocf, 2)}</td>`,
      nav_ret5: `<td class="${(r.nav_ret5 ?? 0) >= 0 ? "" : "bad"}" title="Jährliche Wertentwicklung des inneren Werts über 5 Jahre (mit Ausschüttungen); zeigt, wie gut die Verwaltung anlegt">${F.signedPct(r.nav_ret5, 1)}</td>`,
      cap_eur: `<td>${F.big(r.cap_eur, "€")}</td>`,
      top: `<td class="txt top">${r.top ? esc(r.top.join(", ")) : r.symbol && hasSource(r) ? '<span class="muted">aufklappen</span>' : '<span class="muted">–</span>'}</td>`,
    };
    return `<tr data-fund="${esc(r.symbol || "")}">
      <td>${r.symbol ? `<button class="expander" type="button" data-toggle-fund="${esc(r.symbol)}" aria-expanded="${open}" title="Details und Positionen">${open ? "▾" : "▸"}</button>` : ""}</td>
      ${FUND_COLS.map(([k]) => cells[k]).join("")}<td>${r.symbol ? starButton(r.symbol) : ""}</td></tr>`;
  }

  const hasSource = (r) => r.exchange === "XLON" || r.country === "US";

  // Spanne des Abschlags im letzten Jahr mit Markierung des heutigen Werts (links = größter Abschlag)
  function rangeBar(disc, [lo, hi]) {
    const pos = hi > lo && F.isNum(disc) ? Math.min(100, Math.max(0, ((disc - lo) / (hi - lo)) * 100)) : 50;
    return `<span class="range" title="Letzte 12 Monate: größter Abschlag ${F.signedPct(lo, 1)}, kleinster ${F.signedPct(hi, 1)}; heute ${F.signedPct(disc, 1)}">
      <span class="range-bar"><span style="left:${pos}%"></span></span></span>`;
  }

  async function openFund(sym) {
    const tr = root.querySelector(`tr[data-fund="${CSS.escape(sym)}"]`);
    if (!tr) return;
    removeDetail(tr);
    tr.insertAdjacentHTML("afterend", `<tr class="detail-row"><td colspan="${tr.children.length}"><div class="muted">Lade Positionen …</div></td></tr>`);
    const cell = tr.nextElementSibling.firstElementChild;
    let d;
    try { d = await api.trust(sym); } catch (e) { cell.innerHTML = `<div class="error-block">${esc(e.message)}</div>`; return; }
    if (!isCurrent()) return;
    cell.innerHTML = fundDetail(d);
    renderHistory(cell.querySelector(".hist-slot"), sym, isCurrent);
    // die größten Positionen gleich auch in der Tabellenzeile zeigen
    const top = (d.holdings?.holdings || []).slice(0, 3).map((h) => h.name);
    const row = data.funds.find((r) => r.symbol === sym);
    if (row && top.length) {
      row.top = top;
      const topCell = tr.querySelector("td.top");
      if (topCell) topCell.textContent = top.join(", ");
    }
  }

  function fundDetail(d) {
    const h = d.holdings || {};
    const list = h.holdings || [];
    const navFresh = h.nav_date ? `NAV vom ${freshness(h.nav_date, d.appraised ? 120 : 7, d.appraised ? 200 : 30, "Letzter veröffentlichter NAV vom")}` : "";
    const facts = [
      per100(d.disc) ? `<b>${per100(d.disc)}</b>` : "",
      F.isNum(d.disc_usual) ? `Üblich (Ø ${esc(d.usual_basis)}): ${F.signedPct(d.disc_usual, 1)} ${usualBadge(d.disc, d.disc_usual)}` : "Kein Durchschnittsabschlag verfügbar.",
      F.isNum(d.disc_avg1) && d.usual_basis !== "1 J." ? `Ø 1 J. ${F.signedPct(d.disc_avg1, 1)}` : "",
      F.isNum(d.disc_avg3) && d.usual_basis !== "3 J." ? `Ø 3 J. ${F.signedPct(d.disc_avg3, 1)}` : "",
      navFresh, F.isNum(d.ocf) ? `Kosten ${F.pct(d.ocf, 2)} p. a.` : "", F.isNum(d.gearing) ? `${term("gearing", "Fremdkapital")} ${F.pct(d.gearing, 0)}` : "",
      F.isNum(d.nav_ret5) ? `NAV-Rendite 5 J. ${F.signedPct(d.nav_ret5, 1)} p. a.${F.isNum(d.ret5) ? ` (Kurs ${F.signedPct(d.ret5, 1)} p. a.)` : ""}` : "",
      F.isNum(d.yield) && d.yield > 0 ? `Dividendenrendite ${F.pct(d.yield, 1)}` : "",
      d.manager ? `Verwaltung: ${esc(d.manager)}` : "", d.launch ? `aufgelegt ${esc(d.launch.slice(0, 4))}` : "",
      d.website ? `<a href="https://${esc(d.website.replace(/^https?:\/\//, ""))}" target="_blank" rel="noopener">Webseite</a>` : "",
    ].filter(Boolean).join(" · ");
    const total = list.reduce((s, x) => s + (x.weight || 0), 0);
    const table = list.length ? `<table class="data inner"><thead><tr><th>Position</th><th>Anteil</th>${list.some((x) => x.kind) ? "<th>Art</th>" : ""}</tr></thead><tbody>
        ${list.map((x) => `<tr><td class="name">${esc(x.name)}${x.title ? `<span class="sym">${esc(x.title)}</span>` : ""}</td><td>${F.pct(x.weight, 1)}</td>
          ${list.some((y) => y.kind) ? `<td class="muted">${esc(KINDS[x.kind] || x.kind || "")}</td>` : ""}</tr>`).join("")}
        <tr class="total"><td class="name">Zusammen</td><td>${F.pct(total, 1)}</td>${list.some((x) => x.kind) ? "<td></td>" : ""}</tr></tbody></table>`
      : `<p class="muted">${h.error ? `Positionen gerade nicht abrufbar (${esc(h.error)}).` : h.source ? "Die Quelle meldet für diesen Fonds keine Positionen." : "Für Fonds an dieser Börse gibt es keine kostenlose Positionsliste; die Webseite des Fonds nennt meist die größten Positionen."}</p>`;
    const src = h.source ? `Positionen: ${esc(h.source)}, Stand ${freshness(h.date, 100, 200, "Positionen laut Meldung vom")}${h.count ? ` · ${F.int(h.count)} Positionen insgesamt` : ""}` : "";
    return `<div class="detail-box"><p style="margin:0 0 8px">${facts}</p>${d.wind_up ? `<p class="muted" style="font-size:13px;margin:0 0 8px">Fortbestand: ${esc(d.wind_up)}</p>` : ""}
      <div class="hist-slot"></div><h3 style="font-size:15px;margin:14px 0 6px">Größte Positionen</h3>
      ${table}<p class="muted" style="font-size:13px;margin:8px 0 0">${src}</p></div>`;
  }

  const KINDS = { EC: "Aktie", DBT: "Anleihe", LON: "Kredit", "ABS-MBS": "Verbriefung", STIV: "Geldmarkt", EP: "Vorzugsaktie", RF: "Fonds", DE: "Derivat" };

  function starButton(sym) {
    const on = watch.has(sym);
    return `<button class="star ${on ? "on" : ""}" type="button" data-watch="${esc(sym)}" title="${on ? "Aus Watchlist entfernen" : "Zur Watchlist"}" aria-label="${on ? "Aus Watchlist entfernen" : "Zur Watchlist"}">${on ? "★" : "☆"}</button>`;
  }

  // ---------------------------------------------------------------- Bedienung
  // Profil aus einer der Tabellen öffnen: im Profil durch die Holdings bzw. die gefilterten Fonds blättern
  let holdingList = [];
  let fundList = [];
  trackBrowse($("#h-body"), "Holdings", () => holdingList);
  trackBrowse($("#f-body"), () => `Trusts & Fonds (${F.int(fundList.length)})`, () => fundList);
  root.addEventListener("click", async (e) => {
    const star = e.target.closest("[data-watch]");
    if (star) {
      star.disabled = true;
      const sym = star.dataset.watch;
      const name = [...holdingList, ...fundList].find(([s]) => s === sym)?.[1];
      // auch nach „Rückgängig“ alle Sterne dieser Aktie neu zeichnen
      const paintStars = async () => {
        watch = await getWatchlist();
        const on = watch.has(sym);
        root.querySelectorAll(`[data-watch="${CSS.escape(sym)}"]`).forEach((b) => { b.classList.toggle("on", on); b.textContent = on ? "★" : "☆"; });
      };
      try { await flipWatch(sym, name, paintStars); } catch (err) { toast(err.message, { kind: "bad" }); } finally { star.disabled = false; }
      return;
    }
    const th = e.target.closest("table.funds th[data-key]");
    if (th && !e.target.closest(".term")) {
      const k = th.dataset.key;
      S.dir = S.sort === k ? -S.dir : ["name", "country", "group", "top", "disc", "vs", "range"].includes(k) ? 1 : -1;
      S.sort = k;
      paintFunds();
      return;
    }
    const tog = e.target.closest("[data-toggle], [data-toggle-fund]");
    if (tog) {
      const sym = tog.dataset.toggle || tog.dataset.toggleFund;
      const tr = tog.closest("tr");
      if (S.open.has(sym)) {
        S.open.delete(sym);
        removeDetail(tr);
        tog.textContent = "▸";
        tog.setAttribute("aria-expanded", "false");
      } else {
        S.open.add(sym);
        tog.textContent = "▾";
        tog.setAttribute("aria-expanded", "true");
        (tog.dataset.toggle ? openHolding : openFund)(sym);
      }
      return;
    }
    if (e.target.id === "f-more") {
      S.limit += PAGE;
      paintFunds();
    }
  });
  $("#h-add").addEventListener("click", () => showForm($("#h-form-new"), null));
  const onFilter = () => {
    S.q = $("#f-q").value;
    S.group = $("#f-group").value;
    S.country = $("#f-country").value;
    S.minCap = Number($("#f-cap").value);
    S.onlyDisc = $("#f-disc").checked;
    S.cheaper = $("#f-cheaper").checked;
    if (S.tr !== $("#f-tr").checked) {
      S.tr = $("#f-tr").checked;
      setTrOnly(S.tr);
    }
    S.limit = PAGE;
    if (data) paintFunds();
  };
  root.querySelectorAll(".filter-card input, .filter-card select").forEach((el) => el.addEventListener(el.tagName === "INPUT" && el.type !== "checkbox" ? "input" : "change", onFilter));
  if (params.get("suche")) {
    $("#f-q").value = params.get("suche");
    S.q = params.get("suche");
  }
  load();
}
