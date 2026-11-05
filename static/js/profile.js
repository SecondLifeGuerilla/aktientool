// Aktien-Profil: Qualität, Kurs, Scorecard, Bewertung, fairer Wert, Dividende, Jahreswerte, Fazit
import { api, getWatchlist } from "./api.js";
import { backToList, browseBar, browseStep, wireBrowseBar } from "./browse.js";
import { trLine } from "./broker.js";
import * as C from "./charts.js";
import { derivOverview } from "./derivlist.js";
import * as F from "./format.js";
import { term } from "./glossary.js";
import { setPageKeys } from "./keys.js";
import { isBasic } from "./mode.js";
import { loadOutlook, outlookSection } from "./outlook.js";
import { remember } from "./recent.js";
import { toast } from "./toast.js";
import { discText, freshness, per100, renderHistory, reportFreshness, reportOld, usualBadge } from "./trusts.js";
import { flipWatch } from "./watch.js";
import { getGroups, groupsOf, openAssign, pathLabel } from "./watchgroups.js";

// „Auf einen Blick“ und „Scores & Nachrichten“ stehen vor der Abschnittsnavigation, die übrigen darunter in dieser Reihenfolge
const SECTIONS = [
  ["verdict", "Auf einen Blick"], ["news", "Scores & Nachrichten"], ["outlook", "Zukunft"], ["quality", "Qualität"], ["business", "Geschäft"], ["signals", "Signale"],
  ["price", "Kursentwicklung"], ["scorecard", "Scorecard"], ["valuation", "Bewertung"], ["fairvalue", "Fairer Wert"], ["dividend", "Dividende"],
  ["annual", "Jahreswerte"], ["derivatives", "Hebelprodukte"], ["notes", "Notizen"],
];
const TOP_SECTIONS = new Set(["verdict", "news"]);
// Abschnitte, die es nur in der Profi-Ansicht gibt; die Basis-Ansicht zeigt auch in den übrigen nur das Wichtigste
const ADVANCED_SECTIONS = new Set(["business", "signals", "valuation", "annual"]);
const sections = () => SECTIONS.filter(([id]) => !(isBasic() && ADVANCED_SECTIONS.has(id)));
const DAY = 86400000;
const YEAR = 365.25 * DAY;
const esc = F.escapeHtml;

const RELIABILITY_PHRASE = {
  "äußerst zuverlässig": "eine äußerst zuverlässige Gewinnentwicklung",
  "zuverlässig": "eine zuverlässige Gewinnentwicklung",
  "schwankend": "eine schwankende Gewinnentwicklung",
  "unzuverlässig": "eine unzuverlässige Gewinnentwicklung",
  "rückläufig": "eine rückläufige Gewinnentwicklung",
  "kaum beurteilbar": "eine wegen der kurzen Historie kaum beurteilbare Gewinnentwicklung",
  "von Verlusten geprägt": "eine von Verlusten geprägte Gewinnentwicklung",
};
const GROWTH_PHRASE = {
  "dynamisches Gewinnwachstum": "einem dynamischen Wachstum",
  "solides Gewinnwachstum": "einem soliden Wachstum",
  "geringes Gewinnwachstum": "einem geringen Wachstum",
  "schrumpfende Gewinne": "schrumpfenden Gewinnen",
};
const RATING_NOUN = {
  "stark überbewertet": "einer starken Überbewertung",
  "überbewertet": "einer Überbewertung",
  "fair bewertet": "einer fairen Bewertung",
  "unterbewertet": "einer Unterbewertung",
  "stark unterbewertet": "einer starken Unterbewertung",
  "nicht aussagekräftig": "wegen der gerade eingebrochenen Kennzahl keiner aussagekräftigen Einordnung",
  "unsicher (kurze Historie)": "wegen der kurzen Datenhistorie keiner verlässlichen Einordnung",
};
const METRIC_GENITIVE = {
  eps: "bilanzierten Gewinns", eps_adj: "bereinigten Gewinns", ocf_ps: "operativen Cash-Flows",
  eps_norm: "normalisierten Gewinns (Ø 5 Jahre)", rev_ps: "Umsatzes",
};
// Bezeichnung mit Artikel im Fließtext („der bilanzierte Gewinn“)
const METRIC_NOMINATIVE = {
  eps: "der bilanzierte Gewinn", eps_adj: "der bereinigte Gewinn", ocf_ps: "der operative Cashflow",
  eps_norm: "der normalisierte Gewinn", rev_ps: "der Umsatz",
};

function loading(title, sub = "") {
  return `<div class="loading-block"><div class="spinner"></div><div>${esc(title)}</div><div class="muted">${esc(sub)}</div></div>`;
}

function errorBlock(e, symbol) {
  return `<div class="error-block"><h2>${esc(symbol)} konnte nicht geladen werden</h2><p>${esc(e.message)}</p>
    <p class="muted">Tipp: Deutsche Aktien haben bei Yahoo die Endung .DE (z. B. ALV.DE), Schweizer .SW, Londoner .L.</p></div>`;
}

