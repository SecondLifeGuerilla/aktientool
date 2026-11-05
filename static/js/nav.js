// Verlauf innerhalb des Tabs: Jeder Eintrag der Browser-Historie bekommt eine Kennung (history.state.navId). Damit stellt das
// Tool beim Zurück- oder Vorgehen (und nach dem Neuladen) die Scroll-Position wieder her und kann gezielt zu einer früheren
// Seite zurückspringen, etwa zur Trefferliste, aus der ein Profil geöffnet wurde. Alles liegt nur im sessionStorage.
const STACK_KEY = "verlaufStapel";
const POS_KEY = "scrollPositionen";
const KEEP = 150;

function read(key, fallback) {
  try { return JSON.parse(sessionStorage.getItem(key) || "null") ?? fallback; } catch (e) { return fallback; }
}
function write(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ohne Speicher nur bis zum Neuladen */ }
}

// Scrollen übernimmt das Tool selbst (der Browser kennt die nachgeladenen Inhalte nicht)
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

let stack = read(STACK_KEY, []);
let positions = read(POS_KEY, {});
let pos = -1;
let replacing = false;
let restoring = null; // laufende Wiederherstellung: { cancel }
let lastId = null; // Eintrag der zuletzt aufgebauten Seite

export const currentEntry = () => history.state?.navId || null;

// zu Beginn jeder Seite (route in app.js): Eintrag erkennen oder neu kennzeichnen.
// Rückgabe: gespeicherte Scroll-Position, wenn der Eintrag schon bekannt ist (Zurück, Vor, Neuladen), sonst null
export function enterEntry() {
  // Position der bisherigen Seite festhalten (falls seit dem letzten Scroll-Ereignis kein weiteres kam); ihr Inhalt steht noch
  if (lastId && !restoring) positions[lastId] = Math.round(window.scrollY);
  let id = currentEntry();
  const known = Boolean(id);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    history.replaceState({ ...(history.state || {}), navId: id }, "");
    if (replacing && pos >= 0) stack[pos] = id;
    else { stack = stack.slice(0, pos + 1); stack.push(id); }
    pos = stack.indexOf(id);
  } else {
    pos = stack.indexOf(id);
    if (pos < 0) { stack.push(id); pos = stack.length - 1; }
  }
  replacing = false;
  lastId = id;
  if (stack.length > KEEP) { stack = stack.slice(-KEEP); pos = stack.indexOf(id); }
  write(STACK_KEY, stack);
  write(POS_KEY, positions);
  return known && Number.isFinite(positions[id]) ? positions[id] : null;
}

// zur Seite wechseln, ohne einen neuen Eintrag anzulegen (Blättern im Profil: „Zurück“ führt dann direkt zur Liste)
export function replaceHash(hash) {
  replacing = true;
  location.replace(hash);
}

// zu einem früheren Eintrag springen (mit dessen Scroll-Position); false, wenn er nicht mehr im Verlauf steht
export function goToEntry(id) {
  const j = stack.indexOf(id);
  if (j < 0 || j >= pos) return false;
  history.go(j - pos);
  return true;
}

// ---- Scroll-Position je Eintrag mitschreiben
let saveTimer = null;
window.addEventListener("scroll", () => {
  const id = currentEntry();
  if (!id || restoring) return;
  positions[id] = Math.round(window.scrollY);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const keep = new Set(stack);
    positions = Object.fromEntries(Object.entries(positions).filter(([k]) => keep.has(k)));
    write(POS_KEY, positions);
  }, 300);
}, { passive: true });

export function cancelRestore() {
  restoring?.cancel();
}

// Position wiederherstellen, sobald die Seite hoch genug ist (Seiten laden ihre Daten nach); bricht ab, wenn der
// Nutzer selbst scrollt oder klickt, oder nach acht Sekunden
export function restoreScroll(y) {
  restoring?.cancel();
  if (!y) { window.scrollTo({ top: 0, behavior: "instant" }); return; }
  const until = Date.now() + 8000;
  const stop = () => {
    clearInterval(timer);
    for (const ev of ["wheel", "mousedown", "keydown", "touchstart"]) window.removeEventListener(ev, stop, true);
    restoring = null;
  };
  const tryNow = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: Math.min(y, Math.max(0, max)), behavior: "instant" });
    if (max >= y - 2 || Date.now() > until) stop();
  };
  for (const ev of ["wheel", "mousedown", "keydown", "touchstart"]) window.addEventListener(ev, stop, true);
  const timer = setInterval(tryNow, 120);
  restoring = { cancel: stop };
  tryNow();
}
