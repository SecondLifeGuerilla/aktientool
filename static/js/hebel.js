// Seite „Optionsscheine & Knock-outs“ (#/hebel?s=SAP.DE&art=os&typ=call): alle Hebelprodukte auf eine Aktie in einer
// großen Tabelle mit Filtern, Sortierung nach jeder Spalte, Matrix, Landkarte und Vergleich (derivtable.js, derivlist.js).
// Oben wählt man Aktie, Produktart und Richtung und stellt „Ihre Erwartung“ ein (Kurs an einem Tag, Schwankung bis
// dahin); danach rechnen Ø Erwartung, Gewinnchance und KO-Risiko. Filter, Sortierung und Ansicht stehen in der Adresse,
// damit „Zurück“ aus dem Rechner genau hierher führt.
import { api } from "./api.js";
import { marketOf } from "./derivmodel.js";
import { productList } from "./derivlist.js";
import * as F from "./format.js";
import { term } from "./glossary.js";
import * as M from "./optionmath.js";
import { attachSearch } from "./search.js";

const esc = F.escapeHtml;
const CHANGES = [-0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.3];
const HORIZONS = [[0.25, "1 Woche"], [1, "1 Monat"], [3, "3 Monate"], [6, "6 Monate"], [12, "1 Jahr"]];
const EXAMPLES = [["SAP.DE", "SAP"], ["NVDA", "Nvidia"], ["AAPL", "Apple"], ["^GDAXI", "DAX"]];

const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const horizonDay = (months) => { if (months >= 1) return M.addMonths(months); const d = new Date(); d.setDate(d.getDate() + Math.round(months * 28)); return localDay(d); };
const inputNum = (x, digits = 2) => (F.isNum(x) ? String(Number(x.toFixed(digits))).replace(".", ",") : "");
const signed = (x) => F.signedPct(x, Math.abs(x) >= 0.995 ? 0 : 1);

