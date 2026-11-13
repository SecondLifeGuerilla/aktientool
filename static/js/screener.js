// Screener und Watchlist: Kennzahlen für eine Liste von Aktien laden, filtern und sortieren
import { api, getWatchlist, setWatchMany, toggleWatch } from "./api.js";
import { trackBrowse } from "./browse.js";
import { NOT_TR_TAG } from "./broker.js";
import { csvNum, downloadCsv, today } from "./csv.js";
import * as F from "./format.js";
import { term } from "./glossary.js";
import { isBasic } from "./mode.js";
import { toast } from "./toast.js";
import { flipWatch } from "./watch.js";
import { childrenOf, clone, flatten, getGroups, groupsOf, openAssign, openManage, pathLabel, saveGroups, saveWithUndo, symbolsIn, topAncestor, ungrouped,
  descendantIds } from "./watchgroups.js";
import { mergeGroups, parseWatchCsv } from "./watchimport.js";
import { presetHref } from "./world.js";

const esc = F.escapeHtml;
const CONCURRENCY = 3;
const CUSTOM = "Eigene Liste";
const STRATEGIES = [["earnings_growth", "Gewinnwachstum"], ["dividend_growth", "Dividendenwachstum"], ["dividend_income", "Dividendenertrag"]];

// basic: Spalte bzw. Filter gibt es auch in der Basis-Ansicht
const COLUMNS = [
  { key: "pick", label: "", basic: true, get: () => null },
  { key: "name", label: "Aktie", basic: true, get: (r) => r.name?.toLowerCase() },
  { key: "country", label: "Land", get: (r) => r.country },
  { key: "market_cap", label: "Börsenwert", term: "boersenwert", basic: true, get: (r) => r.market_cap },
  { key: "earnings_stability", label: "Gewinn­stabilität", term: "gewinnstabilitaet", basic: true, get: (r) => r.earnings_stability },
  { key: "earnings_growth", label: "Gewinn­wachstum p. a.", term: "wachstum_pa", basic: true, get: (r) => r.earnings_growth },
  { key: "div_yield", label: "Div.-Rendite", term: "dividendenrendite", basic: true, get: (r) => r.div_yield },
  { key: "div_growth", label: "Div.-Wachstum p. a.", term: "dividendenwachstum", get: (r) => r.div_growth },
  { key: "payout", label: "Ausschüttung", term: "ausschuettungsquote", get: (r) => r.payout },
  { key: "debt_years", label: "Tilgungs­jahre", term: "tilgungsjahre", get: (r) => (r.debt_infinite ? Infinity : r.debt_years) },
  { key: "momentum", label: "Momentum", term: "momentum", get: (r) => r.momentum },
  { key: "deviation", label: "Kurs vs. fairer Wert", term: "fairer_wert", basic: true, get: (r) => r.deviation },
  // sortiert nach der vorsichtigen Variante (ohne Bewertungsaufholung), angezeigt wird die Spanne bis zum Modellwert
  { key: "expected_return", label: "Erw. Rendite p. a.", term: "erwartete_rendite", basic: true, get: (r) => r.expected_cautious ?? r.expected_return },
  { key: "piotroski", label: "Piotroski", term: "piotroski", get: (r) => r.piotroski },
  { key: "score", label: "Scores", term: "scorecard", get: (r, s) => r.scores?.[s.strategy] },
  { key: "watch", label: "", basic: true, get: () => null },
];

const FILTERS = [
  { id: "f-stab", label: "Gewinnstabilität ab", placeholder: "z. B. 0,8", basic: true, test: (r, v) => (r.earnings_stability ?? -9) >= v },
  { id: "f-growth", label: "Gewinnwachstum ab %", placeholder: "z. B. 5", pct: true, basic: true, test: (r, v) => (r.earnings_growth ?? -9) >= v },
  { id: "f-yield", label: "Div.-Rendite ab %", placeholder: "z. B. 2", pct: true, basic: true, test: (r, v) => (r.div_yield ?? 0) >= v },
  { id: "f-payout", label: "Ausschüttung bis %", placeholder: "z. B. 70", pct: true, test: (r, v) => r.payout == null || r.payout <= v },
  { id: "f-debt", label: "Tilgungsjahre bis", placeholder: "z. B. 4", test: (r, v) => !r.debt_infinite && (r.debt_years == null || r.debt_years <= v) },
  { id: "f-score", label: "Score ab", placeholder: "1–10", test: (r, v, s) => (r.scores?.[s.strategy] ?? 0) >= v },
];