const tile = (label, value, sub = "", cls = "") =>
  `<div class="tile ${cls}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
const badge = (r) => (r ? `<span class="badge ${r.status}">${esc(r.label)}</span>` : "–");
// Beträge kommen vom Server in Euro (eur.py): Kurse zum Wechselkurs des jeweiligen Tages, Jahreswerte zum heutigen Kurs.
// Ohne Wechselkurs (p.eur == null) bleibt alles in der Originalwährung.
const foreign = (p) => Boolean(p.eur && p.eur.original_currency !== "EUR");
const unitNote = (p, mode) => (!p.eur ? `in ${esc(p.currency || "")}` : !foreign(p) ? "in €"
  : mode === "day" ? "in €, zum Wechselkurs des jeweiligen Tages" : "in €, zum heutigen Wechselkurs");
// Pence & Co.: Wechselkurs je Hauptwährung zeigen (1 GBP = 1,19 € statt 1 GBp = 0,0119 €)
const MINOR_UNITS = { GBp: ["GBP", 100], GBX: ["GBP", 100], ZAc: ["ZAR", 100], ILA: ["ILS", 100], KWF: ["KWD", 1000] };
const fx1 = (p) => (MINOR_UNITS[p.eur.original_currency] || [p.eur.original_currency])[0];
const fxRate = (p) => p.eur.rate * (MINOR_UNITS[p.eur.original_currency]?.[1] ?? 1);
const year = (d) => d.slice(0, 4);

// Tasten zum Blättern gelten schon während des Ladens, damit man zügig durch eine Liste gehen kann
function browseKeys(symbol, extra = {}) {
  setPageKeys({
    ArrowLeft: () => browseStep(symbol, "prev"),
    ArrowRight: () => browseStep(symbol, "next"),
    b: () => backToList(symbol),
    ...extra,
  });
}

export async function renderProfile(root, symbol, isCurrent, refresh = false) {
  root.innerHTML = browseBar(symbol) + loading(`Lade ${symbol} …`, "Beim ersten Aufruf werden Kurse, Bilanzdaten und Schätzungen geholt. Das dauert einige Sekunden.");
  wireBrowseBar(root, symbol);
  browseKeys(symbol);
  let p;
  try {
    p = await api.profile(symbol, refresh);
  } catch (e) {
    if (isCurrent()) {
      root.innerHTML = browseBar(symbol) + errorBlock(e, symbol);
      wireBrowseBar(root, symbol);
    }
    return;
  }
  if (!isCurrent()) return;
  document.title = `${p.name} – Aktientool`;
  remember(p.symbol, p.name);
  C.disposeAll();
  const build = { outlook: outlookSection, quality, business, signals, price, scorecard, valuation, fairvalue: fairValue, dividend, annual, derivatives, notes };
  // bei Trusts und Holdings zählt der Abschlag zum inneren Wert mehr als KGV & Co.: deshalb vor „Auf einen Blick“
  root.innerHTML = [browseBar(p.symbol), head(p), trustCard(p), glance(p), overview(), subnav(), ...sections().filter(([id]) => !TOP_SECTIONS.has(id)).map(([id]) => build[id](p))].join("");
  wireBrowseBar(root, p.symbol);
  loadOutlook(root, p, isCurrent);
  wire(root, p, isCurrent);
}

// ---------------------------------------------------------------- Kopf
function head(p) {
  const f = p.facts;
  const d = p.data;
  const ccy = p.currency;
  const years = d.fundamental_years ? `Geschäftsjahre ${d.fundamental_years[0]}–${d.fundamental_years[1]}` : "keine Jahresabschlüsse";
  const age = F.isNum(d.age_seconds) ? (d.age_seconds < 120 ? "gerade eben" : `vor ${Math.round(d.age_seconds / 60)} Min.`) : "";
  const website = f.website ? `<a href="${esc(f.website)}" target="_blank" rel="noopener">${esc(f.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>` : "–";
  const basic = isBasic();
  // drittes Element true: nur in der Profi-Ansicht
  const facts = [
    ["Land", esc(f.country || "–")], [term("sektor", "Sektor"), esc(f.sector || "–")], [term("branche", "Branche"), esc(f.industry || "–"), true],
    ["Mitarbeiter", F.int(f.employees), true], ["Webseite", website, true], [term("isin", "ISIN"), `<span id="fact-isin">${esc(f.isin || "–")}</span>`, true],
    [term("boersenwert", "Börsenwert"), F.big(f.market_cap, ccy)], ["Aktienkurs", F.money(f.price, ccy)],
    [term("dividendenrendite", "Dividendenrendite"), F.pct(f.dividend_yield, 2)],
    ["Nächste Zahlen", f.earnings_date ? F.date(f.earnings_date) : "–"],
  ].filter(([, , adv]) => !(basic && adv)).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
  const warnings = d.warnings.map((w) => `<li class="warn">${esc(w)}</li>`).join("");
  // Basis-Ansicht: Datenquelle und Ladezeit entfallen, Warnungen (z. B. kurze Historie) bleiben
  const notice = basic ? (warnings ? `<div class="notice"><ul>${warnings}</ul></div>` : "") : `
    <div class="notice">
      Fundamentaldaten: <b>${esc(d.fundamentals_source)}</b> (${years}, ${term("bilanzwaehrung", "Bilanzwährung")} ${esc(d.financial_currency || "–")}) ·
      ${foreign(p) || (p.eur && d.financial_currency && d.financial_currency !== "EUR") ? "alle Beträge in € umgerechnet (Kurse zum Tageskurs, Jahreswerte zum heutigen Kurs) ·" : ""}
      Kurse seit ${F.date(d.price_start)} · letzter Kurs ${F.date(d.last_price_date)} · geladen ${age}
      ${warnings ? `<ul>${warnings}</ul>` : ""}
    </div>`;
  return `
  <section class="card">
    <div class="profile-head">
      <div>
        <h1>${esc(p.name)}</h1>
        <div class="meta">${esc(p.symbol)} · ${esc(p.exchange || "")} · ${esc(p.eur?.original_currency || ccy || "")}</div>
        <div class="tr-line" id="tr-line">${trLine(p.trade_republic, F.date)}</div>
        <div class="price">${F.money(f.price, ccy)} <small class="${(f.change ?? 0) >= 0 ? "good" : "bad"}">${F.signedPct(f.change, 2)}</small></div>
        ${foreign(p) ? `<div class="muted price-orig">an der Börse ${F.money(p.eur.original_price, p.eur.original_currency)} · 1 ${esc(fx1(p))} = ${F.num(fxRate(p), 4)} €</div>`
          : !p.eur ? '<div class="muted price-orig">Euro-Umrechnung gerade nicht möglich (kein Wechselkurs); Beträge in Originalwährung.</div>' : ""}
      </div>
      <div class="actions">
        <button class="btn" id="watch-btn" type="button">☆ Zur Watchlist</button>
        <button class="btn" id="group-btn" type="button" hidden title="Watchlist-Gruppen dieser Aktie wählen">Gruppe wählen</button>
        <a class="btn" href="#/depot?neu=${encodeURIComponent(p.symbol)}" title="Position im Depot erfassen">＋ Depot</a>
        <a class="btn" href="#/alarme?neu=${encodeURIComponent(p.symbol)}" title="Kurs- oder Bewertungsalarm anlegen">🔔 Alarm</a>
        ${basic ? "" : `<a class="btn" href="#/vergleich?s=${encodeURIComponent(p.symbol)}" title="Mit anderen Aktien vergleichen">⇄ Vergleichen</a>`}
        <a class="btn" href="#/callput?s=${encodeURIComponent(p.symbol)}" title="Optionsschein oder Knock-out auf diese Aktie durchrechnen">Call/Put</a>
        <button class="btn" id="refresh-btn" type="button" title="Daten neu von Yahoo laden">↻ Aktualisieren</button>
      </div>
    </div>
    <dl class="facts">${facts}</dl>
    ${notice}
    <details class="about" id="about"${f.description ? "" : " hidden"}><summary>Was macht ${esc(p.name)}? <span class="muted" id="about-src">(Beschreibung von Yahoo, englisch)</span></summary>
      <div id="about-text"><p>${esc(f.description || "")}</p></div></details>
  </section>`;
}

// ---------------------------------------------------------------- Auf einen Blick: das Fazit direkt unter dem Kopf
const RELIABILITY_STATUS = {
  "äußerst zuverlässig": "good", "zuverlässig": "good", "schwankend": "warning", "unzuverlässig": "serious",
  "rückläufig": "critical", "kaum beurteilbar": "neutral", "von Verlusten geprägt": "serious",
};

function glance(p) {
  const s = p.summary;
  const q = p.quality;
  const v = p.valuation;
  const per = v.available ? v.periods[v.default_period] : null;
  const exp = v.expected?.by_period?.[v.default_period];
  const uncertain = v.dip_now || v.short_history;
  const rel = s.earnings.reliability;
  const earnSub = q.loss_making ? `Verlust in ${q.losses} von ${q.count} Geschäftsjahren`
    : [F.isNum(q.stability) ? `Stabilität ${F.stability(q.stability)}` : null,
      F.isNum(q.growth) ? `Gewinn ${F.signedPct(q.growth, 1)} pro Jahr` : null].filter(Boolean).join(" · ") || "zu wenige Geschäftsjahre";
  const expText = F.isNum(exp)
    ? `<br>erwartete Rendite <span class="${uncertain ? "" : exp >= 0.08 ? "good" : exp < 0 ? "bad" : ""}">${F.signedPct(exp, 1)} pro Jahr</span>` : "";
  const valSub = per ? `Kurs ${F.signedPct(per.deviation, 0)} vs. ${term("fairer_wert", "fairer Wert")} ${F.money(per.fair_value, p.currency)}${expText}`
    : "kein fairer Wert berechenbar";
  const cards = [...p.scorecard].sort((a, b) => b.score - a.score);
  const best = cards[0];
  const fit = best && best.score >= 6;
  const mom = p.price.momentum;
  const tiles = [
    tile(term("gewinnstabilitaet", "Gewinnentwicklung"), badge(rel ? { label: rel, status: RELIABILITY_STATUS[rel] || "neutral" } : null), earnSub),
    tile("Bewertung", badge(s.valuation || { label: "nicht bewertbar", status: "neutral" }), valSub),
    tile(term("scorecard", "Passt am besten zu"), fit ? esc(best.label) : '<span class="muted">keiner Strategie</span>',
      `Scores 1–10: ${cards.map((c) => `${esc(c.label)} <b>${c.score}</b>`).join(" · ")}`),
    tile(term("momentum", "Stimmung"), badge(s.sentiment),
      F.isNum(mom) ? `Kurs ${F.pct(Math.abs(mom), 1)} ${mom >= 0 ? "über" : "unter"} der 200-Tage-Linie` : "zu kurze Kurshistorie"),
  ].join("");
  return `
  <section class="card glance" id="sec-verdict" style="margin-top:12px">
    <div class="chart-title">
      <h2 style="font-size:18px">Auf einen Blick</h2>
      <a href="#/tutorial?pruefen=${encodeURIComponent(p.symbol)}">Kauf-Checkliste für diese Aktie →</a>
    </div>
    <p class="glance-text">${esc(s.text)}</p>
    <div class="grid tiles">${tiles}</div>
  </section>`;
}

// ---------------------------------------------------------------- Trust oder Holding: Abschlag zum inneren Wert
function trustCard(p) {
  const t = p.trust;
  if (!t || !F.isNum(t.disc)) return "";
  const holding = t.kind === "holding";
  const tiles = [
    tile(term("abschlag_nav", "Kurs vs. innerer Wert"), `<b>${discText(t.disc)}</b>`,
      `Kurs ${F.money(t.price_eur, "€")} · ${term("nav", "NAV")} ${F.money(t.nav_eur, "€")} je Aktie`),
    holding
      ? tile("Börsennotierte Beteiligungen", F.pct(t.listed_share, 0), "des Bruttovermögens zum aktuellen Kurs; der Rest zum Wert laut Bericht")
      : tile(term("ueblicher_abschlag", "Üblicher Abschlag"),
        F.isNum(t.disc_usual) ? `${F.signedPct(t.disc_usual, 1)} <small class="muted">Ø ${esc(t.usual_basis)}</small>` : "–",
        usualBadge(t.disc, t.disc_usual) || "für diesen Fonds kein Durchschnitt verfügbar"),
    holding
      ? tile("NAV laut Bericht", F.money(t.nav_report_eur, "€"), "je Aktie, zum heutigen Wechselkurs")
      : tile(term("laufende_kosten", "Kosten"), F.isNum(t.ocf) ? `${F.pct(t.ocf, 2)} p. a.` : "–",
        [F.isNum(t.gearing) ? `${term("gearing", "Fremdkapital")} ${F.pct(t.gearing, 0)}` : "", esc(t.sector || t.group || "")].filter(Boolean).join(" · ")),
    tile("Datenstand", holding ? reportFreshness(t.date) : freshness(t.date, 4, 10, "Schlusskurs und NAV vom"),
      !holding ? "Schlusskurs und NAV, automatisch aktualisiert"
        : reportOld(t.date) ? 'Bericht älter als drei Monate: neuere Zahlen unter <a href="#/trusts">Trusts & Holdings</a> eintragen'
          : "Beteiligungen laut Bericht, Kurse aktuell"),
  ].join("");
  const top = t.top?.length ? ` Größte ${holding ? "Beteiligungen" : "Positionen"}: ${esc(t.top.join(", "))}.` : "";
  return `
  <section class="card glance trust-card" id="sec-trust" style="margin-top:12px">
    <div class="chart-title">
      <h2 style="font-size:18px">Innerer Wert (${holding ? "Holding" : "Trust"})</h2>
      <a href="#/trusts">Alle Trusts & Holdings vergleichen →</a>
    </div>
    <p class="glance-text">${per100(t.disc)}${top} KGV, fairer Wert und Scorecard sagen bei ${holding ? "Holdings" : "Trusts"} wenig aus;
      maßgeblich sind der Abschlag im Vergleich zum üblichen, die Kosten und die Wertentwicklung der Beteiligungen.</p>
    <div class="grid tiles">${tiles}</div>
    <div class="hist-slot" id="trust-hist" style="margin-top:14px"></div>
  </section>`;
}

// ---------------------------------------------------------------- Scores im Sektorvergleich und Nachrichten
// viertes Element true: nur in der Profi-Ansicht
const WORLD_SCORES = [
  ["score_total", "Gesamt", "score_gesamt"], ["score_quality", "Qualität", "score_qualitaet"],
  ["score_value", "Bewertung", "score_bewertung"], ["score_growth", "Wachstum", "score_wachstum"],
  ["score_momentum", "Momentum", "score_momentum", true], ["score_dividend", "Dividende", "score_dividende"],
  ["magic_formula", "Magic Formula", "magic_formula", true],
];

function overview() {
  return `
  <div class="grid two" id="sec-news" style="margin-top:12px">
    <section class="card" id="world-card"><h2 style="font-size:18px">Scores im Sektorvergleich</h2><p class="muted">Lade …</p></section>
    <section class="card">
      <div class="chart-title">
        <h2 style="font-size:18px">Aktuelle Nachrichten</h2>
        <div class="segmented" id="news-seg" role="group" aria-label="Sprache der Nachrichten">
          <button type="button" data-lang="de" aria-pressed="true">Deutsch</button><button type="button" data-lang="en" aria-pressed="false">Englisch</button>
        </div>
      </div>
      <ul class="news-list" id="news-list"></ul>
      <p class="muted" id="news-src" style="font-size:12px;margin:8px 0 0"></p>
    </section>
  </div>`;
}

async function loadWorld(root, p, isCurrent) {
  const card = root.querySelector("#world-card");
  let w;
  try { w = await api.worldStock(p.symbol); } catch (e) { w = {}; }
  if (!isCurrent()) return;
  loadDescription(root, p, w.isin, isCurrent);
  // Yahoo liefert die ISIN im Profil oft nicht (z. B. bei US-Aktien), der Screener der Weltauswahl schon
  const isin = root.querySelector("#fact-isin"); // nicht in der Basis-Ansicht
  if (w.isin && !p.facts.isin && isin) isin.textContent = w.isin;
  if (!w.symbol) {
    card.innerHTML = `<h2 style="font-size:18px">Scores im Sektorvergleich</h2>
      <p class="secondary">Diese Notierung ist nicht in der <a href="#/welt">Weltauswahl</a> enthalten (z. B. Börsenwert unter der Mindestgröße,
      eine Zweitnotierung oder die Weltauswahl ist noch nicht geladen). Scores gibt es nur dort.</p>`;
    return;
  }
  const basic = isBasic();
  const rows = WORLD_SCORES.filter(([k, , , adv]) => F.isNum(w[k]) && !(basic && adv)).map(([k, label, t]) => `
    <div class="ws-row"><span>${term(t, label)}</span>
      <span class="score-cell"><span class="score-bar" style="--w:${w[k]}%"></span><b>${F.int(w[k])}</b></span></div>`).join("");
  const themes = (w.themes || []).map((t) => `<a class="tag" href="#/welt?thema=${encodeURIComponent(t)}&ansicht=scores&sort=score_total">${esc(t)}</a>`).join("");
  const peers = `#/welt?branche=${encodeURIComponent(w.industry || "")}&ansicht=scores&sort=score_total`;
  card.innerHTML = `<h2 style="font-size:18px">Scores im Sektorvergleich</h2>
    <p class="muted" style="font-size:13px;margin:4px 0 10px">0–100, höher ist besser: 80 = besser als 80 % der Aktien im Sektor ${esc(w.sector || "")}
      (Weltauswahl, ${F.int(w.universe)} Aktien). Der Gesamt-Score vergleicht mit allen Aktien.</p>
    ${rows || '<p class="muted">Für diese Aktie fehlen die nötigen Kennzahlen.</p>'}
    ${themes ? `<p style="margin:12px 0 0">${term("thema", "Themen")}: ${themes}</p>` : ""}
    <p style="margin:10px 0 0"><a href="${peers}">Andere Aktien der Branche ${esc(w.industry || "")} vergleichen →</a></p>`;
}

function ago(iso) {
  if (!iso) return "";
  const min = (Date.now() - Date.parse(iso)) / 60000;
  if (min < 60) return `vor ${Math.max(1, Math.round(min))} Min.`;
  if (min < 24 * 60) return `vor ${Math.round(min / 60)} Std.`;
  if (min < 7 * 24 * 60) return `vor ${Math.round(min / 1440)} Tagen`;
  return F.date(iso);
}

async function loadNews(root, p, isCurrent, lang) {
  const list = root.querySelector("#news-list");
  root.querySelectorAll("#news-seg [data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
  list.innerHTML = '<li class="muted">Lade Nachrichten …</li>';
  root.querySelector("#news-src").textContent = "";
  let items;
  try {
    items = await api.news(p.symbol, p.name, lang);
  } catch (e) {
    if (isCurrent()) list.innerHTML = `<li class="muted">Nachrichten nicht verfügbar: ${esc(e.message)}</li>`;
    return;
  }
  if (!isCurrent() || root.querySelector('#news-seg [aria-pressed="true"]')?.dataset.lang !== lang) return;
  list.innerHTML = items.length
    ? items.slice(0, 10).map((n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>
        <div class="muted">${esc(n.source)}${n.published ? ` · ${ago(n.published)}` : ""}</div></li>`).join("")
    : '<li class="muted">Keine aktuellen Nachrichten gefunden.</li>';
  root.querySelector("#news-src").textContent = lang === "de"
    ? "Quelle: Google News, Suche nach Firmenname + „Aktie“. Links öffnen die Originalartikel in einem neuen Tab."
    : "Quelle: Yahoo Finance. Links öffnen die Originalartikel in einem neuen Tab.";
}

function subnav() {
  return `<nav class="subnav" aria-label="Abschnitte">${sections().map(([id, label]) => `<button type="button" data-target="sec-${id}">${label}</button>`).join("")}</nav>`;
}

// ---------------------------------------------------------------- Qualität
function quality(p) {
  const q = p.quality;
  const s = p.summary.earnings;
  const otherLabel = q.basis === "eps_adj" ? "bilanzierten Gewinns" : "bereinigten Gewinns";
  const parts = [];
  if (q.loss_making) {
    const pts = q.points.slice(-q.count);
    const [first, last] = [pts[0], pts[pts.length - 1]];
    parts.push(`${esc(p.name)} hat in ${q.losses} von ${q.count} Geschäftsjahren (${year(q.start)}–${year(q.end)}) Verlust gemacht.
      Eine ${term("gewinnstabilitaet", "Gewinnstabilität")} wird deshalb nicht berechnet: Die Trendlinie durch die Jahreswerte würde
      auch schrumpfende Verluste als gleichmäßiges Wachstum werten.`);
    if (first && last && last[0] !== first[0]) {
      parts.push(`Der ${q.basis_label.replace("en Gewinn", "e Gewinn")} je Aktie hat sich von ${F.money(first[1], p.currency)} (${year(first[0])})
        auf ${F.money(last[1], p.currency)} (${year(last[0])}) ${last[1] > first[1] ? "verbessert" : "verschlechtert"}.`);
    }
    if (!isBasic()) parts.push("Ob das Geschäft trotzdem vorankommt, zeigen Umsatz und Margen im Abschnitt Geschäft.");
  } else if (F.isNum(q.stability)) {
    parts.push(`Die Gewinnstabilität von ${esc(p.name)} liegt bei ${F.stability(q.stability)} von max. 1,0, was auf ${RELIABILITY_PHRASE[s.reliability] || "eine unklare Gewinnentwicklung"} schließen lässt.
      Grundlage ist der ${q.basis_label.replace("en Gewinn", "e Gewinn")} der Geschäftsjahre ${year(q.start)}–${year(q.end)}.`);
    if (F.isNum(q.other_stability)) parts.push(`Die Stabilität des ${otherLabel} liegt bei ${F.stability(q.other_stability)}.`);
  } else {
    parts.push("Für eine Aussage zur Gewinnstabilität liegen zu wenige Geschäftsjahre vor.");
  }
  if (F.isNum(q.growth) && q.short) {
    parts.push(`Über die nur ${Math.round(q.years)} Jahre ergibt sich ein Gewinnwachstum von ${F.pct(q.growth, 2)} pro Jahr.
      So kurze Reihen hängen stark vom Startjahr ab (z. B. ein Einbruchsjahr) und zeigen keinen verlässlichen Trend;
      in der Scorecard zählen Stabilität und Wachstum deshalb höchstens neutral.`);
  } else if (F.isNum(q.growth)) {
    parts.push(`Auf ${Math.round(q.years)}-Jahres-Sicht liegt das durchschnittliche Gewinnwachstum bei ${F.pct(q.growth, 2)} pro Jahr, was ${GROWTH_PHRASE[s.growth] || "einem unklaren Wachstum"} entspricht.`);
  }
  if (F.isNum(q.forecast_growth)) {
    parts.push(`Für das laufende Geschäftsjahr erwarten Analysten ${q.forecast_growth >= 0 ? "einen Zuwachs" : "einen Rückgang"} des Gewinns um ${F.pct(Math.abs(q.forecast_growth), 1)}.`);
  }
  if (s.outlook) parts.push("Zusammengefasst ist langfristig mit einer positiven Rendite zu rechnen.");
  return `
  <section class="section" id="sec-quality">
    <h2>Ist die ${esc(p.name)} Aktie ein gutes Investment?</h2>
    <p class="lead">Langfristig zählen Unternehmen mit zuverlässig steigenden Gewinnen. Nur dann steigen auch Kurse und Dividenden nachhaltig.</p>
    <div class="grid tiles">
      ${tile(term("gewinnstabilitaet", "Gewinnstabilität"), F.stability(q.stability),
        q.loss_making ? `nicht berechenbar · Verlust in ${q.losses} von ${q.count} Jahren` : `von max. 1,0${s.reliability ? ` · ${esc(s.reliability)}` : ""}`)}
      ${tile(term("wachstum_pa", `Gewinnwachstum (${Math.round(q.years || 0)} J.)`), F.pct(q.growth, 2), "pro Jahr")}
      ${tile(term("gewinnwachstum_erwartet", "Erwartung lfd. Geschäftsjahr"), F.signedPct(q.forecast_growth, 1), "Analystenschätzung (Gewinn)")}
    </div>
    <p style="margin-top:14px;max-width:900px">${parts.join(" ")}</p>
    <div class="card">
      <div class="chart-title"><h3>Gewinn je Aktie (${esc(q.basis_label.replace("en Gewinn", "er Gewinn"))})</h3><span class="muted">${unitNote(p, "now")} · Prognose aus Analystenschätzungen</span></div>
      <div class="chart" id="ch-eps"></div>
    </div>
    ${isBasic() ? "" : qualityExtra(p)}
  </section>`;
}

// Kapitalrendite, Piotroski F-Score, Aktienrückkäufe, Free-Cashflow-Rendite
function qualityExtra(p) {
  const f = p.fundamentals;
  if (!f) return "";
  const roic = f.roic;
  const pio = f.piotroski;
  const sh = f.shares;
  const roicSub = roic.reason ? esc(roic.reason)
    : F.isNum(roic.average) ? `Ø ${roic.years.length} J.: ${F.pct(roic.average, 1)} · ${roic.latest >= 0.15 ? "Burggraben-Niveau" : roic.latest >= 0.08 ? "über den Kapitalkosten" : "unter den Kapitalkosten"}` : "";
  const pioSub = F.isNum(pio.score) ? `${pio.score >= 8 ? "stark" : pio.score >= 5 ? "solide" : pio.score >= 3 ? "schwach" : "sehr schwach"} · ${pio.checked} von 9 Punkten prüfbar` : "zu wenige Bilanzdaten";
  const shareSub = F.isNum(sh.cagr) ? `${sh.cagr < -0.005 ? "Rückkäufe" : sh.cagr > 0.005 ? "Verwässerung" : "etwa gleich"} · ${F.num(sh.years, 0)} J.` : "zu wenige Jahreswerte";
  const tests = pio.tests?.length ? `<details class="table-view"><summary>Piotroski-Prüfpunkte anzeigen</summary>
      <ul class="checklist">${pio.tests.map((t) => `<li class="${t.passed == null ? "muted" : t.passed ? "good" : "bad"}">${t.passed == null ? "–" : t.passed ? "✓" : "✗"} ${esc(t.label)}</li>`).join("")}</ul>
      <p class="muted" style="font-size:13px">Vergleich des letzten mit dem vorletzten Geschäftsjahr (Yahoo-Abschlüsse).</p></details>` : "";
  return `
    <h3 style="margin:18px 0 8px">Weitere Qualitätssignale</h3>
    <div class="grid tiles">
      ${tile(term("roic", "Kapitalrendite (ROIC)"), F.pct(roic.latest, 1), roicSub)}
      ${tile(term("piotroski", "Piotroski F-Score"), F.isNum(pio.score) ? `${pio.score}<small class="muted"> / 9</small>` : "–", pioSub)}
      ${tile(term("aktienrueckkauf", "Aktienzahl pro Jahr"), F.signedPct(sh.cagr, 1), shareSub)}
      ${tile(term("fcf_rendite", "Free-Cashflow-Rendite"), F.pct(f.fcf_yield, 1), "Free Cashflow (12 Monate) ÷ Kurs")}
    </div>
    ${tests}`;
}

// ---------------------------------------------------------------- Geschäft: Umsatz, Margen, Finanzkraft (nur Profi)
// Beträge in Bilanzwährung, damit Wachstumsraten nicht von Wechselkursen abhängen
const MARGINS = [
  ["gross_margin", "Bruttomarge", "bruttomarge"], ["operating_margin", "Operative Marge", "operative_marge"],
  ["net_margin", "Nettomarge", "nettomarge"], ["fcf_margin", "Free-Cashflow-Marge", "fcf_marge"],
];
const latestWith = (rows, key) => [...rows].reverse().find((r) => F.isNum(r[key]));

function business(p) {
  const b = p.business;
  const head = `<h2>Wie entwickelt sich das Geschäft von ${esc(p.name)}?</h2>`;
  if (!b?.years?.length) {
    return `<section class="section" id="sec-business">${head}<p class="muted">Für ${esc(p.name)} liegen keine Umsatzdaten vor.</p></section>`;
  }
  const ccy = b.currency || "";
  const ys = b.years;
  const last = ys[ys.length - 1];
  const tr = b.revenue_trend;
  const e0 = b.estimates.find((e) => e.key === "0y");
  // Die letzten 12 Monate nur zeigen, wenn sie vom Geschäftsjahr abweichen (Halbjahresberichter liefern oft dasselbe)
  const ttmNew = F.isNum(b.ttm.revenue) && F.isNum(last.revenue) && Math.abs(b.ttm.revenue / last.revenue - 1) > 0.005;
  const revenueTiles = [
    tile(`Umsatz ${year(last.end)}`, F.big(last.revenue, ccy), F.isNum(last.growth) ? `${F.signedPct(last.growth, 1)} gegenüber Vorjahr` : "kein Vorjahreswert"),
    tile(term("wachstum_pa", `Umsatzwachstum (${Math.round(tr.years || 0)} J.)`), F.signedPct(tr.growth, 1),
      F.isNum(tr.growth) ? `pro Jahr · Stabilität ${F.stability(tr.stability)}${tr.years < 4.8 ? " · kurze Historie" : ""}` : "zu wenige Jahreswerte"),
    ttmNew ? tile("Umsatz letzte 12 Monate", F.big(b.ttm.revenue, ccy), `Geschäftsjahr ${year(last.end)}: ${F.big(last.revenue, ccy)}`) : "",
    e0 && F.isNum(e0.revenue_growth) ? tile(term("umsatzerwartung", `Erwartung ${e0.year ?? "lfd. GJ"}`), F.signedPct(e0.revenue_growth, 1),
      `${F.big(e0.revenue, ccy)} · ${F.int(e0.revenue_analysts)} Analysten`) : "",
  ].join("");

  const marginTile = ([key, label, t]) => {
    const r = latestWith(ys, key);
    if (!r) return "";
    const before = latestWith(ys.filter((x) => x.end < r.end), key);
    const ttm = ttmNew && F.isNum(b.ttm[key]) ? ` · 12 Monate ${F.pct(b.ttm[key], 1)}` : "";
    return tile(term(t, label), F.pct(r[key], 1), `${year(r.end)}${before ? ` · Vorjahr ${F.pct(before[key], 1)}` : ""}${ttm}`);
  };
  const rnd = latestWith(ys, "rnd_ratio");
  const marginTiles = [...MARGINS.map(marginTile),
    rnd ? tile(term("fe_quote", "F&E-Quote"), F.pct(rnd.rnd_ratio, 1), `Forschung und Entwicklung ÷ Umsatz · ${year(rnd.end)}`) : ""].join("");

  const bal = b.balance;
  const h = b.holders || {};
  const strengthTiles = [
    F.isNum(bal.net_cash) ? tile(term("nettoliquiditaet", bal.net_cash >= 0 ? "Nettoliquidität" : "Nettoverschuldung"), F.big(Math.abs(bal.net_cash), ccy),
      `Kasse ${F.big(bal.cash, ccy)} · Schulden ${F.big(bal.debt, ccy)}`) : "",
    F.isNum(bal.equity_ratio) ? tile(term("eigenkapitalquote", "Eigenkapitalquote"), F.pct(bal.equity_ratio, 0),
      `Eigenkapital ${F.big(bal.equity, ccy)} · Bilanz ${year(bal.date)}`) : "",
    F.isNum(bal.runway_years)
      ? tile(term("cash_reichweite", "Cash-Reichweite"), `<span class="${bal.runway_years < 2 ? "bad" : ""}">${F.num(bal.runway_years, 1)} Jahre</span>`,
        `Free Cashflow 12 Monate: ${F.big(bal.fcf_ttm, ccy)}`)
      : F.isNum(bal.fcf_ttm) ? tile(term("free_cashflow", "Free Cashflow (12 Monate)"), F.big(bal.fcf_ttm, ccy),
        bal.fcf_ttm >= 0 ? "positiv: das Geschäft finanziert sich selbst" : "negativ") : "",
    F.isNum(h.insiders) || F.isNum(h.institutions) ? tile(term("aktionaersstruktur", "Aktionärsstruktur"), `${F.pct(h.insiders, 0)} <small class="muted">Insider</small>`,
      `${F.pct(h.institutions, 0)} institutionelle Anleger${F.isNum(h.institutions_count) ? ` (${F.int(h.institutions_count)})` : ""}`) : "",
  ].join("");

  const shortMargins = ys.filter((r) => F.isNum(r.gross_margin) || F.isNum(r.operating_margin)).length < ys.filter((r) => F.isNum(r.net_margin)).length;
  const clipped = MARGINS.some(([k]) => ys.some((r) => r[k] < -1));
  const marginNotes = [shortMargins ? "Brutto- und operative Marge nur für die Jahre mit Yahoo-Abschlüssen (rund 4 Jahre)." : "",
    clipped ? "Werte unter −100 % sind abgeschnitten (Tabelle unten)." : ""].filter(Boolean).join(" ");
  return `
  <section class="section" id="sec-business">
    ${head}
    <p class="lead">Wächst der Umsatz, und bleibt davon etwas übrig? Umsatz, Margen und Finanzkraft zeigen, wie gesund das Geschäft ist.
      Bei jungen Wachstumsfirmen mit Verlusten sagen sie mehr als die Gewinnstabilität.</p>
    <div class="grid tiles">${revenueTiles}</div>
    <p style="margin-top:14px;max-width:900px">${businessText(p)}</p>
    <div class="grid two">
      <div class="card">
        <div class="chart-title"><h3>Umsatz und Nettoergebnis</h3><span class="muted">${p.eur && ccy === "EUR" && p.data.financial_currency && p.data.financial_currency !== "EUR"
          ? `in €, aus ${esc(p.data.financial_currency)} (${term("bilanzwaehrung", "Bilanzwährung")}) zum heutigen Wechselkurs` : `in ${esc(ccy === "EUR" ? "€" : ccy)} (${term("bilanzwaehrung", "Bilanzwährung")})`}</span></div>
        <div class="chart small" id="ch-revenue"></div>
      </div>
      <div class="card">
        <div class="chart-title"><h3>Margen</h3><span class="muted">in % vom Umsatz</span></div>
        <div class="chart small" id="ch-margins"></div>
        ${marginNotes ? `<p class="muted" style="font-size:13px;margin:8px 0 0">${marginNotes}</p>` : ""}
      </div>
    </div>
    <details class="table-view"><summary>Alle Jahreswerte als Tabelle</summary>${businessTable(b)}</details>
    ${marginTiles ? `<h3 style="margin:18px 0 8px">Margen</h3><div class="grid tiles">${marginTiles}</div>` : ""}
    ${strengthTiles ? `<h3 style="margin:18px 0 8px">Finanzkraft und Aktionäre</h3><div class="grid tiles">${strengthTiles}</div>` : ""}
    ${estimatesCard(b, p)}
  </section>`;
}

function businessTable(b) {
  const ccy = b.currency || "";
  const rows = [...b.years].reverse().map((r) => `<tr><td>${F.date(r.end)}</td><td>${F.big(r.revenue, ccy)}</td><td>${F.signedPct(r.growth, 1)}</td>
      ${MARGINS.map(([k]) => `<td>${F.pct(r[k], 1)}</td>`).join("")}<td>${F.pct(r.rnd_ratio, 1)}</td><td>${F.big(r.net_income, ccy)}</td></tr>`).join("");
  return `<div class="table-wrap"><table class="data"><thead><tr><th>Geschäftsjahr bis</th><th>Umsatz</th><th>Wachstum</th>
    ${MARGINS.map(([, label]) => `<th>${label}</th>`).join("")}<th>F&amp;E-Quote</th><th>Nettoergebnis</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function estimatesCard(b, p) {
  const ests = b.estimates.filter((e) => F.isNum(e.revenue) || F.isNum(e.eps));
  if (!ests.length) return "";
  const ccy = b.currency || "";
  const range = (lo, hi, fmt) => (F.isNum(lo) && F.isNum(hi) ? `${fmt(lo)} – ${fmt(hi)}` : "–");
  const rows = ests.map((e) => {
    const eccy = e.eps_currency || ccy;
    return `<tr><td>${e.year ?? (e.key === "0y" ? "laufendes" : "nächstes")}</td>
      <td>${F.big(e.revenue, ccy)}</td><td>${F.signedPct(e.revenue_growth, 1)}</td><td>${range(e.revenue_low, e.revenue_high, (x) => F.big(x, ""))}</td>
      <td class="${e.eps > 0 ? "" : F.isNum(e.eps) ? "bad" : ""}">${F.money(e.eps, eccy)}</td><td>${range(e.eps_low, e.eps_high, (x) => F.money(x, ""))}</td>
      <td>${F.int(e.revenue_analysts ?? e.eps_analysts)}${F.isNum(e.eps_analysts) && e.eps_analysts !== e.revenue_analysts ? ` / ${F.int(e.eps_analysts)}` : ""}</td></tr>`;
  }).join("");
  return `
    <div class="card table-scroll" style="margin-top:12px">
      <div class="chart-title"><h3>${term("umsatzerwartung", "Analystenschätzungen")}</h3><span class="muted">Durchschnitt und Spanne der Schätzungen (Yahoo)</span></div>
      <table class="data" style="margin-top:8px"><thead><tr><th>Geschäftsjahr</th><th>Umsatz</th><th>Wachstum</th><th>Spanne Umsatz</th>
        <th>Gewinn je Aktie</th><th>Spanne Gewinn</th><th>Analysten</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted" style="font-size:13px;margin:8px 0 0">Analysten: Zahl der Umsatzschätzungen${ests.some((e) => F.isNum(e.eps_analysts) && e.eps_analysts !== e.revenue_analysts) ? " / Gewinnschätzungen" : ""}.
        Gewinn je Aktie ${ests[0].eps_currency === "EUR" ? "in €" : `in der Währung der Schätzung${ests[0].eps_currency && ests[0].eps_currency !== ccy ? ` (${esc(ests[0].eps_currency)})` : ""}`}, so wie die Analysten ihn rechnen (oft bereinigt).</p>
    </div>`;
}

// Fließtext: Umsatztrend, Erwartung, bei Verlusten der Weg zur Gewinnschwelle und die Finanzierung
function businessText(p) {
  const b = p.business;
  const ccy = b.currency || "";
  const ys = b.years.filter((r) => F.isNum(r.revenue));
  const nm = esc(p.name);
  const parts = [];
  if (ys.length >= 2) {
    const [a, z] = [ys[0], ys[ys.length - 1]];
    parts.push(`Der Umsatz von ${nm} hat sich von ${F.big(a.revenue, ccy)} (${year(a.end)}) auf ${F.big(z.revenue, ccy)} (${year(z.end)})
      ${z.revenue >= a.revenue ? "erhöht" : "verringert"}${F.isNum(b.revenue_trend.growth) ? `, im Schnitt um ${F.signedPct(b.revenue_trend.growth, 1)} pro Jahr` : ""}.`);
  }
  const ests = b.estimates.filter((e) => F.isNum(e.revenue_growth));
  if (ests.length) {
    parts.push(`Analysten erwarten einen Umsatz von ${ests.map((e) => `${F.big(e.revenue, ccy)} für ${e.year ?? "das laufende Geschäftsjahr"} (${F.signedPct(e.revenue_growth, 1)})`).join(" und ")}.`);
  }
  const last = b.years[b.years.length - 1];
  if (b.loss_years && F.isNum(last.net_income) && last.net_income <= 0) {
    parts.push(`Unterm Strich schreibt ${nm} Verluste (in ${b.loss_years} von ${b.profit_years} Geschäftsjahren).`);
    const nets = b.years.filter((r) => F.isNum(r.net_margin));
    if (nets.length >= 2) {
      const [prev, cur] = [nets[nets.length - 2], nets[nets.length - 1]];
      const better = cur.net_margin > prev.net_margin;
      const why = !better ? "" : cur.net_income > prev.net_income
        ? `: Der Verlust ist von ${F.big(prev.net_income, ccy)} auf ${F.big(cur.net_income, ccy)} gesunken` : ": Die Verluste wachsen langsamer als der Umsatz";
      parts.push(`Die Nettomarge hat sich von ${F.pct(prev.net_margin, 0)} (${year(prev.end)}) auf ${F.pct(cur.net_margin, 0)} (${year(cur.end)})
        ${better ? "verbessert" : "verschlechtert"}${why}.`);
    }
    const eps = b.estimates.filter((e) => F.isNum(e.eps));
    const profit = eps.find((e) => e.eps > 0);
    const eccy = eps[0]?.eps_currency || ccy;
    if (profit) {
      const loss0 = eps.find((e) => e.key === "0y" && e.eps <= 0);
      const n = profit.eps_analysts;
      const who = [F.isNum(n) ? `${n < 4 ? "nur " : ""}${n === 1 ? "1 Analyst" : `${F.int(n)} Analysten`}` : null,
        F.isNum(profit.eps_low) ? `Spanne ${F.money(profit.eps_low, "")} bis ${F.money(profit.eps_high, eccy)}` : null].filter(Boolean).join(", ");
      const gain = `einen Gewinn von ${F.money(profit.eps, eccy)} je Aktie${who ? ` (${who})` : ""}`;
      parts.push(loss0 ? `Für ${loss0.year} erwarten Analysten noch einen Verlust von ${F.money(loss0.eps, eccy)} je Aktie, für ${profit.year} dann ${gain}.`
        : `Für ${profit.year} erwarten Analysten ${gain}.`);
    } else if (eps.length) {
      parts.push(`Auch für ${eps[eps.length - 1].year ?? "die nächsten Jahre"} erwarten Analysten noch keinen Gewinn.`);
    }
  }
  const bal = b.balance;
  if (F.isNum(bal.runway_years)) {
    const sh = p.fundamentals?.shares;
    parts.push(`Die Kasse von ${F.big(bal.cash, ccy)} reicht beim Mittelabfluss der letzten 12 Monate (Free Cashflow ${F.big(bal.fcf_ttm, ccy)})
      rechnerisch noch rund ${F.num(bal.runway_years, 1)} Jahre. Danach braucht es neues Geld, etwa durch Kredite oder Kapitalerhöhungen.${
      F.isNum(sh?.cagr) && sh.cagr > 0.005 ? ` Die Aktienzahl ist zuletzt bereits um ${F.pct(sh.cagr, 1)} pro Jahr gestiegen (Verwässerung).` : ""}`);
  }
  return parts.join(" ");
}

function revenueChart(el, p) {
  const b = p.business;
  const ys = b.years;
  const fc = b.estimates.filter((e) => F.isNum(e.revenue) && e.year && (!ys.length || e.year > Number(year(ys[ys.length - 1].end))));
  const cats = [...ys.map((r) => year(r.end)), ...fc.map((e) => `${e.year}e`)];
  const ccy = b.currency || "";
  const radius = (v) => (v >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4]);
  const growth = [...ys.map((r) => r.growth), ...fc.map((e) => e.revenue_growth)];
  const range = [...ys.map(() => null), ...fc.map((e) => (F.isNum(e.revenue_low) ? [e.revenue_low, e.revenue_high, e.revenue_analysts] : null))];
  C.mount(el, (t) => ({
    ...C.base(t),
    legend: { ...C.base(t).legend, data: ["Umsatz", "Prognose", "Nettoergebnis"] },
    tooltip: {
      ...C.base(t).tooltip, axisPointer: { type: "shadow", shadowStyle: { color: "rgba(127,127,127,0.08)" } },
      formatter: (params) => {
        const i = params[0]?.dataIndex;
        const rows = params.filter((x) => x.value != null).map((x) => `<div style="display:flex;gap:12px;justify-content:space-between">
          <span>${x.marker}${esc(x.seriesName)}</span><b>${F.big(x.value, ccy)}</b></div>`);
        if (F.isNum(growth[i])) rows.push(`<div style="opacity:.7">Umsatz ${F.signedPct(growth[i], 1)} gegenüber Vorjahr</div>`);
        if (range[i]) rows.push(`<div style="opacity:.7">Spanne ${F.big(range[i][0], "")} – ${F.big(range[i][1], ccy)} · ${F.int(range[i][2])} Analysten</div>`);
        return `<div style="min-width:200px"><div style="margin-bottom:4px;opacity:.7">${esc(cats[i] ?? "")}</div>${rows.join("")}</div>`;
      },
    },
    xAxis: C.categoryAxis(t, cats),
    yAxis: C.valueAxis(t, { scale: false }),
    series: [
      { name: "Umsatz", type: "bar", stack: "rev", barMaxWidth: 22, itemStyle: { color: t.series[0], borderRadius: [4, 4, 0, 0] },
        data: [...ys.map((r) => r.revenue), ...fc.map(() => null)] },
      { name: "Prognose", type: "bar", stack: "rev", barMaxWidth: 22, itemStyle: { color: t.series[0], opacity: 0.4, borderRadius: [4, 4, 0, 0] },
        data: [...ys.map(() => null), ...fc.map((e) => e.revenue)] },
      { name: "Nettoergebnis", type: "bar", barMaxWidth: 22, itemStyle: { color: t.series[1] },
        data: [...ys.map((r) => (F.isNum(r.net_income) ? { value: r.net_income, itemStyle: { borderRadius: radius(r.net_income) } } : null)), ...fc.map(() => null)] },
    ],
  }));
}

function marginChart(el, p) {
  const ys = p.business.years;
  const cats = ys.map((r) => year(r.end));
  const keys = MARGINS.filter(([k]) => ys.some((r) => F.isNum(r[k])));
  const values = keys.flatMap(([k]) => ys.map((r) => r[k]).filter(F.isNum));
  // Anlaufjahre junger Firmen (−500 %) würden die übrigen Werte plattdrücken: Achse höchstens bis −100 %.
  // Feste Schrittweite, damit Grenzen und Teilstriche zusammenfallen (sonst überlappen die Beschriftungen)
  const [min, max] = [Math.max(-1, Math.min(0, ...values)), Math.max(0, ...values)];
  const step = max - min > 1.2 ? 0.25 : max - min > 0.6 ? 0.2 : max - min > 0.3 ? 0.1 : 0.05;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  C.mount(el, (t) => ({
    ...C.base(t),
    legend: { ...C.base(t).legend, data: keys.map(([, label]) => label) },
    tooltip: { ...C.base(t).tooltip, valueFormatter: (v) => (v == null ? "–" : F.pct(v, 1)) },
    xAxis: C.categoryAxis(t, cats),
    yAxis: C.valueAxis(t, { scale: false, min: lo, max: hi, interval: step, axisLabel: { color: t.muted, formatter: (v) => `${F.num(v * 100, 0)} %` } }),
    series: keys.map(([k, label], i) => C.line(label, ys.map((r) => (F.isNum(r[k]) ? r[k] : null)), t.series[i], {
      showSymbol: true, symbolSize: 6, connectNulls: true,
      markLine: i === 0 && lo < 0 ? { symbol: "none", silent: true, label: { show: false }, lineStyle: { color: t.baseline, type: "solid", width: 1 }, data: [{ yAxis: 0 }] } : undefined,
    })),
  }));
}

// ---------------------------------------------------------------- Signale: Analysten, Insider, Leerverkäufer
function signals(p) {
  const a = p.analysts;
  const rev = a.revisions || {};
  const cur = rev.periods?.["0y"];
  const next = rev.periods?.["+1y"];
  const revRow = (label, r) => (r ? `<tr><td>${label}</td><td>${F.money(r.now, p.currency)}</td><td>${F.signedPct(r.change30, 1)}</td>
      <td>${F.signedPct(r.change90, 1)}</td><td>${F.isNum(r.up30) ? `${F.int(r.up30)} ↑ / ${F.int(r.down30)} ↓` : "–"}</td></tr>` : "");
  const trendBadge = rev.trend ? badge({ label: `Schätzungen ${rev.trend}`, status: rev.trend === "steigend" ? "good" : rev.trend === "fallend" ? "serious" : "neutral" }) : "";
  const s = a.surprises || {};
  const surpriseRows = (s.quarters || []).map((q) => `<tr><td>${F.date(q.quarter)}</td><td>${F.money(q.estimate, "")}</td><td>${F.money(q.actual, "")}</td>
      <td class="${q.surprise > 0 ? "good" : q.surprise < 0 ? "bad" : ""}">${F.signedPct(q.surprise, 1)}</td></tr>`).join("");
  const ins = p.insider;
  const insSummary = ins?.summary?.buys || ins?.summary?.sales ? `Letzte 6 Monate: ${F.int(ins.summary.buys?.count ?? 0)} Käufe
      (${F.int(ins.summary.buys?.shares ?? 0)} Aktien), ${F.int(ins.summary.sales?.count ?? 0)} Verkäufe (${F.int(ins.summary.sales?.shares ?? 0)} Aktien).` : "";
  const insRows = (ins?.transactions || []).map((t) => `<tr><td>${F.date(t.date)}</td><td style="text-align:left">${esc(t.insider)}<div class="muted" style="font-size:12px">${esc(t.position)}</div></td>
      <td style="text-align:left;white-space:normal">${esc(t.text || "–")}</td><td>${F.int(t.shares)}</td><td>${F.big(t.value, p.eur ? "EUR" : "USD")}</td></tr>`).join("");
  const sp = p.shorts;
  const shortBlock = sp ? `<p style="margin-top:8px">Gemeldete Netto-Leerverkaufspositionen: <b>${F.pct(sp.total, 2)}</b> der Aktien
      (${F.int(sp.active)} Positionen ab 0,5 %).${sp.total >= 0.05 ? " Das ist viel: Große Investoren setzen auf fallende Kurse." : ""}</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Positionsinhaber</th><th>Position</th><th>Meldung</th></tr></thead><tbody>
      ${sp.positions.slice(0, 10).map((x) => `<tr><td>${esc(x.holder)}</td><td>${x.position < 0.005 ? '<span class="muted">unter 0,5 %</span>' : F.pct(x.position, 2)}</td><td>${F.date(x.date)}</td></tr>`).join("")}
      </tbody></table></div>`
    : '<p class="muted" style="margin-top:8px">Keine gemeldeten Positionen ab 0,5 %. Der Bundesanzeiger listet nur Emittenten, für die die BaFin zuständig ist (vor allem deutsche Aktien).</p>';
  return `
  <section class="section" id="sec-signals">
    <h2>Was erwarten Analysten und Insider von ${esc(p.name)}?</h2>
    <p class="lead">Steigende Gewinnschätzungen und wiederholt übertroffene Erwartungen gehören zu den am besten belegten Signalen für
      die nächsten Monate. Insiderkäufe zeigen, dass das Management selbst an die Aktie glaubt.</p>
    <div class="grid two">
      <div class="card table-scroll">
        <div class="chart-title"><h3>${term("revisionen", "Revisionen der Gewinnschätzung")}</h3>${trendBadge}</div>
        ${cur || next ? `<table class="data" style="margin-top:8px"><thead><tr><th>Geschäftsjahr</th><th>Ø Schätzung</th><th>vs. 30 Tage</th><th>vs. 90 Tage</th><th>Änderungen 30 T.</th></tr></thead>
          <tbody>${revRow("laufendes", cur)}${revRow("nächstes", next)}</tbody></table>` : '<p class="muted">Keine Schätzungen verfügbar.</p>'}
      </div>
      <div class="card table-scroll">
        <div class="chart-title"><h3>${term("gewinnueberraschung", "Gewinnüberraschungen")}</h3>
          <span class="muted">${F.isNum(s.beats) ? `${s.beats} von ${s.quarters.length} Quartalen über der Erwartung` : ""}</span></div>
        ${surpriseRows ? `<table class="data" style="margin-top:8px"><thead><tr><th>Quartal</th><th>Erwartet</th><th>Gemeldet</th><th>Abweichung</th></tr></thead>
          <tbody>${surpriseRows}</tbody></table>` : '<p class="muted">Keine Quartalsdaten verfügbar.</p>'}
      </div>
      <div class="card table-scroll">
        <h3>${term("insider", "Insidergeschäfte")}</h3>
        ${insRows ? `<p style="margin-top:8px">${insSummary}</p><div class="table-wrap"><table class="data"><thead><tr><th>Datum</th><th style="text-align:left">Person</th>
          <th style="text-align:left">Art</th><th>Aktien</th><th>Wert</th></tr></thead><tbody>${insRows}</tbody></table></div>`
          : '<p class="muted" style="margin-top:8px">Keine Daten. Yahoo meldet Insidergeschäfte praktisch nur für US-Aktien (SEC Form 4); für deutsche Aktien gibt es die Eigengeschäfte von Führungskräften nur in der Datenbank der BaFin (ohne Schnittstelle).</p>'}
      </div>
      <div class="card table-scroll">
        <h3>${term("leerverkauf", "Leerverkäufer")}</h3>
        ${shortBlock}
      </div>
    </div>
  </section>`;
}

function epsChart(el, p) {
  const q = p.quality;
  const actual = q.points.slice(-15);
  const fc = q.forecasts.filter((f) => !actual.length || f.date > actual[actual.length - 1][0]);
  const cats = [...actual.map(([d]) => year(d)), ...fc.map((f) => `${year(f.date)}e`)];
  const radius = (v) => (v >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4]);
  C.mount(el, (t) => ({
    ...C.base(t),
    tooltip: { ...C.base(t).tooltip, axisPointer: { type: "shadow", shadowStyle: { color: "rgba(127,127,127,0.08)" } },
      valueFormatter: (v) => (v == null ? "–" : F.money(v, p.currency)) },
    legend: { ...C.base(t).legend, data: ["Ist", "Prognose"] },
    xAxis: C.categoryAxis(t, cats),
    yAxis: C.valueAxis(t, { scale: false }),
    series: [
      { name: "Ist", type: "bar", stack: "x", barMaxWidth: 24, itemStyle: { color: t.series[0] },
        data: [...actual.map(([, v]) => ({ value: v, itemStyle: { borderRadius: radius(v) } })), ...fc.map(() => null)] },
      { name: "Prognose", type: "bar", stack: "x", barMaxWidth: 24,
        itemStyle: { color: t.series[0], opacity: 0.4 },
        data: [...actual.map(() => null), ...fc.map((f) => ({ value: f.avg, itemStyle: { borderRadius: radius(f.avg) } }))] },
    ],
  }));
}

// ---------------------------------------------------------------- Kurs
const RANGES = [["1J", 1], ["3J", 3], ["5J", 5], ["10J", 10], ["20J", 20], ["Max", null]];

function price(p) {
  const pr = p.price;
  const rows = pr.returns.map((r) => `<tr><td>${r.label}</td>
      <td class="${(r.price ?? 0) >= 0 ? "good" : "bad"}">${F.signedPct(r.price, 2)}</td>
      <td>${F.signedPct(r.price_pa, 1)}</td><td>${F.signedPct(r.total_pa, 1)}</td></tr>`).join("");
  const mood = p.summary.sentiment;
  const mom = pr.momentum;
  const ath = pr.ath;
  const athText = ath.distance > -0.005
    ? `Die Aktie notiert nahe ihrem Allzeithoch von ${F.money(ath.price, p.currency)} (${F.date(ath.date)}).`
    : `Ihr Allzeithoch erreichte die Aktie am ${F.date(ath.date)} bei ${F.money(ath.price, p.currency)}; heute notiert sie ${F.pct(Math.abs(ath.distance), 1)} darunter.`;
  return `
  <section class="section" id="sec-price">
    <h2>Wie hoch sind die Kursgewinne bei ${esc(p.name)}?</h2>
    <p class="lead" id="price-text"></p>
    <div class="card">
      <div class="toolbar">
        <div class="segmented" id="range-seg" role="group" aria-label="Zeitraum">
          ${RANGES.map(([l]) => `<button type="button" data-range="${l}">${l}</button>`).join("")}
        </div>
        <label class="check"><input type="checkbox" id="log-toggle"> Logarithmische Skala</label>
        <span class="spacer"></span>
        <span class="muted" style="font-size:13px">${unitNote(p, "day")} · Linien per Klick in der Legende ein- und ausblenden</span>
      </div>
      <div class="chart" id="ch-price"></div>
      ${foreign(p) && p.eur.history_start && pr.series.length && pr.series[0][0] < p.eur.history_start
        ? `<p class="muted" style="font-size:13px;margin:8px 0 0">Tägliche Wechselkurse ${esc(fx1(p))}/€ gibt es erst ab ${F.date(p.eur.history_start)};
          davor rechnet das Tool mit dem ersten bekannten Kurs.</p>` : ""}
    </div>
    ${isBasic() ? "" : `<div class="grid two" style="margin-top:12px">
      <div class="card table-scroll">
        <h3>Kursentwicklung nach Haltedauer</h3>
        <table class="data" style="margin-top:8px">
          <thead><tr><th>Haltedauer</th><th>Kursgewinn</th><th>Kurs p. a.</th><th>${term("total_return", "inkl. Dividenden p. a.")}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="card">
        <h3>Marktstimmung (${term("momentum", "200-Tage-Linie")})</h3>
        <p style="margin-top:8px">${F.isNum(mom)
          ? `Aktuell notiert der Kurs ${F.pct(Math.abs(mom), 1)} ${mom >= 0 ? "über" : "unter"} der 200-Tage-Linie, was auf eine ${esc(mood ? `${mood.label}e` : "")} Stimmung gegenüber der Aktie hindeutet.`
          : "Für die 200-Tage-Linie ist die Kurshistorie zu kurz."}</p>
        <p>${mood ? badge(mood) : ""}</p>
        ${foreign(p) ? `<p class="muted" style="font-size:13px">Die 200-Tage-Linie und das Momentum rechnet das Tool in der Börsenwährung
          (${esc(fx1(p))}), wie in der Weltauswahl; Wechselkursschwankungen verzerren die Stimmung so nicht.</p>` : ""}
        ${F.isNum(pr.momentum_12_1) ? `<p class="secondary">${term("momentum_12_1", "Momentum 12-1")}: Kursentwicklung der letzten 12 Monate ohne den
          jüngsten Monat ${F.signedPct(pr.momentum_12_1, 1)}. In der Forschung gehören Aktien mit hohem 12-1-Momentum im Schnitt auch in den
          folgenden Monaten zu den Gewinnern.</p>` : ""}
        <p class="secondary">${athText}</p>
      </div>
    </div>`}
  </section>`;
}

function smaArray(closes, n) {
  const out = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= n) sum -= closes[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function priceChart(root, p) {
  const raw = p.price.series;
  const t0 = raw.map((r) => Date.parse(r[0]));
  const closes = raw.map((r) => r[1]);
  const adj = raw.map((r) => r[2]);
  const sma = { 20: smaArray(closes, 20), 50: smaArray(closes, 50), 200: smaArray(closes, 200) };
  const last = t0[t0.length - 1];
  const span = (last - t0[0]) / YEAR;
  let range = span >= 10 ? "10J" : "Max";
  let log = false;
  const selected = { Kurs: true, "Total Return": true, "20-Tage-Linie": false, "50-Tage-Linie": false, "200-Tage-Linie": true };
  const el = root.querySelector("#ch-price");
  const text = root.querySelector("#price-text");

  const startIndex = () => {
    const years = RANGES.find(([l]) => l === range)[1];
    if (!years) return 0;
    const from = last - years * YEAR;
    const i = t0.findIndex((t) => t >= from);
    return Math.max(0, i);
  };

  const build = (t) => {
    const i0 = startIndex();
    const k = closes[i0] / adj[i0];
    const pick = (arr, f = (v) => v) => t0.slice(i0).map((t, j) => [t, arr[i0 + j] == null ? null : f(arr[i0 + j])]);
    const yrs = (last - t0[i0]) / YEAR;
    return {
      ...C.base(t),
      legend: { ...C.base(t).legend, selected },
      tooltip: { ...C.base(t).tooltip, formatter: C.timeTooltip((v) => F.money(v, p.currency)) },
      xAxis: C.timeAxis(t, yrs),
      yAxis: log ? C.valueAxis(t, { type: "log", logBase: 10, scale: false }) : C.valueAxis(t),
      series: [
        C.line("Kurs", pick(closes), t.series[0]),
        C.line("Total Return", pick(adj, (v) => v * k), t.series[1]),
        C.line("20-Tage-Linie", pick(sma[20]), t.series[2]),
        C.line("50-Tage-Linie", pick(sma[50]), t.series[3]),
        C.line("200-Tage-Linie", pick(sma[200]), t.series[4]),
      ],
    };
  };
  const chart = C.mount(el, build);
  chart.chart.on("legendselectchanged", (e) => Object.assign(selected, e.selected));

  const describe = () => {
    const i0 = startIndex();
    const yrs = (last - t0[i0]) / YEAR;
    const change = closes[closes.length - 1] / closes[i0] - 1;
    const pa = yrs > 0.9 ? Math.pow(1 + change, 1 / yrs) - 1 : null;
    const tr = adj[adj.length - 1] / adj[i0] - 1;
    const trPa = yrs > 0.9 ? Math.pow(1 + tr, 1 / yrs) - 1 : null;
    text.innerHTML = `Im ausgewählten Zeitraum vom ${C.dateDE(t0[i0])} bis heute hat die ${esc(p.name)} Aktie
      ${F.pct(Math.abs(change), 1)} ${change >= 0 ? "zugelegt" : "verloren"}${pa != null ? `, was einer jährlichen Rendite von ${F.pct(pa, 1)} entspricht` : ""}.
      ${trPa != null ? `Mit wieder angelegten Dividenden (Total Return) waren es ${F.pct(trPa, 1)} pro Jahr.` : ""}`;
  };
  const seg = root.querySelector("#range-seg");
  const paintSeg = () => seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === range)));
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-range]");
    if (!b) return;
    range = b.dataset.range;
    paintSeg(); describe(); chart.update();
  });
  root.querySelector("#log-toggle").addEventListener("change", (e) => { log = e.target.checked; chart.update(); });
  paintSeg(); describe();
}

