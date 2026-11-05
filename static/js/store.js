// Eigene Daten im Browser: Watchlist, Gruppen, Notizen, Depot, Alarme, Korrekturen zur Handelbarkeit und eigene
// Holdings. Der Server speichert nichts über Nutzer; jeder Browser hat seinen eigenen Stand (ohne Konto).
// Sicherung und Umzug auf ein anderes Gerät: Seite „Meine Daten“ (Export/Import als JSON-Datei).
//
// Die Funktionen liefern dasselbe wie früher die Server-Endpunkte (api.js ruft sie an deren Stelle auf) und prüfen die
// Eingaben genauso; Fehler kommen als StoreError mit verständlicher Meldung.

const PREFIX = "aktientool.";
const memory = new Map(); // Ersatz, wenn der Browser keinen Speicher erlaubt (privates Fenster o. Ä.)
let persistent = true;

export class StoreError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function read(name, fallback) {
  let raw = null;
  try {
    raw = localStorage.getItem(PREFIX + name);
  } catch (e) {
    persistent = false;
    raw = memory.get(name) ?? null;
  }
  if (raw === null && !persistent) raw = memory.get(name) ?? null;
  if (raw === null) return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}

function write(name, value) {
  const raw = JSON.stringify(value);
  memory.set(name, raw);
  try {
    localStorage.setItem(PREFIX + name, raw);
  } catch (e) {
    persistent = false;
    if (e?.name === "QuotaExceededError") throw new StoreError("Der Speicher des Browsers ist voll. Bitte „Meine Daten“ exportieren und aufräumen.");
  }
  document.dispatchEvent(new CustomEvent("store-changed", { detail: { name } }));
}

export const isPersistent = () => {
  try {
    localStorage.setItem(PREFIX + "probe", "1");
    localStorage.removeItem(PREFIX + "probe");
    return true;
  } catch (e) { return false; }
};

// andere Tabs desselben Browsers haben etwas geändert
window.addEventListener("storage", (e) => {
  if (e.key?.startsWith(PREFIX)) document.dispatchEvent(new CustomEvent("store-changed", { detail: { name: e.key.slice(PREFIX.length), external: true } }));
});

const SYMBOL_RE = /^[A-Z0-9.\-^=]{1,20}$/;
const ID_RE = /^[0-9a-f]{6,32}$/;
const GROUP_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

function newId() {
  const b = new Uint8Array(5);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const now = () => {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return `${local}${off >= 0 ? "+" : "-"}${pad(off / 60)}:${pad(off % 60)}`;
};

function symbol(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!SYMBOL_RE.test(s)) throw new StoreError("Ungültiges Tickersymbol.");
  return s;
}

function number(value, name, positive = true) {
  const f = typeof value === "number" ? value : Number(String(value ?? "").trim().replace(",", "."));
  if (value === null || value === undefined || String(value).trim() === "" || !Number.isFinite(f)) throw new StoreError(`${name}: keine Zahl`);
  if (positive && f <= 0) throw new StoreError(`${name} muss größer als 0 sein`);
  return f;
}

function day(value) {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  const d = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new StoreError("Datum im Format JJJJ-MM-TT angeben");
  }
  return s;
}

const text = (v, limit) => String(v ?? "").trim().slice(0, limit);

// ---------------------------------------------------------------- Watchlist

export function watchlist() {
  const items = read("watchlist", []);
  return Array.isArray(items) ? items.filter((s) => typeof s === "string") : [];
}

export function watch(sym) {
  const s = symbol(sym);
  const items = watchlist();
  if (!items.includes(s)) {
    items.push(s);
    write("watchlist", items);
  }
  return items;
}

export function unwatch(sym) {
  const s = symbol(sym);
  const items = watchlist().filter((x) => x !== s);
  write("watchlist", items);
  return items;
}

// ---------------------------------------------------------------- Gruppen der Watchlist

const GROUP_MAX_DEPTH = 3; // Gruppe › Untergruppe › Unter-Untergruppe

export function watchGroups() {
  const items = read("watchgruppen", []);
  return Array.isArray(items) ? items : [];
}

