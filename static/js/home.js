// Startseite: Übersicht über Depot, Alarme, nächste Termine und Watchlist; darunter die Schnelleinstiege
import { api, getWatchlist } from "./api.js";
import { trackBrowse } from "./browse.js";
import { NOT_TR_TAG } from "./broker.js";
import * as F from "./format.js";
import { term } from "./glossary.js";
import { isBasic } from "./mode.js";
import { clearRecent, recent } from "./recent.js";
import { savedFilters, savedHref } from "./savedfilters.js";
import { attachSearch } from "./search.js";
import { tutorialProgress } from "./tutorial.js";
import { presetHref } from "./world.js";

const esc = F.escapeHtml;
const QUOTES_MAX = 100; // Grenze von /api/quotes

// Schnelleinstiege in die Weltauswahl; basic: auch in der Basis-Ansicht
const WORLD_LINKS = [
  ["Europa", "#/welt?kontinent=Europa", true], ["Nordamerika", "#/welt?kontinent=Nordamerika", true], ["Asien", "#/welt?kontinent=Asien"],
  ["Deutschland", "#/welt?land=DE", true], ["DACH", "#/welt?land=DE|AT|CH"],
  ["Kauf-Checkliste", presetHref("Kauf-Checkliste"), true],
  ["Stabil & unterbewertet", presetHref("Stabil & unterbewertet"), true], ["Hohe erwartete Rendite", presetHref("Hohe erwartete Rendite"), true],
  ["Dividenden-Aristokraten", presetHref("Dividenden-Aristokraten"), true], ["Dividendenperlen", presetHref("Dividendenperlen")],
];
const TOOL_LINKS = [["Termine", "#/termine"], ["Vergleich", "#/vergleich"], ["Score-Check", "#/score-check"]];
// Vorschläge, wenn die Watchlist leer ist
const STARTER_PRESETS = ["Kauf-Checkliste", "Stabil & unterbewertet", "Hohe erwartete Rendite", "Dividenden-Aristokraten"];

const loadingLine = (text) => `<p class="muted dash-loading"><span class="spinner inline"></span>${esc(text)}</p>`;

// zuletzt angesehene Aktien als Knöpfe unter der Suche
function recentRow() {
  const list = recent();
  if (!list.length) return "";
  return `<div class="recent-line" id="h-recent"><span class="muted">Zuletzt angesehen:</span>
    <span class="recent-row">${list.slice(0, 10).map((r) => `<a class="btn" href="#/aktie/${encodeURIComponent(r.symbol)}" title="${esc(r.symbol)}">${esc(r.name)}</a>`).join("")}</span>
    <button type="button" class="linklike" id="h-recent-clear" title="Liste der zuletzt angesehenen Aktien leeren">leeren</button></div>`;
}

