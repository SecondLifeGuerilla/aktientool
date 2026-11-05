// Blättern im Profil: Öffnet man eine Aktie aus einer Liste (Weltauswahl, Screener, Watchlist, Depot, Startseite), merkt sich
// das Tool diese Liste für den Tab. Im Profil führen dann ‹ und › (oder die Pfeiltasten) zur vorigen bzw. nächsten Aktie,
// und „← Liste“ springt zurück an dieselbe Stelle der Liste.
import { escapeHtml as esc } from "./format.js";
import { currentEntry, goToEntry, replaceHash } from "./nav.js";

const KEY = "blaetterListe";
const MAX = 3000;

function read() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { return null; }
}

// items: [[Symbol, Name], …] in der angezeigten Reihenfolge
export function setBrowseList(label, items) {
  const ctx = { label, href: location.hash, entry: currentEntry(), items: items.slice(0, MAX) };
  try { sessionStorage.setItem(KEY, JSON.stringify(ctx)); } catch (e) { /* ohne Speicher kein Blättern */ }
}

// Klick auf einen Profil-Link im Container: vorher die aktuelle Liste merken (getItems wird erst beim Klick ausgewertet)
export function trackBrowse(container, label, getItems) {
  container.addEventListener("click", (e) => {
    if (e.target.closest('a[href^="#/aktie/"]')) setBrowseList(typeof label === "function" ? label() : label, getItems());
  }, true);
}

export function browseContext(symbol) {
  const ctx = read();
  const i = ctx?.items?.findIndex(([s]) => s === symbol) ?? -1;
  if (i < 0) return null;
  return { ...ctx, index: i, prev: ctx.items[i - 1] || null, next: ctx.items[i + 1] || null };
}

// Leiste über dem Profil; leer, wenn die Aktie in keiner gemerkten Liste steht
export function browseBar(symbol) {
  const c = browseContext(symbol);
  if (!c || c.items.length < 2) return "";
  const link = (it, dir) => (it
    ? `<a class="btn small browse-${dir}" href="#/aktie/${encodeURIComponent(it[0])}" data-browse="${dir}"
        title="${dir === "prev" ? "Vorige" : "Nächste"} Aktie der Liste (Taste ${dir === "prev" ? "←" : "→"})">${dir === "prev" ? "‹ " : ""}${esc(it[1] || it[0])}${dir === "next" ? " ›" : ""}</a>`
    : `<span class="btn small browse-${dir}" aria-disabled="true">${dir === "prev" ? "‹ Anfang der Liste" : "Ende der Liste ›"}</span>`);
  return `<nav class="browse-bar" aria-label="In der Liste blättern">
    <a class="linklike" href="${esc(c.href || "#/")}" data-browse="list" title="Zurück zur Liste, an dieselbe Stelle">← ${esc(c.label)}</a>
    <span class="spacer"></span>
    ${link(c.prev, "prev")}
    <span class="muted num">${c.index + 1} von ${c.items.length}</span>
    ${link(c.next, "next")}
  </nav>`;
}

// Klicks in der Leiste: Blättern ersetzt den Verlaufseintrag, „← Liste“ springt im Verlauf zurück
export function wireBrowseBar(root, symbol) {
  const bar = root.querySelector(".browse-bar");
  if (!bar) return;
  bar.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-browse]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return; // neuer Tab: normal öffnen
    e.preventDefault();
    if (a.dataset.browse === "list") backToList(symbol);
    else replaceHash(a.getAttribute("href"));
  });
}

export function browseStep(symbol, dir) {
  const c = browseContext(symbol);
  const it = c?.[dir];
  if (it) replaceHash(`#/aktie/${encodeURIComponent(it[0])}`);
  return Boolean(it);
}

export function backToList(symbol) {
  const c = browseContext(symbol);
  if (!c) return;
  try { sessionStorage.setItem("zeileZeigen", symbol); } catch (e) { /* nur Komfort */ }
  if (!(c.entry && goToEntry(c.entry))) location.hash = c.href || "#/";
}

// Nach der Rückkehr zur Liste: Zeile der zuletzt angesehenen Aktie kurz hervorheben (einmalig)
export function takeRowToShow() {
  try {
    const s = sessionStorage.getItem("zeileZeigen");
    sessionStorage.removeItem("zeileZeigen");
    return s;
  } catch (e) { return null; }
}
