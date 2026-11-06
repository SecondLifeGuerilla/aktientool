// Handy (bis 640 px): Tab-Leiste unten (Tabs selbst wählbar), „Mehr“ als Bottom-Sheet mit allen Seiten und Einstellungen,
// eigene Startseite, Kopfzeile blendet sich beim Runterscrollen aus, Wischen im Aktienprofil blättert in der Liste.
// Die Wahl liegt wie Darstellung und Ansicht nur in diesem Browser (localStorage).
import { browseStep } from "./browse.js";
import { setViewMode, viewMode } from "./mode.js";

const PHONE = window.matchMedia("(max-width: 640px)");
const TABS_KEY = "handyTabs";
const START_KEY = "startseite";
const MAX_TABS = 4;
const DEFAULT_TABS = ["start", "welt", "watchlist", "depot"];

const I = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
// [Schlüssel, Bezeichnung, Ziel, Symbol, nur Profi]
export const PAGES = [
  ["start", "Start", "#/", I("M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z")],
  ["welt", "Weltauswahl", "#/welt", I("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18")],
  ["watchlist", "Watchlist", "#/watchlist", I("M12 4l2.5 5.2 5.5.8-4 4 1 5.5L12 17l-5 2.5 1-5.5-4-4 5.5-.8z")],
  ["depot", "Depot", "#/depot", I("M4 7h16v12H4zM9 7V5h6v2M4 12h16")],
  ["alarme", "Alarme", "#/alarme", I("M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20h4")],
  ["screener", "Screener", "#/screener", I("M4 5h16l-6 7v6l-4 2v-8z"), true],
  ["trusts", "Trusts", "#/trusts", I("M4 20h16M6 20V10M10 20V10M14 20V10M18 20V10M3 10l9-6 9 6z")],
  ["termine", "Termine", "#/termine", I("M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"), true],
  ["vergleich", "Vergleich", "#/vergleich", I("M6 20V10M12 20V4M18 20v-7"), true],
  ["score-check", "Score-Check", "#/score-check", I("M5 12l4 4 10-10"), true],
  ["hebel", "Hebel", "#/hebel", I("M4 18l6-6 4 4 6-8M15 8h5v5")],
  ["callput", "Call/Put", "#/callput", I("M5 9h14M5 15h14M8 5l-3 4 3 4M16 11l3 4-3 4")],
  ["lexikon", "Lexikon", "#/lexikon", I("M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11")],
  ["tutorial", "Tutorial", "#/tutorial", I("M12 3l10 5-10 5L2 8zM6 10v5c3 3 9 3 12 0v-5")],
  ["daten", "Meine Daten", "#/daten", I("M12 3v12M7 10l5 5 5-5M4 19h16")],
];
const byKey = Object.fromEntries(PAGES.map((p) => [p[0], p]));
const MORE_ICON = I("M5 12h.01M12 12h.01M19 12h.01");

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch (e) { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ohne Speicher nur bis zum Neuladen */ }
}
const tabs = () => {
  const t = load(TABS_KEY, DEFAULT_TABS).filter((k) => byKey[k]).slice(0, MAX_TABS);
  return t.length ? t : DEFAULT_TABS;
};
export const startPage = () => (byKey[load(START_KEY, "start")] ? load(START_KEY, "start") : "start");

