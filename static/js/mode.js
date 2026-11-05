// Ansicht „Basis“ oder „Profi“: Basis zeigt überall nur die wichtigsten Kennzahlen und Funktionen, Profi alles.
// Die Wahl bleibt im Browser gespeichert. Während einer Tutorial-Tour gilt immer die Profi-Ansicht, weil die Tour
// alle Bereiche zeigt. Bei jedem Wechsel löst das Modul „mode-changed“ aus; app.js baut die Seite dann neu auf.
const KEY = "viewMode";

function read() {
  try { return localStorage.getItem(KEY) === "basic" ? "basic" : "advanced"; } catch (e) { return "advanced"; }
}

let chosen = read();
let tour = false;

export const viewMode = () => chosen;
export const tourRunning = () => tour;
export const tourOverride = () => tour && chosen === "basic";
export const isBasic = () => chosen === "basic" && !tour;

function apply(wasBasic) {
  document.documentElement.dataset.mode = isBasic() ? "basic" : "advanced";
  document.dispatchEvent(new CustomEvent("mode-changed", { detail: { rerender: wasBasic !== isBasic() } }));
}

export function setViewMode(mode) {
  if (mode === chosen) return;
  const was = isBasic();
  chosen = mode;
  try { localStorage.setItem(KEY, mode); } catch (e) { /* ohne Speicher gilt die Wahl nur bis zum Neuladen */ }
  apply(was);
}

export function setTourOverride(on) {
  if (on === tour) return;
  const was = isBasic();
  tour = on;
  apply(was);
}
