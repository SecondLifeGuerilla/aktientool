// Screener und Watchlist: Kennzahlen für eine Liste von Aktien laden, filtern und sortieren
import { api, getWatchlist, toggleWatch } from "./api.js";
import * as F from "./format.js";
import { term } from "./glossary.js";

const esc = F.escapeHtml;
const CONCURRENCY = 3;
const CUSTOM = "Eigene Liste";
const STRATEGIES = [["earnings_growth", "Gewinnwachstum"], ["dividend_growth", "Dividendenwachstum"], ["dividend_income", "Dividendenertrag"]];

const COLUMNS = [
  { key: "name", label: "Aktie", get: (r) => r.name?.toLowerCase() },
  { key: "country", label: "Land", get: (r) => r.country },
  { key: "market_cap", label: "Börsenwert", term: "boersenwert", get: (r) => r.market_cap },
  { key: "earnings_stability", label: "Gewinn­stabilität", term: "gewinnstabilitaet", get: (r) => r.earnings_stability },
  { key: "earnings_growth", label: "Gewinn­wachstum p. a.", term: "wachstum_pa", get: (r) => r.earnings_growth },
  { key: "div_yield", label: "Div.-Rendite", term: "dividendenrendite", get: (r) => r.div_yield },
  { key: "div_growth", label: "Div.-Wachstum p. a.", term: "dividendenwachstum", get: (r) => r.div_growth },
  { key: "payout", label: "Ausschüttung", term: "ausschuettungsquote", get: (r) => r.payout },
  { key: "debt_years", label: "Tilgungs­jahre", term: "tilgungsjahre", get: (r) => (r.debt_infinite ? Infinity : r.debt_years) },
  { key: "momentum", label: "Momentum", term: "momentum", get: (r) => r.momentum },
  { key: "deviation", label: "Kurs vs. fairer Wert", term: "fairer_wert", get: (r) => r.deviation },
  { key: "expected_return", label: "Erw. Rendite p. a.", term: "erwartete_rendite", get: (r) => r.expected_return },
  { key: "piotroski", label: "Piotroski", term: "piotroski", get: (r) => r.piotroski },
  { key: "score", label: "Scores", term: "scorecard", get: (r, s) => r.scores?.[s.strategy] },
  { key: "watch", label: "", get: () => null },
];

const FILTERS = [
  { id: "f-stab", label: "Gewinnstabilität ab", placeholder: "z. B. 0,8", test: (r, v) => (r.earnings_stability ?? -9) >= v },
  { id: "f-growth", label: "Gewinnwachstum ab %", placeholder: "z. B. 5", pct: true, test: (r, v) => (r.earnings_growth ?? -9) >= v },
  { id: "f-yield", label: "Div.-Rendite ab %", placeholder: "z. B. 2", pct: true, test: (r, v) => (r.div_yield ?? 0) >= v },
  { id: "f-payout", label: "Ausschüttung bis %", placeholder: "z. B. 70", pct: true, test: (r, v) => r.payout == null || r.payout <= v },
  { id: "f-debt", label: "Tilgungsjahre bis", placeholder: "z. B. 4", test: (r, v) => !r.debt_infinite && (r.debt_years == null || r.debt_years <= v) },
  { id: "f-score", label: "Score ab", placeholder: "1–10", test: (r, v, s) => (r.scores?.[s.strategy] ?? 0) >= v },
];

