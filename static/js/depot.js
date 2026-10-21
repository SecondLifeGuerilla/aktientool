// Depot: Positionen erfassen, Wert und Gewinn in Euro, Dividenden nach Steuern, Aufteilung nach Land/Sektor/Währung
import { api, loadSummaries } from "./api.js";
import * as C from "./charts.js";
import * as F from "./format.js";
import { term } from "./glossary.js";
import { attachSearch } from "./search.js";

const esc = F.escapeHtml;
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const STRATEGIES = [["earnings_growth", "Gewinnwachstum"], ["dividend_growth", "Dividendenwachstum"], ["dividend_income", "Dividendenertrag"]];

export async function renderDepot(root, params, isCurrent) {
  document.title = "Depot – Aktientool";
  const preset = params.get("neu") || "";
  root.innerHTML = `
    <h1>Depot</h1>
    <p class="secondary" style="max-width:860px;margin-top:6px">Erfassen Sie Ihre Käufe mit Stückzahl und Kaufkurs (in der Kurswährung der Aktie,
      bei Londoner Aktien in Pence). Das Tool zeigt Wert und Gewinn in Euro, die erwarteten Dividenden nach Quellen- und Abgeltungsteuer und
      wie sich das Depot auf Länder, Sektoren und Währungen verteilt. Die Daten bleiben lokal (data/depot.json).</p>
    <div class="card" style="margin-top:14px">
      <form class="filters" id="depot-form" autocomplete="off">
        <div class="field search" style="max-width:260px"><label for="d-symbol">Aktie (Ticker oder Name)</label>
          <input id="d-symbol" class="wide" required value="${esc(preset)}" placeholder="z. B. ALV.DE">
          <ul id="d-results" class="search-results" role="listbox" hidden></ul></div>
        <div class="field"><label for="d-shares">Stück</label><input id="d-shares" inputmode="decimal" required placeholder="10"></div>
        <div class="field"><label for="d-price">Kaufkurs je Aktie</label><input id="d-price" inputmode="decimal" required placeholder="250,00"></div>
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
    try {
      await api.depotAdd({ symbol: $("#d-symbol").value.trim().toUpperCase(), shares: $("#d-shares").value, price: $("#d-price").value,
        date: $("#d-date").value || null, note: $("#d-note").value });
      ["#d-symbol", "#d-shares", "#d-price", "#d-date", "#d-note"].forEach((s) => { $(s).value = ""; });
      $("#d-msg").textContent = "Gespeichert.";
      load();
    } catch (err) { $("#d-msg").textContent = err.message; }
  });

  let token = 0;
  async function load() {
    const my = ++token;
    const alive = () => my === token && isCurrent();
    const body = $("#depot-body");
    let lots;
    try { lots = await api.depot(); } catch (e) { body.innerHTML = `<div class="error-block">${esc(e.message)}</div>`; return; }
    if (!alive()) return;
    if (!lots.length) {
      body.innerHTML = '<div class="card"><p class="muted">Noch keine Positionen. Fügen Sie oben Ihren ersten Kauf hinzu oder öffnen Sie ein Aktienprofil und klicken Sie auf „＋ Depot“.</p></div>';
      return;
    }
    const symbols = [...new Set(lots.map((l) => l.symbol))];
    body.innerHTML = '<div class="loading-block"><div class="spinner"></div>Lade Kurse und Kennzahlen …</div>';
    const rows = new Map();
    let quotes = [];
    try { quotes = await api.quotes(symbols); } catch (e) { /* ohne Live-Kurse: Kurse aus dem Profil */ }
    const live = new Map(quotes.map((q) => [q.symbol, q]));
    // Wechselkurse vorab, soweit die Kurswährung schon aus den Live-Kursen bekannt ist
    let fx = {};
    const loadFx = async () => {
      const ccys = [...new Set(symbols.map((s) => live.get(s)?.currency || rows.get(s)?.data?.currency).filter(Boolean))];
      try { fx = await api.fx(ccys); } catch (e) { /* Euro-Werte fehlen dann */ }
    };
    await loadFx();
    const paintLater = debounce(() => alive() && paint(), 200);
    await loadSummaries(symbols, (sym, r) => { rows.set(sym, r); paintLater(); }, alive);
    if (!alive()) return;
    if (symbols.some((s) => !fx[live.get(s)?.currency || rows.get(s)?.data?.currency])) await loadFx();
    paint();

    function paint() {
      const positions = symbols.map((sym) => {
        const mine = lots.filter((l) => l.symbol === sym);
        const shares = mine.reduce((s, l) => s + l.shares, 0);
        const cost = mine.reduce((s, l) => s + l.shares * l.price, 0);
        const r = rows.get(sym);
        const d = r?.status === "ok" ? r.data : null;
        const q = live.get(sym);
        const price = q?.price ?? d?.price;
        const ccy = q?.currency || d?.currency;
        const rate = fx[ccy];
        const value = F.isNum(price) ? shares * price : null;
        const div = d ? shares * (d.div_ttm || 0) : null;
        return { sym, mine, shares, cost, d, q, price, ccy, rate, value, valueEur: value != null && rate ? value * rate : null,
          costEur: rate ? cost * rate : null, divEur: div != null && rate ? div * rate : null,
          divNetEur: div != null && rate && d ? div * rate * (d.net_dividend_share ?? 0.73625) : null, status: r?.status, error: r?.error };
      });
      const total = sum(positions.map((p) => p.valueEur));
      const cost = sum(positions.map((p) => (p.valueEur != null ? p.costEur : null)));
      const divGross = sum(positions.map((p) => p.divEur));
      const divNet = sum(positions.map((p) => p.divNetEur));
      const pl = total != null && cost ? total - cost : null;
      const scores = STRATEGIES.map(([k]) => weighted(positions, (p) => p.d?.scores?.[k]));
      const tiles = [
        tileHtml("Depotwert", F.big(total, "€"), `${positions.length} Aktien`),
        tileHtml("Gewinn/Verlust", `<span class="${(pl ?? 0) >= 0 ? "good" : "bad"}">${F.big(pl, "€")}</span>`, cost ? F.signedPct(pl / cost, 1) : ""),
        tileHtml(term("dividendenrendite", "Dividenden p. a."), F.big(divGross, "€"), total ? `Rendite ${F.pct(divGross / total, 2)} · auf Einstand ${F.pct(divGross / cost, 2)}` : ""),
        tileHtml(term("quellensteuer", "Dividenden netto p. a."), F.big(divNet, "€"), "nach Quellen- und Abgeltungsteuer"),
        tileHtml(term("scorecard", "Ø Scores (gewichtet)"), scores.map((s) => (F.isNum(s) ? F.num(s, 1) : "–")).join(" · "), "Gewinn- / Dividendenwachstum / -ertrag"),
      ].join("");
      const sorted = [...positions].sort((a, b) => (b.valueEur ?? -1) - (a.valueEur ?? -1));
      const tableRows = sorted.map((p) => {
        const share = total && p.valueEur != null ? p.valueEur / total : null;
        const plPct = p.value != null && p.cost ? p.value / p.cost - 1 : null;
        const rating = p.d?.rating;
        return `<tr>
          <td class="name"><a href="#/aktie/${encodeURIComponent(p.sym)}">${esc(p.d?.name || p.sym)}</a><span class="sym">${esc(p.sym)}</span></td>
          <td>${F.num(p.shares, p.shares % 1 ? 3 : 0)}</td><td>${F.money(p.cost / p.shares, "")}</td>
          <td>${F.money(p.price, p.ccy)}${p.q ? ` <span class="${p.q.change >= 0 ? "good" : "bad"}" style="font-size:12px">${F.signedPct(p.q.change, 1)}</span>` : ""}</td>
          <td>${F.big(p.valueEur, "€")}</td><td>${F.pct(share, 1)}</td>
          <td class="${(plPct ?? 0) >= 0 ? "good" : "bad"}">${F.signedPct(plPct, 1)}</td>
          <td>${F.big(p.divNetEur, "€")}</td>
          <td>${rating ? `<span class="badge ${rating.status}" title="${esc(rating.label)}">${F.signedPct(p.d.deviation, 0)}</span>` : "–"}</td>
          <td><span class="chips">${STRATEGIES.map(([k, l]) => { const v = p.d?.scores?.[k]; return `<span class="chip ${v >= 8 ? "hi" : v >= 6 ? "mid" : ""}" title="${l}: ${v ?? "–"}">${v ?? "–"}</span>`; }).join("")}</span></td>
        </tr>${p.status === "error" ? `<tr class="failed"><td colspan="10" style="text-align:left">${esc(p.sym)}: ${esc(p.error)}</td></tr>` : ""}`;
      }).join("");
      const lotRows = [...lots].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((l) => `<tr><td>${esc(l.symbol)}</td><td>${F.date(l.date)}</td>
        <td>${F.num(l.shares, l.shares % 1 ? 3 : 0)}</td><td>${F.money(l.price, "")}</td><td style="text-align:left">${esc(l.note || "")}</td>
        <td><button class="linklike" data-del="${esc(l.id)}" type="button">löschen</button></td></tr>`).join("");
      body.innerHTML = `
        <div class="grid tiles">${tiles}</div>
        <div class="card table-scroll" style="margin-top:12px;padding:8px 8px 4px">
          <table class="data screener"><thead><tr><th>Aktie</th><th>Stück</th><th>Ø Kaufkurs</th><th>Kurs</th><th>Wert</th><th>Anteil</th><th>G/V</th>
            <th>${term("quellensteuer", "Div. netto p. a.")}</th><th>${term("fairer_wert", "vs. fairer Wert")}</th><th>${term("scorecard", "Scores")}</th></tr></thead>
            <tbody>${tableRows}</tbody></table>
        </div>
        <div class="grid two" style="margin-top:12px">
          <div class="card"><div class="chart-title"><h3>Dividenden nach Monaten (netto, erwartet)</h3><span class="muted">in €, nach den Ex-Tagen der letzten 12 Monate (Zahlung meist wenige Wochen danach)</span></div><div class="chart small" id="ch-months"></div></div>
          <div class="card"><div class="chart-title"><h3>Aufteilung</h3>
            <div class="segmented" id="alloc-seg" role="group" aria-label="Aufteilung nach"><button type="button" data-k="country" aria-pressed="true">Land</button><button type="button" data-k="sector" aria-pressed="false">Sektor</button><button type="button" data-k="ccy" aria-pressed="false">Währung</button></div></div>
            <div class="chart small" id="ch-alloc"></div></div>
        </div>
        <details class="table-view card" style="margin-top:12px"><summary>Alle Käufe (${lots.length})</summary>
          <div class="table-wrap"><table class="data"><thead><tr><th>Aktie</th><th>Datum</th><th>Stück</th><th>Kaufkurs</th><th style="text-align:left">Notiz</th><th></th></tr></thead>
          <tbody>${lotRows}</tbody></table></div></details>
        <p class="muted" style="font-size:13px;margin-top:10px">Kurse: Yahoo Finance (verzögert), Umrechnung in Euro zum aktuellen Wechselkurs. Dividenden: Zahlungen der
          letzten 12 Monate, fortgeschrieben; Steuern laut quellensteuer.json (ohne Kirchensteuer und Sparerpauschbetrag).</p>`;
      body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm("Diesen Kauf löschen?")) return;
        await api.depotRemove(b.dataset.del);
        load();
      }));
      charts(body, positions, total);
    }
  }

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