export async function renderHome(root, isCurrent) {
  const tut = tutorialProgress();
  const basic = isBasic();
  const pick = (links) => links.filter(([, , b]) => b || !basic);
  const mine = savedFilters();
  root.innerHTML = `
    <section class="home-head">
      <div>
        <h1>Übersicht</h1>
        <p class="secondary">Depot, Alarme, Termine und Watchlist auf einen Blick. Neue Kandidaten finden Sie in der Weltauswahl.</p>
      </div>
      <div class="search">
        <input id="hero-search" type="search" placeholder="Aktie suchen: Name, Ticker oder ISIN, z. B. Allianz, AAPL, SAP.DE" autocomplete="off" aria-label="Aktie suchen">
        <ul id="hero-results" class="search-results" role="listbox" hidden></ul>
      </div>
    </section>
    ${recentRow()}
    ${tut.done < tut.total ? `<section class="card tut-teaser" style="margin-top:16px">
      <div><h2>${tut.done ? "Tutorial fortsetzen" : "Neu hier? Das Tutorial"}</h2>
        <p class="secondary" style="margin:6px 0 0">In fünf Lektionen führt Sie das Tool durch die eigenen Seiten und zeigt, wie Sie Schritt für Schritt
          Aktien finden, die sich als Investition lohnen könnten.${tut.done ? ` ${tut.done} von ${tut.total} Lektionen geschafft.` : ""}</p></div>
      <div class="preset-row" style="margin-top:0"><a class="btn primary" href="#/tutorial">${tut.done ? "Weitermachen" : "Tutorial starten"}</a>
        ${tut.done ? '<a class="btn" href="#/tutorial?neu=1">Von vorn beginnen</a>' : ""}</div>
    </section>` : ""}
    <div class="grid three dash" style="margin-top:16px">
      <section class="card" id="h-depot"><div class="chart-title"><h2>Depot</h2><a href="#/depot">Öffnen →</a></div>${loadingLine("Lade Kurse …")}</section>
      <section class="card" id="h-alerts"><div class="chart-title"><h2>Alarme</h2><a href="#/alarme">Alle Alarme →</a></div>${loadingLine("Lade …")}</section>
      <section class="card" id="h-dates"><div class="chart-title"><h2>Nächste Termine</h2><a href="#/termine">Alle Termine →</a></div>${loadingLine("Lade …")}</section>
    </div>
    <section class="card" id="h-watch" style="margin-top:12px">
      <div class="chart-title"><h2>Watchlist</h2><a href="#/watchlist">Mit allen Kennzahlen öffnen →</a></div>
      <div id="h-watch-body">${loadingLine("Lade Kurse …")}</div>
    </section>
    <div class="${basic ? "" : "grid two"}" style="margin-top:12px">
      <section class="card">
        <h2>Weltauswahl</h2>
        <p class="secondary" style="margin-top:6px">Rund 6.000 große Aktien weltweit, nach Region, Sektor und Kennzahlen filterbar.</p>
        <div class="preset-row">
          <a class="btn primary" href="#/welt">Alle Aktien</a>
          ${pick(WORLD_LINKS).map(([l, h]) => `<a class="btn" href="${esc(h)}">${esc(l)}</a>`).join("")}
        </div>
        ${mine.length ? `<p class="dash-sub" style="margin-top:12px">Meine Filter</p>
          <div class="preset-row" style="margin-top:4px">${mine.map((f) => `<a class="btn" href="${esc(savedHref(f))}">★ ${esc(f.name)}</a>`).join("")}</div>` : ""}
      </section>
      ${basic ? "" : `<section class="card">
        <h2>Screener und Werkzeuge</h2>
        <p class="secondary" style="margin-top:6px">Kennzahlen für ganze Listen laden, Aktien vergleichen und prüfen, ob die Scores Rendite bringen.</p>
        <div id="preset-row" class="preset-row"></div>
        <div class="preset-row">${TOOL_LINKS.map(([l, h]) => `<a class="btn" href="${h}">${l}</a>`).join("")}</div>
      </section>`}
    </div>`;
  // erst fokussieren, dann die Suche anhängen: so klappt die Liste „Zuletzt angesehen“ nicht ungefragt auf
  root.querySelector("#hero-search").focus();
  attachSearch(root.querySelector("#hero-search"), root.querySelector("#hero-results"));
  const $ = (s) => root.querySelector(s);
  $("#h-recent-clear")?.addEventListener("click", () => { clearRecent(); $("#h-recent").remove(); });

  if (!basic) {
    api.presets().then((presets) => {
      if (!isCurrent()) return;
      $("#preset-row").innerHTML = [...Object.keys(presets), "Eigene Liste"]
        .map((name) => `<a class="btn" href="#/screener?list=${encodeURIComponent(name)}">${esc(name)}</a>`).join("");
    }).catch(() => {});
  }

  let watch, lots, alerts;
  try {
    [watch, lots, alerts] = await Promise.all([getWatchlist(), api.depot(), api.alerts().catch(() => null)]);
  } catch (e) {
    if (isCurrent()) $("#h-watch-body").innerHTML = `<p class="bad">${esc(e.message)}</p>`;
    return;
  }
  if (!isCurrent()) return;
  paintAlerts($("#h-alerts"), alerts);

  const depotSyms = [...new Set(lots.map((l) => l.symbol))];
  const symbols = [...new Set([...depotSyms, ...watch])];
  // Kurse (inkl. Termine) und Kennzahlen der Weltauswahl je eine Sammelabfrage: schnell, ohne einzelne Profile zu laden
  const [quotes, worldRows] = await Promise.all([
    symbols.length ? api.quotes(symbols.slice(0, QUOTES_MAX)).catch(() => []) : [],
    symbols.length ? api.worldStocks(symbols).catch(() => ({})) : {},
  ]);
  if (!isCurrent()) return;
  const live = new Map(quotes.map((q) => [q.symbol, q]));
  paintDepot($("#h-depot"), lots, live, worldRows);
  paintDates($("#h-dates"), symbols, live, worldRows, new Set(depotSyms));
  paintWatch($("#h-watch-body"), [...watch], live, worldRows);
}