// Beim Öffnen ohne Ziel (nur die Adresse) auf die gewählte Startseite; „Start“ im Tab führt immer zur Übersicht
export function applyStartPage() {
  const k = startPage();
  if (!location.hash && k !== "start") history.replaceState(history.state, "", byKey[k][2]);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const adv = (p) => (p[4] ? " adv" : "");

// ---- Tab-Leiste
const bar = document.createElement("nav");
bar.className = "tabbar";
bar.setAttribute("aria-label", "Hauptnavigation");
document.body.append(bar);

let current = "start";
let unseen = 0;
function paintBar() {
  const t = tabs();
  const badge = (n) => (n ? `<span class="tab-badge">${n > 9 ? "9+" : n}</span>` : "");
  bar.innerHTML = t.map((k) => {
    const p = byKey[k];
    return `<a href="${p[2]}" class="tab${adv(p)}" data-tab="${k}"${k === current ? ' aria-current="page"' : ""}>
      ${p[3]}${k === "alarme" ? badge(unseen) : ""}<span>${esc(p[1])}</span></a>`;
  }).join("") + `<button type="button" class="tab" id="tab-more" aria-haspopup="dialog" aria-expanded="${sheet.classList.contains("open")}"
      ${current && !t.includes(current) ? 'aria-current="page"' : ""}>${MORE_ICON}${t.includes("alarme") ? "" : badge(unseen)}<span>Mehr</span></button>`;
}
bar.addEventListener("click", (e) => {
  if (e.target.closest("#tab-more")) { e.preventDefault(); toggleSheet(); return; }
  const a = e.target.closest("a.tab");
  // Tab der aktuellen Seite nochmals antippen: nach oben
  if (a && a.dataset.tab === current && a.getAttribute("href") === location.hash.split("?")[0] && window.scrollY > 0) {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  closeSheet();
});

// ---- Bottom-Sheet „Mehr“
const sheet = document.createElement("div");
sheet.className = "sheet";
sheet.setAttribute("role", "dialog");
sheet.setAttribute("aria-modal", "true");
sheet.setAttribute("aria-label", "Mehr");
const backdrop = document.createElement("div");
backdrop.className = "sheet-backdrop";
document.body.append(backdrop, sheet);
let editing = false;
let full = false;

function paintSheet() {
  const t = tabs();
  const theme = document.getElementById("theme-toggle")?.textContent || "";
  const tourBtn = document.getElementById("tour-btn");
  sheet.innerHTML = `
    <div class="sheet-grip" aria-hidden="true"></div>
    <div class="sheet-head">
      <b>${editing ? `Tab-Leiste wählen <span class="muted">(${t.length}/${MAX_TABS})</span>` : "Alle Seiten"}</b>
      <button type="button" class="linklike" data-act="edit">${editing ? "Fertig" : "Tab-Leiste anpassen"}</button>
    </div>
    ${editing ? `<p class="${full ? "bad" : "muted"} sheet-hint">${full ? "Schon 4 Tabs gewählt: erst einen abwählen. " : ""}Bis zu ${MAX_TABS} Seiten antippen, die unten als Tab erscheinen sollen. Die Reihenfolge folgt der Auswahl.</p>` : ""}
    <div class="sheet-grid${editing ? " editing" : ""}">
      ${PAGES.map((p) => {
        const on = t.includes(p[0]);
        return editing
          ? `<button type="button" class="sheet-item${adv(p)}" data-pick="${p[0]}" aria-pressed="${on}">${p[3]}<span>${esc(p[1])}</span>
              ${on ? `<i class="sheet-pos">${t.indexOf(p[0]) + 1}</i>` : ""}</button>`
          : `<a class="sheet-item${adv(p)}" href="${p[2]}"${p[0] === current ? ' aria-current="page"' : ""}>${p[3]}<span>${esc(p[1])}</span>
              ${p[0] === "alarme" && unseen ? `<i class="tab-badge">${unseen}</i>` : ""}</a>`;
      }).join("")}
    </div>
    ${editing ? "" : `
    <div class="sheet-settings">
      <div class="sheet-row"><span>Ansicht</span>
        <div class="segmented" role="group" aria-label="Ansicht">
          <button type="button" data-mode="basic" aria-pressed="${viewMode() === "basic"}">Basis</button>
          <button type="button" data-mode="advanced" aria-pressed="${viewMode() !== "basic"}">Profi</button>
        </div></div>
      <div class="sheet-row"><span>Darstellung</span><button type="button" class="btn" data-act="theme">${esc(theme)}</button></div>
      <div class="sheet-row"><label for="sheet-start">Beim Öffnen starten mit</label>
        <select id="sheet-start">${PAGES.map((p) => `<option value="${p[0]}"${p[0] === startPage() ? " selected" : ""}>${esc(p[1])}</option>`).join("")}</select></div>
      ${tourBtn && !tourBtn.hidden ? `<div class="sheet-row"><span>Diese Seite erklärt</span><button type="button" class="btn" data-act="tour">? Kurz-Tour</button></div>` : ""}
    </div>`}`;
}

function openSheet() {
  editing = false;
  paintSheet();
  sheet.classList.add("open");
  backdrop.classList.add("open");
  document.documentElement.classList.add("sheet-open");
  paintBar();
}
function closeSheet() {
  if (!sheet.classList.contains("open")) return;
  sheet.classList.remove("open");
  backdrop.classList.remove("open");
  sheet.style.transform = "";
  document.documentElement.classList.remove("sheet-open");
  paintBar();
}
const toggleSheet = () => (sheet.classList.contains("open") ? closeSheet() : openSheet());
backdrop.addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

sheet.addEventListener("click", (e) => {
  const pick = e.target.closest("[data-pick]");
  if (pick) {
    let t = tabs();
    const k = pick.dataset.pick;
    if (t.includes(k)) t = t.filter((x) => x !== k);
    else if (t.length < MAX_TABS) t = [...t, k];
    else { full = true; paintSheet(); full = false; return; } // voll: erst eine Seite abwählen
    if (!t.length) return;
    save(TABS_KEY, t);
    paintSheet();
    paintBar();
    return;
  }
  const act = e.target.closest("[data-act]")?.dataset.act;
  const mode = e.target.closest("[data-mode]")?.dataset.mode;
  if (act === "edit") { editing = !editing; paintSheet(); }
  else if (act === "theme") { document.getElementById("theme-toggle").click(); paintSheet(); }
  else if (act === "tour") { closeSheet(); document.getElementById("tour-btn").click(); }
  else if (mode) { setViewMode(mode); paintSheet(); }
  else if (e.target.closest("a.sheet-item")) closeSheet();
});
sheet.addEventListener("change", (e) => {
  if (e.target.id === "sheet-start") save(START_KEY, e.target.value);
});

// Sheet nach unten ziehen zum Schließen
let drag = null;
sheet.addEventListener("touchstart", (e) => {
  if (sheet.scrollTop > 0) return;
  drag = { y: e.touches[0].clientY, dy: 0 };
}, { passive: true });
sheet.addEventListener("touchmove", (e) => {
  if (!drag) return;
  drag.dy = Math.max(0, e.touches[0].clientY - drag.y);
  sheet.style.transform = drag.dy ? `translateY(${drag.dy}px)` : "";
}, { passive: true });
sheet.addEventListener("touchend", () => {
  if (!drag) return;
  const close = drag.dy > 80;
  drag = null;
  sheet.style.transform = "";
  if (close) closeSheet();
});

// ---- Seitenwechsel (aus route in app.js)
export function mobileRoute(page) {
  current = byKey[page] ? page : page === "aktie" ? null : "start";
  closeSheet();
  showTopbar();
  paintBar();
}
export function setAlarmCount(n) {
  unseen = n || 0;
  paintBar();
}
document.addEventListener("mode-changed", () => { if (sheet.classList.contains("open")) paintSheet(); });

// ---- Kopfzeile beim Runterscrollen ausblenden, beim Hochscrollen zeigen (nur Handy)
const root = document.documentElement;
let lastY = window.scrollY;
function showTopbar() { root.classList.remove("bar-hidden"); }
window.addEventListener("scroll", () => {
  const y = window.scrollY;
  if (!PHONE.matches || document.activeElement?.id === "search-input") { lastY = y; showTopbar(); return; }
  const dy = y - lastY;
  if (Math.abs(dy) < 8) return;
  root.classList.toggle("bar-hidden", dy > 0 && y > 120);
  lastY = y;
}, { passive: true });

// ---- Wischen im Aktienprofil: nach links nächste, nach rechts vorige Aktie der Liste
let swipe = null;
const app = document.getElementById("app");
app.addEventListener("touchstart", (e) => {
  swipe = null;
  if (!PHONE.matches || e.touches.length !== 1 || !location.hash.startsWith("#/aktie/")) return;
  // nicht in seitlich scrollbaren Bereichen (Tabellen, Diagramme, Leisten) oder Eingaben
  if (e.target.closest(".table-scroll, .subnav, canvas, input, select, textarea, [data-no-swipe], .chart")) return;
  const t = e.touches[0];
  swipe = { x: t.clientX, y: t.clientY, at: Date.now() };
}, { passive: true });
app.addEventListener("touchend", (e) => {
  if (!swipe) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - swipe.x;
  const dy = t.clientY - swipe.y;
  const fast = Date.now() - swipe.at < 600;
  swipe = null;
  if (!fast || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
  const sym = decodeURIComponent(location.hash.slice("#/aktie/".length).split("?")[0]);
  const dir = dx < 0 ? "next" : "prev";
  browseStep(sym, dir);
}, { passive: true });

PHONE.addEventListener("change", () => { closeSheet(); showTopbar(); });
paintBar();