// ---------------------------------------------------------------- Scorecard
const CRIT_TERMS = {
  earnings_stability: "gewinnstabilitaet", earnings_growth: "wachstum_pa", debt_years: "tilgungsjahre", momentum: "momentum",
  discount: "fairer_wert", div_yield: "dividendenrendite", div_stability: "dividendenstabilitaet", div_growth: "dividendenwachstum",
};
const SUITABILITY = (s) => (s >= 9 ? "sehr gut" : s >= 7 ? "gut" : s >= 5 ? "eher mäßig" : s >= 3 ? "wenig" : "nicht");

function critValue(c, p) {
  if (c.key === "earnings_stability" && p.quality.loss_making) return "Verluste";
  if (c.value == null) {
    if (c.key === "debt_years" && p.debt.infinite) return "∞";
    return "n. a.";
  }
  switch (c.key) {
    case "earnings_stability": case "div_stability": return F.stability(c.value);
    case "earnings_growth": case "div_growth": return F.pct(c.value, 1);
    case "div_yield": return F.pct(c.value, 2);
    case "momentum": return F.signedPct(c.value, 1);
    case "discount": return F.num(c.value, 1);
    case "debt_years": return `${F.num(c.value, 1)} J.`;
    default: return F.num(c.value, 2);
  }
}