// ---------------------------------------------------------------- Depot: Wert, Veränderung heute und seit Kauf
function paintDepot(card, lots, live, worldRows) {
  const body = card.querySelector(".dash-loading") || card.lastElementChild;
  if (!lots.length) {
    body.outerHTML = `<div class="dash-empty"><p class="muted">Noch keine Positionen. Erfassen Sie Ihre Käufe, dann sehen Sie hier jeden Tag
      Wert und Veränderung in Euro.</p><a class="btn primary" href="#/depot">Ersten Kauf erfassen</a></div>`;
    return;
  }
  const bySym = new Map();
  for (const l of lots) {
    const p = bySym.get(l.symbol) || { sym: l.symbol, shares: 0, lots: [] };
    p.shares += l.shares;
    p.lots.push(l);
    bySym.set(l.symbol, p);
  }
  let value = 0, cost = 0, day = 0, missing = 0;
  const movers = [];
  for (const p of bySym.values()) {
    // Kurse kommen in Euro vom Server; Käufe vor der Euro-Anzeige (ohne "currency") stehen in Kurswährung
    const q = live.get(p.sym);
    if (!q || q.currency !== "EUR" || !F.isNum(q.price)) { missing += 1; continue; }
    const v = p.shares * q.price;
    value += v;
    cost += p.lots.reduce((s, l) => s + l.shares * l.price * (l.currency === "EUR" ? 1 : q.eur_rate ?? 1), 0);
    const dayEur = F.isNum(q.change) ? v - v / (1 + q.change) : 0;
    day += dayEur;
    movers.push({ sym: p.sym, name: worldRows[p.sym]?.name || q.name || p.sym, change: q.change, dayEur });
  }
  const dayPct = value - day ? day / (value - day) : null;
  const pl = value - cost;
  const signedMoney = (x) => `${x >= 0 ? "+" : "−"}${F.big(Math.abs(x), "€")}`;
  const top = movers.filter((m) => F.isNum(m.change)).sort((a, b) => Math.abs(b.dayEur) - Math.abs(a.dayEur)).slice(0, 3);
  body.outerHTML = `
    <div class="dash-big">${F.big(value, "€")}</div>
    <dl class="dash-list">
      <div><dt>heute</dt><dd class="${day >= 0 ? "good" : "bad"}">${signedMoney(day)} (${F.signedPct(dayPct, 1)})</dd></div>
      <div><dt>seit Kauf</dt><dd class="${pl >= 0 ? "good" : "bad"}">${signedMoney(pl)} (${F.signedPct(cost ? pl / cost : null, 1)})</dd></div>
    </dl>
    ${top.length ? `<p class="dash-sub">Größte Bewegungen heute</p><ul class="dash-rows">${top.map((m) => `<li>
      <a href="#/aktie/${encodeURIComponent(m.sym)}">${esc(m.name)}</a>
      <span class="${m.change >= 0 ? "good" : "bad"}">${F.signedPct(m.change, 1)}</span></li>`).join("")}</ul>` : ""}
    <p class="muted dash-note">${bySym.size} ${bySym.size === 1 ? "Position" : "Positionen"}${missing ? `, ${missing} ohne aktuellen Kurs` : ""} · Kurse von Yahoo, verzögert</p>`;
}