export function cleanWatchGroups(groups) {
  if (!Array.isArray(groups)) throw new StoreError("Erwartet wird eine Liste von Gruppen.");
  if (groups.length > 300) throw new StoreError("Höchstens 300 Gruppen");
  const clean = [];
  const ids = new Set();
  for (const g of groups) {
    if (!g || typeof g !== "object") throw new StoreError("Ungültige Gruppe");
    const gid = String(g.id ?? "").trim() || newId();
    if (!GROUP_ID_RE.test(gid) || ids.has(gid)) throw new StoreError(`Ungültige oder doppelte Gruppen-Id: „${gid}“`);
    const name = text(g.name, 200).replace(/\s+/g, " ").slice(0, 60);
    if (!name) throw new StoreError("Jede Gruppe braucht einen Namen");
    const symbols = [];
    for (const raw of g.symbols || []) {
      const s = text(raw, 20).toUpperCase();
      if (!SYMBOL_RE.test(s)) throw new StoreError(`Ungültiger Ticker: „${raw}“`);
      if (!symbols.includes(s)) symbols.push(s);
    }
    ids.add(gid);
    clean.push({ id: gid, name, parent: g.parent ? String(g.parent) : null, symbols: symbols.slice(0, 2000) });
  }
  const byId = new Map(clean.map((g) => [g.id, g]));
  for (const g of clean) {
    if (g.parent && !byId.has(g.parent)) throw new StoreError(`Übergeordnete Gruppe von „${g.name}“ fehlt`);
    let depth = 1;
    const seen = new Set([g.id]);
    let cur = g;
    while (cur.parent) {
      cur = byId.get(cur.parent);
      if (seen.has(cur.id)) throw new StoreError(`„${g.name}“ kann nicht in sich selbst liegen`);
      seen.add(cur.id);
      depth += 1;
    }
    if (depth > GROUP_MAX_DEPTH) throw new StoreError(`„${g.name}“: höchstens ${GROUP_MAX_DEPTH} Ebenen (Gruppe › Untergruppe › Unter-Untergruppe)`);
  }
  const siblings = new Set();
  for (const g of clean) {
    const key = `${g.parent}\u0000${g.name.toLocaleLowerCase("de")}`;
    if (siblings.has(key)) throw new StoreError(`Die Gruppe „${g.name}“ gibt es an dieser Stelle schon`);
    siblings.add(key);
  }
  return clean;
}

export function saveWatchGroups(groups) {
  const clean = cleanWatchGroups(groups);
  write("watchgruppen", clean);
  return clean;
}

// ---------------------------------------------------------------- Notizen

export function notes() {
  const items = read("notizen", {});
  return items && typeof items === "object" && !Array.isArray(items) ? items : {};
}

export function note(sym) {
  return notes()[symbol(sym)] || { text: "", updated: null };
}

export function saveNote(sym, value) {
  const s = symbol(sym);
  const t = String(value ?? "").trim().slice(0, 20000);
  const items = notes();
  if (t) items[s] = { text: t, updated: now() };
  else delete items[s];
  write("notizen", items);
  return items[s] || { text: "", updated: null };
}

// ---------------------------------------------------------------- Depot

export function positions() {
  const items = read("depot", []);
  return Array.isArray(items) ? items : [];
}

// Ein Kauf: Stückzahl, Kaufkurs je Aktie in Euro, Kaufdatum (optional) und Notiz. Käufe ohne "currency" stammen aus
// der Zeit vor der Euro-Anzeige; ihr Kaufkurs ist in der Kurswährung der Aktie.
function lot(sym, data) {
  return {
    id: newId(), symbol: symbol(sym),
    shares: number(data.shares, "Stückzahl"),
    price: number(data.price, "Kaufkurs"), currency: "EUR",
    date: day(data.date),
    note: String(data.note ?? "").slice(0, 500),
  };
}

export function addPosition(data) {
  const items = positions();
  items.push(lot(data.symbol, data));
  write("depot", items);
  return items;
}

