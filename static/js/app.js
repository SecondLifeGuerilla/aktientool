// Einstieg: Router, Suche in der Kopfzeile, Hell/Dunkel-Umschalter, Hinweis auf ausgelöste Alarme
import { renderAlarms } from "./alarms.js";
import { api, checkAlertsIfDue } from "./api.js";
import { renderCalendar } from "./calendar.js";
import { renderCallPut } from "./callput.js";
import { disposeAll, rerenderAll } from "./charts.js";
import { renderCompare } from "./compare.js";
import { renderData } from "./daten.js";
import { renderDepot } from "./depot.js";
import { initTooltips } from "./glossary.js";
import { renderHebel } from "./hebel.js";
import { renderHome } from "./home.js";
import { setPageKeys, showShortcuts } from "./keys.js";
import { renderLexicon } from "./lexicon.js";
import { setViewMode, tourOverride, viewMode } from "./mode.js";
import { applyStartPage, mobileRoute, setAlarmCount } from "./mobile.js";
import { enterEntry, restoreScroll } from "./nav.js";
import { renderProfile } from "./profile.js";
import { renderScoreCheck } from "./scorecheck.js";
import { renderScreener } from "./screener.js";
import { attachSearch } from "./search.js";
import { renderTrusts } from "./trusts.js";
import { initTour, pageTourInfo, renderTutorial, startPageTour } from "./tutorial.js";
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
  // Zurück/Vor/Neuladen: an dieselbe Stelle scrollen, sobald die Seite wieder so hoch ist; neue Seiten beginnen oben
  const savedY = enterEntry();
  setPageKeys(null);
  disposeAll();
  app.innerHTML = "";
  restoreScroll(savedY);
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === parts[0]));
  document.getElementById("navmore").open = false;
  setNavOpen(false);
  mobileRoute(parts[0] || "start");
  if (parts[0] !== "alarme") paintAlertBadge();
  paintTourBtn();
  // Seiten prüfen nach jedem await, ob sie noch aktuell sind (Nutzer kann inzwischen weiternavigiert sein)
  const isCurrent = () => token === routeToken;
  if (parts[0] === "aktie" && parts[1]) return renderProfile(app, parts[1], isCurrent);
  if (parts[0] === "welt") return renderWorld(app, params, isCurrent);
  if (parts[0] === "lexikon") return renderLexicon(app, params, isCurrent);
  if (parts[0] === "screener") return renderScreener(app, params.get("list") || "Watchlist", isCurrent, params.get("symbols"));
  if (parts[0] === "watchlist") return renderScreener(app, "Watchlist", isCurrent);
  if (parts[0] === "depot") return renderDepot(app, params, isCurrent);
  if (parts[0] === "trusts") return renderTrusts(app, params, isCurrent);
  if (parts[0] === "alarme") return renderAlarms(app, params, isCurrent);
  if (parts[0] === "termine") return renderCalendar(app, isCurrent);
  if (parts[0] === "vergleich") return renderCompare(app, params, isCurrent);
  if (parts[0] === "callput") return renderCallPut(app, params, isCurrent);
  if (parts[0] === "hebel") return renderHebel(app, params, isCurrent);
  if (parts[0] === "score-check") return renderScoreCheck(app, params, isCurrent);
  if (parts[0] === "tutorial") return renderTutorial(app, params, isCurrent);
  if (parts[0] === "daten") return renderData(app, params, isCurrent);
  document.title = "Aktientool";
  return renderHome(app, isCurrent);
}

window.addEventListener("hashchange", route);

// ---- „? Tour“: Kurz-Tour für die aktuelle Seite (pagetours.js); ein Punkt zeigt, dass sie noch nicht gemacht ist
const tourBtn = document.getElementById("tour-btn");
function paintTourBtn() {
  const info = pageTourInfo();
  tourBtn.hidden = !info;
  if (!info) return;
  tourBtn.classList.toggle("fresh", !info.done);
  tourBtn.title = `Kurz-Tour: ${info.short} in 1–3 Minuten erklärt${info.done ? " (schon gemacht)" : ""}`;
}
tourBtn.addEventListener("click", () => startPageTour());
document.addEventListener("tutorial-changed", paintTourBtn);
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

