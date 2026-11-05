// Zugriff auf die lokale API

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(method, url, payload) {
  const headers = { Accept: "application/json" };
  if (payload !== undefined) headers["Content-Type"] = "application/json";
  const resp = await fetch(url, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
  let body = null;
  try { body = await resp.json(); } catch (e) { /* kein JSON */ }
  if (!resp.ok) throw new ApiError(body?.error || `Fehler ${resp.status}`, resp.status, body);
  return body;
}

const enc = encodeURIComponent;

export const api = {
  search: (q) => request("GET", `/api/search?q=${enc(q)}`),
  profile: (sym, refresh = false) => request("GET", `/api/profile/${enc(sym)}${refresh ? "?refresh=1" : ""}`),
  outlook: (sym, isin = "") => request("GET", `/api/outlook/${enc(sym)}?isin=${enc(isin)}`),
  summary: (sym, refresh = false) => request("GET", `/api/summary/${enc(sym)}${refresh ? "?refresh=1" : ""}`),
  presets: () => request("GET", "/api/presets"),
  news: (sym, name, lang) => request("GET", `/api/news/${enc(sym)}?lang=${lang}&name=${enc(name)}`),
  wiki: (title, lang) => request("GET", `/api/wiki?title=${enc(title)}&lang=${lang}`),
  description: (sym, isin, name) => request("GET", `/api/beschreibung/${enc(sym)}?isin=${enc(isin)}&name=${enc(name)}`),
  setTradable: (sym, tradable, isin) => request("PUT", `/api/handelbar/${enc(sym)}`, { tradable, isin }),
  worldStock: (sym) => request("GET", `/api/world/stock/${enc(sym)}`),
  worldStocks: (syms) => request("GET", `/api/world/stocks?s=${enc(syms.join(","))}`),
  worldStatus: () => request("GET", "/api/world/status"),
  worldData: () => request("GET", "/api/world/data"),
  worldRefresh: () => request("POST", "/api/world/refresh"),
  watchlist: () => request("GET", "/api/watchlist"),
  watch: (sym) => request("POST", `/api/watchlist/${enc(sym)}`),
  unwatch: (sym) => request("DELETE", `/api/watchlist/${enc(sym)}`),
  watchGroups: () => request("GET", "/api/watchgruppen"),
  saveWatchGroups: (groups) => request("PUT", "/api/watchgruppen", { groups }),
  quotes: (syms) => request("GET", `/api/quotes?s=${enc(syms.join(","))}`),
  fx: (ccys) => request("GET", `/api/fx?c=${enc(ccys.join(","))}`),
  underlying: (sym) => request("GET", `/api/basiswert/${enc(sym)}`),
  derivative: (id) => request("GET", `/api/derivat/${enc(id)}`),
  derivatives: (sym, params) => request("GET", `/api/derivate/${enc(sym)}?${new URLSearchParams(params)}`),
  derivativesAll: (sym, params) => request("GET", `/api/derivate/${enc(sym)}/alle?${new URLSearchParams(params)}`),
  derivativesOverview: (sym, tr) => request("GET", `/api/derivate/${enc(sym)}/ueberblick?tr=${tr ? 1 : 0}`),
  trusts: () => request("GET", "/api/trusts"),
  trust: (sym) => request("GET", `/api/trusts/${enc(sym)}`),
  trustHistory: (sym) => request("GET", `/api/trusts/${enc(sym)}/verlauf`),
  trustSave: (sym, def) => request("PUT", `/api/trusts/holding/${enc(sym)}`, def),
  trustRemove: (sym) => request("DELETE", `/api/trusts/holding/${enc(sym)}`),
  note: (sym) => request("GET", `/api/notes/${enc(sym)}`),
  saveNote: (sym, text) => request("PUT", `/api/notes/${enc(sym)}`, { text }),
  depot: () => request("GET", "/api/depot"),
  depotAdd: (item) => request("POST", "/api/depot", item),
  depotUpdate: (id, changes) => request("PUT", `/api/depot/${enc(id)}`, changes),
  depotRestore: (item) => request("POST", "/api/depot/restore", item),
  depotImport: (items) => request("POST", "/api/depot/import", { items }),
  depotRemove: (id) => request("DELETE", `/api/depot/${enc(id)}`),
  alerts: () => request("GET", "/api/alerts"),
  alertAdd: (item) => request("POST", "/api/alerts", item),
  alertRemove: (id) => request("DELETE", `/api/alerts/${enc(id)}`),
  alertRestore: (item, index) => request("POST", "/api/alerts/restore", { ...item, index }),
  alertReset: (id) => request("POST", `/api/alerts/${enc(id)}/reset`),
  alertsSeen: () => request("POST", "/api/alerts/seen"),
  alertsCheck: () => request("POST", "/api/alerts/check"),
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
// ihre Sterne neu zeichnen (auch nach „Rückgängig“ in einer Meldung).
let watchSet = null;
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