// Mehrere Käufe auf einmal (CSV-Import): erst alle prüfen, dann alle oder keinen speichern
export function addPositions(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new StoreError("Keine Käufe zum Importieren.");
  if (rows.length > 500) throw new StoreError("Höchstens 500 Käufe auf einmal.");
  const fresh = rows.map((r, i) => {
    try { return lot(r?.symbol, r || {}); } catch (e) { throw new StoreError(`Zeile ${i + 1} (${r?.symbol ?? "?"}): ${e.message}`); }
  });
  const items = [...positions(), ...fresh];
  write("depot", items);
  return items;
}

// Gelöschten Kauf zurückholen („Rückgängig“): mit derselben Kennung und Währung wie vorher
export function restorePosition(data) {
  const item = lot(data.symbol, data);
  if (ID_RE.test(String(data.id ?? ""))) item.id = String(data.id);
  if (data.currency !== "EUR") delete item.currency;
  const items = positions();
  if (!items.some((p) => p.id === item.id)) {
    items.push(item);
    write("depot", items);
  }
  return items;
}

// Einen Kauf korrigieren; nur die übergebenen Felder ändern sich, die Währung bleibt, wie sie war
export function updatePosition(id, data) {
  const items = positions();
  const item = items.find((p) => p.id === id);
  if (!item) throw new StoreError("Kauf nicht gefunden");
  if ("shares" in data) item.shares = number(data.shares, "Stückzahl");
  if ("price" in data) item.price = number(data.price, "Kaufkurs");
  if ("date" in data) item.date = day(data.date);
  if ("note" in data) item.note = String(data.note ?? "").slice(0, 500);
  write("depot", items);
  return items;
}

export function removePosition(id) {
  const items = positions().filter((p) => p.id !== id);
  write("depot", items);
  return items;
}

// ---------------------------------------------------------------- Alarme

export const ALERT_TYPES = {
  price_below: "Kurs fällt unter",
  price_above: "Kurs steigt über",
  below_fair: "Kurs mindestens x % unter fairem Wert",
  dividend_cut: "Dividende gekürzt",
  score_below: "Gesamt-Score der Weltauswahl fällt unter",
};
export const ALERT_INTERVAL = 30 * 60; // Sekunden zwischen zwei Prüfungen, solange das Tool geöffnet ist

export function alertList() {
  const items = read("alarme", []);
  return Array.isArray(items) ? items : [];
}

export function alertState() {
  const st = read("alarmstatus", {});
  return st && typeof st === "object" ? st : {};
}

export function setAlertState(changes) {
  write("alarmstatus", { ...alertState(), ...changes });
}

export const notificationsOn = () => typeof Notification !== "undefined" && Notification.permission === "granted";

export function alertStatus() {
  const items = alertList();
  const st = alertState();
  return {
    total: items.length, open: items.filter((a) => !a.triggered).length,
    unseen: items.filter((a) => a.triggered && !a.seen).length,
    last_check: st.last_check || null, error: st.error || null, running: false,
    interval: ALERT_INTERVAL, email: false, notify: notificationsOn(),
  };
}

// baseline/baseline_eur (Dividende gekürzt) ermittelt api.js vorher beim Server
export function addAlert(sym, data) {
  const kind = data.type;
  if (!(kind in ALERT_TYPES)) throw new StoreError("Unbekannte Art von Alarm");
  const value = kind === "dividend_cut" ? null : number(data.value, "Schwelle", kind !== "below_fair");
  const item = {
    id: newId(), symbol: symbol(sym), type: kind, value, created: now(), triggered: null, message: null, seen: true,
    baseline: data.baseline ?? null,
    // Kursschwellen in Euro; die Dividende vergleicht intern in Kurswährung, angezeigt wird sie in Euro
    currency: kind === "price_below" || kind === "price_above" ? "EUR" : null, baseline_eur: data.baseline_eur ?? null,
  };
  const items = alertList();
  items.push(item);
  write("alarme", items);
  return items;
}

