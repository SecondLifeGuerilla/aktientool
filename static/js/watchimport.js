// Watchlist aus einer Tabelle (CSV) übernehmen: eine Zeile je Aktie, Ticker in Yahoo-Schreibweise, optional Gruppe.
// Gruppe als Pfad „Obergruppe › Untergruppe“ (auch > oder /), mehrere Gruppen durch „;“ oder „|“ getrennt.
// Passt zum CSV-Export der Watchlist (Spalten „Ticker“ und „Gruppen“), lässt sich also auch zurückspielen.
import { parseCsv } from "./csv.js";

const SYMBOL_RE = /^[A-Z0-9.\-^=]{1,20}$/;
const MAX_DEPTH = 3;

const groupPaths = (cell) => String(cell || "").split(/[;|]/)
  .map((p) => p.split(/\s*(?:›|>|\/)\s*/).map((x) => x.replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean).slice(0, MAX_DEPTH))
  .filter((p) => p.length);

// → { items: [{symbol, groups: [[pfad …]]}], errors: [Text] }; doppelte Ticker werden zusammengeführt
export function parseWatchCsv(text) {
  const table = parseCsv(text);
  if (!table.length) return { items: [], errors: [] };
  const head = table[0].map((h) => h.toLowerCase());
  const find = (re) => head.findIndex((h) => re.test(h));
  const headerRow = find(/^(ticker|symbol|kürzel|aktie|wertpapier)$/) >= 0 || find(/ticker|symbol/) >= 0;
  let sym = 0;
  let grp = table[0].length > 1 ? 1 : -1;
  if (headerRow) {
    sym = Math.max(find(/ticker|symbol|kürzel/), 0);
    grp = find(/gruppe|group|thema|kategorie|ordner/);
  }
  const bySym = new Map();
  const errors = [];
  (headerRow ? table.slice(1) : table).forEach((r, i) => {
    const line = i + 1 + (headerRow ? 1 : 0);
    const symbol = (r[sym] || "").trim().toUpperCase();
    if (!symbol) { errors.push(`Zeile ${line}: Ticker fehlt`); return; }
    if (!SYMBOL_RE.test(symbol)) { errors.push(`Zeile ${line}: „${symbol}“ ist kein gültiger Ticker`); return; }
    const item = bySym.get(symbol) || { symbol, groups: [] };
    for (const p of grp >= 0 ? groupPaths(r[grp]) : []) if (!item.groups.some((q) => q.join("›") === p.join("›"))) item.groups.push(p);
    bySym.set(symbol, item);
  });
  return { items: [...bySym.values()], errors };
}

// Gruppenbaum (Kopie) um die Pfade der Zeilen ergänzen; fehlende Gruppen werden angelegt, Namen ohne Groß/klein-Unterschied
export function mergeGroups(groups, items, newId) {
  const out = groups.map((g) => ({ ...g, symbols: [...(g.symbols || [])] }));
  let created = 0;
  for (const { symbol, groups: paths } of items) {
    for (const path of paths) {
      let parent = null;
      let g = null;
      for (const name of path) {
        g = out.find((x) => (x.parent || null) === parent && x.name.toLowerCase() === name.toLowerCase());
        if (!g) { g = { id: newId(), name, parent, symbols: [] }; out.push(g); created++; }
        parent = g.id;
      }
      if (!g.symbols.includes(symbol)) g.symbols.push(symbol);
    }
  }
  return { groups: out, created };
}
