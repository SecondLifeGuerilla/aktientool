// Startseite: Suche, Watchlist, Vorlagen für den Screener
import { api, getWatchlist } from "./api.js";
import { escapeHtml as esc } from "./format.js";
import { attachSearch } from "./search.js";

export async function renderHome(root, isCurrent) {
  root.innerHTML = `
    <section class="hero">
      <h1>Qualitätsaktien finden und bewerten</h1>
      <p>Gewinnstabilität, Wachstum, Scorecard für drei Anlagestrategien, fairer Wert aus der historischen Bewertung
        und Dividenden-Profil. Kostenlose Daten von Yahoo Finance und SEC EDGAR, lokal auf Ihrem Rechner berechnet.</p>
      <div class="search">
        <input id="hero-search" type="search" placeholder="Name, Ticker oder ISIN, z. B. Allianz, AAPL, SAP.DE" autocomplete="off" aria-label="Aktie suchen">
        <ul id="hero-results" class="search-results" role="listbox" hidden></ul>
      </div>
    </section>
    <section class="card" style="margin-top:24px">
      <h2>Weltauswahl</h2>
      <p class="secondary" style="margin-top:6px">Die größten Aktien aller wichtigen Börsen der Welt, live von Yahoo Finance geladen.
        Nach Kontinent, Land, Sektor und Branche filtern und nach über 20 Kennzahlen sortieren.</p>
      <div class="preset-row">
        <a class="btn primary" href="#/welt">Alle Aktien</a>
        ${[["Europa", "kontinent=Europa"], ["Nordamerika", "kontinent=Nordamerika"], ["Asien", "kontinent=Asien"],
           ["Deutschland", "land=DE"], ["DACH", "land=DE|AT|CH"], ["Dividendenwerte", "f=div_yield:min:3|div_years:min:10&ansicht=dividend&sort=div_yield"],
           ["Stabil & unterbewertet", "f=d_stab:min:0,9|d_dev:max:-10&ansicht=deep&sort=d_dev"],
           ["Dividenden-Aristokraten", "f=d_streak:min:25&ansicht=dividend&sort=d_streak"]]
          .map(([l, q]) => `<a class="btn" href="#/welt?${q}">${l}</a>`).join("")}
      </div>
    </section>
    <section class="card" style="margin-top:12px">
      <h2>Ihr Depot und Ihre Termine</h2>
      <p class="secondary" style="margin-top:6px">Positionen mit Gewinn und Dividenden nach Steuern, Alarme bei Kurs- oder Bewertungsschwellen,
        Termine für Zahlen und Dividenden, Aktien im direkten Vergleich und der Score-Check, ob die Scores wirklich Rendite bringen.</p>
      <div class="preset-row">
        ${[["Depot", "#/depot"], ["Alarme", "#/alarme"], ["Termine", "#/termine"], ["Vergleich", "#/vergleich"], ["Score-Check", "#/score-check"]]
          .map(([l, h]) => `<a class="btn" href="${h}">${l}</a>`).join("")}
      </div>
    </section>
    <div class="grid two" style="margin-top:12px">
      <section class="card">
        <h2>Watchlist</h2>
        <div id="watch-preview" class="preset-row" style="margin-top:12px"><span class="muted">Lade …</span></div>
        <p style="margin:14px 0 0"><a href="#/watchlist">Watchlist mit allen Kennzahlen öffnen →</a></p>
      </section>
      <section class="card">
        <h2>Screener</h2>
        <p class="secondary" style="margin-top:6px">Kennzahlen für ganze Listen laden, filtern und nach Score sortieren.</p>
        <div id="preset-row" class="preset-row"></div>
      </section>
    </div>`;
  attachSearch(root.querySelector("#hero-search"), root.querySelector("#hero-results"));
  root.querySelector("#hero-search").focus();

  try {
    const [watch, presets] = await Promise.all([getWatchlist(), api.presets()]);
    if (!isCurrent()) return;
    root.querySelector("#watch-preview").innerHTML = watch.size
      ? [...watch].map((s) => `<a class="btn" href="#/aktie/${encodeURIComponent(s)}">${esc(s)}</a>`).join("")
      : '<span class="muted">Noch leer. Im Aktien-Profil fügen Sie Aktien mit „Zur Watchlist“ hinzu.</span>';
    root.querySelector("#preset-row").innerHTML = [...Object.keys(presets), "Eigene Liste"]
      .map((name) => `<a class="btn" href="#/screener?list=${encodeURIComponent(name)}">${esc(name)}</a>`).join("");
  } catch (e) {
    if (isCurrent()) root.querySelector("#watch-preview").textContent = e.message;
  }
}