export function updateAlerts(changes) {
  const items = alertList();
  for (const a of items) if (changes[a.id]) Object.assign(a, changes[a.id]);
  write("alarme", items);
  return items;
}

// Gelöschten Alarm zurückholen („Rückgängig“): unverändert samt Ausgangswert und Status, an seiner alten Stelle
export function restoreAlert(data, index) {
  if (!(data.type in ALERT_TYPES)) throw new StoreError("Unbekannte Art von Alarm");
  const id = String(data.id ?? "");
  if (!ID_RE.test(id)) throw new StoreError("Ungültige Kennung");
  const keys = ["type", "value", "created", "triggered", "message", "seen", "baseline", "currency", "baseline_eur"];
  const item = { id, symbol: symbol(data.symbol) };
  for (const k of keys) item[k] = data[k] ?? null;
  if (item.value !== null) item.value = number(item.value, "Schwelle", item.type !== "below_fair");
  const items = alertList();
  if (!items.some((a) => a.id === id)) {
    const at = Number.isInteger(index) ? Math.max(0, Math.min(index, items.length)) : items.length;
    items.splice(at, 0, item);
    write("alarme", items);
  }
  return items;
}

export function removeAlert(id) {
  const items = alertList().filter((a) => a.id !== id);
  write("alarme", items);
  return items;
}

// ---------------------------------------------------------------- Handelbarkeit bei Trade Republic

export function tradable() {
  const items = read("handelbar", {});
  return items && typeof items === "object" && !Array.isArray(items) ? items : {};
}

// true/false: eigene Angabe; null: zurück zur Handelsliste
export function setTradable(sym, value) {
  if (value !== null && typeof value !== "boolean") throw new StoreError("Erwartet wird true, false oder null");
  const s = symbol(sym);
  const items = tradable();
  if (value === null) delete items[s];
  else items[s] = value;
  write("handelbar", items);
  return items;
}

// ---------------------------------------------------------------- Eigene Holdings (geprüft vom Server, siehe api.js)

export function holdings() {
  const items = read("holdings", {});
  return items && typeof items === "object" && !Array.isArray(items) ? items : {};
}

export function saveHolding(sym, definition) {
  const items = holdings();
  items[symbol(sym)] = definition;
  write("holdings", items);
}

export function removeHolding(sym) {
  const items = holdings();
  delete items[symbol(sym)];
  write("holdings", items);
}

// Was in Berechnungen des Servers einfließt; wird mit den Anfragen mitgeschickt
export function context() {
  const t = tradable();
  const h = holdings();
  return Object.keys(t).length || Object.keys(h).length ? { tradable: t, holdings: h } : null;
}

// ---------------------------------------------------------------- Sicherung: Export und Import

export const SECTIONS = {
  watchlist: { label: "Watchlist", file: "watchlist.json", empty: [] },
  watchgruppen: { label: "Gruppen der Watchlist", file: "watchgruppen.json", empty: [] },
  depot: { label: "Depot", file: "depot.json", empty: [] },
  notizen: { label: "Notizen", file: "notizen.json", empty: {} },
  alarme: { label: "Alarme", file: "alarme.json", empty: [] },
  handelbar: { label: "Korrekturen zur Handelbarkeit", file: "handelbar.json", empty: {} },
  holdings: { label: "Eigene Holdings", file: "holdings.json", empty: {} },
};

export function counts() {
  const out = {};
  for (const name of Object.keys(SECTIONS)) {
    const v = read(name, SECTIONS[name].empty);
    out[name] = Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0;
  }
  return out;
}

export function exportAll() {
  const data = { app: "aktientool", version: 1, exported: now() };
  for (const [name, s] of Object.entries(SECTIONS)) data[name] = read(name, s.empty);
  return data;
}