function critEnds(c) {
  if (c.key === "debt_years") return ["∞", "2"];
  if (c.key.endsWith("stability")) return ["0", "1,0"];
  if (c.key === "discount") return ["1", "10"];
  const f = (x) => `${F.num(x * 100, 0)} %`;
  if (c.key === "momentum") return ["−15 %", "+15 %"];
  return [f(c.lo), f(c.hi)];
}

function scorecard(p) {
  const basic = isBasic();
  const cards = p.scorecard.map((s) => {
    const crits = basic ? "" : s.criteria.map((c) => {
      const [lo, hi] = critEnds(c);
      // kurze Historie: der Balken zeigt, was in den Score eingeht (höchstens die Mitte)
      const n = c.short && c.norm != null ? Math.min(c.norm, 0.5) : c.norm;
      const missingNote = c.norm == null ? ` <span class="muted">(${["debt_years", "discount", "momentum"].includes(c.key) ? "neutral gewertet" : "zählt als 0"})</span>`
        : c.short ? ' <span class="muted" title="Weniger als 5 Jahre Daten: zählt höchstens neutral">(kurze Historie)</span>' : "";
      return `<div class="crit">
        <div class="row"><span class="name">${CRIT_TERMS[c.key] ? term(CRIT_TERMS[c.key], esc(c.label)) : esc(c.label)}${c.core ? '<span class="core-mark" title="Kernkriterium der Strategie">!</span>' : ""}</span>
          <span class="num">${critValue(c, p)}${missingNote}</span></div>
        <div class="track">${n != null ? `<div class="fill" style="width:${n * 100}%"></div><div class="dot" style="left:${n * 100}%"></div>` : ""}</div>
        <div class="ends"><span>${lo}</span><span>${hi}</span></div>
      </div>`;
    }).join("");
    return `<div class="card">
      <div class="score-head">
        <div><h3>${esc(s.label)}</h3><p class="muted" style="font-size:13px;margin:4px 0 0">${esc(s.text)}</p></div>
        <div class="score-num">${s.score}<small>/10</small></div>
      </div>
      <div class="meter" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<span class="${i < s.score ? "on" : ""}"></span>`).join("")}</div>
      ${crits}
      <p style="margin:12px 0 0;font-size:14px">Mit einem ${esc(s.label)}s-Score von ${s.score} scheint die Aktie ${SUITABILITY(s.score)} für diese Strategie geeignet zu sein.</p>
    </div>`;
  }).join("");
  return `
  <section class="section" id="sec-scorecard">
    <h2>Eignet sich die ${esc(p.name)} Aktie für Ihre Anlagestrategie? <small class="muted">${term("scorecard", "Was ist das?")}</small></h2>
    <p class="lead">${basic ? "Nicht jede Qualitätsaktie passt zu jeder Strategie. Je höher der Score (1–10), desto besser passt die Aktie."
      : `Nicht jede Qualitätsaktie passt zu jeder Strategie. Die Balken zeigen, wo die Aktie bei jedem Kriterium innerhalb der Bandbreite liegt;
      das mit „!“ markierte Kernkriterium bremst den Score, wenn es schwach ausfällt.`}</p>
    <div class="grid three">${cards}</div>
  </section>`;
}

// ---------------------------------------------------------------- Bewertung
const STABILITY_TERMS = { eps: "gewinn_je_aktie", eps_adj: "bereinigter_gewinn", ocf_ps: "operativer_cashflow", eps_norm: "normalisierter_gewinn", rev_ps: "kuv" };
const MULTIPLE_TERMS = { KGV: "kgv", KCV: "kcv", KUV: "kuv" };

function basisText(v, p) {
  if (v.basis_note === "normalized") {
    return `Der Gewinn von ${esc(p.name)} schwankt stark, wie bei zyklischen Firmen üblich. Bewertet wird deshalb mit dem
      ${term("normalisierter_gewinn", "normalisierten Gewinn")}, dem Durchschnitt der letzten 5 Geschäftsjahre (wie beim Shiller-KGV):
      So lässt ein Spitzengewinn im Boom die Aktie nicht billig erscheinen und ein Einbruch nicht teuer.`;
  }
  if (v.basis_note === "revenue") {
    return `Weder Gewinn noch Cashflow waren in den letzten Jahren überwiegend positiv. Ersatzweise wird über den Umsatz bewertet
      (${term("kuv", "KUV")}). Für Firmen mit Verlusten ist das nur ein grober Maßstab: Er setzt voraus, dass aus dem Umsatz später Gewinn wird.`;
  }
  return `Die Kennzahl mit der höchsten Stabilität ist bei ${esc(p.name)} ${METRIC_NOMINATIVE[v.metric_key]}, der nachfolgend für die Bewertung verwendet wird.`;
}

// Verläufe aller verfügbaren Multiples; ältere Daten ohne `multiples` liefern nur die Bewertungsgrundlage
function multiples(v) {
  if (v.multiples?.length || !v.available) return v.multiples || [];
  const averages = Object.fromEntries(Object.entries(v.periods).filter(([, x]) => x).map(([k, x]) => [k, x.avg_multiple]));
  return [{ key: v.metric_key, label: v.multiple_label, metric_label: v.metric_label, multiple_label: v.multiple_label,
    used: true, current: v.current_multiple, averages, series: v.multiple_series }];
}

function valuation(p) {
  const v = p.valuation;
  const tiles = v.stabilities.map((s) =>
    tile(term(STABILITY_TERMS[s.key], esc(s.label)), F.stability(s.stability),
      [s.losses ? "überwiegend negativ, keine Stabilität" : s.years ? `Stabilität · ${Math.round(s.years)} Jahre` : "zu wenige Daten",
        s.issue && s.years ? `<span class="tile-issue">${esc(s.issue)}</span>` : ""]
        .filter(Boolean).join("<br>"),
      v.available && s.key === v.metric_key ? "highlight" : "")).join("");
  if (!v.available) {
    return `<section class="section" id="sec-valuation"><h2>Ist die ${esc(p.name)} Aktie günstig bewertet?</h2>
      <div class="grid tiles">${tiles}</div><p style="margin-top:12px">${esc(v.reason)}</p>
      ${multipleCard(v, p)}</section>`;
  }
  const per = v.periods[v.default_period];
  const diff = v.current_multiple - per.avg_multiple;
  const view = diff > per.avg_multiple * 0.1 ? "teuer" : diff < -per.avg_multiple * 0.1 ? "günstig" : "fair";
  const yearsText = per.covered_years + 0.3 < Number(v.default_period)
    ? `seit ${F.date(v.data_start)} (${F.num(per.covered_years, 1)} Jahre)` : `der letzten ${v.default_period} Jahre`;
  return `
  <section class="section" id="sec-valuation">
    <h2>Ist die ${esc(p.name)} Aktie günstig bewertet?</h2>
    <p class="lead">Bewertet wird nur mit der zuverlässigsten Kennzahl. Deshalb wird zuerst die Stabilität von Gewinn und Cashflow verglichen.</p>
    <div class="grid tiles">${tiles}</div>
    <p style="margin-top:14px;max-width:900px">${basisText(v, p)}
      Das daraus berechnete ${term(MULTIPLE_TERMS[v.multiple_label], v.multiple_label)} liegt bei ${F.num(v.current_multiple, 2)}
      und damit um ${F.num(Math.abs(diff), 2)} Punkte ${diff >= 0 ? "über" : "unter"} dem historischen Durchschnitt von ${F.num(per.avg_multiple, 2)} ${yearsText}.
      ${v.dip_now ? "Weil die Kennzahl gerade eingebrochen ist, ist dieser Vergleich derzeit nicht aussagekräftig."
        : v.short_history ? `Weil die Daten nur ${F.num(v.history_years, 1)} Jahre zurückreichen, ist dieser Vergleich wenig belastbar.`
          : `Die Aktie scheint aus dieser Perspektive ${view} bewertet zu sein.`}
      ${per.excluded_share > 0.02 ? `Nicht mitgezählt sind ${term("gewinndelle", "Phasen mit eingebrochener Kennzahl")}
        (${F.pct(per.excluded_share, 0)} der Tage, im Diagramm grau), weil das ${v.multiple_label} dort künstlich hoch ist.` : ""}</p>
    ${v.dip_now ? `<div class="notice"><ul><li class="warn">Die Kennzahl ist aktuell selbst eingebrochen (unter 60 % ihres Niveaus im
      vergangenen Jahr). Der faire Wert (Ø ${esc(v.multiple_label)} × aktuelle Kennzahl) fällt deshalb zu niedrig aus; das Tool
      ordnet die Aktie deshalb nicht als über- oder unterbewertet ein.</li></ul></div>`
    : v.short_history ? `<div class="notice"><ul><li class="warn">Die Bewertungsgrundlage reicht nur ${F.num(v.history_years, 1)} Jahre zurück.
      Der Durchschnitt hängt dann an einer einzigen Marktphase (z. B. einem Gewinneinbruch mit hohem ${esc(v.multiple_label)})
      und kann den fairen Wert stark verzerren. Das Tool zeigt ihn zur Orientierung, ordnet die Aktie aber nicht als über- oder
      unterbewertet ein (auch nicht in Scorecard und Screener).</li></ul></div>` : ""}
    ${multipleCard(v, p)}
  </section>`;
}

// Diagramm mit Umschalter KGV / KGV bereinigt / KCV. Nicht verfügbare Kennzahlen bleiben sichtbar, aber gesperrt,
// damit klar ist, warum es z. B. bei Verlusten kein KGV gibt.
const SWITCH_ORDER = ["eps", "eps_adj", "ocf_ps", "eps_norm", "rev_ps"];

function multipleCard(v, p) {
  const shown = multiples(v);
  const missing = v.multiples_missing || [];
  const buttons = SWITCH_ORDER.map((key) => {
    const m = shown.find((x) => x.key === key);
    if (m) return `<button type="button" data-mult="${key}">${esc(m.label)}${m.used ? " ★" : ""}</button>`;
    const x = missing.find((y) => y.key === key);
    return x ? `<button type="button" disabled aria-disabled="true" title="${esc(`${x.label} nicht verfügbar: ${x.reason}`)}">${esc(x.label)}</button>` : "";
  }).join("");
  const notes = missing.map((x) => {
    const per = F.isNum(x.current_value) ? ` (letzte 12 Monate: ${F.money(x.current_value, p.currency)} je Aktie)` : "";
    const why = x.key === "ocf_ps" ? "Bei negativem Cashflow ist ein KCV nicht aussagekräftig." : "Bei Verlusten ist ein KGV nicht aussagekräftig.";
    const dataGap = x.reason === "keine Daten" || x.reason.startsWith("zu wenige");
    return `<li><b>${esc(x.label)}</b> nicht verfügbar: ${esc(x.reason)}${per}.${dataGap ? "" : ` ${why}`}</li>`;
  }).join("");
  if (!shown.length) {
    return notes ? `<div class="notice"><ul>${notes}</ul></div>` : "";
  }
  return `
    <div class="card">
      <div class="chart-title"><h3 id="mult-title"></h3><span class="muted" id="mult-sub"></span></div>
      <div class="toolbar">
        <div class="segmented scroll" id="mult-seg" role="group" aria-label="Kennzahl im Diagramm">${buttons}</div>
        ${shown.some((m) => m.used) ? '<span class="muted" style="font-size:13px">★ = Grundlage für den fairen Wert</span>' : ""}
      </div>
      <div class="chart small" id="ch-multiple"></div>
      <p class="muted" id="mult-note" style="font-size:13px;margin:8px 0 0"></p>
      ${notes ? `<ul class="mult-missing">${notes}</ul>` : ""}
    </div>`;
}

// Jahre mit Gewinneinbruch erzeugen Spitzen bis 500; die Achse endet dann knapp über dem üblichen Bereich.
// Maßstab sind die Werte außerhalb der grau markierten Einbruchphasen.
function axisCap(m) {
  const ranges = (m.excluded || []).map(([a, b]) => [Date.parse(a), Date.parse(b) + 7 * DAY]);
  const all = m.series.filter(([, x]) => x != null);
  const normal = all.filter(([d]) => !ranges.some(([a, b]) => Date.parse(d) >= a && Date.parse(d) <= b));
  const values = (normal.length >= 10 ? normal : all).map(([, x]) => x).sort((a, b) => a - b);
  if (!values.length) return undefined;
  const p95 = values[Math.floor(values.length * 0.95)];
  const max = Math.max(...all.map(([, x]) => x));
  return max > p95 * 1.6 ? Math.ceil((p95 * 1.4) / 10) * 10 : undefined;
}

function multipleChart(root, p, state) {
  const v = p.valuation;
  const all = multiples(v);
  const current = () => all.find((m) => m.key === state.mult) || all.find((m) => m.used) || all[0];
  const chart = C.mount(root.querySelector("#ch-multiple"), (t) => {
    const m = current();
    const series = m.series.map(([d, x]) => [Date.parse(d), x]);
    const lastT = series.length ? series[series.length - 1][0] : Date.now();
    // Prognose: Analystenschätzungen gelten für den Gewinn; für das KCV nur, wenn es die Bewertungsgrundlage ist
    const source = m.used ? v.forecasts : m.key === p.quality.basis ? p.quality.forecasts : [];
    const fc = source.filter((f) => Date.parse(f.date) > lastT && f.avg > 0);
    const fcLine = fc.length && F.isNum(m.current) ? [[lastT, m.current], ...fc.map((f) => [Date.parse(f.date), p.facts.price / f.avg])] : [];
    const avg = m.averages[state.period];
    const span = ((fc.length ? Date.parse(fc[fc.length - 1].date) : lastT) - (series[0]?.[0] ?? lastT)) / YEAR;
    const yMax = axisCap(m);
    return {
      ...C.base(t),
      legend: { ...C.base(t).legend, data: [m.label, "Prognose"] },
      tooltip: { ...C.base(t).tooltip, formatter: C.timeTooltip((x) => F.num(x, 1)) },
      xAxis: C.timeAxis(t, span),
      yAxis: C.valueAxis(t, { scale: false, min: 0, max: yMax }),
      series: [
        C.line(m.label, series, t.series[0], {
          markArea: m.excluded?.length ? {
            silent: true, itemStyle: { color: t.grid, opacity: 0.6 },
            data: m.excluded.map(([a, b]) => [{ xAxis: Date.parse(a) }, { xAxis: Date.parse(b) }]),
          } : undefined,
          markLine: F.isNum(avg) ? {
            symbol: "none", silent: true, precision: 6,
            lineStyle: { color: t.secondary, type: "dashed", width: 1 },
            label: { formatter: `⌀ ${m.label} ${state.period} J.: ${F.num(avg, 2)}`, color: t.secondary, position: "insideEndTop" },
            data: [{ yAxis: avg }],
          } : undefined,
        }),
        C.line("Prognose", fcLine, t.series[0], { lineStyle: { width: 2, type: "dashed", color: t.series[0] } }),
      ],
    };
  });
  const paint = () => {
    const m = current();
    root.querySelector("#mult-title").innerHTML = `${term(MULTIPLE_TERMS[m.multiple_label], esc(m.label))}-Verlauf${m.used ? " inklusive Prognose" : ""}`;
    root.querySelector("#mult-sub").textContent = `Kurs ÷ ${METRIC_NOMINATIVE[m.key].replace(/^der /, "")} je Aktie (letzte 12 Monate)`
      + (axisCap(m) ? " · Ausreißer abgeschnitten" : "");
    const used = all.find((x) => x.used);
    const notes = [];
    if (m.loss_now) {
      notes.push(`Aktuell ${m.key === "ocf_ps" ? "negativer Cashflow" : "Verlust"} (letzte 12 Monate: ${F.money(m.current_value, p.currency)} je Aktie):
        Der Verlauf zeigt nur die Zeiträume mit positivem Wert.`);
    }
    if (used && !m.used) {
      notes.push(`Nur zum Vergleich: Der faire Wert von ${p.name} wird mit dem ${used.label} berechnet, weil ${METRIC_NOMINATIVE[used.key]} ${used.key === "rev_ps" ? "als Ersatz dient (Gewinn und Cashflow taugen nicht)" : "in der Vergangenheit gleichmäßiger verlief"}.`);
    } else if (m.used && all.length > 1) {
      notes.push("Über die Schaltflächen lassen sich die Verläufe der übrigen Kennzahlen zum Vergleich anzeigen.");
    } else if (!used) {
      notes.push("Nur zur Information: Keine Kennzahl erfüllt die Regeln für einen fairen Wert (siehe oben).");
    }
    if (m.excluded?.length) {
      notes.push("Grau hinterlegt: Phasen mit vorübergehend eingebrochener Kennzahl; sie zählen nicht zum Durchschnitt.");
    }
    root.querySelector("#mult-note").textContent = notes.join(" ");
    root.querySelectorAll("#mult-seg [data-mult]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mult === m.key)));
  };
  root.querySelector("#mult-seg")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mult]");
    if (!b) return;
    state.mult = b.dataset.mult;
    paint();
    chart.update();
  });
  paint();
  return chart;
}

// ---------------------------------------------------------------- Fairer Wert
function fairValue(p) {
  const v = p.valuation;
  if (!v.available) {
    return `<section class="section" id="sec-fairvalue"><h2>Wie hoch ist der faire Wert der ${esc(p.name)} Aktie?</h2>
      <p class="lead">Für ${esc(p.name)} lässt sich kein verlässlicher ${term("fairer_wert", "fairer Wert")} berechnen: Weder Gewinn noch
        operativer Cashflow waren über die letzten Jahre überwiegend positiv${isBasic() ? "" : " (Einzelheiten im Abschnitt Bewertung)"}.
        Ein Durchschnitts-KGV aus wenigen Gewinnmonaten wäre keine tragfähige Grundlage.</p>
      ${F.isNum(p.analysts.target_mean) ? `<div class="grid tiles">${tile(term("kursziel", "Analysten-Kursziel"), F.money(p.analysts.target_mean, p.currency),
        `${F.signedPct(p.analysts.upside, 1)} · ${F.int(p.analysts.count)} Analysten`)}</div>` : ""}
      ${isBasic() ? "" : dcfCard(p)}
    </section>`;
  }
  // Zeiträume ohne zusätzliche Daten bleiben sichtbar, aber gesperrt
  const covered = Math.max(...Object.values(v.periods).filter(Boolean).map((x) => x.covered_years));
  const basic = isBasic();
  const buttons = ["3", "5", "10"].map((k) => (v.periods[k]
    ? `<button type="button" data-period="${k}">${k} Jahre</button>`
    : `<button type="button" disabled aria-disabled="true" title="Die Daten reichen nur ${F.num(covered, 1)} Jahre zurück">${k} Jahre</button>`)).join("");
  return `
  <section class="section" id="sec-fairvalue">
    <h2>Wie hoch ist der faire Wert der ${esc(p.name)} Aktie?</h2>
    <p class="lead">Die Differenz zwischen fairem Wert und aktuellem Kurs spiegelt das Renditepotenzial wider.
      ${basic ? `Der faire Wert ist das durchschnittliche ${v.multiple_label} der vergangenen Jahre, angewendet auf die heutige Kennzahl.`
        : `Der faire Wert hängt vom Zeitraum ab, über den das durchschnittliche ${v.multiple_label} berechnet wird.`}</p>
    ${basic ? "" : `<div class="toolbar">
      <span class="secondary">Bewertungszeitraum</span>
      <div class="segmented" id="period-seg" role="group" aria-label="Bewertungszeitraum">${buttons}</div>
    </div>`}
    <div class="grid tiles" id="fv-tiles"></div>
    <p id="fv-text" style="margin-top:14px;max-width:900px"></p>
    <div class="card">
      <div class="chart-title"><h3>Kurs und fairer Wert</h3><span class="muted">${unitNote(p, "day")}</span></div>
      <div class="chart" id="ch-fv"></div>
    </div>
    ${basic ? "" : `<p id="fv-forecast" style="margin-top:14px;max-width:900px"></p>
    ${dcfCard(p)}`}
  </section>`;
}

// Reverse-DCF: welches Free-Cashflow-Wachstum der Kurs voraussetzt, umschaltbar nach geforderter Rendite
function dcfCard(p) {
  const d = p.dcf;
  if (!d) return "";
  if (!d.available) {
    return `<div class="card" style="margin-top:12px"><h3>${term("reverse_dcf", "Reverse-DCF")}: eingepreistes Wachstum</h3>
      <p class="muted" style="margin-top:8px">${esc(d.reason)}</p></div>`;
  }
  return `
    <div class="card" style="margin-top:12px">
      <div class="chart-title"><h3>${term("reverse_dcf", "Reverse-DCF")}: Welches Wachstum steckt im Kurs?</h3>
        <div class="segmented" id="dcf-seg" role="group" aria-label="Geforderte Rendite">
          ${Object.keys(d.rates).map((r) => `<button type="button" data-rate="${r}">${F.num(Number(r) * 100, 0)} %</button>`).join("")}
        </div></div>
      <p id="dcf-text" style="margin:8px 0 0;max-width:900px"></p>
      <p class="muted" style="font-size:13px;margin:8px 0 0">Basis: Ø Free Cashflow je Aktie ${F.money(d.fcf, p.currency)} (letzte 12 Monate und
        ${d.fcf_points - 1} Geschäftsjahre), ${d.years} Jahre Wachstum, danach ${F.pct(d.terminal, 1)} pro Jahr. Die Schaltflächen wählen die
        geforderte Rendite (Eigenkapitalkosten). Modellrechnung, keine Prognose.</p>
    </div>`;
}

function dcfWire(root, p) {
  const d = p.dcf;
  const seg = root.querySelector("#dcf-seg");
  if (!d?.available || !seg) return;
  let rate = "0.09" in d.rates ? "0.09" : Object.keys(d.rates)[0];
  const hist = p.quality.short ? null : p.quality.growth;
  const analysts = p.valuation.expected?.sources?.analysts;
  const paint = () => {
    seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.rate === rate)));
    const g = d.rates[rate];
    const compare = [F.isNum(hist) ? `bisher ${F.pct(hist, 1)} pro Jahr (Gewinn)` : null,
      F.isNum(analysts) ? `Analysten erwarten ${F.pct(analysts, 1)} pro Jahr` : null].filter(Boolean).join(", ");
    const ref = Math.max(...[hist, analysts].filter(F.isNum));
    const verdict = !F.isNum(g) || !Number.isFinite(ref) ? ""
      : g > ref + 0.03 ? " Der Kurs setzt also mehr Wachstum voraus, als bisher erreicht bzw. erwartet wird: viel Optimismus eingepreist."
        : g < ref - 0.03 ? " Der Kurs setzt weniger Wachstum voraus, als bisher erreicht bzw. erwartet wird: ein Hinweis auf eine günstige Bewertung."
          : " Das entspricht in etwa dem bisherigen bzw. erwarteten Wachstum.";
    root.querySelector("#dcf-text").innerHTML = F.isNum(g)
      ? `Bei einer geforderten Rendite von ${F.pct(Number(rate), 0)} rechtfertigt der heutige Kurs ein Wachstum des Free Cashflows von
        <b>${F.signedPct(g, 1)} pro Jahr</b> über ${d.years} Jahre (Free-Cashflow-Rendite ${F.pct(d.fcf_yield, 1)}).${compare ? ` Zum Vergleich: ${compare}.` : ""}${verdict}`
      : "Das eingepreiste Wachstum liegt außerhalb von −30 % bis +60 % pro Jahr; der Kurs lässt sich mit dem Modell nicht sinnvoll erklären.";
  };
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-rate]");
    if (b) { rate = b.dataset.rate; paint(); }
  });
  paint();
}

// Erwartete Rendite: Kennzahl wächst 5 Jahre mit dem erwarteten Wachstum, das Multiple kehrt zum Durchschnitt zurück
function expectedTile(v, period) {
  const e = v.expected;
  const r = e?.by_period?.[period];
  if (!F.isNum(r)) return tile(term("erwartete_rendite", "Erwartete Rendite p. a."), "–", "kein Wachstum abschätzbar");
  const parts = [e.sources.analysts != null ? `Analysten ${F.pct(e.sources.analysts, 1)}` : null,
    e.sources.history != null ? `Historie ${F.pct(e.sources.history, 1)}` : null].filter(Boolean).join(", ");
  const uncertain = v.dip_now || v.short_history;
  return tile(term("erwartete_rendite", "Erwartete Rendite p. a."), `<span class="${uncertain ? "muted" : r >= 0.08 ? "good" : r < 0 ? "bad" : ""}">${F.signedPct(r, 1)}</span>`,
    `${uncertain ? "unsicher · " : ""}Wachstum ${F.pct(e.growth, 1)} (${parts})${e.dividend_yield ? ` + Dividende ${F.pct(e.dividend_yield, 1)}` : ""}`);
}

function fairValueSection(root, p, state, onPeriod) {
  const v = p.valuation;
  const a = p.analysts;
  const ccy = p.currency;
  const raw = p.price.series;
  const prices = raw.map((r) => [Date.parse(r[0]), r[1]]);
  const metric = v.metric_series.map(([d, m]) => [Date.parse(d), m]);
  const today = prices[prices.length - 1][0];
  const fc = v.forecasts.filter((f) => Date.parse(f.date) > today && f.avg > 0);

  const paintTiles = () => {
    const per = v.periods[state.period];
    root.querySelector("#fv-tiles").innerHTML = [
      tile(term("fairer_wert", "Fairer Wert"), F.money(per.fair_value, ccy), `${term("harmonisches_mittel", "⌀")} ${v.multiple_label} ${F.num(per.avg_multiple, 2)} × ${F.money(v.current_value, ccy)}`),
      tile("Kurs vs. fairer Wert", F.signedPct(per.deviation, 1), badge(per.rating)),
      isBasic() ? "" : tile(term("kursziel", "Analysten-Kursziel"), F.money(a.target_mean, ccy),
        F.isNum(a.target_mean) ? `${F.signedPct(a.upside, 1)} · ${F.int(a.count)} Analysten` : "keine Schätzungen"),
      expectedTile(v, state.period),
    ].join("");
    const metricName = METRIC_GENITIVE[v.metric_key];
    const covered = per.covered_years + 0.3 < Number(state.period)
      ? ` Weil die Daten erst ab ${F.date(v.data_start)} vorliegen, umfasst der Durchschnitt tatsächlich ${F.num(per.covered_years, 1)} Jahre.` : "";
    const skipped = per.excluded_share > 0.02
      ? ` Phasen mit eingebrochener Kennzahl (${F.pct(per.excluded_share, 0)} der Tage) sind dabei ausgelassen.` : "";
    const dipNow = v.dip_now ? ` <b>Achtung:</b> Die Kennzahl ist gerade selbst eingebrochen; der faire Wert ist deshalb zu niedrig und nicht als Kaufsignal oder Warnung zu lesen.`
      : v.short_history ? ` <b>Achtung:</b> Bei so kurzer Historie ist der faire Wert nur ein grober Anhaltspunkt, kein Kaufsignal und keine Warnung.` : "";
    root.querySelector("#fv-text").innerHTML = `Die Berechnung des fairen Werts erfolgt über den Bewertungszeitraum von ${state.period} Jahren.${covered}${skipped}
      Das durchschnittliche ${v.multiple_label} liegt in diesem Fall bei ${F.num(per.avg_multiple, 2)}.
      Multipliziert mit dem Wert des ${metricName} je Aktie von ${F.money(v.current_value, ccy)} (letzte 12 Monate) ergibt sich ein fairer Wert von
      ${F.money(per.fair_value, ccy)}. Der aktuelle Kurs von ${F.money(p.facts.price, ccy)} liegt ${F.pct(Math.abs(per.deviation), 1)}
      ${per.deviation >= 0 ? "über" : "unter"} diesem fairen Wert, was ${RATING_NOUN[per.rating.label]} entspricht.${dipNow}
      ${F.isNum(v.expected?.by_period?.[state.period]) ? `Wächst die Kennzahl ${v.expected.years} Jahre lang um ${F.pct(v.expected.growth, 1)} pro Jahr und
        kehrt das ${v.multiple_label} zu seinem Durchschnitt zurück, ergibt sich einschließlich Dividende eine
        ${term("erwartete_rendite", "erwartete Rendite")} von ${F.signedPct(v.expected.by_period[state.period], 1)} pro Jahr.` : ""}`;
    const parts = [];
    const lastFc = v.forecasts[v.forecasts.length - 1];
    if (lastFc && F.isNum(lastFc.low) && F.isNum(lastFc.high)) {
      const spread = v.forecast_spread;
      const level = spread < 0.1 ? "einer geringen" : spread < 0.25 ? "einer moderaten" : "einer hohen";
      parts.push(`Analystenschätzungen sind unsicher; je stärker sie voneinander abweichen, desto größer die Unsicherheit.
        Die Spanne für den prognostizierten fairen Wert zum ${F.date(lastFc.date)} liegt zwischen ${F.money(per.avg_multiple * lastFc.low, ccy)}
        und ${F.money(per.avg_multiple * lastFc.high, ccy)}, was ${level} Unsicherheit entspricht.`);
    }
    if (F.isNum(a.target_mean)) {
      parts.push(`Für die Aktie prognostizieren ${F.int(a.count)} Analysten auf die nächsten 12 Monate ein Kursziel von ${F.money(a.target_mean, ccy)},
        was einer Renditeerwartung von ${F.signedPct(a.upside, 1)} entspricht. Das niedrigste Kursziel liegt bei ${F.money(a.target_low, ccy)},
        das höchste bei ${F.money(a.target_high, ccy)}.`);
    }
    const forecast = root.querySelector("#fv-forecast"); // nicht in der Basis-Ansicht
    if (forecast) forecast.innerHTML = parts.join(" ");
  };

  const build = (t) => {
    const per = v.periods[state.period];
    const k = per.avg_multiple;
    const metricStart = metric.length ? metric[0][0] : today;
    const start = Math.max(metricStart, today - (Number(state.period) + 2) * YEAR);
    const targetT = today + 365 * DAY;
    const end = Math.max(fc.length ? Date.parse(fc[fc.length - 1].date) : today, F.isNum(a.target_mean) ? targetT : today) + 60 * DAY;
    const fairNow = per.fair_value;
    const fcPts = [[today, fairNow], ...fc.map((f) => [Date.parse(f.date), k * f.avg])];
    const lowPts = [[today, fairNow], ...fc.map((f) => [Date.parse(f.date), k * (f.low ?? f.avg)])];
    const bandPts = [[today, 0], ...fc.map((f) => [Date.parse(f.date), k * ((f.high ?? f.avg) - (f.low ?? f.avg))])];
    const corridor = new Map(fc.map((f) => [Date.parse(f.date), [k * (f.low ?? f.avg), k * (f.high ?? f.avg)]]));
    const seriesColor = { price: t.series[0], fair: t.series[1], target: t.series[2] };
    const tooltipFmt = (params) => {
      const list = (Array.isArray(params) ? params : [params]).filter((x) => x.value && x.value[1] != null);
      if (!list.length) return "";
      const time = list[0].value[0];
      const rows = [];
      for (const x of list) {
        if (x.seriesName.startsWith("_")) continue;
        let val = F.money(x.value[1], ccy);
        if (x.seriesName === "Prognosekorridor") {
          const c = corridor.get(time);
          if (!c) continue;
          val = `${F.money(c[0], ccy)} – ${F.money(c[1], ccy)}`;
        }
        rows.push(`<div style="display:flex;gap:12px;justify-content:space-between"><span>${x.marker}${esc(x.seriesName)}</span><b>${val}</b></div>`);
      }
      return `<div style="min-width:200px"><div style="margin-bottom:4px;opacity:.7">${C.dateDE(time)}</div>${rows.join("")}</div>`;
    };
    const series = [
      C.line("Kurs", prices.filter(([d]) => d >= start), seriesColor.price),
      C.line(`Fairer Wert (${v.metric_label})`, metric.filter(([d]) => d >= start).map(([d, m]) => [d, m > 0 ? k * m : null]), seriesColor.fair),
    ];
    if (fc.length) {
      series.push(C.line("Prognose", fcPts, seriesColor.fair, { lineStyle: { width: 2, type: "dashed", color: seriesColor.fair }, showSymbol: true, symbolSize: 8 }));
      series.push({ name: "_low", type: "line", data: lowPts, stack: "band", lineStyle: { opacity: 0 }, showSymbol: false, silent: true, tooltip: { show: false } });
      series.push({ name: "Prognosekorridor", type: "line", data: bandPts, stack: "band", lineStyle: { opacity: 0 }, showSymbol: false,
        itemStyle: { color: seriesColor.fair }, areaStyle: { color: seriesColor.fair, opacity: 0.12 } });
    }
    if (F.isNum(a.target_mean)) {
      series.push({ name: "Kursziel (Analysten)", type: "scatter", data: [[targetT, a.target_mean]], symbolSize: 10,
        itemStyle: { color: seriesColor.target, borderColor: t.surface, borderWidth: 2 }, z: 5 });
      if (F.isNum(a.target_low) && F.isNum(a.target_high)) {
        series.push({ name: "_Spanne", type: "line", data: [[targetT, a.target_low], [targetT, a.target_high]],
          lineStyle: { color: seriesColor.target, width: 2 }, showSymbol: true, symbol: "rect", symbolSize: [10, 2],
          itemStyle: { color: seriesColor.target }, tooltip: { show: false } });
      }
    }
    return {
      ...C.base(t),
      legend: { ...C.base(t).legend, data: series.map((s) => s.name).filter((n) => !n.startsWith("_")) },
      tooltip: { ...C.base(t).tooltip, formatter: tooltipFmt },
      xAxis: { ...C.timeAxis(t, (end - start) / YEAR), min: start, max: end },
      yAxis: C.valueAxis(t),
      series,
    };
  };
  const chart = C.mount(root.querySelector("#ch-fv"), build);
  const seg = root.querySelector("#period-seg");
  const paintSeg = () => seg?.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.period === state.period)));
  seg?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-period]");
    if (!b) return;
    state.period = b.dataset.period;
    paintSeg(); paintTiles(); chart.update(); onPeriod();
  });
  paintSeg(); paintTiles();
}

// ---------------------------------------------------------------- Dividende
function dividend(p) {
  const d = p.dividends;
  if (!d.pays) {
    return `<section class="section" id="sec-dividend"><h2>Dividende</h2><p>${esc(p.name)} zahlt keine Dividende.</p></section>`;
  }
  const ccy = p.currency;
  const ref = d.avg_yield["10"] ?? d.avg_yield["5"];
  const refYears = d.avg_yield["10"] != null ? 10 : 5;
  const turboText = F.isNum(d.turbo)
    ? `Die aktuelle Dividendenrendite von ${F.pct(d.yield, 2)} liegt ${F.pct(Math.abs(d.turbo), 0)} ${d.turbo >= 0 ? "über" : "unter"} ihrem ${refYears}-Jahres-Durchschnitt von ${F.pct(ref, 2)}.
       ${d.turbo > 0.2 ? "Die Aktie lockt also mit einer historisch hohen Dividendenrendite (Dividenden-Turbo)." : ""}` : "";
  const basic = isBasic();
  const payments = [...d.payments].reverse().map(([day, v]) => `<tr><td>${F.date(day)}</td><td>${F.money(v, ccy, 4)}</td></tr>`).join("");
  return `
  <section class="section" id="sec-dividend">
    <h2>Wie entwickelt sich die Dividende von ${esc(p.name)}?</h2>
    <p class="lead">${d.suspended ? "Die letzte Zahlung liegt über 15 Monate zurück; die Dividende gilt als ausgesetzt. " : ""}
      ${d.uninterrupted_since && d.uninterrupted_since !== d.first_year
        ? `Erste Dividende ${d.first_year}, ohne Unterbrechung gezahlt seit ${d.uninterrupted_since}`
        : `Dividenden seit ${d.first_year}`}, letzte Zahlung am ${F.date(d.last_payment)}. ${turboText}</p>
    <div class="grid tiles">
      ${tile(term("dividendenrendite", "Dividendenrendite"), F.pct(d.yield, 2), `${F.money(d.ttm, ccy)} in den letzten 12 Monaten`)}
      ${tile(term("dividendenwachstum", `Dividendenwachstum (${Math.round(d.stats_years || 0)} J.)`), F.pct(d.growth, 2), `pro Jahr · 5 J.: ${F.pct(d.growth_cagr_5y, 1)}`)}
      ${basic ? "" : tile(term("dividendenstabilitaet", "Dividendenstabilität"), F.stability(d.stability), "von max. 1,0")}
      ${tile(term("ausschuettungsquote", "Ausschüttungsquote"), F.pct(d.payout_eps, 0), `vom Gewinn · vom ${term("free_cashflow", "Free Cashflow")}: ${F.pct(d.payout_fcf, 0)}`)}
      ${tile(term("dividendensteigerungen", "Steigerungen in Folge"), `${d.increase_streak} J.`, `ohne Kürzung: ${d.no_cut_streak} J.`)}
      ${basic ? "" : `${tile(term("rendite_vs_durchschnitt", "Rendite vs. Durchschnitt"), F.signedPct(d.turbo, 0), F.isNum(ref) ? `⌀ ${refYears} J.: ${F.pct(ref, 2)}` : "zu kurze Historie")}
      ${taxTile(p)}
      ${tile("Nächste Termine", p.facts.ex_dividend_date ? F.date(p.facts.ex_dividend_date) : "–",
        `Ex-Tag${p.facts.dividend_pay_date ? ` · Zahlung ${F.date(p.facts.dividend_pay_date)}` : ""}${p.facts.ex_dividend_date && p.facts.ex_dividend_date < p.data.last_price_date ? " (vergangen)" : ""}`)}`}
    </div>
    ${basic ? "" : taxNote(p)}
    <div class="${basic ? "" : "grid two"}" style="margin-top:12px">
      <div class="card">
        <div class="chart-title"><h3>Dividende je Kalenderjahr</h3><span class="muted">${unitNote(p, "now")}, splitbereinigt</span></div>
        <div class="chart small" id="ch-div"></div>
        ${basic ? "" : `<details class="table-view"><summary>Alle Zahlungen als Tabelle</summary>
          <div class="table-wrap"><table class="data"><thead><tr><th>Datum</th><th>Betrag</th></tr></thead><tbody>${payments}</tbody></table></div>
        </details>`}
      </div>
      ${basic ? "" : `<div class="card">
        <div class="chart-title"><h3>Dividendenrendite im Zeitverlauf</h3><span class="muted">Dividenden der letzten 12 Monate ÷ Kurs</span></div>
        <div class="chart small" id="ch-yield"></div>
      </div>`}
    </div>
  </section>`;
}

// Dividendenrendite nach Quellensteuer und deutscher Abgeltungsteuer
function taxTile(p) {
  const t = p.tax;
  if (!t) return "";
  return tile(term("quellensteuer", "Rendite nach Steuern"), F.pct(p.dividends.yield * t.net_share, 2),
    `Quellensteuer ${F.pct(t.withholding, 1)} + dt. Steuer ${F.pct(t.german, 1)}`);
}

function taxNote(p) {
  const t = p.tax;
  if (!t) return "";
  const lost = t.refundable > 0.0005
    ? ` ${F.pct(t.refundable, 1)} der Dividende sind nicht anrechenbar und nur per Antrag im Sitzland zurückzuholen; mit Erstattung bleiben netto
      ${F.pct(p.dividends.yield * (1 - (t.total - t.refundable)), 2)}.` : "";
  return `<p class="muted" style="font-size:13px;margin:8px 0 0;max-width:900px">Für Anleger in Deutschland (${t.country ? esc(t.country) : "Land unbekannt"}):
    ${t.country === "DE" ? "25 % Abgeltungsteuer plus Solidaritätszuschlag." : `Quellensteuer ${F.pct(t.withholding, 1)}, davon ${F.pct(t.creditable, 1)} auf die
    Abgeltungsteuer anrechenbar.`}${lost} ${t.note ? `${esc(t.note)}.` : ""} Ohne Kirchensteuer und Sparerpauschbetrag; Sätze in
    <code>quellensteuer.json</code>, ohne Gewähr.</p>`;
}

function dividendCharts(root, p) {
  const d = p.dividends;
  if (!d.pays) return;
  const rows = d.per_year.slice(-20);
  C.mount(root.querySelector("#ch-div"), (t) => ({
    ...C.base(t),
    legend: { ...C.base(t).legend, data: ["Gezahlt", "Lfd. Jahr (bisher)"] },
    tooltip: { ...C.base(t).tooltip, axisPointer: { type: "shadow", shadowStyle: { color: "rgba(127,127,127,0.08)" } },
      valueFormatter: (v) => (v == null ? "–" : F.money(v, p.currency, 3)) },
    xAxis: C.categoryAxis(t, rows.map(([y]) => String(y))),
    yAxis: C.valueAxis(t, { scale: false }),
    series: [
      { name: "Gezahlt", type: "bar", stack: "d", barMaxWidth: 24, itemStyle: { color: t.series[0], borderRadius: [4, 4, 0, 0] },
        data: rows.map(([, v, partial]) => (partial ? null : v)) },
      { name: "Lfd. Jahr (bisher)", type: "bar", stack: "d", barMaxWidth: 24, itemStyle: { color: t.series[0], opacity: 0.4, borderRadius: [4, 4, 0, 0] },
        data: rows.map(([, v, partial]) => (partial ? v : null)) },
    ],
  }));
  if (!root.querySelector("#ch-yield")) return; // nicht in der Basis-Ansicht
  const ys = d.yield_series.map(([day, v]) => [Date.parse(day), v]);
  const from = ys.length ? Math.max(ys[0][0], ys[ys.length - 1][0] - 15 * YEAR) : 0;
  const data = ys.filter(([t]) => t >= from);
  C.mount(root.querySelector("#ch-yield"), (t) => {
    const marks = Object.entries(d.avg_yield).map(([n, v]) => ({
      yAxis: v, label: { formatter: `⌀ ${n} J.: ${F.pct(v, 2)}`, color: t.secondary, position: n === "10" ? "insideEndTop" : "insideStartTop" },
    }));
    return {
      ...C.base(t),
      legend: { show: false },
      grid: { ...C.base(t).grid, top: 16 },
      tooltip: { ...C.base(t).tooltip, formatter: C.timeTooltip((v) => F.pct(v, 2)) },
      xAxis: C.timeAxis(t, data.length ? (data[data.length - 1][0] - data[0][0]) / YEAR : 1),
      yAxis: C.valueAxis(t, { scale: false, min: 0, axisLabel: { color: t.muted, formatter: (v) => `${F.num(v * 100, 1)} %` } }),
      series: [C.line("Dividendenrendite", data, t.series[0], {
        // precision: ECharts rundet Markierungslinien sonst auf 2 Stellen (0,0086 -> 0,01)
        markLine: marks.length ? { symbol: "none", silent: true, precision: 6, lineStyle: { color: t.secondary, type: "dashed", width: 1 }, data: marks } : undefined,
      })],
    };
  });
}

// ---------------------------------------------------------------- Jahreswerte
function annual(p) {
  const ccy = p.currency;
  const rows = [...p.annual].reverse().map((r) => `<tr>
      <td>${F.date(r.end)}</td><td>${F.money(r.eps, "")}</td><td>${F.money(r.eps_adj, "")}</td>
      <td>${F.money(r.ocf_ps, "")}</td><td>${F.money(r.fcf_ps, "")}</td><td>${F.big(r.revenue, "")}</td>
      <td class="muted" style="text-align:left">${esc(r.source)}</td></tr>`).join("");
  const t = p.ttm;
  return `
  <section class="section" id="sec-annual">
    <h2>Jahreswerte</h2>
    <p class="lead">Grundlage aller Kennzahlen. Werte je Aktie ${foreign(p) ? `in €, aus der Kurswährung ${esc(p.eur.original_currency)} zum heutigen Wechselkurs umgerechnet${p.data.financial_currency && p.data.financial_currency !== fx1(p) ? ` (dorthin aus der Bilanzwährung ${esc(p.data.financial_currency)} zum Kurs am Bilanzstichtag)` : ""}`
      : `in ${esc(ccy)}${p.data.financial_currency && !ccy.startsWith(p.data.financial_currency) ? ` (umgerechnet aus ${esc(p.data.financial_currency)})` : ""}`}, splitbereinigt.</p>
    <div class="card table-scroll">
      <table class="data">
        <thead><tr><th>Geschäftsjahr bis</th><th>${term("gewinn_je_aktie", "Gewinn je Aktie")}</th><th>${term("bereinigter_gewinn", "Gewinn bereinigt")}</th>
          <th>${term("operativer_cashflow", "Op. Cashflow je Aktie")}</th><th>${term("free_cashflow", "Free Cashflow je Aktie")}</th><th>Umsatz</th><th style="text-align:left">Quelle</th></tr></thead>
        <tbody>
          <tr><td><b>Letzte 12 Monate</b></td><td>${F.money(t.eps, "")}</td><td>${F.money(t.eps_adj, "")}</td><td>${F.money(t.ocf_ps, "")}</td>
            <td>${F.money(t.fcf_ps, "")}</td><td>–</td><td class="muted" style="text-align:left">Yahoo</td></tr>
          ${rows}
        </tbody>
      </table>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- Hebelprodukte (Optionsscheine, Knock-outs)
// Wird erst geladen, wenn der Abschnitt in die Nähe des Bildschirms kommt (acht Abfragen bei onvista)
function derivatives(p) {
  return `
  <section class="section" id="sec-derivatives">
    <div class="chart-title"><h2>Optionsscheine und Knock-outs auf die ${esc(p.name)} Aktie</h2>
      <span class="toolbar" style="margin:0"><a class="btn primary" href="#/hebel?s=${encodeURIComponent(p.symbol)}">Alle Produkte in der großen Tabelle</a>
      <a class="btn" href="#/callput?s=${encodeURIComponent(p.symbol)}">Call/Put-Rechner</a></span></div>
    <div id="deriv-overview" style="margin-top:12px"><p class="muted">Wird geladen, sobald Sie hierher scrollen …</p></div>
  </section>`;
}

function wireDerivatives(root, p, isCurrent) {
  const el = root.querySelector("#deriv-overview");
  if (!el) return;
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    derivOverview(el, p.symbol, isCurrent);
  }, { rootMargin: "600px 0px" });
  io.observe(el);
}