// ---------------------------------------------------------------- Alarme: ausgelöste zuerst, ungesehene markiert
function paintAlerts(card, data) {
  const body = card.querySelector(".dash-loading");
  if (!data) { body.outerHTML = '<p class="muted">Alarme nicht verfügbar.</p>'; return; }
  const { alerts, status } = data;
  if (!alerts.length) {
    body.outerHTML = `<div class="dash-empty"><p class="muted">Noch keine Alarme. Ein Alarm meldet sich zum Beispiel, wenn eine Aktie Ihrer
      Watchlist 10 % unter ihren fairen Wert fällt oder die Dividende gekürzt wird.</p><a class="btn primary" href="#/alarme">Alarm anlegen</a></div>`;
    return;
  }
  const fired = alerts.filter((a) => a.triggered).sort((a, b) => b.triggered.localeCompare(a.triggered));
  const checked = status.last_check ? `zuletzt geprüft ${new Date(status.last_check * 1000).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}` : "noch nicht geprüft";
  body.outerHTML = `
    <div class="dash-big">${status.unseen ? `${status.unseen} neu` : fired.length ? "nichts Neues" : "alles ruhig"}</div>
    <p class="dash-sub">${F.int(status.open)} aktiv, ${F.int(fired.length)} ausgelöst · ${checked}</p>
    ${fired.length ? `<ul class="dash-rows alerts">${fired.slice(0, 4).map((a) => `<li class="${a.seen ? "" : "new"}">
      <a href="#/aktie/${encodeURIComponent(a.symbol)}">${esc(a.symbol)}</a>
      <span>${esc((a.message || "").replace(new RegExp(`^${a.symbol.replace(/[.^$*+?()[\]{}|\\]/g, "\\$&")}:\\s*`), ""))}</span>
      <span class="muted">${F.date(a.triggered)}</span></li>`).join("")}</ul>`
      : '<p class="muted dash-note">Keiner Ihrer Alarme hat bisher ausgelöst.</p>'}`;
}

// ---------------------------------------------------------------- Termine: Zahlen und Dividenden-Zahltage der nächsten 60 Tage
function paintDates(card, symbols, live, worldRows, depotSyms) {
  const body = card.querySelector(".dash-loading");
  if (!symbols.length) {
    body.outerHTML = `<div class="dash-empty"><p class="muted">Hier erscheinen die nächsten Quartalszahlen und Dividendentermine der Aktien aus
      Watchlist und Depot. Beide sind noch leer.</p></div>`;
    return;
  }
  const localDay = (ms) => new Date(ms).toLocaleDateString("sv-SE"); // JJJJ-MM-TT in Ortszeit
  const today = localDay(Date.now());
  const until = localDay(Date.now() + 60 * 86400000);
  const events = [];
  for (const sym of symbols) {
    const q = live.get(sym);
    if (!q) continue;
    const name = worldRows[sym]?.name || q.name || sym;
    if (q.earnings_date >= today && q.earnings_date <= until) events.push({ day: q.earnings_date, kind: "Zahlen", sym, name, estimate: q.earnings_estimate });
    if (q.dividend_date >= today && q.dividend_date <= until) events.push({ day: q.dividend_date, kind: "Dividende", sym, name });
  }
  events.sort((a, b) => a.day.localeCompare(b.day));
  const dayLabel = (d) => {
    const n = Math.round((Date.parse(`${d}T12:00:00`) - Date.parse(`${today}T12:00:00`)) / 86400000);
    return n === 0 ? "heute" : n === 1 ? "morgen" : `in ${n} Tagen`;
  };
  body.outerHTML = events.length ? `
    <ul class="dash-rows dates">${events.slice(0, 6).map((e) => `<li>
      <span class="dash-day" title="${F.date(e.day)}">${F.date(e.day).slice(0, 6)}</span>
      <span class="badge ${e.kind === "Zahlen" ? "neutral" : "good"}">${e.kind}</span>
      <a href="#/aktie/${encodeURIComponent(e.sym)}">${esc(e.name)}</a>${depotSyms.has(e.sym) ? '<span class="tag">Depot</span>' : ""}
      <span class="muted">${dayLabel(e.day)}${e.estimate ? ", geschätzt" : ""}</span></li>`).join("")}</ul>
    <p class="muted dash-note">Zahlen und Dividenden-Zahltage laut Yahoo; Ex-Tage stehen unter „Alle Termine“.</p>`
    : '<p class="muted">In den nächsten 60 Tagen sind keine Zahlen- oder Dividendentermine bekannt. Ex-Tage stehen unter „Alle Termine“.</p>';
}

