// Eigene Filter der Weltauswahl unter einem Namen merken (im Browser gespeichert). Gespeichert wird die Adresse der
// Weltauswahl ohne Seitenzahl, also Suche, Region, Sektor, Kennzahl-Filter, Ansicht und Sortierung.
const KEY = "weltMeineFilter";

export function savedFilters() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter((f) => f && typeof f.name === "string" && typeof f.query === "string") : [];
  } catch (e) { return []; }
}

function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* ohne Speicher nicht dauerhaft */ }
}

// gleicher Name: überschreiben (an derselben Stelle)
export function saveFilter(name, query) {
  const list = savedFilters();
  const i = list.findIndex((f) => f.name.toLowerCase() === name.toLowerCase());
  const item = { name, query, at: Date.now() };
  if (i >= 0) list[i] = item; else list.push(item);
  write(list);
  return i >= 0;
}

export function removeFilter(name) {
  const list = savedFilters();
  const i = list.findIndex((f) => f.name === name);
  const [gone] = i >= 0 ? list.splice(i, 1) : [];
  write(list);
  return { item: gone, index: i };
}

export function restoreFilter(item, index) {
  const list = savedFilters().filter((f) => f.name !== item.name);
  list.splice(Math.max(0, Math.min(index, list.length)), 0, item);
  write(list);
}

export const savedHref = (f) => `#/welt${f.query ? `?${f.query}` : ""}`;
