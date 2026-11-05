// Depot: Positionen erfassen, Wert und Gewinn in Euro, Dividenden nach Steuern, Aufteilung nach Land/Sektor/Währung
import { api, loadSummaries } from "./api.js";
import { trackBrowse } from "./browse.js";
import * as C from "./charts.js";
import { csvNum, downloadCsv, parseCsv, today } from "./csv.js";
import * as F from "./format.js";
import { term } from "./glossary.js";
import { isBasic } from "./mode.js";
import { attachSearch } from "./search.js";
import { toast } from "./toast.js";

const esc = F.escapeHtml;
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const STRATEGIES = [["earnings_growth", "Gewinnwachstum"], ["dividend_growth", "Dividendenwachstum"], ["dividend_income", "Dividendenertrag"]];

export async function renderDepot(root, params, isCurrent) {
  document.title = "Depot – Aktientool";
  const preset = params.get("neu") || "";
  root.innerHTML = `
    <h1>Depot</h1>
    <p class="secondary" style="max-width:860px;margin-top:6px">Erfassen Sie Ihre Käufe mit Stückzahl und Kaufkurs in Euro (so, wie er in der
      Abrechnung Ihrer Bank steht). Das Tool zeigt Wert und Gewinn in Euro, die erwarteten Dividenden nach Quellen- und Abgeltungsteuer und
      wie sich das Depot auf Länder, Sektoren und Währungen verteilt. Die Daten bleiben lokal (data/depot.json).</p>
    <div class="card" style="margin-top:14px">
      <form class="filters" id="depot-form" autocomplete="off">
        <div class="field search" style="max-width:260px"><label for="d-symbol">Aktie (Ticker oder Name)</label>
          <input id="d-symbol" class="wide" required value="${esc(preset)}" placeholder="z. B. ALV.DE">
          <ul id="d-results" class="search-results" role="listbox" hidden></ul></div>
        <div class="field"><label for="d-shares">Stück</label><input id="d-shares" inputmode="decimal" required placeholder="10"></div>
        <div class="field"><label for="d-price">Kaufkurs je Aktie (€)</label><input id="d-price" inputmode="decimal" required placeholder="250,00"></div>
        <div class="field"><label for="d-date">Kaufdatum</label><input id="d-date" type="date" style="width:150px"></div>
        <div class="field"><label for="d-note">Notiz</label><input id="d-note" class="wide" placeholder="optional"></div>
        <button class="btn primary" type="submit">Kauf hinzufügen</button>
        <span class="muted" id="d-msg" style="font-size:13px"></span>
      </form>
    </div>
    <div id="depot-body" style="margin-top:12px"><div class="loading-block"><div class="spinner"></div>Lade Depot …</div></div>`;
  const $ = (s) => root.querySelector(s);
  // Auswahl aus der Suche übernimmt nur den Ticker, statt das Profil zu öffnen
  attachSearch($("#d-symbol"), $("#d-results"), (sym) => { $("#d-symbol").value = sym; $("#d-shares").focus(); });
  if (preset) $("#d-shares").focus();

  $("#depot-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const sym = $("#d-symbol").value.trim().toUpperCase();
    // deutsche wie englische Schreibweise („1.234,50“, „1234.5“) annehmen
    const numOrRaw = (v) => F.parseNum(v) ?? v;
    try {
      lots = await api.depotAdd({ symbol: sym, shares: numOrRaw($("#d-shares").value), price: numOrRaw($("#d-price").value),
        date: $("#d-date").value || null, note: $("#d-note").value });
      ["#d-symbol", "#d-shares", "#d-price", "#d-date", "#d-note"].forEach((s) => { $(s).value = ""; });
      $("#d-msg").textContent = "";
      toast(`Kauf ${sym} gespeichert.`, { kind: "good" });
      $("#d-symbol").focus();
      load();
    } catch (err) { $("#d-msg").textContent = err.message; }
  });

  const body = $("#depot-body");
  let token = 0;
  let lots = [];
  const rows = new Map(); // Kennzahlen je Ticker (bleiben bei Änderungen an den Käufen erhalten)
  const live = new Map(); // aktuelle Kurse je Ticker
  let lotsOpen = false; // „Alle Käufe“ aufgeklappt
  let importOpen = false;
  let editing = null; // Id des Kaufs, der gerade bearbeitet wird
  let shown = []; // Positionen in der angezeigten Reihenfolge (zum Blättern im Profil)

  // Käufe laden; Kurse und Kennzahlen nur für Ticker holen, die noch fehlen (Bearbeiten und Löschen bleiben so schnell)
  async function load() {
    const my = ++token;
    const alive = () => my === token && isCurrent();
    try { lots = await api.depot(); } catch (e) { body.innerHTML = `<div class="error-block">${esc(e.message)}</div>`; return; }
    if (!alive()) return;
    const missing = [...new Set(lots.map((l) => l.symbol))].filter((s) => !rows.has(s));
    if (!missing.length) { paint(); return; }
    if (!body.querySelector(".grid.tiles")) body.innerHTML = '<div class="loading-block"><div class="spinner"></div>Lade Kurse und Kennzahlen …</div>';
    try { for (const q of await api.quotes(missing)) live.set(q.symbol, q); } catch (e) { /* ohne Live-Kurse: Kurse aus dem Profil */ }
    const paintLater = debounce(() => alive() && paint(), 200);
    await loadSummaries(missing, (sym, r) => { rows.set(sym, r); paintLater(); }, alive);
    if (!alive()) return;
    paint();
  }

  function paint() {
    if (!lots.length) {
      body.innerHTML = `<div class="card"><p class="muted">Noch keine Positionen. Fügen Sie oben Ihren ersten Kauf hinzu, öffnen Sie ein Aktienprofil
        und klicken Sie auf „＋ Depot“ oder übernehmen Sie Ihre Käufe aus einer Tabelle.</p></div>${importBox()}`;
      return;
    }
    const symbols = [...new Set(lots.map((l) => l.symbol))];
    const positions = symbols.map((sym) => {
      const mine = lots.filter((l) => l.symbol === sym);
      const shares = mine.reduce((s, l) => s + l.shares, 0);
      const r = rows.get(sym);
      const d = r?.status === "ok" ? r.data : null;
      const q = live.get(sym);
      // Kurse kommen in Euro vom Server; ohne Wechselkurs bleibt die Position außen vor
      const eurQuote = q?.currency === "EUR" ? q : null;
      const eurRow = d?.currency === "EUR" ? d : null;
      const price = eurQuote?.price ?? eurRow?.price;
      const ccy = q?.original_currency || d?.original_currency || q?.currency || d?.currency;
      // Käufe vor der Euro-Anzeige (ohne "currency") stehen in Kurswährung: zum heutigen Kurs umgerechnet
      const toEur = q?.eur_rate ?? d?.eur_rate;
      const lotCost = (l) => (l.currency === "EUR" ? l.shares * l.price : toEur ? l.shares * l.price * toEur : null);
      const costs = mine.map(lotCost);
      const cost = costs.every(F.isNum) ? costs.reduce((a, b) => a + b, 0) : null;
      const valueEur = F.isNum(price) ? shares * price : null;
      const divEur = eurRow ? shares * (eurRow.div_ttm || 0) : null;
      return { sym, mine, shares, cost, d, q, price, ccy, valueEur, costEur: cost, divEur,
        divNetEur: divEur != null ? divEur * (d.net_dividend_share ?? 0.73625) : null, status: r?.status, error: r?.error };
    });
    const total = sum(positions.map((p) => p.valueEur));
    const cost = sum(positions.map((p) => (p.valueEur != null ? p.costEur : null)));
    const divGross = sum(positions.map((p) => p.divEur));
    const divNet = sum(positions.map((p) => p.divNetEur));
    const pl = total != null && cost ? total - cost : null;
    const scores = STRATEGIES.map(([k]) => weighted(positions, (p) => p.d?.scores?.[k]));
    // Basis-Ansicht: ohne Bruttodividende und Scores
    const basic = isBasic();
    const tiles = [
      tileHtml("Depotwert", F.big(total, "€"), `${positions.length} Aktien`),
      tileHtml("Gewinn/Verlust", `<span class="${(pl ?? 0) >= 0 ? "good" : "bad"}">${F.big(pl, "€")}</span>`, cost ? F.signedPct(pl / cost, 1) : ""),
      basic ? "" : tileHtml(term("dividendenrendite", "Dividenden p. a."), F.big(divGross, "€"), total ? `Rendite ${F.pct(divGross / total, 2)} · auf Einstand ${F.pct(divGross / cost, 2)}` : ""),
      tileHtml(term("quellensteuer", "Dividenden netto p. a."), F.big(divNet, "€"),
        basic && total ? `Rendite ${F.pct(divNet / total, 2)} nach Quellen- und Abgeltungsteuer` : "nach Quellen- und Abgeltungsteuer"),
      basic ? "" : tileHtml(term("scorecard", "Ø Scores (gewichtet)"), scores.map((s) => (F.isNum(s) ? F.num(s, 1) : "–")).join(" · "), "Gewinn- / Dividendenwachstum / -ertrag"),
    ].join("");
    const sorted = [...positions].sort((a, b) => (b.valueEur ?? -1) - (a.valueEur ?? -1));
    const tableRows = sorted.map((p) => {
      const share = total && p.valueEur != null ? p.valueEur / total : null;
      const plPct = p.valueEur != null && p.cost ? p.valueEur / p.cost - 1 : null;
      const rating = p.d?.rating;
      return `<tr>
        <td class="name"><a href="#/aktie/${encodeURIComponent(p.sym)}">${esc(p.d?.name || p.sym)}</a><span class="sym">${esc(p.sym)}</span></td>
        <td>${F.num(p.shares, p.shares % 1 ? 3 : 0)}</td><td>${F.isNum(p.cost) ? F.money(p.cost / p.shares, "€") : "–"}</td>
        <td>${F.money(p.price, "€")}${p.q ? ` <span class="${p.q.change >= 0 ? "good" : "bad"}" style="font-size:12px">${F.signedPct(p.q.change, 1)}</span>` : ""}</td>
        <td>${F.big(p.valueEur, "€")}</td><td>${F.pct(share, 1)}</td>
        <td class="${(plPct ?? 0) >= 0 ? "good" : "bad"}">${F.signedPct(plPct, 1)}</td>
        <td>${F.big(p.divNetEur, "€")}</td>
        <td>${rating ? `<span class="badge ${rating.status}" title="${esc(rating.label)}">${F.signedPct(p.d.deviation, 0)}</span>` : "–"}</td>
        ${basic ? "" : `<td><span class="chips">${STRATEGIES.map(([k, l]) => { const v = p.d?.scores?.[k]; return `<span class="chip ${v >= 8 ? "hi" : v >= 6 ? "mid" : ""}" title="${l}: ${v ?? "–"}">${v ?? "–"}</span>`; }).join("")}</span></td>`}
      </tr>${p.status === "error" ? `<tr class="failed"><td colspan="${basic ? 9 : 10}" style="text-align:left">${esc(p.sym)}: ${esc(p.error)}</td></tr>` : ""}`;
    }).join("");
    shown = sorted;
    const lotRows = [...lots].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((l) => (l.id === editing ? editRow(l) : lotRow(l))).join("");
    body.innerHTML = `
      <div class="grid tiles">${tiles}</div>
      <div class="card table-scroll" style="margin-top:12px;padding:8px 8px 4px">
        <table class="data screener"><thead><tr><th>Aktie</th><th>Stück</th><th>Ø Kaufkurs</th><th>Kurs</th><th>Wert</th><th>Anteil</th><th>G/V</th>
          <th>${term("quellensteuer", "Div. netto p. a.")}</th><th>${term("fairer_wert", "vs. fairer Wert")}</th>${basic ? "" : `<th>${term("scorecard", "Scores")}</th>`}</tr></thead>
          <tbody id="pos-rows">${tableRows}</tbody></table>
      </div>
      <div class="grid two" style="margin-top:12px">
        <div class="card"><div class="chart-title"><h3>Dividenden nach Monaten (netto, erwartet)</h3><span class="muted">in €, nach den Ex-Tagen der letzten 12 Monate (Zahlung meist wenige Wochen danach)</span></div><div class="chart small" id="ch-months"></div></div>
        <div class="card"><div class="chart-title"><h3>Aufteilung</h3>
          <div class="segmented" id="alloc-seg" role="group" aria-label="Aufteilung nach"><button type="button" data-k="country" aria-pressed="true">Land</button><button type="button" data-k="sector" aria-pressed="false">Sektor</button><button type="button" data-k="ccy" aria-pressed="false">Währung</button></div></div>
          <div class="chart small" id="ch-alloc"></div></div>
      </div>
      <details class="table-view card" id="lots-box" style="margin-top:12px" ${lotsOpen ? "open" : ""}><summary>Alle Käufe (${lots.length}) – bearbeiten, löschen, als CSV sichern</summary>
        <div class="toolbar" style="margin:10px 0 4px"><span class="muted" style="font-size:13px">Tippfehler korrigieren Sie mit „bearbeiten“; gelöschte Käufe lassen sich in der Meldung zurückholen.</span>
          <span class="spacer"></span><button class="btn small" type="button" id="lots-csv" title="Alle Käufe als CSV-Datei; lässt sich unten wieder importieren">Als CSV sichern</button></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Aktie</th><th>Datum</th><th>Stück</th><th>Kaufkurs</th><th style="text-align:left">Notiz</th><th></th></tr></thead>
        <tbody>${lotRows}</tbody></table></div></details>
      ${importBox()}
      <p class="muted" style="font-size:13px;margin-top:10px">Kurse: Yahoo Finance (verzögert), Umrechnung in Euro zum aktuellen Wechselkurs; die Veränderung heute enthält die Bewegung des Wechselkurses. Dividenden: Zahlungen der
        letzten 12 Monate, fortgeschrieben; Steuern laut quellensteuer.json (ohne Kirchensteuer und Sparerpauschbetrag).</p>`;
    charts(body, positions, total);
    body.querySelector(`tr[data-lot="${CSS.escape(editing || "")}"] [data-f="shares"]`)?.select();
  }

  // ---- Käufe: Zeile, Bearbeiten-Zeile, Speichern, Löschen mit „Rückgängig“
  const shareFmt = (x) => F.num(x, x % 1 ? 3 : 0);
  const plain = (x) => String(x).replace(".", ","); // Zahl zum Bearbeiten, ohne Tausenderpunkte
  function lotRow(l) {
    return `<tr data-lot="${esc(l.id)}"><td>${esc(l.symbol)}</td><td>${F.date(l.date)}</td>
      <td>${shareFmt(l.shares)}</td><td>${F.money(l.price, l.currency === "EUR" ? "€" : "")}</td><td style="text-align:left">${esc(l.note || "")}</td>
      <td><button class="linklike" data-edit="${esc(l.id)}" type="button">bearbeiten</button> · <button class="linklike" data-del="${esc(l.id)}" type="button">löschen</button></td></tr>`;
  }
  function editRow(l) {
    return `<tr data-lot="${esc(l.id)}" class="editing"><td>${esc(l.symbol)}</td>
      <td><input class="cell" type="date" data-f="date" value="${esc(l.date || "")}" aria-label="Kaufdatum"></td>
      <td><input class="cell" inputmode="decimal" data-f="shares" value="${esc(plain(l.shares))}" aria-label="Stück"></td>
      <td><input class="cell" inputmode="decimal" data-f="price" value="${esc(plain(l.price))}" aria-label="Kaufkurs ${l.currency === "EUR" ? "in €" : "in Kurswährung"}"></td>
      <td style="text-align:left"><input class="cell note" data-f="note" value="${esc(l.note || "")}" aria-label="Notiz"></td>
      <td><button class="btn small primary" data-save="${esc(l.id)}" type="button">Speichern</button> <button class="linklike" data-cancel type="button">Abbrechen</button></td></tr>`;
  }
  async function saveEdit(id) {
    const tr = body.querySelector(`tr[data-lot="${CSS.escape(id)}"]`);
    const v = (f) => tr.querySelector(`[data-f="${f}"]`).value;
    const shares = F.parseNum(v("shares"));
    const price = F.parseNum(v("price"));
    if (!(shares > 0) || !(price > 0)) { toast("Stück und Kaufkurs müssen Zahlen größer als 0 sein.", { kind: "bad" }); return; }
    try {
      lots = await api.depotUpdate(id, { shares, price, date: v("date") || null, note: v("note") });
      editing = null;
      paint();
      toast("Kauf geändert.", { kind: "good" });
    } catch (err) { toast(err.message, { kind: "bad" }); }
  }
  async function removeLot(id) {
    const lot = lots.find((l) => l.id === id);
    if (!lot) return;
    try { lots = await api.depotRemove(id); } catch (err) { toast(err.message, { kind: "bad" }); return; }
    paint();
    toast(`Kauf ${lot.symbol} (${shareFmt(lot.shares)} Stück${lot.date ? ` vom ${F.date(lot.date)}` : ""}) gelöscht.`, {
      action: "Rückgängig",
      onAction: async () => { lots = await api.depotRestore(lot); if (isCurrent()) paint(); },
    });
  }

  // ---- CSV: Sichern und Importieren (Ticker; Stück; Kaufkurs; Datum; Notiz)
  function exportLots() {
    const header = ["Ticker", "Stück", "Kaufkurs", "Datum", "Notiz", "Währung"];
    const out = [...lots].sort((a, b) => (a.date || "").localeCompare(b.date || "")).map((l) => [l.symbol, csvNum(l.shares, 6), csvNum(l.price, 6),
      l.date ? F.date(l.date) : "", l.note || "", l.currency === "EUR" ? "EUR" : "Kurswährung"]);
    downloadCsv(`depot-kaeufe-${today()}.csv`, header, out);
    toast(`${F.int(out.length)} Käufe als CSV gespeichert (Ordner „Downloads“).`, { kind: "good" });
  }
  function importBox() {
    return `<details class="card import-box" id="import-box" style="margin-top:12px" ${importOpen ? "open" : ""}><summary>Käufe aus einer Tabelle übernehmen (CSV)</summary>
      <p class="secondary" style="font-size:14px;margin:10px 0 8px">Eine Zeile je Kauf: <b>Ticker; Stück; Kaufkurs in €; Datum; Notiz</b> – Datum und Notiz
        dürfen fehlen. Getrennt durch Semikolon, Komma oder Tab (aus Excel kopiert); eine Kopfzeile wird erkannt. Datum als 15.03.2024 oder 2024-03-15.</p>
      <textarea id="imp-text" spellcheck="false" placeholder="ALV.DE; 10; 245,50; 15.03.2024; Sparplan&#10;SAP.DE; 5; 180; 2023-01-02"></textarea>
      <div class="toolbar" style="margin:8px 0 0"><label class="btn small" style="cursor:pointer">Datei wählen …<input type="file" id="imp-file" accept=".csv,.txt,text/csv,text/plain" hidden></label>
        <button class="btn small primary" type="button" id="imp-go" disabled>Importieren</button><span class="import-preview" id="imp-preview"></span></div>
    </details>`;
  }
  // gelesene Zeilen prüfen: Ticker, Stück > 0, Kurs > 0, gültiges Datum
  function parseImport(text) {
    const table = parseCsv(text);
    if (!table.length) return { items: [], errors: [] };
    let cols = { symbol: 0, shares: 1, price: 2, date: 3, note: 4 };
    const headerRow = F.parseNum(table[0][1]) == null;
    if (headerRow) {
      const head = table[0].map((h) => h.toLowerCase());
      const find = (re, fallback) => { const i = head.findIndex((h) => re.test(h)); return i >= 0 ? i : fallback; };
      cols = { symbol: find(/ticker|symbol|aktie|wertpapier|isin/, 0), shares: find(/st(ü|ue)ck|anzahl|menge|shares|qty/, 1),
        price: find(/kurs|preis|price/, 2), date: find(/datum|date/, 3), note: find(/notiz|note|bemerkung|kommentar/, 4) };
    }
    const items = [];
    const errors = [];
    (headerRow ? table.slice(1) : table).forEach((r, i) => {
      const line = i + 1 + (headerRow ? 1 : 0);
      const symbol = (r[cols.symbol] || "").trim().toUpperCase();
      const shares = F.parseNum((r[cols.shares] || "").replace(/[^\d.,\-−]/g, ""));
      const price = F.parseNum((r[cols.price] || "").replace(/[^\d.,\-−]/g, ""));
      const rawDate = (r[cols.date] || "").trim();
      const de = rawDate.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
      const date = !rawDate ? null : de ? `${de[3].length === 2 ? `20${de[3]}` : de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`
        : /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : undefined;
      if (!symbol) errors.push(`Zeile ${line}: Ticker fehlt`);
      else if (!(shares > 0)) errors.push(`Zeile ${line} (${symbol}): Stückzahl fehlt oder ist nicht größer als 0`);
      else if (!(price > 0)) errors.push(`Zeile ${line} (${symbol}): Kaufkurs fehlt oder ist nicht größer als 0`);
      else if (date === undefined) errors.push(`Zeile ${line} (${symbol}): Datum „${rawDate}“ nicht erkannt`);
      else items.push({ symbol, shares, price, date, note: r[cols.note] || "" });
    });
    return { items, errors };
  }
  let parsed = { items: [], errors: [] };
  function previewImport() {
    parsed = parseImport(body.querySelector("#imp-text").value);
    const { items, errors } = parsed;
    const total = items.reduce((s, it) => s + it.shares * it.price, 0);
    body.querySelector("#imp-preview").innerHTML = !items.length && !errors.length ? ""
      : `${items.length ? `<span class="good">${F.int(items.length)} ${items.length === 1 ? "Kauf" : "Käufe"} erkannt (zusammen ${F.money(total, "€")})</span>` : ""}
        ${errors.length ? `<span class="bad">${errors.length === 1 ? "" : `${errors.length} Fehler: `}${esc(errors.slice(0, 3).join(" · "))}${errors.length > 3 ? " …" : ""}</span>` : ""}`;
    body.querySelector("#imp-go").disabled = !items.length || errors.length > 0;
    body.querySelector("#imp-go").title = errors.length ? "Erst die markierten Zeilen korrigieren" : "";
  }
  async function runImport() {
    const { items } = parsed;
    if (!items.length) return;
    try {
      const before = new Set(lots.map((l) => l.id));
      lots = await api.depotImport(items);
      const added = lots.filter((l) => !before.has(l.id)).map((l) => l.id);
      importOpen = false;
      toast(`${F.int(added.length)} ${added.length === 1 ? "Kauf" : "Käufe"} übernommen.`, {
        kind: "good", action: "Rückgängig",
        onAction: async () => { for (const id of added) lots = await api.depotRemove(id); if (isCurrent()) paint(); },
      });
      load();
    } catch (err) { toast(err.message, { kind: "bad", ms: 8000 }); }
  }

  // ---- Ereignisse (einmal am Container, der Inhalt wird neu gezeichnet)
  body.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-edit]")) { editing = t.closest("[data-edit]").dataset.edit; paint(); return; }
    if (t.closest("[data-cancel]")) { editing = null; paint(); return; }
    if (t.closest("[data-save]")) { saveEdit(t.closest("[data-save]").dataset.save); return; }
    if (t.closest("[data-del]")) { removeLot(t.closest("[data-del]").dataset.del); return; }
    if (t.closest("#lots-csv")) { exportLots(); return; }
    if (t.closest("#imp-go")) runImport();
  });
  body.addEventListener("keydown", (e) => {
    const tr = e.target.closest("tr.editing");
    if (!tr) return;
    if (e.key === "Enter") { e.preventDefault(); saveEdit(tr.dataset.lot); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); editing = null; paint(); }
  });
  body.addEventListener("toggle", (e) => {
    if (e.target.id === "lots-box") lotsOpen = e.target.open;
    if (e.target.id === "import-box") importOpen = e.target.open;
  }, true);
  body.addEventListener("input", (e) => { if (e.target.id === "imp-text") previewImport(); });
  body.addEventListener("change", async (e) => {
    if (e.target.id !== "imp-file" || !e.target.files[0]) return;
    body.querySelector("#imp-text").value = await e.target.files[0].text();
    previewImport();
  });
  trackBrowse(body, "Depot", () => shown.map((p) => [p.sym, p.d?.name || p.sym]));

  function charts(body, positions, total) {
    const months = Array(12).fill(0);
    for (const p of positions) {
      const ms = p.d?.div_payment_months || [];
      if (!ms.length || p.divNetEur == null) continue;
      for (const m of ms) months[m - 1] += p.divNetEur / ms.length;
    }
    C.mount(body.querySelector("#ch-months"), (t) => ({
      ...C.base(t), legend: { show: false }, grid: { ...C.base(t).grid, top: 16 },
      tooltip: { ...C.base(t).tooltip, axisPointer: { type: "shadow" }, valueFormatter: (v) => F.money(v, "€") },
      xAxis: C.categoryAxis(t, MONTHS), yAxis: C.valueAxis(t, { scale: false }),
      series: [{ name: "Dividenden netto", type: "bar", barMaxWidth: 28, data: months.map((v) => Math.round(v * 100) / 100), itemStyle: { color: t.series[0], borderRadius: [4, 4, 0, 0] } }],
    }));
    let key = "country";
    const alloc = C.mount(body.querySelector("#ch-alloc"), (t) => {
      const groups = new Map();
      for (const p of positions) {
        if (p.valueEur == null) continue;
        const k = key === "ccy" ? (p.ccy || "?") : (p.d?.[key] || "unbekannt");
        groups.set(k, (groups.get(k) || 0) + p.valueEur);
      }
      const items = [...groups.entries()].sort((a, b) => a[1] - b[1]);
      return {
        ...C.base(t), legend: { show: false }, grid: { ...C.base(t).grid, top: 8 },
        tooltip: { ...C.base(t).tooltip, axisPointer: { type: "shadow" }, valueFormatter: (v) => `${F.big(v, "€")} (${F.pct(v / total, 1)})` },
        xAxis: { ...C.valueAxis(t, { scale: false }), axisLabel: { color: t.muted, formatter: (v) => F.pct(v / total, 0) } },
        yAxis: { ...C.categoryAxis(t, items.map(([k]) => k)), axisLabel: { color: t.secondary } },
        series: [{ type: "bar", data: items.map(([, v]) => v), barMaxWidth: 18, itemStyle: { color: t.series[0], borderRadius: [0, 4, 4, 0] } }],
      };
    });
    const seg = body.querySelector("#alloc-seg");
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-k]");
      if (!b) return;
      key = b.dataset.k;
      seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      alloc.update();
    });
  }

  load();
}

function tileHtml(label, value, sub) {
  return `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
}

function sum(values) {
  const v = values.filter(F.isNum);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
}

// nach Depotwert gewichteter Durchschnitt
function weighted(positions, get) {
  let w = 0;
  let s = 0;
  for (const p of positions) {
    const v = get(p);
    if (F.isNum(v) && F.isNum(p.valueEur)) { w += p.valueEur; s += v * p.valueEur; }
  }
  return w ? s / w : null;
}

function debounce(fn, ms) {
  let t;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}