function parseNum(s) {
  if (s == null || String(s).trim() === "") return null;
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Leere Watchlist: Wege zu den ersten Kandidaten
function emptyWatchlist() {
  return `Die Watchlist ist leer. Merken Sie sich Kandidaten mit ☆ in der Weltauswahl oder mit „Zur Watchlist“ im Aktienprofil. Gute Startpunkte:
    <div class="preset-row" style="margin:8px 0 4px">${["Kauf-Checkliste", "Stabil & unterbewertet", "Hohe erwartete Rendite", "Dividenden-Aristokraten"]
      .map((n) => `<a class="btn" href="${esc(presetHref(n))}">${esc(n)}</a>`).join("")}</div>`;
}

// Watchlist-Gruppen: gewählte Gruppe, Gliederung und eingeklappte Abschnitte merkt sich der Browser (nur Komfort)
const NONE = "_ohne";
function readPref(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* nur Komfort */ }
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
  let presets, watch, groups = [];
  const isWatch = listName === "Watchlist";
  try {
    [presets, watch, groups] = await Promise.all([api.presets(), getWatchlist(), isWatch ? getGroups() : []]);
  } catch (e) {
    if (isCurrent()) root.innerHTML = `<div class="error-block">${esc(e.message)}</div>`;
    return;
  }
  if (!isCurrent()) return;
  const basic = isBasic();
  const cols = basic ? COLUMNS.filter((c) => c.basic) : COLUMNS;
  const filters = basic ? FILTERS.filter((f) => f.basic) : FILTERS;
  document.title = `${isWatch ? "Watchlist" : "Screener"} – Aktientool`;
  const lists = ["Watchlist", ...Object.keys(presets), CUSTOM];
  if (!lists.includes(listName)) listName = "Watchlist";

  root.innerHTML = `
    <h1>${isWatch ? "Watchlist" : "Screener"}</h1>
    <p class="secondary" style="max-width:860px;margin-top:6px">
      ${isWatch ? "Ihre gemerkten Aktien mit den wichtigsten Kennzahlen. Aktien fügen Sie im Profil über „Zur Watchlist“ hinzu oder übernehmen sie unten aus einer CSV-Datei." :
        "Wählen Sie eine Liste, laden Sie die Kennzahlen und filtern Sie nach Qualität, Dividende und Bewertung. Zum Sortieren auf eine Spaltenüberschrift klicken."}
      <span class="hide-phone">Bereits geladene Aktien kommen aus dem lokalen Cache (6 Stunden gültig).
      Für US-Firmen und Firmen mit SEC-Berichten (z. B. SAP) gibt es 10+ Jahre Bilanzdaten, für andere nur rund 4 Jahre (markiert mit „(4 J.)“).</span></p>
    <div class="card phone-filters" style="margin-top:14px">
      <div class="filters">
        <div class="field"><label for="list-select">Liste</label>
          <select id="list-select">${lists.map((l) => `<option ${l === listName ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
        <button class="btn pf-toggle" id="pf-toggle" type="button" aria-expanded="false">Filter ▾</button>
        ${basic ? "" : `<div class="field pf"><label for="strategy-select">${term("scorecard", "Score-Strategie")}</label>
          <select id="strategy-select">${STRATEGIES.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>`}
        ${filters.map((f) => `<div class="field pf"><label for="${f.id}">${f.label}</label><input id="${f.id}" inputmode="decimal" placeholder="${f.placeholder}"></div>`).join("")}
        <div class="field pf"><label for="f-val">Bewertung</label>
          <select id="f-val"><option value="">alle</option><option value="0.1">höchstens fair (bis +10 %)</option><option value="-0.1">unterbewertet (unter −10 %)</option></select></div>
        <button class="btn pf" id="reset-btn" type="button">Filter zurücksetzen</button>
        <button class="btn pf" id="csv-btn" type="button" title="Die angezeigten Zeilen mit allen geladenen Kennzahlen als CSV-Datei (für Excel & Co.)">CSV</button>
        <div class="field" id="custom-field" style="flex-basis:100%" ${listName === CUSTOM ? "" : "hidden"}>
          <label for="custom-input">Ticker, getrennt durch Komma oder Leerzeichen (Yahoo-Schreibweise, z. B. ALV.DE, NESN.SW, ULVR.L)</label>
          <textarea id="custom-input" placeholder="AAPL, MSFT, ALV.DE">${esc(customText)}</textarea>
          <div><button class="btn primary" id="custom-load" type="button" style="margin-top:6px">Liste laden</button></div>
        </div>
      </div>
      <div class="progress"><div id="progress-bar"></div></div>
      <div class="muted" id="status-line" style="margin-top:6px;font-size:13px"></div>
    </div>
    ${isWatch ? `<div class="card grp-bar" id="grp-bar" style="margin-top:12px"></div>
    <details class="card import-box" id="wimp-box" style="margin-top:12px"><summary>Aktien aus einer Tabelle übernehmen (CSV)</summary>
      <p class="secondary" style="font-size:14px;margin:10px 0 8px">Eine Zeile je Aktie: <b>Ticker; Gruppe</b> – die Gruppe darf fehlen.
        Untergruppen mit „›“ oder „&gt;“ (z. B. <i>Zukunftsmärkte › KI</i>), mehrere Gruppen mit „|“. Mit Kopfzeile wird die Spalte „Ticker“ bzw. „Gruppe“
        erkannt, auch in einem CSV-Export der Watchlist. Getrennt durch Semikolon, Komma oder Tab. Vorhandene Aktien und Gruppen bleiben.</p>
      <textarea id="wimp-text" spellcheck="false" placeholder="Ticker;Gruppe&#10;NVDA;Zukunftsmärkte › KI&#10;ALV.DE;Dividende"></textarea>
      <div class="toolbar" style="margin:8px 0 0"><label class="btn small" style="cursor:pointer">Datei wählen …<input type="file" id="wimp-file" accept=".csv,.txt,text/csv,text/plain" hidden></label>
        <button class="btn small primary" type="button" id="wimp-go" disabled>Importieren</button><span class="import-preview" id="wimp-preview"></span></div>
    </details>` : ""}
    <div class="card table-scroll" style="margin-top:12px;padding:8px 8px 4px">
      <table class="data screener">
        <thead><tr>${cols.map((c) => (c.key === "pick"
          ? '<th class="pick" scope="col"><input type="checkbox" id="pick-all" title="Alle angezeigten Zeilen auswählen" aria-label="Alle angezeigten Zeilen auswählen"></th>'
          : `<th data-key="${c.key}" scope="col">${c.term ? term(c.term, c.label) : c.label}</th>`)).join("")}</tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <div class="select-bar" id="select-bar" hidden></div>`;

  const state = { strategy: "earnings_growth", sortKey: basic ? "expected_return" : "score", sortDir: -1, rows: new Map(), symbols: [],
    group: readPref("watchGroup", ""), outline: readPref("watchOutline", true), collapsed: new Set(readPref("watchGroupsCollapsed", [])) };
  const $ = (sel) => root.querySelector(sel);
  const groupExists = (id) => !id || id === NONE || groups.some((g) => g.id === id);
  if (!groupExists(state.group)) state.group = "";
  const groupName = (id) => (id === NONE ? "Ohne Gruppe" : pathLabel(groups, id));
  // Ticker der gewählten Gruppe (samt Untergruppen) oder null für alle
  const groupSet = () => (!isWatch || !state.group ? null : state.group === NONE ? new Set(ungrouped(groups, watch)) : symbolsIn(groups, state.group, watch));

  const symbolsFor = (name) => (name === "Watchlist" ? [...watch] : name === CUSTOM ? parseTickers($("#custom-input").value) : presets[name] || []);

  function filtered() {
    const vals = filters.map((f) => {
      const n = parseNum($(`#${f.id}`).value);
      return n == null ? null : f.pct ? n / 100 : n;
    });
    const val = parseNum($("#f-val").value);
    const only = groupSet();
    return state.symbols.filter((s) => !only || only.has(s)).map((s) => state.rows.get(s)).filter((row) => {
      if (row.status !== "ok") return true;
      const r = row.data;
      if (filters.some((f, i) => vals[i] != null && !f.test(r, vals[i], state))) return false;
      if (val != null && !(r.deviation != null && r.deviation <= val)) return false;
      return true;
    });
  }

  function cell(c, r) {
    switch (c.key) {
      case "pick": return `<td class="pick"><input type="checkbox" data-pick="${esc(r.symbol)}" ${picked.has(r.symbol) ? "checked" : ""} aria-label="${esc(r.name)} auswählen"></td>`;
      case "name": {
        const tags = r.tr === false ? [NOT_TR_TAG] : [];
        if (isWatch) {
          const gs = groupsOf(groups, r.symbol);
          tags.push(...gs.map((g) => `<button type="button" class="tag grp" data-group="${esc(g.id)}" title="Nur diese Gruppe zeigen">${esc(pathLabel(groups, g.id))}</button>`),
            `<button type="button" class="linklike grp-add" data-assign="${esc(r.symbol)}">${gs.length ? "Gruppen ändern" : "+ Gruppe"}</button>`);
        }
        return `<td class="name"><a href="#/aktie/${encodeURIComponent(r.symbol)}">${esc(r.name)}</a><span class="sym">${esc(r.symbol)}</span>${
          tags.length ? `<div class="tags">${tags.join("")}</div>` : ""}</td>`;
      }
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
      case "expected_return": {
        const hi = r.expected_return;
        const lo = r.expected_cautious;
        const range = F.isNum(lo) && F.isNum(hi) && Math.abs(hi - lo) >= 0.005;
        const worst = range ? Math.min(lo, hi) : hi;
        const trap = r.value_trap ? ' <span class="badge serious" title="Wirkt günstig, hat aber mindestens zwei Warnzeichen: Wachstumsbruch, fallende Schätzungen oder gebrochener Kurstrend">Value-Falle?</span>' : "";
        return `<td class="${(worst ?? 0) >= 0.08 ? "good" : (worst ?? 0) < 0 ? "bad" : ""}"${range ? ' title="vorsichtig gerechnet bis Modell"' : ""}>${
          range ? `${F.signedPct(Math.min(lo, hi), 1)} bis ${F.signedPct(Math.max(lo, hi), 1)}` : F.signedPct(hi, 1)}${trap}</td>`;
      }
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
    shownOk = ok.map((x) => x.data);
    const rowHtml = (x) => `<tr${picked.has(x.data.symbol) ? ' class="picked"' : ""}>${cols.map((c) => cell(c, x.data)).join("")}</tr>`;
    const html = outlined() ? sectionsHtml(ok, rowHtml) : ok.map(rowHtml);
    for (const x of rest) {
      const cls = x.status === "error" ? "failed" : "loading";
      const msg = x.status === "error" ? esc(x.error) : "wird geladen …";
      html.push(`<tr class="${cls}"><td class="name">${esc(x.symbol)}</td><td colspan="${cols.length - 1}" style="text-align:left">${msg}</td></tr>`);
    }
    const only = groupSet();
    $("#rows").innerHTML = html.join("") || `<tr><td colspan="${cols.length}" style="text-align:left;white-space:normal" class="muted">${
      !state.symbols.length ? (isWatch ? emptyWatchlist() : "Die Liste ist leer.")
        : only && !only.size ? (state.group === NONE ? "Alle Aktien der Watchlist stehen in mindestens einer Gruppe."
          : `In „${esc(groupName(state.group))}“ stehen noch keine Aktien. Wählen Sie unter „Alle“ Aktien aus (Häkchen vorn) und teilen Sie sie
            mit „In Gruppe einteilen …“ ein, oder klicken Sie in einer Zeile auf „+ Gruppe“.`)
        : "Keine Aktie erfüllt alle Filter."}</td></tr>`;
    root.querySelectorAll("th[data-key]").forEach((th) => {
      th.setAttribute("aria-sort", th.dataset.key === state.sortKey ? (state.sortDir > 0 ? "ascending" : "descending") : "none");
    });
    const done = state.symbols.filter((s) => state.rows.get(s).status !== "loading").length;
    const failed = state.symbols.filter((s) => state.rows.get(s).status === "error").length;
    $("#progress-bar").style.width = state.symbols.length ? `${(done / state.symbols.length) * 100}%` : "0";
    $("#status-line").textContent = state.symbols.length
      ? `${done} von ${state.symbols.length} geladen${failed ? `, ${failed} fehlgeschlagen` : ""} · ${ok.length} angezeigt`
      : "";
    $("#pick-all").checked = shownOk.length > 0 && shownOk.every((r) => picked.has(r.symbol));
    paintSelect();
  }

  // ---- Gruppen: Leiste oberhalb der Tabelle und gegliederte Anzeige mit Zwischenüberschriften
  const outlined = () => isWatch && state.outline && groups.length > 0 && state.group !== NONE;

  // ok: sortierte Zeilen; eine Aktie in mehreren Gruppen erscheint in jedem ihrer Abschnitte
  function sectionsHtml(ok, rowHtml) {
    const shown = new Set(ok.map((x) => x.data.symbol));
    const list = state.group
      ? [{ g: groups.find((g) => g.id === state.group), depth: 0 }, ...flatten(groups, state.group).map(({ g, depth }) => ({ g, depth: depth + 1 }))]
      : flatten(groups);
    const out = [];
    const hiddenBelow = new Set(); // Ids eingeklappter Gruppen samt Untergruppen
    const head = (id, label, depth, n, own) => {
      const open = !state.collapsed.has(id);
      return `<tr class="grp-head" style="--d:${depth}"><td colspan="${cols.length}"><button type="button" class="grp-toggle" data-collapse="${esc(id)}"
        aria-expanded="${open}" title="${open ? "Einklappen" : "Ausklappen"}">${open ? "▾" : "▸"}</button><b>${esc(label)}</b>
        <span class="muted">${F.int(n)} ${n === 1 ? "Aktie" : "Aktien"}${own != null && own !== n ? `, davon ${F.int(own)} direkt` : ""}</span>
        ${id !== NONE && id !== state.group ? `<button type="button" class="linklike" data-group="${esc(id)}">nur diese zeigen</button>` : ""}</td></tr>`;
    };
    for (const { g, depth } of list) {
      if (hiddenBelow.has(g.id)) continue;
      const total = [...symbolsIn(groups, g.id, watch)].filter((s) => shown.has(s)).length;
      if (!total) continue;
      const direct = ok.filter((x) => g.symbols.includes(x.data.symbol));
      out.push(head(g.id, g.name, depth, total, direct.length));
      if (state.collapsed.has(g.id)) { descendantIds(groups, g.id).forEach((id) => hiddenBelow.add(id)); continue; }
      out.push(...direct.map(rowHtml));
    }
    if (!state.group) {
      const loose = new Set(ungrouped(groups, watch));
      const rest = ok.filter((x) => loose.has(x.data.symbol));
      if (rest.length) {
        out.push(head(NONE, "Ohne Gruppe", 0, rest.length, null));
        if (!state.collapsed.has(NONE)) out.push(...rest.map(rowHtml));
      }
    }
    return out;
  }

  function paintGroupBar() {
    if (!isWatch) return;
    const chip = (val, label, n, title = "") => `<button type="button" class="btn small grp-chip" data-group="${esc(val)}" aria-pressed="${state.group === val}"
      ${title ? `title="${esc(title)}"` : ""}>${esc(label)} <span class="grp-n">${F.int(n)}</span></button>`;
    const top = state.group && state.group !== NONE ? topAncestor(groups, state.group) : null;
    const subs = top ? flatten(groups, top.id) : [];
    $("#grp-bar").innerHTML = `
      <div class="grp-row">
        <span class="field-label">Gruppen</span>
        ${chip("", "Alle", watch.size)}
        ${childrenOf(groups, null).map((g) => chip(g.id, g.name, symbolsIn(groups, g.id, watch).size)).join("")}
        ${groups.length ? chip(NONE, "Ohne Gruppe", ungrouped(groups, watch).length, "Aktien, die noch in keiner Gruppe stehen") : ""}
        <span class="grp-spacer"></span>
        ${groups.length ? `<label class="grp-outline" title="Tabelle mit Zwischenüberschriften je Gruppe und Untergruppe"><input type="checkbox" id="grp-outline"
          ${state.outline ? "checked" : ""}> nach Gruppen gliedern</label>` : ""}
        <button type="button" class="btn small" id="grp-manage">${groups.length ? "Gruppen verwalten" : "Gruppen anlegen"}</button>
      </div>
      ${subs.length ? `<div class="grp-row sub"><span class="field-label">${esc(top.name)} ›</span>${subs.map(({ g, depth }) =>
        chip(g.id, `${"› ".repeat(depth)}${g.name}`, symbolsIn(groups, g.id, watch).size)).join("")}</div>` : ""}
      ${groups.length ? "" : `<p class="muted grp-hint">Viele Aktien im Blick? Teilen Sie sie in Gruppen und Untergruppen ein: frei benannt, aus Vorlagen
        (etwa Kaufkandidaten, Dividende, Wachstum) oder automatisch nach Sektor und Branche, Land, Bewertung, Dividende oder Größe.</p>`}`;
  }

  function setGroup(id) {
    state.group = groupExists(id) ? id : "";
    savePref("watchGroup", state.group);
    paintGroupBar();
    paint();
  }

  // ---- Mehrfachauswahl: vergleichen, von der Watchlist nehmen bzw. auf die Watchlist setzen
  const picked = new Set();
  let shownOk = [];
  function paintSelect() {
    const bar = $("#select-bar");
    const n = picked.size;
    bar.hidden = n === 0;
    if (!n) return;
    const canCompare = n >= 2 && n <= 4;
    bar.innerHTML = `<b>${F.int(n)} ausgewählt</b>
      <button class="btn small primary" type="button" data-act="compare" ${canCompare ? "" : "disabled"}
        title="${canCompare ? "Die ausgewählten Aktien nebeneinander vergleichen" : "Zum Vergleichen 2 bis 4 Aktien auswählen"}">Vergleichen</button>
      ${isWatch ? `<button class="btn small" type="button" data-act="group">In Gruppe einteilen …</button>
        ${state.group && state.group !== NONE ? `<button class="btn small" type="button" data-act="ungroup">Aus „${esc(groupName(state.group))}“ nehmen</button>` : ""}
        <button class="btn small" type="button" data-act="unwatch">Von der Watchlist nehmen</button>`
        : '<button class="btn small" type="button" data-act="watch">Auf die Watchlist</button>'}
      <button class="linklike" type="button" data-act="clear">Auswahl aufheben</button>`;
  }

  // ---- CSV: angezeigte Zeilen in der angezeigten Reihenfolge, Prozentwerte als Zahl
  function exportCsv() {
    const pct = (v) => csvNum(F.isNum(v) ? v * 100 : null, 2);
    const header = ["Name", "Ticker", "Land", "Währung", "Börsenwert", "Gewinnstabilität", "Gewinnwachstum p. a. (%)", "Div.-Rendite (%)",
      "Div.-Wachstum p. a. (%)", "Ausschüttung (%)", "Tilgungsjahre", "Momentum (%)", "Kurs vs. fairer Wert (%)", "Erw. Rendite p. a. (%)",
      "Erw. Rendite vorsichtig (%)", "Warnzeichen", "Piotroski", ...STRATEGIES.map(([, l]) => `Score ${l}`), "Geschäftsjahre", ...(isWatch ? ["Gruppen"] : [])];
    const rows = shownOk.map((r) => [r.name, r.symbol, r.country || "", r.currency || "", csvNum(r.market_cap, 0), csvNum(r.earnings_stability, 3),
      pct(r.earnings_growth), pct(r.div_yield), pct(r.div_growth), pct(r.payout), r.debt_infinite ? "unendlich" : csvNum(r.debt_years, 2),
      pct(r.momentum), pct(r.deviation), pct(r.expected_return), pct(r.expected_cautious), r.warning_signs ?? "", r.piotroski ?? "", ...STRATEGIES.map(([k]) => r.scores?.[k] ?? ""),
      r.fundamental_points ?? "", ...(isWatch ? [groupsOf(groups, r.symbol).map((g) => pathLabel(groups, g.id)).join("; ")] : [])]);
    if (!rows.length) { toast("Noch keine Zeilen geladen."); return; }
    downloadCsv(`${isWatch ? "watchlist" : `screener-${listName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}-${today()}.csv`, header, rows);
    toast(`${F.int(rows.length)} Zeilen als CSV gespeichert (Ordner „Downloads“).`, { kind: "good" });
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
  $("#strategy-select")?.addEventListener("change", (e) => { state.strategy = e.target.value; paint(); });
  root.querySelectorAll(".filters input, #f-val").forEach((el) => el.addEventListener("input", paint));
  // Handy: Filterfelder eingeklappt, damit die Liste gleich sichtbar ist
  $("#pf-toggle").addEventListener("click", (e) => {
    const open = e.currentTarget.closest(".phone-filters").classList.toggle("pf-open");
    e.currentTarget.setAttribute("aria-expanded", String(open));
    e.currentTarget.textContent = open ? "Filter ▴" : "Filter ▾";
  });
  $("#reset-btn").addEventListener("click", () => {
    root.querySelectorAll(".filters input").forEach((el) => { el.value = ""; });
    $("#f-val").value = "";
    paint();
  });
  $("#custom-load")?.addEventListener("click", () => { saveCustom($("#custom-input").value); load(symbolsFor(CUSTOM)); });
  root.querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-key]");
    if (!th || th.dataset.key === "watch" || th.dataset.key === "pick") return;
    if (state.sortKey === th.dataset.key) state.sortDir *= -1;
    else { state.sortKey = th.dataset.key; state.sortDir = th.dataset.key === "name" || th.dataset.key === "country" || th.dataset.key === "debt_years" ? 1 : -1; }
    paint();
  });
  $("#rows").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-watch]");
    if (!b) return;
    b.disabled = true;
    const sym = b.dataset.watch;
    try {
      await flipWatch(sym, state.rows.get(sym)?.data?.name, async () => { watch = await getWatchlist(); if (isCurrent()) { paintGroupBar(); paint(); } });
    } catch (err) { toast(err.message, { kind: "bad" }); b.disabled = false; }
  });
  $("#rows").addEventListener("change", (e) => {
    const cb = e.target.closest("input[data-pick]");
    if (!cb) return;
    if (cb.checked) picked.add(cb.dataset.pick); else picked.delete(cb.dataset.pick);
    if (outlined()) { paint(); return; } // dieselbe Aktie kann in mehreren Abschnitten stehen
    cb.closest("tr").classList.toggle("picked", cb.checked);
    $("#pick-all").checked = shownOk.length > 0 && shownOk.every((r) => picked.has(r.symbol));
    paintSelect();
  });
  $("#pick-all").addEventListener("change", (e) => {
    for (const r of shownOk) { if (e.target.checked) picked.add(r.symbol); else picked.delete(r.symbol); }
    paint();
  });
  $("#select-bar").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const syms = [...picked];
    const act = b.dataset.act;
    if (act === "clear") { picked.clear(); paint(); return; }
    if (act === "compare") { location.hash = `#/vergleich?s=${encodeURIComponent(syms.join(","))}`; return; }
    if (act === "group") {
      const one = syms.length === 1 ? state.rows.get(syms[0])?.data?.name || syms[0] : null;
      await openAssign(syms, one ? `Gruppen für ${one}` : `${F.int(syms.length)} Aktien in Gruppen einteilen`);
      return;
    }
    if (act === "ungroup") {
      const ids = new Set(descendantIds(groups, state.group));
      const next = clone(groups);
      for (const g of next) if (ids.has(g.id)) g.symbols = g.symbols.filter((s) => !picked.has(s));
      const label = groupName(state.group);
      try { await saveWithUndo(clone(groups), next, `${F.int(syms.length)} ${syms.length === 1 ? "Aktie" : "Aktien"} aus „${label}“ genommen.`, null); }
      catch (err) { toast(err.message, { kind: "bad" }); }
      return;
    }
    // auf die Watchlist bzw. herunter: nur die, bei denen sich etwas ändert; „Rückgängig“ dreht genau diese zurück
    const change = syms.filter((s) => (act === "watch" ? !watch.has(s) : watch.has(s)));
    if (!change.length) { toast(act === "watch" ? "Alle ausgewählten Aktien stehen schon auf der Watchlist." : "Keine der ausgewählten Aktien steht auf der Watchlist."); return; }
    b.disabled = true;
    try { for (const s of change) await toggleWatch(s); } catch (err) { toast(err.message, { kind: "bad" }); }
    watch = await getWatchlist();
    paintGroupBar();
    if (act === "unwatch") {
      for (const s of change) picked.delete(s);
      // die Watchlist-Seite zeigt nur gemerkte Aktien: entfernte Zeilen verschwinden sofort
      state.symbols = state.symbols.filter((s) => watch.has(s));
    }
    if (isCurrent()) paint();
    const n = change.length;
    toast(`${F.int(n)} ${n === 1 ? "Aktie" : "Aktien"} ${act === "watch" ? "auf die Watchlist gesetzt" : "von der Watchlist genommen"}.`, {
      kind: act === "watch" ? "good" : "",
      action: "Rückgängig",
      onAction: async () => {
        for (const s of change) await toggleWatch(s);
        watch = await getWatchlist();
        if (isCurrent()) paintGroupBar();
        if (act === "unwatch" && isCurrent()) { load([...watch]); return; }
        if (isCurrent()) paint();
      },
    });
  });
  $("#csv-btn").addEventListener("click", exportCsv);
  trackBrowse($("#rows"), () => (isWatch ? `Watchlist${state.group ? `: ${groupName(state.group)}` : ""}` : `Screener: ${listName}`),
    () => shownOk.map((r) => [r.symbol, r.name]));

  if (isWatch) {
    // Gruppen wählen (Leiste, Schlagwort in der Zeile, Zwischenüberschrift), einklappen, zuordnen, verwalten
    const onGroupClick = async (e) => {
      const pick = e.target.closest("[data-group]");
      if (pick) { setGroup(pick.dataset.group); return; }
      const fold = e.target.closest("[data-collapse]");
      if (fold) {
        const id = fold.dataset.collapse;
        if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
        savePref("watchGroupsCollapsed", [...state.collapsed]);
        paint();
        return;
      }
      const assign = e.target.closest("[data-assign]");
      if (assign) {
        const sym = assign.dataset.assign;
        await openAssign([sym], `Gruppen für ${state.rows.get(sym)?.data?.name || sym}`);
        return;
      }
      if (e.target.closest("#grp-manage")) await openManage(state.symbols.map((s) => state.rows.get(s)).filter((x) => x?.status === "ok").map((x) => x.data), watch);
    };
    // an die Elemente der Seite gehängt, nicht an root: root bleibt über Seitenwechsel hinweg dasselbe Element
    $("#grp-bar").addEventListener("click", onGroupClick);
    $("#rows").addEventListener("click", onGroupClick);
    $("#grp-bar").addEventListener("change", (e) => {
      if (e.target.id !== "grp-outline") return;
      state.outline = e.target.checked;
      savePref("watchOutline", state.outline);
      paint();
    });
    // jede gespeicherte Änderung (auch „Rückgängig“ aus einer Meldung) zeichnet Leiste und Tabelle neu
    const onGroups = async () => {
      if (!isCurrent()) { document.removeEventListener("watchgroups-changed", onGroups); return; }
      groups = await getGroups();
      if (!groupExists(state.group)) state.group = "";
      paintGroupBar();
      paint();
    };
    document.addEventListener("watchgroups-changed", onGroups);
    paintGroupBar();

    // ---- CSV-Import: Vorschau beim Tippen bzw. nach Dateiwahl, dann Watchlist und Gruppen ergänzen (mit „Rückgängig“)
    let parsed = { items: [], errors: [] };
    const preview = () => {
      parsed = parseWatchCsv($("#wimp-text").value);
      const { items, errors } = parsed;
      const fresh = items.filter((it) => !watch.has(it.symbol)).length;
      $("#wimp-preview").innerHTML = !items.length && !errors.length ? ""
        : `${items.length ? `<span class="good">${F.int(items.length)} ${items.length === 1 ? "Aktie" : "Aktien"} erkannt, davon ${F.int(fresh)} neu</span>` : ""}
          ${errors.length ? `<span class="bad">${errors.length === 1 ? "" : `${errors.length} Fehler: `}${esc(errors.slice(0, 3).join(" · "))}${errors.length > 3 ? " …" : ""}</span>` : ""}`;
      $("#wimp-go").disabled = !items.length || errors.length > 0;
      $("#wimp-go").title = errors.length ? "Erst die markierten Zeilen korrigieren" : "";
    };
    const newId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    $("#wimp-text").addEventListener("input", preview);
    $("#wimp-file").addEventListener("change", async (e) => {
      if (!e.target.files[0]) return;
      $("#wimp-text").value = await e.target.files[0].text();
      e.target.value = "";
      preview();
    });
    $("#wimp-go").addEventListener("click", async () => {
      const { items } = parsed;
      if (!items.length) return;
      try {
        const prev = clone(await getGroups());
        const added = await setWatchMany(items.map((it) => it.symbol), true);
        const { groups: next, created } = mergeGroups(prev, items, newId);
        if (created || items.some((it) => it.groups.length)) await saveGroups(next);
        watch = await getWatchlist();
        $("#wimp-text").value = "";
        $("#wimp-box").open = false;
        preview();
        toast(`${F.int(added.length)} ${added.length === 1 ? "Aktie" : "Aktien"} neu auf der Watchlist${created ? `, ${F.int(created)} ${created === 1 ? "Gruppe" : "Gruppen"} angelegt` : ""}.`, {
          kind: "good", action: "Rückgängig",
          onAction: async () => {
            await saveGroups(prev);
            await setWatchMany(added, false);
            watch = await getWatchlist();
            if (isCurrent()) { paintGroupBar(); load([...watch]); }
          },
        });
        if (isCurrent()) { paintGroupBar(); load([...watch]); }
      } catch (err) { toast(err.message, { kind: "bad", ms: 8000 }); }
    });
  }

  load(symbolsFor(listName));
}