export async function renderHebel(root, params, isCurrent) {
  document.title = "Optionsscheine & Knock-outs – Aktientool";
  const sym = (params.get("s") || "").trim().toUpperCase();
  const st = { kind: params.get("art") === "ko" ? "ko" : "os", call: params.get("typ") !== "put", u: null, touched: new Set() };
  let list = null;

  root.innerHTML = `
    <div class="page-head"><h1>Optionsscheine &amp; Knock-outs</h1>
      <p class="muted">Alle Produkte auf eine Aktie: filtern, nach jeder Spalte sortieren, vergleichen</p></div>
    <div class="card hb-top">
      <form class="filters" id="hb-form" autocomplete="off">
        <div class="field search" style="max-width:300px"><label for="hb-sym">Basiswert</label>
          <input id="hb-sym" class="wide" placeholder="Aktie oder Index suchen" value="${esc(sym)}">
          <ul id="hb-results" class="search-results" role="listbox" hidden></ul></div>
        <div class="field"><span class="field-label">Produkt</span>
          <div class="segmented" id="hb-kind" role="group" aria-label="Produktart">
            <button type="button" data-kind="os">${term("optionsschein", "Optionsscheine")}</button><button type="button" data-kind="ko">${term("knockout", "Knock-outs")}</button></div></div>
        <div class="field"><span class="field-label">Richtung</span>
          <div class="segmented" id="hb-dir" role="group" aria-label="Richtung">
            <button type="button" data-dir="call" title="Gewinnt, wenn die Aktie steigt">Call ↗</button>
            <button type="button" data-dir="put" title="Gewinnt, wenn die Aktie fällt">Put ↘</button></div></div>
        <div class="cp-under hb-under" id="hb-under"></div>
      </form>
      <div class="hb-view" id="hb-view" hidden>
        <span class="hb-lbl">${term("erwartung", "Ihre Erwartung")}: Aktie in</span>
        <div class="segmented" id="hb-hz" role="group" aria-label="Zeitraum">${HORIZONS.map(([mo, l]) => `<button type="button" data-hz="${mo}">${l}</button>`).join("")}</div>
        <label class="hb-inline">am <input id="hb-wd" type="date" style="width:140px"></label>
        <div class="segmented" id="hb-chg" role="group" aria-label="Veränderung gegenüber heute">${CHANGES.map((x) =>
          `<button type="button" data-chg="${x}">${x === 0 ? "±0" : `${x > 0 ? "+" : "−"}${Math.abs(x * 100)} %`}</button>`).join("")}</div>
        <label class="hb-inline" id="hb-ws-l">bei <input id="hb-ws" inputmode="decimal" style="width:90px"> <span id="hb-ws-u">€</span></label>
        <label class="hb-inline" title="Wie stark die Aktie bis dahin schwanken kann. Voreingestellt: die Schwankung im letzten Jahr.">Schwankung
          <input id="hb-sig" inputmode="decimal" style="width:60px"> % p. a.</label>
        <p class="muted hb-range" id="hb-range"></p>
      </div>
    </div>
    <div id="hb-body"></div>
    <div id="hb-list" style="margin-top:12px"></div>
    <div id="hb-cmp"></div>
    <details class="about">
      <summary>So liest man die Tabelle</summary>
      <p><b>Alle Produkte:</b> Die Tabelle lädt alle Optionsscheine bzw. Knock-outs auf die Aktie von onvista (bis zu 6.000; bei sehr vielen, etwa auf
        den Dax, die mit dem Basispreis am nächsten am Kurs – dann grenzen die Filter schon beim Laden ein). Filter und Sortierung gelten deshalb für
        alle Produkte, nicht nur für die ersten hundert. „Nur bei Trade Republic handelbar“ zeigt die Produkte von HSBC, Société Générale, UBS und Vontobel.</p>
      <p><b>Neutral, ohne Meinung:</b> ${term("preischeck", "Preis-Check")} (Briefkurs gegenüber dem fairen Wert), ${term("aehnliche", "vs. ähnliche")}
        (gegenüber Scheinen anderer Emittenten mit ähnlichem Basispreis und ähnlicher Laufzeit), ${term("spanne", "Spanne")} und
        ${term("spanne_aktie", "Spanne ÷ Hebel")} (die Spanne, umgerechnet auf die Aktie: vergleichbar über alle Hebel), ${term("gewinnschwelle", "Gewinnschwelle")},
        ${term("delta", "Delta")} und Zeitwertverlust pro Tag.</p>
      <p><b>Zu Ihrer Erwartung:</b> Ø Erwartung, Gewinnchance, Verlust über 50 % und KO-Risiko rechnen mit dem Kurs und der Schwankung oben. Mit „±0“
        und der bisherigen Schwankung ist das die neutrale Sicht: Ein fair bepreistes Produkt kommt im Durchschnitt auf etwa 0 %. Sortieren Sie nach
        „Ø Erwartung“ oder „Gewinnchance“, um das Produkt zu finden, das am besten zu Ihrer Meinung passt.</p>
      <p><b>Matrix:</b> Optionsscheine nach Fälligkeit und Basispreis, Knock-outs nach Abstand zur Schwelle und Art; je Feld der beste Wert und die Anzahl.
        Ein Klick zeigt die Produkte des Felds in der Liste. <b>Landkarte:</b> jedes Produkt als Punkt, nach Emittent gefärbt – so sieht man auf einen
        Blick, welcher Emittent bei welchem Basispreis am günstigsten ist.</p>
      <p><b>Spalten und Export:</b> „Spalten“ blendet weitere Kennzahlen ein (Geld, Delta, Zeitwert/Tag, Aufgeld, Verlust über 50 %, Veränderung heute,
        Bezugsverhältnis, erster Handelstag). „CSV“ speichert die gefilterte, sortierte Liste für Excel. Alle Angaben ohne Gewähr, keine Anlageberatung.</p>
    </details>`;

  const $ = (s) => root.querySelector(s);
  const field = (id) => $(`#${id}`);
  const fx = () => (st.u && st.u.currency !== "EUR" && st.u.eur ? st.u.eur : 1);
  const nowShown = () => (st.u ? st.u.price * fx() : null);
  const dccy = () => (st.u && (st.u.currency === "EUR" || st.u.eur) ? "EUR" : st.u?.currency || "EUR");
  const stock = (S) => F.money(S * fx(), dccy());
  const sigmaNow = () => { const x = F.parseNum(field("hb-sig").value); return x > 0 ? x / 100 : (st.u?.vola_1y ?? st.u?.vola_3m ?? 0.3); };
  const market = () => (st.u ? marketOf(st.u, sigmaNow()) : null);
  const scenario = () => {
    const now = nowShown();
    const shown = F.parseNum(field("hb-ws").value);
    if (!(now > 0) || !(shown > 0)) return null;
    let day = field("hb-wd").value || M.today();
    if (day < M.today()) day = M.today();
    const sigma = sigmaNow();
    const S = shown / fx();
    return { S, g: shown / now, day, t: M.years(M.today(), day), sigma,
      label: `Ihre Erwartung: Aktie am ${F.date(day)} im Durchschnitt bei ${stock(S)} (${signed(shown / now - 1)}), Schwankung ${F.pct(sigma, 0)} p. a.` };
  };

  // Erwartung für die Adresse: nur, was selbst eingestellt wurde; der Kurs als Veränderung in %
  const viewParams = () => {
    const out = {};
    const now = nowShown();
    const ws = F.parseNum(field("hb-ws").value);
    if (st.touched.has("hb-ws") && now > 0 && ws > 0) out.ziel = String(Math.round((ws / now - 1) * 1000) / 10);
    if (st.touched.has("hb-wd") && field("hb-wd").value) out.am = field("hb-wd").value;
    if (st.touched.has("hb-sig") && field("hb-sig").value.trim()) out.sig = field("hb-sig").value.trim();
    return out;
  };
  const href = (extra = {}) => `#/hebel?${new URLSearchParams({ s: sym, art: st.kind, typ: st.call ? "call" : "put", ...viewParams(), ...extra })}`;
  const syncHash = () => {
    if (!isCurrent()) return;
    history.replaceState(history.state, "", href(list ? list.state() : {}));
  };

  // ---- Basiswert, Produktart, Richtung
  const pick = (s) => { if (s) location.hash = `#/hebel?${new URLSearchParams({ s, art: st.kind, typ: st.call ? "call" : "put" })}`; };
  attachSearch($("#hb-sym"), $("#hb-results"), pick);
  $("#hb-form").addEventListener("submit", (e) => { e.preventDefault(); pick($("#hb-sym").value.trim().toUpperCase()); });
  const paintSegments = () => {
    $("#hb-kind").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === st.kind)));
    $("#hb-dir").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.dir === "call") === st.call)));
  };
  $("#hb-kind").addEventListener("click", (e) => {
    const b = e.target.closest("[data-kind]");
    if (!b || b.dataset.kind === st.kind) return;
    st.kind = b.dataset.kind;
    paintSegments();
    list?.setKind(st.kind, st.call);
    syncHash();
  });
  $("#hb-dir").addEventListener("click", (e) => {
    const b = e.target.closest("[data-dir]");
    if (!b || (b.dataset.dir === "call") === st.call) return;
    st.call = b.dataset.dir === "call";
    paintSegments();
    list?.setKind(st.kind, st.call);
    syncHash();
  });
  paintSegments();

  // ---- Ihre Erwartung
  function paintView() {
    const sc = scenario();
    const now = nowShown();
    $("#hb-chg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(Boolean(sc) && Math.abs(sc.g - 1 - Number(b.dataset.chg)) < 0.0005)));
    $("#hb-hz").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(field("hb-wd").value === horizonDay(Number(b.dataset.hz)))));
    if (!sc) { $("#hb-range").textContent = ""; return; }
    const [a, b] = M.likelyRange(sc.S, sc.sigma, sc.t);
    $("#hb-range").textContent = `${signed(sc.g - 1)} gegenüber heute (${stock(now / fx())}). ${sc.t > 0
      ? `Bei ${F.pct(sc.sigma, 0)} Schwankung p. a. liegt die Aktie am ${F.date(sc.day)} in 2 von 3 Fällen zwischen ${stock(a)} und ${stock(b)}.`
      : "Heute: Die Rechnung gilt genau für diesen Kurs."} Danach rechnen Ø Erwartung, Gewinnchance und KO-Risiko.`;
  }
  const viewChanged = () => { paintView(); list?.repaint(); syncHash(); };
  $("#hb-chg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-chg]");
    if (!b || !(nowShown() > 0)) return;
    field("hb-ws").value = inputNum(nowShown() * (1 + Number(b.dataset.chg)));
    st.touched.add("hb-ws");
    viewChanged();
  });
  $("#hb-hz").addEventListener("click", (e) => {
    const b = e.target.closest("[data-hz]");
    if (!b) return;
    field("hb-wd").value = horizonDay(Number(b.dataset.hz));
    st.touched.add("hb-wd");
    viewChanged();
  });
  $("#hb-view").addEventListener("change", (e) => {
    if (!["hb-ws", "hb-wd", "hb-sig"].includes(e.target.id)) return;
    st.touched.add(e.target.id);
    viewChanged();
  });

  if (!sym) {
    $("#hb-body").innerHTML = `<div class="card" style="margin-top:12px"><p class="muted">Wählen Sie oben eine Aktie oder einen Index – dann erscheinen alle
      Optionsscheine und Knock-outs darauf in einer großen Tabelle.</p>
      <div class="preset-row" style="margin-top:0">${EXAMPLES.map(([s, n]) => `<button class="btn" type="button" data-example="${esc(s)}">${esc(n)}</button>`).join("")}</div></div>`;
    $("#hb-body").addEventListener("click", (e) => { const b = e.target.closest("[data-example]"); if (b) pick(b.dataset.example); });
    return;
  }

  // ---- Tabelle (lädt sofort; die Bewertung kommt, sobald Kurs und Schwankung der Aktie da sind)
  list = productList($("#hb-list"), $("#hb-cmp"), {
    symbol: sym, mode: "page", initial: params, kind: () => st.kind, call: () => st.call, market, scenario,
    current: () => null,
    open: (isin) => {
      const q = new URLSearchParams({ p: isin, ...viewParams() });
      const v = list.selected();
      if (v.length) q.set("v", v.join(","));
      location.hash = `#/callput?${q}`;
    },
    rechnerLink: (isins) => `#/callput?${new URLSearchParams({ s: sym, art: st.kind, typ: st.call ? "call" : "put", v: isins.join(","), ...viewParams() })}`,
    compare: (params.get("v") || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
    changed: syncHash,
  });
  list.load();

  $("#hb-under").innerHTML = '<span class="muted"><span class="spinner inline"></span>Lade Kurs und Schwankung …</span>';
  let u;
  try {
    u = await api.underlying(sym);
  } catch (e) {
    if (!isCurrent()) return;
    $("#hb-under").innerHTML = `<span class="bad">${esc(e.message)}</span> <span class="muted">Ohne Kurs lassen sich Preis-Check und Erwartung nicht rechnen.</span>`;
    return;
  }
  if (!isCurrent()) return;
  st.u = u;
  const foreign = u.currency !== "EUR" && u.eur;
  $("#hb-under").innerHTML = `<a href="#/aktie/${encodeURIComponent(u.symbol)}">${esc(u.name)}</a> <span class="muted">· ${esc(u.symbol)} ·</span>
    <b class="num">${stock(u.price)}</b>${foreign ? ` <span class="muted">(${F.money(u.price, u.currency)})</span>` : ""}
    <span class="${(u.change ?? 0) >= 0 ? "good" : "bad"}">${F.signedPct(u.change, 2)}</span>
    <span class="muted">· Schwankung 1 Jahr ${F.pct(u.vola_1y, 0)}, 3 Monate ${F.pct(u.vola_3m, 0)}${u.div_yield ? ` · Dividendenrendite ${F.pct(u.div_yield, 1)}` : ""}</span>
    · <a href="#/callput?${new URLSearchParams({ s: u.symbol, art: st.kind, typ: st.call ? "call" : "put" })}">Call/Put-Rechner</a>`;
  document.title = `Hebelprodukte auf ${u.name} – Aktientool`;
  // Erwartung: aus der Adresse, sonst heutiger Kurs (±0), in einem Monat, Schwankung wie im letzten Jahr
  const z = F.parseNum(params.get("ziel"));
  field("hb-ws").value = inputNum(nowShown() * (1 + (z != null && z > -100 ? z / 100 : 0)));
  if (z != null) st.touched.add("hb-ws");
  const am = params.get("am");
  field("hb-wd").value = /^\d{4}-\d{2}-\d{2}$/.test(am || "") ? am : M.addMonths(1);
  if (am) st.touched.add("hb-wd");
  const sig = F.parseNum(params.get("sig"));
  field("hb-sig").value = sig > 0 ? params.get("sig") : inputNum((u.vola_1y ?? u.vola_3m ?? 0.3) * 100, 1);
  if (sig > 0) st.touched.add("hb-sig");
  $("#hb-ws-u").textContent = dccy() === "EUR" ? "€" : dccy();
  $("#hb-view").hidden = false;
  paintView();
  list.repaint();
}