// Prüft einen Bereich wie beim Anlegen; Ungültiges führt zu einer Meldung statt kaputter Daten
function cleanSection(name, value) {
  const s = SECTIONS[name];
  if (Array.isArray(s.empty) !== Array.isArray(value) || !value || typeof value !== "object") {
    throw new StoreError(`${s.label}: unerwartetes Format`);
  }
  if (name === "watchlist") return [...new Set(value.map((x) => symbol(x)))];
  if (name === "watchgruppen") return cleanWatchGroups(value);
  if (name === "depot") {
    return value.map((p, i) => {
      try {
        const item = lot(p.symbol, p);
        if (ID_RE.test(String(p.id ?? ""))) item.id = String(p.id);
        if (p.currency !== "EUR") delete item.currency;
        return item;
      } catch (e) { throw new StoreError(`Depot, Eintrag ${i + 1}: ${e.message}`); }
    });
  }
  if (name === "alarme") {
    const out = [];
    for (const [i, a] of value.entries()) {
      try {
        const id = ID_RE.test(String(a.id ?? "")) ? String(a.id) : newId();
        const keys = ["type", "value", "created", "triggered", "message", "seen", "baseline", "currency", "baseline_eur"];
        if (!(a.type in ALERT_TYPES)) throw new StoreError("Unbekannte Art von Alarm");
        const item = { id, symbol: symbol(a.symbol) };
        for (const k of keys) item[k] = a[k] ?? null;
        if (item.value !== null) item.value = number(item.value, "Schwelle", item.type !== "below_fair");
        if (item.seen === null) item.seen = true;
        out.push(item);
      } catch (e) { throw new StoreError(`Alarme, Eintrag ${i + 1}: ${e.message}`); }
    }
    return out;
  }
  if (name === "notizen") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const t = String((v && typeof v === "object" ? v.text : v) ?? "").trim().slice(0, 20000);
      if (t) out[symbol(k)] = { text: t, updated: (v && v.updated) || now() };
    }
    return out;
  }
  if (name === "handelbar") {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (typeof v === "boolean") out[symbol(k)] = v;
    return out;
  }
  if (name === "holdings") {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v && typeof v === "object") out[symbol(k)] = v;
    return out;
  }
  return value;
}

// Liest eine Sicherung (eine Datei aus „Exportieren“) oder Dateien aus dem Datenordner der lokalen Fassung
// (watchlist.json, depot.json, notizen.json, alarme.json, handelbar.json, holdings.json, watchgruppen.json).
// Gibt {Bereich: bereinigter Inhalt} zurück, ohne etwas zu speichern.
export function parseImport(files) {
  const found = {};
  for (const { name, content } of files) {
    let data;
    try { data = JSON.parse(content); } catch (e) { throw new StoreError(`${name}: keine gültige JSON-Datei`); }
    if (data && typeof data === "object" && !Array.isArray(data) && data.app === "aktientool") {
      for (const key of Object.keys(SECTIONS)) if (data[key] !== undefined) found[key] = cleanSection(key, data[key]);
      continue;
    }
    const base = name.split(/[\\/]/).pop().toLowerCase();
    const key = Object.keys(SECTIONS).find((k) => SECTIONS[k].file === base);
    if (!key) throw new StoreError(`${name}: unbekannte Datei. Erwartet wird eine Sicherung aus „Exportieren“ oder z. B. depot.json.`);
    found[key] = cleanSection(key, data);
  }
  return found;
}

export function applyImport(sections, mode = "replace") {
  for (const [name, value] of Object.entries(sections)) {
    if (mode === "merge") {
      const cur = read(name, SECTIONS[name].empty);
      if (name === "watchlist") write(name, [...new Set([...cur, ...value])]);
      else if (Array.isArray(value)) {
        const have = new Set(cur.map((x) => x.id));
        const merged = [...cur, ...value.filter((x) => !have.has(x.id))];
        write(name, name === "watchgruppen" ? cleanWatchGroups(merged) : merged);
      } else write(name, { ...cur, ...value });
    } else {
      write(name, value);
    }
  }
}

export function clearAll() {
  for (const name of [...Object.keys(SECTIONS), "alarmstatus"]) {
    memory.delete(name);
    try { localStorage.removeItem(PREFIX + name); } catch (e) { /* nichts gespeichert */ }
  }
  document.dispatchEvent(new CustomEvent("store-changed", { detail: { name: "*" } }));
}
