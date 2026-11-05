// Zuletzt angesehene Aktien (im Browser gespeichert): erscheinen in der Suche, solange das Feld leer ist, und auf der Startseite
const KEY = "zuletztAngesehen";
const MAX = 12;

export function recent() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter((x) => x && typeof x.symbol === "string") : [];
  } catch (e) { return []; }
}

// beim Öffnen eines Profils: an den Anfang, Dubletten raus
export function remember(symbol, name) {
  const list = [{ symbol, name: name || symbol, at: Date.now() }, ...recent().filter((x) => x.symbol !== symbol)].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* ohne Speicher eben ohne Verlauf */ }
}

export function clearRecent() {
  try { localStorage.removeItem(KEY); } catch (e) { /* nichts zu tun */ }
}