// ---- Ansicht: Basis (nur das Wichtigste) oder Profi (alles); die aktuelle Seite wird in der neuen Ansicht neu aufgebaut
const modeSwitch = document.getElementById("mode-switch");
const paintModeSwitch = () => {
  modeSwitch.querySelectorAll("[data-view-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.viewMode === viewMode())));
  modeSwitch.title = tourOverride() ? "Während der Tutorial-Tour gilt die Profi-Ansicht, danach wieder Basis." : "";
};
modeSwitch.addEventListener("click", (e) => {
  const b = e.target.closest("[data-view-mode]");
  if (b) setViewMode(b.dataset.viewMode);
});
document.addEventListener("mode-changed", (e) => {
  paintModeSwitch();
  if (e.detail.rerender) route();
});
paintModeSwitch();

// ---- Ausgelöste, noch nicht angesehene Alarme als Zahl in der Kopfzeile. Die Alarme liegen im Browser; geprüft
// werden sie alle 30 Minuten, solange das Tool in einem Tab geöffnet ist (Prüfung beim Server, siehe api.js).
async function paintAlertBadge() {
  const badge = document.getElementById("alert-badge");
  try {
    const { status } = await api.alerts();
    badge.textContent = String(status.unseen);
    badge.hidden = !status.unseen;
    setAlarmCount(status.unseen);
  } catch (e) { badge.hidden = true; setAlarmCount(0); }
}
document.addEventListener("alerts-changed", paintAlertBadge);
document.addEventListener("store-changed", (e) => { if (["alarme", "*"].includes(e.detail.name)) paintAlertBadge(); });
paintAlertBadge();
setTimeout(checkAlertsIfDue, 5000);
setInterval(() => { checkAlertsIfDue(); paintAlertBadge(); }, 5 * 60 * 1000);
document.addEventListener("click", (e) => {
  const more = document.getElementById("navmore");
  if (more.open && !more.contains(e.target)) more.open = false;
  if (!e.target.closest(".topbar") || e.target.closest(".mainnav a")) setNavOpen(false);
});

// ---- Menü auf schmalen Bildschirmen (Handy): Navigation klappt unter der Kopfzeile auf
function setNavOpen(open) {
  const btn = document.getElementById("nav-toggle");
  document.querySelector(".topbar").classList.toggle("nav-open", open);
  btn.setAttribute("aria-expanded", String(open));
  btn.setAttribute("aria-label", open ? "Menü schließen" : "Menü öffnen");
}
document.getElementById("nav-toggle").addEventListener("click", () => {
  setNavOpen(!document.querySelector(".topbar").classList.contains("nav-open"));
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setNavOpen(false); });
document.getElementById("keys-btn").addEventListener("click", () => {
  document.getElementById("navmore").open = false;
  showShortcuts();
});

// ---- Höhe der Kopfzeile als CSS-Variable (Abschnittsnavigation und Tabellenköpfe kleben darunter)
const topbar = document.querySelector(".topbar");
new ResizeObserver(() => document.documentElement.style.setProperty("--topbar-h", `${topbar.offsetHeight}px`)).observe(topbar);

// ---- Tabellenköpfe bleiben beim Scrollen stehen. Das geht nur, solange die Tabelle nicht seitlich scrollt: passt sie in
// die Breite, bekommt ihr Rahmen die Klasse „fits“ (kein eigener Scrollbereich), sonst bleibt seitliches Scrollen möglich.
let fitQueued = false;
function fitTables() {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => {
    fitQueued = false;
    for (const el of app.querySelectorAll(".table-scroll")) {
      const table = el.querySelector(":scope > table");
      if (!table) continue;
      el.classList.toggle("fits", table.offsetWidth <= el.clientWidth + 1);
    }
  });
}
new MutationObserver(fitTables).observe(app, { childList: true, subtree: true });
window.addEventListener("resize", fitTables);

// ---- „nach oben“ auf langen Seiten
const toTop = document.createElement("button");
toTop.type = "button";
toTop.className = "to-top";
toTop.textContent = "↑ nach oben";
toTop.hidden = true;
toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
document.body.append(toTop);
window.addEventListener("scroll", () => { toTop.hidden = window.scrollY < 1400; }, { passive: true });

applyStartPage();
route();
initTour(); // laufende Tutorial-Tour nach einem Neuladen fortsetzen