// ---------------------------------------------------------------- Notizen (das Fazit steht oben unter „Auf einen Blick“)
function notes(p) {
  return `
  <section class="section" id="sec-notes">
    <h2>Meine Notizen zur ${esc(p.name)} Aktie</h2>
    <div class="card" style="margin-top:12px">
      <p class="muted" style="font-size:13px;margin:0 0 8px">Ihre Investment-These: Warum kaufen? Was müsste passieren, damit Sie verkaufen?
        Die Notizen bleiben lokal auf Ihrem Rechner (data/notizen.json).</p>
      <div class="field"><textarea id="note-text" rows="5" aria-label="Notizen"></textarea></div>
      <div class="toolbar" style="margin:8px 0 0"><button class="btn primary" id="note-save" type="button">Notiz speichern</button>
        <span class="muted" id="note-status" style="font-size:13px"></span></div>
    </div>
  </section>`;
}

// Notizen speichern sich nach kurzer Tipp-Pause und beim Verlassen des Feldes selbst; der Knopf speichert sofort
async function wireNotes(root, p, isCurrent) {
  const text = root.querySelector("#note-text");
  const status = root.querySelector("#note-status");
  let loaded = false;
  let saved = "";
  let timer = null;
  try {
    const n = await api.note(p.symbol);
    if (!isCurrent()) return;
    text.value = n.text || "";
    saved = text.value;
    loaded = true;
    status.textContent = n.updated ? `zuletzt gespeichert am ${F.date(n.updated)}` : "speichert automatisch, während Sie schreiben";
  } catch (e) { status.textContent = e.message; }
  const save = async () => {
    clearTimeout(timer);
    if (!loaded || text.value === saved) return;
    const value = text.value;
    status.textContent = "wird gespeichert …";
    try {
      const n = await api.saveNote(p.symbol, value);
      saved = value;
      const time = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      status.textContent = n.updated ? `gespeichert um ${time} Uhr` : "Notiz gelöscht";
    } catch (e) { status.textContent = e.message; }
  };
  text.addEventListener("input", () => {
    clearTimeout(timer);
    status.textContent = "ungespeicherte Änderungen …";
    timer = setTimeout(save, 1500);
  });
  text.addEventListener("blur", save);
  text.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } });
  root.querySelector("#note-save").addEventListener("click", async () => {
    if (text.value === saved) { status.textContent = "schon gespeichert"; return; }
    await save();
  });
  // beim Verlassen der Seite noch speichern, was in der Tipp-Pause steckt
  window.addEventListener("hashchange", save, { once: true });
}