// ---------------------------------------------------------------- Watchlist: Kurs, heute, Scores und fairer Wert aus der Weltauswahl
function paintWatch(body, symbols, live, worldRows) {
  if (!symbols.length) {
    body.innerHTML = `<div class="dash-empty"><p class="muted">Noch leer. Merken Sie sich Kandidaten mit ☆ in der Weltauswahl oder mit
      „Zur Watchlist“ im Aktienprofil. Gute Startpunkte:</p>
      <div class="preset-row" style="margin-top:0">${STARTER_PRESETS.map((n) => `<a class="btn" href="${esc(presetHref(n))}">${esc(n)}</a>`).join("")}</div></div>`;
    return;
  }
  const rows = symbols.map((sym) => ({ sym, q: live.get(sym), w: worldRows[sym] }));
  // die interessantesten zuerst: höchster Abschlag zum fairen Wert, Aktien ohne Wert ans Ende
  rows.sort((a, b) => (a.w?.d_dev ?? 9) - (b.w?.d_dev ?? 9));
  trackBrowse(body, "Watchlist (Übersicht)", () => rows.map(({ sym, q, w }) => [sym, w?.name || q?.name || sym]));
  const dev = (w) => (F.isNum(w?.d_dev)
    ? `<span class="badge ${w.d_dev > 0.3 ? "critical" : w.d_dev > 0.1 ? "serious" : w.d_dev >= -0.1 ? "neutral" : "good"}">${F.signedPct(w.d_dev, 0)}</span>`
    : w?.d_rating ? `<span class="muted" title="${esc(w.d_rating)}">unsicher</span>` : "–");
  const score = (v) => (F.isNum(v) ? `<span class="score-cell"><span class="score-bar" style="--w:${v}%"></span><b>${F.int(v)}</b></span>` : "–");
  const notInWorld = rows.filter((r) => !r.w).length;
  body.innerHTML = `
    <div class="table-scroll"><table class="data screener">
      <thead><tr><th>Aktie</th><th>Kurs</th><th>heute</th><th>${term("score_gesamt", "Gesamt-Score")}</th>
        <th>${term("gewinnstabilitaet", "Gewinnstab.")}</th><th>${term("fairer_wert", "vs. fairer Wert")}</th><th>${term("erwartete_rendite", "Erw. Rendite")}</th>
        <th>${term("dividendenrendite", "Div.-Rendite")}</th></tr></thead>
      <tbody>${rows.map(({ sym, q, w }) => `<tr>
        <td class="name"><a href="#/aktie/${encodeURIComponent(sym)}">${esc(w?.name || q?.name || sym)}</a><span class="sym">${esc(sym)}</span>${
          w?.tr === 0 ? `<div class="tags">${NOT_TR_TAG}</div>` : ""}</td>
        <td>${q ? F.money(q.price, q.currency) : "–"}</td>
        <td class="${(q?.change ?? 0) >= 0 ? "good" : "bad"}">${q ? F.signedPct(q.change, 1) : "–"}</td>
        <td>${score(w?.score_total)}</td>
        <td>${F.isNum(w?.d_stab) ? F.stability(w.d_stab) : "–"}</td>
        <td>${dev(w)}</td>
        <td class="${(w?.d_exp ?? 0) >= 0.08 ? "good" : (w?.d_exp ?? 0) < 0 ? "bad" : ""}">${F.signedPct(w?.d_exp, 1)}</td>
        <td>${F.pct(w?.div_yield, 2)}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="muted dash-note">Sortiert nach Abstand zum fairen Wert (Tiefenanalyse der Weltauswahl).${notInWorld
      ? ` ${notInWorld} ${notInWorld === 1 ? "Aktie ist" : "Aktien sind"} nicht in der Weltauswahl; Kennzahlen dazu in der Watchlist.` : ""}</p>`;
}