function parseNum(s) {
  if (s == null || String(s).trim() === "") return null;
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function readCustom() {
  try { return localStorage.getItem("customList") || ""; } catch (e) { return ""; }
}
function saveCustom(v) {
  try { localStorage.setItem("customList", v); } catch (e) { /* nur Komfort */ }
}
const parseTickers = (s) => [...new Set(s.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];

// symbols: kommagetrennte Ticker für die eigene Liste (z. B. aus der Weltauswahl), werden sofort geladen
export async function renderScreener(root, listName, isCurrent, symbols = null) {
  let customText = readCustom();
  if (symbols) {
    listName = CUSTOM;
    customText = parseTickers(symbols).join(", ");
    saveCustom(customText);
  }
  root.innerHTML = '<div class="loading-block"><div class="spinner"></div>Lade Listen …</div>';
  let presets, watch;
  try {
    [presets, watch] = await Promise.all([api.presets(), getWatchlist()]);
  } catch (e) {
    if (isCurrent()) root.innerHTML = `<div class="error-block">${esc(e.message)}</div>`;
    return;
  }
  if (!isCurrent()) return;
  const isWatch = listName === "Watchlist";
  document.title = `${isWatch ? "Watchlist" : "Screener"} – Aktientool`;
  const lists = ["Watchlist", ...Object.keys(presets), CUSTOM];
  if (!lists.includes(listName)) listName = "Watchlist";

  root.innerHTML = `
    <h1>${isWatch ? "Watchlist" : "Screener"}</h1>
    <p class="secondary" style="max-width:860px;margin-top:6px">
      ${isWatch ? "Ihre gemerkten Aktien mit den wichtigsten Kennzahlen. Aktien fügen Sie im Profil über „Zur Watchlist“ hinzu." :
        "Wählen Sie eine Liste, laden Sie die Kennzahlen und filtern Sie nach Qualität, Dividende und Bewertung. Zum Sortieren auf eine Spaltenüberschrift klicken."}
      Bereits geladene Aktien kommen aus dem lokalen Cache (6 Stunden gültig).
      Für US-Firmen und Firmen mit SEC-Berichten (z. B. SAP) gibt es 10+ Jahre Bilanzdaten, für andere nur rund 4 Jahre (markiert mit „(4 J.)“).</p>
    <div class="card" style="margin-top:14px">
      <div class="filters">
        <div class="field"><label for="list-select">Liste</label>
          <select id="list-select">${lists.map((l) => `<option ${l === listName ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
        <div class="field"><label for="strategy-select">${term("scorecard", "Score-Strategie")}</label>
          <select id="strategy-select">${STRATEGIES.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
        ${FILTERS.map((f) => `<div class="field"><label for="${f.id}">${f.label}</label><input id="${f.id}" inputmode="decimal" placeholder="${f.placeholder}"></div>`).join("")}
        <div class="field"><label for="f-val">Bewertung</label>
          <select id="f-val"><option value="">alle</option><option value="0.1">höchstens fair (bis +10 %)</option><option value="-0.1">unterbewertet (unter −10 %)</option></select></div>
        <button class="btn" id="reset-btn" type="button">Filter zurücksetzen</button>
        <div class="field" id="custom-field" style="flex-basis:100%" ${listName === CUSTOM ? "" : "hidden"}>
          <label for="custom-input">Ticker, getrennt durch Komma oder Leerzeichen (Yahoo-Schreibweise, z. B. ALV.DE, NESN.SW, ULVR.L)</label>
          <textarea id="custom-input" placeholder="AAPL, MSFT, ALV.DE">${esc(customText)}</textarea>
          <div><button class="btn primary" id="custom-load" type="button" style="margin-top:6px">Liste laden</button></div>
        </div>
      </div>
      <div class="progress"><div id="progress-bar"></div></div>
      <div class="muted" id="status-line" style="margin-top:6px;font-size:13px"></div>
    </div>
    <div class="card table-scroll" style="margin-top:12px;padding:8px 8px 4px">
      <table class="data screener">
        <thead><tr>${COLUMNS.map((c) => `<th data-key="${c.key}" scope="col">${c.term ? term(c.term, c.label) : c.label}</th>`).join("")}</tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>`;

  const state = { strategy: "earnings_growth", sortKey: "score", sortDir: -1, rows: new Map(), symbols: [] };
  const $ = (sel) => root.querySelector(sel);

  const symbolsFor = (name) => (name === "Watchlist" ? [...watch] : name === CUSTOM ? parseTickers($("#custom-input").value) : presets[name] || []);

  function filtered() {
    const vals = FILTERS.map((f) => {
      const n = parseNum($(`#${f.id}`).value);
      return n == null ? null : f.pct ? n / 100 : n;
    });
    const val = parseNum($("#f-val").value);
    return state.symbols.map((s) => state.rows.get(s)).filter((row) => {
      if (row.status !== "ok") return true;
      const r = row.data;
      if (FILTERS.some((f, i) => vals[i] != null && !f.test(r, vals[i], state))) return false;
      if (val != null && !(r.deviation != null && r.deviation <= val)) return false;
      return true;
    });
  }

  function cell(c, r) {
    switch (c.key) {
      case "name": return `<td class="name"><a href="#/aktie/${encodeURIComponent(r.symbol)}">${esc(r.name)}</a><span class="sym">${esc(r.symbol)}</span></td>`;
      case "country": return `<td>${esc(r.country || "–")}</td>`;
      case "market_cap": return `<td>${F.big(r.market_cap, r.currency)}</td>`;
      case "earnings_stability": {
        // Kurze Historie (kostenlose Daten außerhalb der USA) sichtbar machen
        const n = r.fundamental_points;
        const short = F.isNum(n) && n < 6 ? ` <span class="muted" title="Nur ${n} Geschäftsjahre verfügbar">(${n} J.)</span>` : "";
        return `<td>${F.stability(r.earnings_stability)}${short}</td>`;
      }
      case "earnings_growth": case "div_growth": return `<td>${F.pct(r[c.key], 1)}</td>`;
      case "div_yield": return `<td>${F.pct(r.div_yield, 2)}</td>`;
      case "payout": return `<td>${F.pct(r.payout, 0)}</td>`;
      case "debt_years": return `<td>${r.debt_infinite ? "∞" : F.num(r.debt_years, 1)}</td>`;
      case "momentum": return `<td>${F.signedPct(r.momentum, 1)}</td>`;
      case "deviation": return `<td>${r.rating ? `<span class="badge ${r.rating.status}" title="${esc(r.rating.label)}">${F.signedPct(r.deviation, 0)}</span>` : "–"}</td>`;
      case "expected_return": return `<td class="${(r.expected_return ?? 0) >= 0.08 ? "good" : (r.expected_return ?? 0) < 0 ? "bad" : ""}">${F.signedPct(r.expected_return, 1)}</td>`;
      case "piotroski": return `<td>${F.isNum(r.piotroski) ? `${r.piotroski} / 9` : "–"}</td>`;
      case "score": {
        const chips = STRATEGIES.map(([k, l]) => {
          const v = r.scores?.[k];
          const cls = v >= 8 ? "hi" : v >= 6 ? "mid" : "";
          return `<span class="chip ${cls}" title="${l}: ${v ?? "–"}">${v ?? "–"}</span>`;
        });
        return `<td><span class="chips">${chips.join("")}</span></td>`;
      }
      case "watch": {
        const on = watch.has(r.symbol);
        return `<td><button class="star ${on ? "on" : ""}" data-watch="${esc(r.symbol)}" title="${on ? "Aus Watchlist entfernen" : "Zur Watchlist"}" aria-label="Watchlist">${on ? "★" : "☆"}</button></td>`;
      }
      default: return "<td></td>";
    }
  }

  function paint() {
    const col = COLUMNS.find((c) => c.key === state.sortKey);
    const list = filtered();
    const ok = list.filter((x) => x.status === "ok");
    const rest = list.filter((x) => x.status !== "ok");
    ok.sort((a, b) => {
      const va = col.get(a.data, state);
      const vb = col.get(b.data, state);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va > vb ? 1 : va < vb ? -1 : 0) * state.sortDir;
    });
    const html = ok.map((x) => `<tr>${COLUMNS.map((c) => cell(c, x.data)).join("")}</tr>`);
    for (const x of rest) {
      const cls = x.status === "error" ? "failed" : "loading";
      const msg = x.status === "error" ? esc(x.error) : "wird geladen …";
      html.push(`<tr class="${cls}"><td class="name">${esc(x.symbol)}</td><td colspan="${COLUMNS.length - 1}" style="text-align:left">${msg}</td></tr>`);
    }
    $("#rows").innerHTML = html.join("") || `<tr><td colspan="${COLUMNS.length}" style="text-align:left" class="muted">${
      state.symbols.length ? "Keine Aktie erfüllt alle Filter." : isWatch ? "Die Watchlist ist leer. Suchen Sie oben eine Aktie und fügen Sie sie im Profil hinzu." : "Die Liste ist leer."}</td></tr>`;
    root.querySelectorAll("th[data-key]").forEach((th) => {
      th.setAttribute("aria-sort", th.dataset.key === state.sortKey ? (state.sortDir > 0 ? "ascending" : "descending") : "none");
    });
    const done = state.symbols.filter((s) => state.rows.get(s).status !== "loading").length;
    const failed = state.symbols.filter((s) => state.rows.get(s).status === "error").length;
    $("#progress-bar").style.width = state.symbols.length ? `${(done / state.symbols.length) * 100}%` : "0";
    $("#status-line").textContent = state.symbols.length
      ? `${done} von ${state.symbols.length} geladen${failed ? `, ${failed} fehlgeschlagen` : ""} · ${ok.length} angezeigt`
      : "";
  }

  let loadToken = 0;
  async function load(symbols) {
    const token = ++loadToken;
    state.symbols = symbols;
    state.rows = new Map(symbols.map((s) => [s, { symbol: s, status: "loading" }]));
    paint();
    const queue = [...symbols];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const worker = async () => {
      while (queue.length) {
        if (token !== loadToken || !isCurrent()) return;
        const sym = queue.shift();
        for (let attempt = 0; ; attempt++) {
          try {
            state.rows.set(sym, { symbol: sym, status: "ok", data: await api.summary(sym) });
            break;
          } catch (e) {
            // Yahoo drosselt bei vielen Abfragen: kurz warten und erneut versuchen
            if (e.status === 429 && attempt < 2) { await sleep(20000); continue; }
            state.rows.set(sym, { symbol: sym, status: "error", error: e.message });
            break;
          }
        }
        if (token === loadToken && isCurrent()) paint();
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  $("#list-select").addEventListener("change", (e) => { location.hash = `#/screener?list=${encodeURIComponent(e.target.value)}`; });
  $("#strategy-select").addEventListener("change", (e) => { state.strategy = e.target.value; paint(); });
  root.querySelectorAll(".filters input, #f-val").forEach((el) => el.addEventListener("input", paint));
  $("#reset-btn").addEventListener("click", () => {
    root.querySelectorAll(".filters input").forEach((el) => { el.value = ""; });
    $("#f-val").value = "";
    paint();
  });
  $("#custom-load")?.addEventListener("click", () => { saveCustom($("#custom-input").value); load(symbolsFor(CUSTOM)); });
  root.querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-key]");
    if (!th || th.dataset.key === "watch") return;
    if (state.sortKey === th.dataset.key) state.sortDir *= -1;
    else { state.sortKey = th.dataset.key; state.sortDir = th.dataset.key === "name" || th.dataset.key === "country" || th.dataset.key === "debt_years" ? 1 : -1; }
    paint();
  });
  $("#rows").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-watch]");
    if (!b) return;
    b.disabled = true;
    await toggleWatch(b.dataset.watch);
    watch = await getWatchlist();
    paint();
  });

  load(symbolsFor(listName));
}