// ---------------------------------------------------------------- Verdrahtung
// „Was macht …?“: deutsche Einleitung des Wikipedia-Artikels (über Wikidata per ISIN oder Firmenname gefunden),
// sonst bleibt die englische Beschreibung von Yahoo stehen
async function loadDescription(root, p, worldIsin, isCurrent) {
  const box = root.querySelector("#about");
  if (!box) return;
  let d;
  try { d = await api.description(p.symbol, p.facts.isin || worldIsin || "", p.name); } catch (e) { return; }
  if (!isCurrent() || !d?.text) return;
  const paras = d.text.split(/\n+/).filter((t) => t.trim()).map((t) => `<p>${esc(t)}</p>`).join("");
  root.querySelector("#about-text").innerHTML = `${paras}
    <p class="muted" style="font-size:13px">Quelle: <a href="${esc(d.url)}" target="_blank" rel="noopener">Wikipedia, Artikel „${esc(d.title)}“ ↗</a>
      (Text unter CC BY-SA 4.0)${p.facts.description ? ' · <button type="button" class="linklike" id="about-en">englische Beschreibung von Yahoo</button>' : ""}</p>
    <div id="about-en-text" hidden><p>${esc(p.facts.description || "")}</p></div>`;
  root.querySelector("#about-src").textContent = "(Wikipedia)";
  box.hidden = false;
  root.querySelector("#about-en")?.addEventListener("click", () => {
    const en = root.querySelector("#about-en-text");
    en.hidden = !en.hidden;
  });
}

