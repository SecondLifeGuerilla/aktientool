// Einstieg: Router, Suche in der Kopfzeile, Hell/Dunkel-Umschalter, Hinweis auf ausgelöste Alarme
import { renderAlarms } from "./alarms.js";
import { api } from "./api.js";
import { renderCalendar } from "./calendar.js";
import { disposeAll, rerenderAll } from "./charts.js";
import { renderCompare } from "./compare.js";
import { renderDepot } from "./depot.js";
import { initTooltips } from "./glossary.js";
import { renderHome } from "./home.js";
import { renderLexicon } from "./lexicon.js";
import { renderProfile } from "./profile.js";
import { renderScoreCheck } from "./scorecheck.js";
import { renderScreener } from "./screener.js";
import { attachSearch } from "./search.js";
import { renderWorld } from "./world.js";

const app = document.getElementById("app");

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, query = ""] = raw.split("?");
  return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(query) };
}

let routeToken = 0;
async function route() {
  const { parts, params } = parseHash();
  const token = ++routeToken;
  disposeAll();
  app.innerHTML = "";
  window.scrollTo(0, 0);
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === parts[0]));
  document.getElementById("navmore").open = false;
  if (parts[0] !== "alarme") paintAlertBadge();
  // Seiten prüfen nach jedem await, ob sie noch aktuell sind (Nutzer kann inzwischen weiternavigiert sein)
  const isCurrent = () => token === routeToken;
  if (parts[0] === "aktie" && parts[1]) return renderProfile(app, parts[1], isCurrent);
  if (parts[0] === "welt") return renderWorld(app, params, isCurrent);
  if (parts[0] === "lexikon") return renderLexicon(app, params, isCurrent);
  if (parts[0] === "screener") return renderScreener(app, params.get("list") || "Watchlist", isCurrent, params.get("symbols"));
  if (parts[0] === "watchlist") return renderScreener(app, "Watchlist", isCurrent);
  if (parts[0] === "depot") return renderDepot(app, params, isCurrent);
  if (parts[0] === "alarme") return renderAlarms(app, params, isCurrent);
  if (parts[0] === "termine") return renderCalendar(app, isCurrent);
  if (parts[0] === "vergleich") return renderCompare(app, params, isCurrent);
  if (parts[0] === "score-check") return renderScoreCheck(app, params, isCurrent);
  document.title = "Aktientool";
  return renderHome(app, isCurrent);
}

window.addEventListener("hashchange", route);
initTooltips();
attachSearch(document.getElementById("search-input"), document.getElementById("search-results"));

// ---- Darstellung: System → Hell → Dunkel
const themeBtn = document.getElementById("theme-toggle");
const THEMES = [["system", "◐ System"], ["light", "☀ Hell"], ["dark", "☾ Dunkel"]];
const currentTheme = () => document.documentElement.dataset.theme || "system";
const paintThemeBtn = () => { themeBtn.textContent = THEMES.find(([k]) => k === currentTheme())[1]; };
themeBtn.addEventListener("click", () => {
  const i = THEMES.findIndex(([k]) => k === currentTheme());
  const next = THEMES[(i + 1) % THEMES.length][0];
  if (next === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch (e) { /* ohne Speicher eben nicht dauerhaft */ }
  paintThemeBtn();
  rerenderAll();
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rerenderAll);
paintThemeBtn();

// ---- Ausgelöste, noch nicht angesehene Alarme als Zahl in der Kopfzeile (alle 5 Minuten aktualisiert)
async function paintAlertBadge() {
  const badge = document.getElementById("alert-badge");
  try {
    const { status } = await api.alerts();
    badge.textContent = String(status.unseen);
    badge.hidden = !status.unseen;
  } catch (e) { badge.hidden = true; }
}
document.addEventListener("alerts-changed", paintAlertBadge);
paintAlertBadge();
setInterval(paintAlertBadge, 5 * 60 * 1000);
document.addEventListener("click", (e) => {
  const more = document.getElementById("navmore");
  if (more.open && !more.contains(e.target)) more.open = false;
});

route();
