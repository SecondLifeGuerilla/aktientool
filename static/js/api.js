// Zugriff auf die API. Eigene Daten (Depot, Watchlist, Notizen, Alarme …) liegen im Browser (store.js); was davon in
// Berechnungen des Servers einfließt (Korrekturen zur Handelbarkeit, eigene Holdings), geht als Kontext mit.
import * as store from "./store.js";

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(method, url, payload) {
  const headers = { Accept: "application/json" };
  // GET mit Kontext: als POST mit „X-HTTP-Method-Override: GET“, der Kontext steht im Körper (siehe server.py)
  const ctx = method === "GET" ? store.context() : null;
  if (ctx) {
    method = "POST";
    headers["X-HTTP-Method-Override"] = "GET";
    payload = ctx;
  }
  if (payload !== undefined) headers["Content-Type"] = "application/json";
  let resp;
  try {
    resp = await fetch(url, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
  } catch (e) {
    throw new ApiError("Keine Verbindung zum Server. Bitte gleich noch einmal versuchen.", 0, null);
  }
  let body = null;
  try { body = await resp.json(); } catch (e) { /* kein JSON */ }
  if (!resp.ok) throw new ApiError(body?.error || `Fehler ${resp.status}`, resp.status, body);
  return body;
}

const enc = encodeURIComponent;

// Lokale Operation wie eine API-Antwort behandeln: Ergebnis als Promise, Fehler als ApiError
const local = (fn) => {
  try { return Promise.resolve(fn()); } catch (e) {
    return Promise.reject(e instanceof store.StoreError ? new ApiError(e.message, 400, null) : e);
  }
};

// Alarme prüfen: die offenen gehen zum Server, ausgelöste werden hier vermerkt (und gemeldet, falls erlaubt)
let checking = null;
async function checkAlerts() {
  if (checking) return checking;
  checking = (async () => {
    const pending = store.alertList().filter((a) => !a.triggered);
    let hits = {};
    try {
      if (pending.length) hits = (await request("POST", "/api/alerts/check", { alerts: pending })).triggered || {};
      store.setAlertState({ last_check: Date.now() / 1000, error: null });
    } catch (e) {
      store.setAlertState({ last_check: Date.now() / 1000, error: e.message });
      throw e;
    }
    const changes = {};
    for (const [id, t] of Object.entries(hits)) changes[id] = { ...t, seen: false };
    const items = Object.keys(changes).length ? store.updateAlerts(changes) : store.alertList();
    const triggered = items.filter((a) => changes[a.id]);
    if (triggered.length && store.notificationsOn()) {
      try { new Notification(`Aktientool: ${triggered.length} Alarm${triggered.length > 1 ? "e" : ""}`, { body: triggered.map((a) => a.message).join("\n").slice(0, 400) }); } catch (e) { /* ohne Mitteilung */ }
    }
    if (triggered.length) document.dispatchEvent(new CustomEvent("alerts-changed"));
    return { triggered, status: store.alertStatus() };
  })();
  try { return await checking; } finally { checking = null; }
}

// Fällige Prüfung (alle 30 Minuten, solange das Tool geöffnet ist); Fehler stehen im Status der Alarme
export function checkAlertsIfDue() {
  const last = store.alertState().last_check || 0;
  if (!store.alertList().some((a) => !a.triggered)) return;
  if (Date.now() / 1000 - last < store.ALERT_INTERVAL) return;
  checkAlerts().catch(() => {});
}

export const api = {
  search: (q) => request("GET", `/api/search?q=${enc(q)}`),
  profile: (sym, refresh = false) => request("GET", `/api/profile/${enc(sym)}${refresh ? "?refresh=1" : ""}`),
  outlook: (sym, isin = "") => request("GET", `/api/outlook/${enc(sym)}?isin=${enc(isin)}`),
  summary: (sym, refresh = false) => request("GET", `/api/summary/${enc(sym)}${refresh ? "?refresh=1" : ""}`),
  presets: () => request("GET", "/api/presets"),
  news: (sym, name, lang) => request("GET", `/api/news/${enc(sym)}?lang=${lang}&name=${enc(name)}`),
  wiki: (title, lang) => request("GET", `/api/wiki?title=${enc(title)}&lang=${lang}`),
  description: (sym, isin, name) => request("GET", `/api/beschreibung/${enc(sym)}?isin=${enc(isin)}&name=${enc(name)}`),
  setTradable: async (sym, tradable, isin) => {
    await local(() => store.setTradable(sym, tradable));
    return request("GET", `/api/handelbar/${enc(sym)}?isin=${enc(isin || "")}`);
  },
  worldStock: (sym) => request("GET", `/api/world/stock/${enc(sym)}`),
  worldStocks: (syms) => request("GET", `/api/world/stocks?s=${enc(syms.join(","))}`),
  worldStatus: () => request("GET", "/api/world/status"),
  worldData: () => request("GET", "/api/world/data"),
  worldRefresh: () => request("POST", "/api/world/refresh"),
  watchlist: () => local(() => store.watchlist()),
  watch: (sym) => local(() => store.watch(sym)),
  unwatch: (sym) => local(() => store.unwatch(sym)),
  watchGroups: () => local(() => store.watchGroups()),
  saveWatchGroups: (groups) => local(() => store.saveWatchGroups(groups)),
  quotes: (syms) => request("GET", `/api/quotes?s=${enc(syms.join(","))}`),
  live: (isins) => request("GET", `/api/live?i=${enc(isins.join(","))}`),
  fx: (ccys) => request("GET", `/api/fx?c=${enc(ccys.join(","))}`),
  underlying: (sym) => request("GET", `/api/basiswert/${enc(sym)}`),
  derivative: (id) => request("GET", `/api/derivat/${enc(id)}`),
  derivatives: (sym, params) => request("GET", `/api/derivate/${enc(sym)}?${new URLSearchParams(params)}`),
  derivativesAll: (sym, params) => request("GET", `/api/derivate/${enc(sym)}/alle?${new URLSearchParams(params)}`),
  derivativesOverview: (sym, tr) => request("GET", `/api/derivate/${enc(sym)}/ueberblick?tr=${tr ? 1 : 0}`),
  trusts: () => request("GET", "/api/trusts"),
  trust: (sym) => request("GET", `/api/trusts/${enc(sym)}`),
  trustHistory: (sym) => request("GET", `/api/trusts/${enc(sym)}/verlauf`),
  // Eigene Holding: der Server prüft und rechnet, gespeichert wird die bereinigte Fassung im Browser
  trustSave: async (sym, def) => {
    const r = await request("POST", `/api/trusts/holding/${enc(sym)}`, { definition: def, context: store.context() });
    await local(() => store.saveHolding(sym, r.definition));
    return r.detail;
  },
  trustRemove: async (sym) => {
    await local(() => store.removeHolding(sym));
    try { return await request("GET", `/api/trusts/${enc(sym)}`); } catch (e) {
      if (e.status === 404) return {};
      throw e;
    }
  },
  note: (sym) => local(() => store.note(sym)),
  saveNote: (sym, text) => local(() => store.saveNote(sym, text)),
  depot: () => local(() => store.positions()),
  depotAdd: (item) => local(() => store.addPosition(item)),
  depotUpdate: (id, changes) => local(() => store.updatePosition(id, changes)),
  depotRestore: (item) => local(() => store.restorePosition(item)),
  depotImport: (items) => local(() => store.addPositions(items)),
  depotRemove: (id) => local(() => store.removePosition(id)),
  alerts: () => local(() => ({ alerts: store.alertList(), types: store.ALERT_TYPES, status: store.alertStatus() })),
  alertAdd: async (item) => {
    let extra = {};
    if (item.type === "dividend_cut") {
      // Ausgangswert merken: ausgelöst wird, wenn die Dividende der letzten 12 Monate darunter fällt
      const sym = String(item.symbol || "").trim().toUpperCase();
      if (!sym) throw new ApiError("Ungültiges Tickersymbol.", 400, null);
      extra = await request("GET", `/api/alerts/baseline/${enc(sym)}`);
    }
    return local(() => store.addAlert(item.symbol, { ...item, ...extra }));
  },
  alertRemove: (id) => local(() => store.removeAlert(id)),
  alertRestore: (item, index) => local(() => store.restoreAlert(item, index)),
  alertReset: (id) => local(() => store.updateAlerts({ [id]: { triggered: null, message: null, seen: true } })),
  alertsSeen: () => local(() => store.updateAlerts(Object.fromEntries(store.alertList().filter((a) => a.triggered).map((a) => [a.id, { seen: true }])))),
  alertsCheck: () => checkAlerts(),
  info: () => request("GET", "/api/info"),
  deepStart: () => request("POST", "/api/deep/start"),
  deepPause: () => request("POST", "/api/deep/pause"),
  snapshots: () => request("GET", "/api/snapshots"),
  snapshotEval: (from, to, key, dir) => request("GET", `/api/snapshots/eval?from=${enc(from)}&to=${enc(to)}&key=${enc(key)}${dir ? `&dir=${dir}` : ""}`),
};

// Kennzahlen für viele Aktien nacheinander laden (Yahoo drosselt bei zu vielen parallelen Abfragen).
// onRow(symbol, {status, data|error}) wird nach jeder Aktie aufgerufen; isAlive() bricht ab, wenn die Seite gewechselt wurde.
export async function loadSummaries(symbols, onRow, isAlive = () => true, concurrency = 3) {
  const queue = [...symbols];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const worker = async () => {
    while (queue.length && isAlive()) {
      const sym = queue.shift();
      for (let attempt = 0; ; attempt++) {
        try {
          onRow(sym, { status: "ok", data: await api.summary(sym) });
          break;
        } catch (e) {
          if (e.status === 429 && attempt < 2) { await sleep(20000); continue; }
          onRow(sym, { status: "error", error: e.message });
          break;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

// Watchlist im Speicher halten, damit Sterne überall stimmen. Jede Änderung meldet „watchlist-changed“, damit Seiten
// ihre Sterne neu zeichnen (auch nach „Rückgängig“ in einer Meldung oder einer Änderung in einem anderen Tab).
let watchSet = null;
document.addEventListener("store-changed", (e) => {
  if (e.detail.name === "watchlist" || e.detail.name === "*") {
    const before = watchSet;
    watchSet = null;
    if (before && (e.detail.external || e.detail.name === "*")) document.dispatchEvent(new CustomEvent("watchlist-changed"));
  }
});
export async function getWatchlist() {
  if (!watchSet) watchSet = new Set(await api.watchlist());
  return watchSet;
}
const watchChanged = () => document.dispatchEvent(new CustomEvent("watchlist-changed"));
export async function toggleWatch(sym) {
  const set = await getWatchlist();
  const list = set.has(sym) ? await api.unwatch(sym) : await api.watch(sym);
  watchSet = new Set(list);
  watchChanged();
  return watchSet.has(sym);
}
// mehrere auf einmal merken (on = true) oder entfernen; gibt die Ticker zurück, die sich tatsächlich geändert haben
export async function setWatchMany(symbols, on) {
  const set = await getWatchlist();
  const todo = symbols.filter((s) => set.has(s) !== on);
  let list = [...set];
  for (const s of todo) list = on ? await api.watch(s) : await api.unwatch(s);
  watchSet = new Set(list);
  if (todo.length) watchChanged();
  return todo;
}