// Abschnittsnavigation: der Abschnitt, in dem man gerade liest, ist markiert
function wireSubnav(root, isCurrent) {
  const nav = root.querySelector(".subnav");
  nav.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-target]");
    if (b) document.getElementById(b.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  const buttons = [...nav.querySelectorAll("button[data-target]")];
  let queued = false;
  const mark = () => {
    queued = false;
    if (!isCurrent()) { window.removeEventListener("scroll", onScroll); return; }
    const line = nav.getBoundingClientRect().bottom + 40;
    let current = null;
    for (const b of buttons) {
      const el = document.getElementById(b.dataset.target);
      if (el && el.getBoundingClientRect().top <= line) current = b;
    }
    // ganz unten angekommen: der letzte Abschnitt, auch wenn er kurz ist
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = buttons[buttons.length - 1];
    for (const b of buttons) b.setAttribute("aria-current", String(b === current));
    // markierten Knopf in der (seitlich scrollbaren) Leiste sichtbar halten, ohne die Seite zu bewegen
    if (current && (current.offsetLeft < nav.scrollLeft || current.offsetLeft + current.offsetWidth > nav.scrollLeft + nav.clientWidth)) {
      nav.scrollLeft = current.offsetLeft - 16;
    }
  };
  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(mark); } };
  window.addEventListener("scroll", onScroll, { passive: true });
  mark();
}

async function wire(root, p, isCurrent) {
  wireSubnav(root, isCurrent);
  root.querySelector("#refresh-btn").addEventListener("click", () => renderProfile(root, p.symbol, isCurrent, true));

  const watchBtn = root.querySelector("#watch-btn");
  // Gruppen-Knopf nur, solange die Aktie auf der Watchlist steht; zeigt die Gruppen der Aktie
  const groupBtn = root.querySelector("#group-btn");
  const paintGroups = async () => {
    const all = await getGroups();
    if (!isCurrent()) return;
    const gs = groupsOf(all, p.symbol);
    const label = gs.map((g) => pathLabel(all, g.id)).join(", ");
    groupBtn.textContent = gs.length ? `▤ ${label.length > 40 ? `${label.slice(0, 38)}…` : label}` : "▤ Gruppe wählen";
    groupBtn.title = gs.length ? `Watchlist-Gruppen: ${label}. Klicken zum Ändern.` : "Die Aktie in eine Watchlist-Gruppe einteilen";
  };
  const onGroups = () => { if (!isCurrent()) { document.removeEventListener("watchgroups-changed", onGroups); return; } paintGroups().catch(() => {}); };
  document.addEventListener("watchgroups-changed", onGroups);
  groupBtn.addEventListener("click", () => openAssign([p.symbol], `Gruppen für ${p.name || p.symbol}`));
  const paintWatch = (on) => {
    if (!isCurrent()) return;
    watchBtn.textContent = on ? "★ In der Watchlist" : "☆ Zur Watchlist";
    groupBtn.hidden = !on;
    if (on) paintGroups().catch(() => {});
  };
  const flip = async () => {
    watchBtn.disabled = true;
    try { await flipWatch(p.symbol, p.name, paintWatch); } catch (e) { toast(e.message, { kind: "bad" }); } finally { watchBtn.disabled = false; }
  };
  watchBtn.addEventListener("click", flip);
  getWatchlist().then((set) => paintWatch(set.has(p.symbol))).catch(() => {});
  browseKeys(p.symbol, {
    m: flip,
    n: () => {
      document.getElementById("sec-notes")?.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => root.querySelector("#note-text")?.focus({ preventScroll: true }), 400);
    },
  });

  // Handelbarkeit bei Trade Republic selbst korrigieren (die Handelsliste der LS Exchange ist nur eine Annäherung)
  const trEl = root.querySelector("#tr-line");
  trEl.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-tr]");
    if (!b) return;
    b.disabled = true;
    const value = { yes: true, no: false, reset: null }[b.dataset.tr];
    try {
      p.trade_republic = await api.setTradable(p.symbol, value, p.facts.isin || "");
      trEl.innerHTML = trLine(p.trade_republic, F.date);
    } catch (err) { b.disabled = false; }
  });

  if (p.quality.points.length) epsChart(root.querySelector("#ch-eps"), p);
  else root.querySelector("#ch-eps").outerHTML = '<p class="muted">Keine Gewinnhistorie verfügbar.</p>';
  if (root.querySelector("#ch-revenue")) { // nur in der Profi-Ansicht
    revenueChart(root.querySelector("#ch-revenue"), p);
    const margins = root.querySelector("#ch-margins");
    if (p.business.years.some((r) => MARGINS.some(([k]) => F.isNum(r[k])))) marginChart(margins, p);
    else margins.outerHTML = '<p class="muted">Keine Margen berechenbar (Umsatz oder Ergebnisse fehlen).</p>';
  }
  priceChart(root, p);
  dividendCharts(root, p);
  if (p.valuation.available) {
    const state = { period: p.valuation.default_period, mult: p.valuation.metric_key };
    const multipleView = root.querySelector("#ch-multiple") ? multipleChart(root, p, state) : null;
    fairValueSection(root, p, state, () => multipleView?.update());
  } else if (multiples(p.valuation).length && root.querySelector("#ch-multiple")) {
    // keine Bewertung möglich, aber frühere Phasen mit Gewinn: Verlauf trotzdem zeigen
    const first = multiples(p.valuation)[0];
    const period = ["10", "5", "3"].find((k) => F.isNum(first.averages[k])) || "10";
    multipleChart(root, p, { period, mult: first.key });
  }
  dcfWire(root, p);
  const trustHist = root.querySelector("#trust-hist");
  if (trustHist) renderHistory(trustHist, p.trust.symbol || p.symbol, isCurrent);
  wireNotes(root, p, isCurrent);
  wireDerivatives(root, p, isCurrent);
  loadWorld(root, p, isCurrent);
  loadNews(root, p, isCurrent, "de");
  root.querySelector("#news-seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-lang]");
    if (b) loadNews(root, p, isCurrent, b.dataset.lang);
  });
}
