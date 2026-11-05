// Call/Put-Rechner: Was ist ein Optionsschein oder Knock-out-Produkt wert, wenn die Aktie steigt oder fällt?
// Kurs, Volatilität, Dividendenrendite und Euro-Kurs des Basiswerts kommen vom Server; gerechnet wird im Browser bei
// jeder Eingabe. Intern in der Börsenwährung der Aktie (Basispreis und Schwelle stehen so im Produktblatt), angezeigt
// wird alles in Euro zum heutigen Wechselkurs. Die Produktdaten stehen in der Adresse (#/callput?s=SAP.DE&art=os&typ=call&k=220&bv=0,1&bis=…&preis=…),
// damit sich ein Schein als Lesezeichen speichern lässt. Ein konkretes Produkt lädt der Rechner per ISIN oder WKN von
// onvista (#/callput?p=DE000…): Stammdaten und Briefkurs füllen die Felder, eigene Änderungen stehen zusätzlich in der
// Adresse. Darunter: die Produkte auf die Aktie (derivlist.js), zum Vergleich ausgewählte unter v=ISIN,ISIN.
import { api } from "./api.js";
import * as C from "./charts.js";
import {
  axisRange, DEFAULT_MARGIN, densitySeries, describe, isMini, kindLabel, lev, model, productList, productPrice, stamp, unitScale,
} from "./derivlist.js";
import * as F from "./format.js";
import { term } from "./glossary.js";
import * as M from "./optionmath.js";
import { attachSearch } from "./search.js";

const esc = F.escapeHtml;
const { parseNum } = F;
const STEPS = [-0.3, -0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2, 0.3];
const RATE = 2; // Zins in % p. a. (Euro-Geldmarkt, gerundet): Optionsscheine und Finanzierung der Knock-outs
// Erwartung: Knöpfe für die Kursveränderung und den Zeitraum (Monate; 0,25 = eine Woche)
const CHANGES = [-0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.3];
const HORIZONS = [[0.25, "1 Woche"], [1, "1 Monat"], [3, "3 Monate"], [6, "6 Monate"], [12, "1 Jahr"]];
const EXAMPLES = [["SAP.DE", "SAP"], ["AAPL", "Apple"], ["NVDA", "Nvidia"], ["^GDAXI", "DAX"]];
const TR_ISSUERS = "HSBC, Société Générale, UBS und Vontobel";

const inputNum = (x, digits = 4) => (F.isNum(x) ? String(Number(x.toFixed(digits))).replace(".", ",") : "");
// auf zwei signifikante Stellen runden: 212,3 → 210, 25.239 → 25.000
const nice = (x) => { const step = 10 ** (Math.floor(Math.log10(x)) - 1); return Number((Math.round(x / step) * step).toPrecision(6)); };

const { today, addMonths, years } = M;
const localDayOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDayOf(d); };
const horizonDay = (months) => (months < 1 ? addDays(Math.round(months * 28)) : addMonths(months));
const signed = (x) => F.signedPct(x, Math.abs(x) >= 0.995 ? 0 : 1);
const httpUrl = (u) => (typeof u === "string" && /^https?:\/\//.test(u) ? u : null);

export async function renderCallPut(root, params, isCurrent) {
  document.title = "Call/Put-Rechner – Aktientool";
  let sym = (params.get("s") || "").trim().toUpperCase();
  const pid = (params.get("p") || "").trim().toUpperCase();
  const compareInit = (params.get("v") || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  const st = {
    kind: params.get("art") === "ko" ? "ko" : "os",
    call: params.get("typ") !== "put",
    ccy: "EUR", eur: 1, under: null, volLabel: "Annahme",
    // vom Nutzer geänderte Felder behalten ihren Wert; die übrigen folgen Kurs, Produktart und Richtung
    touched: new Set(),
    // geladenes Produkt (onvista); edited: Felder, die der Nutzer danach selbst geändert hat
    product: null, productError: null, edited: new Set(), scale: 1, unitNote: null, spotEdited: false,
  };
  let list = null;
  const P = {
    "cp-k": params.get("k"), "cp-b": params.get("b"), "cp-ratio": params.get("bv"),
    "cp-exp": params.get("bis"), "cp-price": params.get("preis"),
  };
  // Ihre Erwartung aus der Adresse: Veränderung in % (bleibt beim Wechsel des Produkts), Tag, Schwankung
  const V = { ziel: params.get("ziel"), am: params.get("am"), sig: params.get("sig") };
  root.innerHTML = `
    <h1>Call/Put-Rechner</h1>
    <p class="secondary" style="max-width:860px;margin-top:6px">Was ist ein ${term("optionsschein", "Optionsschein")} oder
      ${term("knockout", "Knock-out-Produkt")} wert, wenn die Aktie steigt oder fällt? Laden Sie ein konkretes Produkt per ISIN
      oder WKN – oder wählen Sie eine Aktie und suchen Sie unten aus den Produkten, die Trade Republic handelt.</p>
    <div class="card" style="margin-top:14px">
      <form class="filters" id="cp-pform" autocomplete="off">
        <div class="field"><label for="cp-isin">Produkt laden</label>
          <input id="cp-isin" class="wide" placeholder="ISIN oder WKN, z. B. DE000HF1RPM0" value="${esc(pid)}" spellcheck="false"></div>
        <button class="btn" type="submit">Laden</button>
        <span class="muted cp-load-hint">Die ISIN steht in der Trade-Republic-App beim Produkt. Stammdaten und Kurse kommen von onvista.</span>
      </form>
      <div id="cp-prod"></div>
      <form class="filters cp-base" id="cp-form" autocomplete="off">
        <div class="field search" style="max-width:300px"><label for="cp-sym">Basiswert</label>
          <input id="cp-sym" class="wide" placeholder="Aktie oder Index suchen" value="${esc(sym)}">
          <ul id="cp-results" class="search-results" role="listbox" hidden></ul></div>
        <div class="field cp-spot-f"><label for="cp-spot" id="cp-spot-l">Kurs jetzt</label><input id="cp-spot" inputmode="decimal"><span class="cp-hint" id="cp-spot-h"></span></div>
        <div class="field"><span class="field-label">Produkt</span>
          <div class="segmented" id="cp-kind" role="group" aria-label="Produktart">
            <button type="button" data-kind="os">Optionsschein</button><button type="button" data-kind="ko">Knock-out</button></div></div>
        <div class="field"><span class="field-label">Richtung</span>
          <div class="segmented" id="cp-dir" role="group" aria-label="Richtung">
            <button type="button" data-dir="call" title="Gewinnt, wenn die Aktie steigt">Call ↗</button>
            <button type="button" data-dir="put" title="Gewinnt, wenn die Aktie fällt">Put ↘</button></div></div>
      </form>
      <div class="cp-under" id="cp-under"></div>
      <div class="filters cp-params">
        <div class="field"><label for="cp-k" id="cp-k-l">${term("basispreis", "Basispreis")}</label><input id="cp-k" inputmode="decimal"><span class="cp-hint" id="cp-k-h"></span></div>
        <div class="field ko-only"><label for="cp-b" id="cp-b-l">Knock-out-Schwelle</label><input id="cp-b" inputmode="decimal"><span class="cp-hint" id="cp-b-h"></span></div>
        <div class="field"><label for="cp-ratio">${term("bezugsverhaeltnis", "Bezugsverhältnis")}</label>
          <input id="cp-ratio" inputmode="decimal" placeholder="0,1" title="0,1 oder 10:1 = 10 Scheine je Aktie"></div>
        <div class="field os-only"><label for="cp-exp">Fälligkeit</label><input id="cp-exp" type="date" style="width:150px"></div>
        <div class="field"><label for="cp-price" id="cp-price-l">Preis des Produkts</label>
          <input id="cp-price" inputmode="decimal" placeholder="optional" title="Aktueller Briefkurs (Kaufkurs) oder Ihr Kaufpreis. Ohne Angabe rechnet das Tool mit dem theoretischen Wert."><span class="cp-hint" id="cp-price-h"></span></div>
      </div>
      <details class="cp-assume" id="cp-assume"><summary id="cp-assume-s">Annahmen</summary>
        <div class="filters">
          <div class="field os-only"><label for="cp-vol" title="Nur für Scheine ohne Preis: Mit dem Preis rechnet der Rechner mit der impliziten Volatilität">${term("implizite_volatilitaet", "Volatilität")} für den Preis % p. a.</label><input id="cp-vol" inputmode="decimal" value="30"></div>
          <div class="field"><label for="cp-rate">Zins % p. a.</label><input id="cp-rate" inputmode="decimal" value="${inputNum(RATE)}"></div>
          <div class="field os-only"><label for="cp-div">Dividendenrendite %</label><input id="cp-div" inputmode="decimal" value="0"></div>
          <div class="field ko-only"><label for="cp-margin" title="Aufschlag des Emittenten auf den Zins bei Knock-outs ohne Laufzeit (üblich 2–4 %)">Marge Knock-out % p. a.</label>
            <input id="cp-margin" inputmode="decimal" value="${inputNum(DEFAULT_MARGIN * 100)}"></div>
        </div>
        <p class="muted" id="cp-assume-note" style="margin:10px 0 0;font-size:13px;max-width:860px"></p>
      </details>
    </div>
    <div id="cp-msg" style="margin-top:12px"></div>
    <div id="cp-res" hidden>
      <div class="grid tiles" id="cp-tiles" style="margin-top:12px"></div>
    </div>
    <div class="card cp-view" id="cp-view" style="margin-top:12px" hidden>
      <div class="chart-title"><h3>${term("erwartung", "Ihre Erwartung")}</h3>
        <span class="muted">Wo steht die Aktie an einem bestimmten Tag? Danach rechnen Rechner, Vergleich und Produktliste.</span></div>
      <div class="filters" style="margin-top:6px">
        <div class="field"><label for="cp-ws" id="cp-ws-l">Aktie dann bei</label><input id="cp-ws" inputmode="decimal"><span class="cp-hint" id="cp-ws-h"></span></div>
        <div class="field"><span class="field-label">Veränderung gegenüber heute</span>
          <div class="segmented" id="cp-chg" role="group" aria-label="Veränderung gegenüber heute">${CHANGES.map((x) =>
            `<button type="button" data-chg="${x}">${x === 0 ? "±0" : `${x > 0 ? "+" : "−"}${Math.abs(x * 100)} %`}</button>`).join("")}</div></div>
      </div>
      <div class="filters" style="margin-top:22px">
        <div class="field"><label for="cp-wd">am Tag</label><input id="cp-wd" type="date" style="width:150px"></div>
        <div class="field"><span class="field-label">Zeitraum</span>
          <div class="segmented" id="cp-hz" role="group" aria-label="Zeitraum">${HORIZONS.map(([mo, l]) => `<button type="button" data-hz="${mo}">${l}</button>`).join("")}</div></div>
        <div class="field"><label for="cp-sig" title="Wie stark die Aktie bis dahin schwanken kann. Voreingestellt: die Schwankung im letzten Jahr. Je unsicherer Sie sind, desto höher.">Schwankung % p. a.</label>
          <input id="cp-sig" inputmode="decimal" style="width:80px"><span class="cp-hint" id="cp-sig-h"></span></div>
      </div>
      <p class="muted cp-range" id="cp-range"></p>
      <div class="cp-what" id="cp-what"></div>
    </div>
    <div id="cp-res2" hidden>
      <div class="card" style="margin-top:12px">
        <div class="chart-title"><h3>Gewinn oder Verlust je nach Aktienkurs</h3><span class="muted" id="cp-chart-note"></span></div>
        <div class="chart" id="cp-chart"></div>
      </div>
      <div class="card table-scroll" style="margin-top:12px">
        <div class="chart-title"><h3>Szenarien</h3><span class="muted" id="cp-table-note"></span></div>
        <table class="data cp-table" id="cp-table"></table>
      </div>
    </div>
    <div id="cp-cmp" hidden></div>
    <div id="cp-list" style="margin-top:12px"></div>
    <details class="about">
      <summary>So rechnet der Rechner</summary>
      <p><b>Optionsschein:</b> Black-Scholes-Modell mit Dividendenrendite, wie es auch die Emittenten verwenden. Geben Sie den
        aktuellen Preis des Scheins ein, bestimmt der Rechner daraus die ${term("implizite_volatilitaet", "implizite Volatilität")};
        sonst nimmt er die Schwankung der Aktie im letzten Jahr. „Sofort“ heißt: Die Aktie springt jetzt auf den Kurs. „Am …“
        rechnet mit weniger Restlaufzeit, also weniger ${term("zeitwert", "Zeitwert")}. Bei Fälligkeit zählt nur noch der innere
        Wert. Die Volatilität bleibt in allen Szenarien gleich; in Wirklichkeit ändert der Emittent sie, etwa nach Quartalszahlen.</p>
      <p><b>Knock-out:</b> Wert = (Aktienkurs − Basispreis) × Bezugsverhältnis beim Call, (Basispreis − Aktienkurs) ×
        Bezugsverhältnis beim Put. Berührt die Aktie die Schwelle, endet das Produkt; bei Mini-Futures (Schwelle vor dem
        Basispreis) bleibt ungefähr der Abstand als Restwert. Die Finanzierungskosten, um die der Emittent den Basispreis täglich
        verschiebt (Zins + Marge beim Call, Zins − Marge beim Put, siehe „Annahmen“), rechnet der Rechner bei Knock-outs ohne
        Laufzeit für spätere Tage ein; bei Knock-outs mit Fälligkeit stecken sie schon im Preis.</p>
      <p><b>Preis-Check (neutral):</b> Briefkurs gegenüber dem fairen Wert. Beim Optionsschein ist das der Black-Scholes-Wert
        mit der Schwankung aus „Ihre Erwartung“ (voreingestellt: die der Aktie im letzten Jahr): Liegt die implizite Volatilität
        des Scheins darüber, ist er teurer als fair. „Ähnliche Scheine“ vergleicht mit Scheinen anderer Emittenten bei
        ähnlichem Basispreis und ähnlicher Laufzeit, ganz ohne Annahme über die Schwankung. Beim Knock-out ist der faire Wert
        der innere Wert, bei Knock-outs mit Fälligkeit der Terminwert (der Zins bis dahin steckt im Preis); der Preis-Check
        zeigt also, was Spanne und Aufgeld kosten. Bewertet wird mit dem Kurs der Aktie,
        mit dem onvista den Briefkurs gerechnet hat, damit Kurs und Preis vom selben Zeitpunkt stammen.</p>
      <p><b>Ihre Erwartung:</b> Sie sagen, wo die Aktie an einem Tag im Durchschnitt steht und wie stark sie bis dahin schwankt.
        Der Rechner spielt alle Kurse durch, die dann möglich sind (lognormal verteilt), und zeigt die durchschnittliche Rendite
        des Produkts, die Chance auf Gewinn, das Risiko, mehr als die Hälfte zu verlieren, und beim Knock-out die
        Wahrscheinlichkeit, dass die Aktie die Schwelle unterwegs berührt. Mit „±0“ und der bisherigen Schwankung ist das die
        neutrale Sicht: Ein fair bepreistes Produkt kommt dann im Durchschnitt auf etwa 0 %, der Rest sind Kosten.</p>
      <p><b>Produkte laden und vergleichen:</b> Stammdaten, Geld- und Briefkurs der Emittenten kommen von onvista. Trade Republic
        handelt Hebelprodukte außerbörslich direkt mit ${TR_ISSUERS}; „nur bei Trade Republic handelbar“ zeigt genau deren
        Produkte. Gerechnet wird mit dem Briefkurs, also dem Preis, zu dem Sie kaufen. Für den Vergleich bestimmt der Rechner
        bei jedem Optionsschein die Volatilität, die zu seinem Briefkurs passt; so ist jeder Schein „sofort, Aktie unverändert“
        genau seinen Preis wert, und der Vergleich zeigt, wie unterschiedlich sie auf dieselbe Kursbewegung reagieren.
        Den Hebel zeigt der Rechner mit zwei Nachkommastellen wie die Trade-Republic-App.
        ${term("quanto", "Quanto")}-Produkte rechnet der Rechner mit festem Kurs 1 Einheit = 1 €. Faktor-Zertifikate,
        Inline- und Discount-Optionsscheine rechnet er nicht.</p>
      <p><b>Währung:</b> Kurse und Werte zeigt der Rechner in Euro. Basispreis und Knock-out-Schwelle stehen im Produktblatt in der
        Währung der Aktie (bei US-Aktien in Dollar) und werden auch so eingegeben; daneben steht der Euro-Wert. Der Rechner nimmt
        den heutigen Wechselkurs an; fällt etwa der Dollar, verliert ein Call auf eine US-Aktie zusätzlich. Alle Ergebnisse sind Näherungen ohne
        Emittentenrisiko und keine Anlageberatung.</p>
    </details>`;

  const $ = (s) => root.querySelector(s);
  const field = (id) => $(`#${id}`);
  // Anzeige in Euro; ohne Wechselkurs bleibt es bei der Börsenwährung
  const foreign = () => st.ccy !== "EUR" && st.eur > 0;
  const fxNow = () => (foreign() ? st.eur : 1);
  const dccy = () => (st.ccy === "EUR" || foreign() ? "EUR" : st.ccy);
  const unit = (c) => (c === "EUR" ? "€" : c);
  const stock = (S) => F.money(S * fxNow(), dccy()); // Aktienkurs in der Börsenwährung, angezeigt in Euro
  const orig = (S) => (foreign() ? `${F.money(S, st.ccy)} · ` : "");
  // Eingaben aus der Adresse; mit Produkt erst nach dessen Stammdaten, sie gelten dann als eigene Änderungen
  const applyParams = () => {
    for (const [id, v] of Object.entries(P)) {
      if (v == null || v === "") continue;
      field(id).value = v;
      st.touched.add(id);
      if (st.product) st.edited.add(id);
    }
  };
  if (!pid) applyParams();

  // Erwartung für die Adresse: nur, was der Nutzer selbst eingestellt hat; der Kurs als Veränderung in %
  const viewParams = () => {
    const out = {};
    const now = parseNum(field("cp-spot").value);
    const ws = parseNum(field("cp-ws").value);
    if (st.touched.has("cp-ws") && now > 0 && ws > 0) out.ziel = String(Math.round((ws / now - 1) * 1000) / 10);
    if (st.touched.has("cp-wd") && field("cp-wd").value) out.am = field("cp-wd").value;
    if (st.touched.has("cp-sig") && field("cp-sig").value.trim()) out.sig = field("cp-sig").value.trim();
    return out;
  };
  const applyView = () => {
    const now = parseNum(field("cp-spot").value);
    const z = parseNum(V.ziel);
    if (z != null && z > -100 && now > 0) { field("cp-ws").value = inputNum(now * (1 + z / 100), 2); st.touched.add("cp-ws"); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(V.am || "")) { field("cp-wd").value = V.am; st.touched.add("cp-wd"); }
    if (parseNum(V.sig) > 0) { field("cp-sig").value = V.sig; st.touched.add("cp-sig"); }
  };

  // ---- Basiswert wählen: neue Adresse, Produktart und Richtung bleiben
  const pick = (s) => {
    const { sig, ...view } = viewParams(); // die Schwankung gehört zur alten Aktie
    if (s) location.hash = `#/callput?${new URLSearchParams({ s, art: st.kind, typ: st.call ? "call" : "put", ...view })}`;
  };
  attachSearch($("#cp-sym"), $("#cp-results"), pick);
  $("#cp-form").addEventListener("submit", (e) => { e.preventDefault(); pick($("#cp-sym").value.trim().toUpperCase()); });
  // ---- Produkt per ISIN/WKN: neue Adresse, der Vergleich bleibt
  const openProduct = (id) => {
    const q = new URLSearchParams({ p: id, ...viewParams() });
    const v = list ? list.selected() : compareInit;
    if (v.length) q.set("v", v.join(","));
    location.hash = `#/callput?${q}`;
  };
  $("#cp-pform").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = $("#cp-isin").value.trim().toUpperCase().replace(/\s/g, "");
    if (id) openProduct(id);
  });

  const paintSegments = () => {
    $("#cp-kind").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === st.kind)));
    $("#cp-dir").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.dir === "call") === st.call)));
    root.querySelectorAll(".os-only").forEach((el) => { el.hidden = st.kind !== "os"; });
    root.querySelectorAll(".ko-only").forEach((el) => { el.hidden = st.kind !== "ko"; });
  };

  // Vorgaben für alle Felder, die der Nutzer nicht selbst geändert hat
  const defaults = () => {
    const shown = parseNum(field("cp-spot").value);
    const spot = shown > 0 ? shown / fxNow() : null;
    const set = (id, v) => { if (!st.touched.has(id)) field(id).value = v; };
    if (spot > 0) {
      const k = nice(st.kind === "os" ? spot : spot * (st.call ? 0.9 : 1.1));
      set("cp-k", inputNum(k));
      set("cp-ratio", inputNum(spot >= 2000 ? 0.01 : spot < 20 ? 1 : 0.1));
      set("cp-ws", inputNum(shown, 2)); // Erwartung: zunächst der heutige Kurs („±0“), Knöpfe ändern ihn
    }
    set("cp-b", field("cp-k").value); // Turbo: Schwelle = Basispreis
    set("cp-exp", addMonths(6));
    set("cp-wd", addMonths(1));
    const u = st.under;
    set("cp-sig", inputNum(((u && (u.vola_1y ?? u.vola_3m)) || 0.3) * 100, 1)); // Schwankung wie im letzten Jahr
  };

  // ---- Geladenes Produkt: Kopfzeile mit Emittent, Kursen und Handelbarkeit
  function paintProduct() {
    const d = st.product;
    const el = $("#cp-prod");
    if (!d) {
      el.innerHTML = st.productError ? `<div class="cp-prod"><span class="bad">${esc(st.productError)}</span></div>` : "";
      return;
    }
    const supported = ["os", "ko"].includes(d.kind);
    const unit = d.under_ccy && d.under_ccy !== "EUR" ? d.under_ccy : "";
    const quote = (x) => (x != null ? `<b class="num">${money(x, "EUR")}</b>` : "–");
    const links = [[httpUrl(d.url), "bei onvista"], [httpUrl(d.doc), "beim Emittenten"]]
      .filter(([u]) => u).map(([u, l]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${l}</a>`).join(" · ");
    const inCmp = list?.has(d.isin);
    el.innerHTML = `<div class="cp-prod">
      <div><b>${esc(d.name || d.isin)}</b> <span class="muted">· ${esc(d.issuer || "")} · WKN ${esc(d.wkn || "–")} · ISIN ${esc(d.isin)}</span></div>
      <div class="cp-prod-line">
        ${d.tr ? `<span class="badge good" title="Trade Republic handelt Hebelprodukte von ${TR_ISSUERS}">bei Trade Republic handelbar</span>`
          : `<span class="badge serious" title="Trade Republic handelt Hebelprodukte nur von ${TR_ISSUERS}">nicht bei Trade Republic handelbar</span>`}
        <span>Geld ${quote(d.bid)} · Brief ${quote(d.ask)}${d.spread != null ? ` <span class="muted">· ${term("spanne", "Spanne")} ${F.pct(d.spread, 1)}</span>` : ""}</span>
        <span class="muted">${esc(describe(d, unit))}${d.time ? ` · ${esc(stamp(d.time))}` : ""}${links ? ` · ${links}` : ""}</span>
        ${supported ? `<button class="linklike" type="button" id="cp-prod-cmp"${!inCmp && list?.selected().length >= 6 ? " disabled" : ""}>${inCmp ? "aus dem Vergleich nehmen" : "＋ zum Vergleich"}</button>` : ""}
      </div>
      ${d.knocked_out ? '<div class="notice" style="margin-top:8px"><span class="bad">Dieses Produkt ist bereits ausgeknockt.</span></div>' : ""}
      ${supported ? "" : `<div class="notice" style="margin-top:8px">${esc(kindLabel(d))}: Der Rechner rechnet nur Optionsscheine und Knock-out-Produkte.</div>`}
    </div>`;
  }
  $("#cp-prod").addEventListener("click", (e) => {
    if (e.target.id === "cp-prod-cmp" && st.product && list) { list.toggle(st.product); paintProduct(); }
  });

  // Stammdaten des Produkts in die Felder (in der Kurswährung der Aktie bei Yahoo, London also in Pence)
  function fillFromProduct() {
    const d = st.product;
    if (d && ["os", "ko"].includes(d.kind)) {
      const scale = unitScale(d.under_ccy, st.ccy, d.eur_under, st.ccy === "EUR" ? 1 : st.eur);
      st.scale = scale ?? 1;
      st.unitNote = scale == null
        ? `Basispreis laut onvista in ${d.under_ccy}, Kurs der Aktie in ${st.ccy} – bitte die Werte prüfen.`
        : scale !== 1 && scale !== 100
          ? `Das Produkt führt Basispreis und Schwelle in ${d.under_ccy} (Basispreis ${F.num(d.strike, 2)} ${d.under_ccy}); der Rechner hat sie zum heutigen Wechselkurs in ${st.ccy} umgerechnet.`
          : null;
      const set = (id, v) => { if (v == null || v === "") return; field(id).value = v; st.touched.add(id); };
      set("cp-k", inputNum(d.strike * st.scale));
      if (d.kind === "ko") set("cp-b", inputNum((d.barrier ?? d.strike) * st.scale));
      set("cp-ratio", inputNum(d.ratio, 6));
      if (d.kind === "os" && d.expiry) set("cp-exp", d.expiry);
      const price = productPrice(d);
      if (price > 0) set("cp-price", inputNum(price, 4));
      // Kurs der Aktie, mit dem onvista den Briefkurs bewertet hat: Kurs und Preis vom selben Zeitpunkt (der Yahoo-Kurs
      // ist oft ein Schlusskurs von früher am Tag, und schon 1 % Abstand verzerrt Aufgeld und Preis-Check bei Hebel 10)
      const ref = d.under_price > 0 && scale != null ? d.under_price * scale : null;
      if (ref && st.under?.price > 0 && Math.abs(ref / st.under.price - 1) < 0.15) {
        field("cp-spot").value = inputNum(ref * fxNow(), 2);
        const hint = $("#cp-spot-h");
        hint.textContent = "Kurs zum Briefkurs (onvista)";
        hint.title = `Mit diesem Kurs hat onvista den Briefkurs bewertet${d.time ? ` (${stamp(d.time)})` : ""}. Letzter Kurs bei Yahoo: ${stock(st.under.price)}.`;
      }
    }
    applyParams();
  }

  // Produkt verworfen (andere Produktart oder Richtung gewählt): sein Preis passt nicht mehr
  function dropProduct() {
    if (!st.product) return;
    st.product = null;
    st.edited.clear();
    st.scale = 1;
    st.unitNote = null;
    st.touched.delete("cp-price");
    field("cp-price").value = "";
    paintProduct();
  }

  // Markt und Szenario für Produktliste und Vergleich
  const market = () => {
    const shown = parseNum(field("cp-spot").value);
    const u = st.under;
    return {
      spot: shown > 0 ? shown / fxNow() : null, fx: fxNow(), ccy: st.ccy, dccy: dccy(), eur: st.ccy === "EUR" ? 1 : st.eur,
      r: (parseNum(field("cp-rate").value) ?? 0) / 100, q: (parseNum(field("cp-div").value) ?? 0) / 100,
      vol: (u && (u.vola_1y ?? u.vola_3m)) || 0.3, sigma: sigmaNow(),
      margin: (parseNum(field("cp-margin").value) ?? 0) / 100,
    };
  };
  const sigmaNow = () => { const x = parseNum(field("cp-sig").value); return x > 0 ? x / 100 : 0.3; };
  // Ihre Erwartung: Kurs (Faktor g gegenüber heute) an einem Tag (t Jahre entfernt), Schwankung bis dahin
  const scenario = () => {
    const shown = parseNum(field("cp-ws").value);
    const now = parseNum(field("cp-spot").value);
    if (!(shown > 0) || !(now > 0)) return null;
    let day = field("cp-wd").value || today();
    if (day < today()) day = today();
    const sigma = sigmaNow();
    const S = shown / fxNow();
    return { S, g: shown / now, day, t: years(today(), day), sigma,
      label: `Ihre Erwartung: Aktie am ${F.date(day)} im Durchschnitt bei ${stock(S)} (${signed(shown / now - 1)}), Schwankung ${F.pct(sigma, 0)} p. a.` };
  };

  // ---- Diagramm: beim ersten sichtbaren Ergebnis anlegen, danach bei jeder Rechnung neu zeichnen
  let R = null; // Ergebnis der letzten gültigen Rechnung
  let chart = null;
  const paintChart = () => {
    if (!R) return;
    if (chart) chart.update();
    else chart = C.mount($("#cp-chart"), (t) => (R ? chartOption(R, t) : {}));
  };

  function calc() {
    const kind = st.kind;
    const call = st.call;
    const shown = parseNum(field("cp-spot").value);
    const spot = shown > 0 ? shown / fxNow() : null;
    const K = parseNum(field("cp-k").value);
    const B = kind === "ko" ? parseNum(field("cp-b").value) ?? K : null;
    const ratio = parseNum(field("cp-ratio").value);
    const expiry = field("cp-exp").value;
    // Knock-out mit Fälligkeit (geladenes Produkt): Terminwert bis dahin, siehe M.value
    const koEnd = kind === "ko" && st.product && !st.product.open_end && st.product.expiry > today() ? st.product.expiry : null;
    const T = kind === "os" && expiry ? years(today(), expiry) : koEnd ? years(today(), koEnd) : 0;
    const price = parseNum(field("cp-price").value);
    const fx = fxNow();
    const pccy = dccy();
    const p = {
      kind, call, K, B, ratio, fx,
      // Quanto: Auszahlung zum festen Kurs 1 Einheit = 1 € (st.scale: Pence statt Pfund)
      pfx: st.product?.quanto ? 1 / st.scale : fx,
      vol: (parseNum(field("cp-vol").value) ?? 0) / 100,
      r: (parseNum(field("cp-rate").value) ?? 0) / 100,
      q: (parseNum(field("cp-div").value) ?? 0) / 100,
      // Knock-out ohne Laufzeit (von Hand eingegeben: angenommen): Finanzierung verschiebt Basispreis und Schwelle
      openEnd: kind === "ko" && (st.product ? st.product.open_end || !st.product.expiry : true),
    };
    const margin = (parseNum(field("cp-margin").value) ?? 0) / 100;
    p.fin = M.financing(call, p.r, margin);
    $("#cp-spot-l").textContent = `Kurs jetzt (${unit(pccy)})`;
    $("#cp-k-l").querySelector(".term").textContent = `Basispreis (${unit(st.ccy)})`;
    $("#cp-b-l").textContent = `Knock-out-Schwelle (${unit(st.ccy)})`;
    $("#cp-ws-l").textContent = `Aktie dann im Durchschnitt bei (${unit(pccy)})`;
    $("#cp-price-l").textContent = `Preis des Produkts (${unit(pccy)})`;
    // Basispreis und Schwelle wie im Produktblatt in Börsenwährung; daneben der Euro-Wert
    $("#cp-k-h").textContent = foreign() && K > 0 ? `≈ ${F.money(K * fx, "€")}` : "";
    $("#cp-b-h").textContent = foreign() && B > 0 ? `≈ ${F.money(B * fx, "€")}` : "";
    const ask = st.product && productPrice(st.product);
    $("#cp-price-h").textContent = ask > 0 && st.touched.has("cp-price") && Math.abs(price - ask) <= 5e-5 ? "Briefkurs von onvista" : "";

    const errors = [];
    if (!(spot > 0)) errors.push("Kurs des Basiswerts eingeben oder oben eine Aktie wählen.");
    if (!(K > 0)) errors.push("Basispreis eingeben.");
    if (!(ratio > 0)) errors.push("Bezugsverhältnis eingeben, z. B. 0,1 (= 10 Scheine je Aktie).");
    if (kind === "os" && !(T > 0)) errors.push("Die Fälligkeit muss in der Zukunft liegen.");
    if (kind === "ko" && spot > 0 && B > 0 && M.knockedOut(p, spot)) {
      errors.push(`Der Kurs liegt schon ${call ? "unter" : "über"} der Knock-out-Schwelle – das Produkt wäre bereits ausgeknockt.`);
    }
    if (kind === "os" && !(p.vol > 0) && !(price > 0)) errors.push("Volatilität unter „Annahmen“ eingeben oder den Preis des Produkts.");

    const notes = st.unitNote ? [st.unitNote] : [];
    let volLabel = st.touched.has("cp-vol") ? "eigene Annahme" : st.volLabel;
    let v0 = null;
    if (!errors.length) {
      if (kind === "os" && price > 0) {
        const iv = M.impliedVol(call, price / (ratio * p.pfx), spot, K, T, p.r, p.q);
        if (iv) { p.vol = iv; volLabel = "implizit, aus dem Preis"; }
        else {
          const inner = M.value(p, spot, 0);
          notes.push(`Zum eingegebenen Preis passt keine Volatilität${price <= inner ? ` (er liegt unter dem inneren Wert von ${money(inner, pccy)})` : ""}. Gerechnet wird mit ${F.pct(p.vol, 1)}.`);
          if (!(p.vol > 0)) errors.push("Volatilität unter „Annahmen“ eingeben.");
        }
      }
      v0 = M.value(p, spot, T);
      if (!(price > 0) && !(v0 >= 0.0005)) errors.push("Das Produkt ist beim aktuellen Kurs theoretisch wertlos. Geben Sie seinen Preis ein, um zu rechnen.");
    }
    if (kind === "ko" && B > 0 && K > 0 && (call ? B < K : B > K)) {
      notes.push(`Ungewöhnlich: Bei einem ${call ? "Call" : "Put"} liegt die Knock-out-Schwelle normalerweise auf dem Basispreis oder ${call ? "darüber" : "darunter"}.`);
    }
    const fxNote = st.ccy !== "EUR" && st.eur ? `1 ${st.ccy} = ${F.num(st.eur, 4)} €, bleibt gleich` : null;
    $("#cp-assume-s").textContent = kind === "os"
      ? `Annahmen: Volatilität ${F.pct(p.vol, 1)} (${volLabel}) · Zins ${F.pct(p.r, 1)} · Dividende ${F.pct(p.q, 1)}${fxNote ? ` · ${fxNote}` : ""}`
      : `Annahmen: ${p.openEnd ? `Finanzierung Zins ${F.pct(p.r, 1)} ${call ? "+" : "−"} Marge ${F.pct(margin, 1)} p. a.` : "Finanzierung im Preis enthalten (Knock-out mit Fälligkeit)"}${fxNote ? ` · ${fxNote}` : ""}`;
    $("#cp-assume-note").textContent = kind === "os"
      ? `Volatilität der Aktie: ${st.under ? `1 Jahr ${F.pct(st.under.vola_1y, 1)}, 3 Monate ${F.pct(st.under.vola_3m, 1)}` : "ohne Kursdaten nicht bekannt"}. Mit dem Preis des Produkts rechnet der Rechner mit dessen impliziter Volatilität. Der Zins gilt auch für die Finanzierung der Knock-outs in der Produktliste.`
      : `Knock-outs ohne Laufzeit: Der Emittent verschiebt den Basispreis (und die Schwelle) täglich – beim Call um Zins + Marge nach oben, beim Put um Zins − Marge. Für ${call ? "diesen Call" : "diesen Put"} sind das ${F.signedPct(p.fin, 1)} p. a. Die Marge steht im Produktblatt (oft „Zinsbereinigungsfaktor“ oder „Finanzierungsspread“), üblich sind 2–4 %.`;
    syncHash();

    if (errors.length) {
      R = null;
      $("#cp-res").hidden = true;
      $("#cp-res2").hidden = true;
      paintView();
      $("#cp-msg").innerHTML = spot > 0 || sym ? `<div class="notice"><ul>${errors.map((e) => `<li class="warn">${esc(e)}</li>`).join("")}</ul></div>` : emptyState();
      list?.repaint();
      return;
    }
    const basis = price > 0 ? price : v0;
    R = { p, spot, T, expiry: kind === "os" ? expiry : koEnd, price, basis, v0, pccy, volLabel };
    $("#cp-msg").innerHTML = notes.length ? `<div class="notice"><ul>${notes.map((n) => `<li class="warn">${esc(n)}</li>`).join("")}</ul></div>` : "";
    $("#cp-res").hidden = false;
    $("#cp-res2").hidden = false;
    paintTiles(R);
    paintView();
    paintTable(R);
    $("#cp-chart-note").textContent = kind === "os" ? "bezogen auf den Preis des Scheins heute" : "bezogen auf den Preis heute, solange die Schwelle nie berührt wurde";
    paintChart();
    list?.repaint();
  }

  const productName = () => (st.product && st.product.kind === st.kind
    ? `${st.call ? "Call" : "Put"}-${st.kind === "os" ? "Optionsschein" : isMini(st.product) ? "Mini-Future" : "Turbo"}`
    : `${st.call ? "Call" : "Put"}-${st.kind === "os" ? "Optionsschein" : "Knock-out"}`);

  function paintTiles(r) {
    const { p, spot, T, basis, v0, pccy } = r;
    const dist = (x) => `${orig(x)}${F.signedPct(x / spot - 1, 1)} vom heutigen Kurs`;
    // geladenes Produkt mit seinem Briefkurs: Hebel wie beim Emittenten (onvista, so zeigt ihn auch die Trade-Republic-App);
    // der eigene rechnet mit einem leicht anderen Wechselkurs und weicht dann in der zweiten Nachkommastelle ab
    const d = st.product;
    const official = d && d.kind === p.kind && F.isNum(d.leverage) && !st.edited.size && !st.spotEdited ? Math.abs(d.leverage) : null;
    const leverage = official ?? Math.abs(M.leverage(p, spot, T, basis));
    // beim Put kann die nötige Kursmarke unter null liegen: dann ist sie nicht erreichbar
    const level = (x) => (x > 0 ? [stock(x), dist(x)] : ["nicht erreichbar", "selbst bei einem Kurs von 0"]);
    const be = level(M.priceForValue(p, basis));
    const inner = Math.max(0, (p.call ? spot - p.K : p.K - spot) * p.ratio * p.pfx);
    const levTile = [term("omega", "Hebel"), lev(leverage), `Aktie ${st.call ? "+" : "−"}1 % → ${p.kind === "os" ? "Schein" : "Produkt"} ca. +${lev(leverage)} %${official != null ? " · Angabe des Emittenten" : ""}`];
    const tiles = [];
    if (p.kind === "os") {
      const theta = (v0 - M.value(p, spot, Math.max(0, T - 1 / 365))) / basis;
      tiles.push(
        ["Wert des Scheins", money(basis, pccy), `${r.price > 0 ? "Ihr Preis" : "theoretischer Wert"}; davon ${term("zeitwert", "Zeitwert")} ${money(Math.max(0, basis - inner), pccy)} · ${r.price > 0 ? "implizite " : ""}Volatilität ${F.pct(p.vol, 1)}`],
        levTile,
        checkTile(r),
        ["Gewinnschwelle bei Fälligkeit", ...be],
        ["Totalverlust bei Fälligkeit", `${st.call ? "unter" : "über"} ${stock(p.K)}`, `${dist(p.K)} · am ${F.date(r.expiry)}`],
        ["Zeitwertverlust pro Tag", F.signedPct(-theta, 2), `ca. ${money(theta * basis, pccy)} je Schein, wenn die Aktie stillsteht; wird zum Ende hin größer`],
      );
    } else {
      const rest = M.value(p, p.B, 0);
      // Wertänderung in einem Monat bei gleichem Kurs: Finanzierung (ohne Laufzeit) bzw. Abschmelzen des Terminwerts
      const month = (M.value(p, spot, Math.max(0, T - 1 / 12), 1 / 12) - M.value(p, spot, T)) / basis;
      tiles.push(
        ["Wert des Produkts", money(basis, pccy), r.price > 0 ? `innerer Wert ${money(inner, pccy)}` : "innerer Wert (ohne Aufgeld)"],
        levTile,
        checkTile(r),
        ["Gewinnschwelle", ...be],
        ["Knock-out", `bei ${stock(p.B)}`, `${dist(p.B)} · eine Berührung genügt${rest > 0 ? `; Restwert ca. ${money(rest, pccy)}` : ", dann wertlos"}`],
        p.openEnd
          ? ["Finanzierung pro Monat", F.signedPct(month, 2), `Basispreis ${p.call ? "steigt" : "ändert sich"} um ${F.signedPct(p.fin, 1)} p. a. (Zins ${p.call ? "+" : "−"} Marge, Annahme); kostet bei gleichem Kurs ca. ${money(-month * basis, pccy)} im Monat`]
          : ["Finanzierung pro Monat", F.signedPct(month, 2), `steckt im Preis: Knock-out mit Fälligkeit${r.expiry ? ` am ${F.date(r.expiry)}` : ""}, sein Wert nähert sich bis dahin dem inneren Wert (Zins ${F.pct(p.r, 1)})`],
      );
    }
    $("#cp-tiles").innerHTML = tiles.map(([label, value, sub], i) => `<div class="tile${i === 1 ? " highlight" : ""}"><div class="label">${label}</div>
      <div class="value num">${value}</div><div class="sub">${sub}</div></div>`).join("");
  }

  // Preis-Check: eingegebener Preis gegenüber dem fairen Wert (Optionsschein: Black-Scholes mit der Schwankung aus
  // „Ihre Erwartung“; Knock-out: innerer Wert), beim geladenen Optionsschein dazu ähnliche Scheine aus der Liste
  function checkTile(r) {
    const { p, spot, T, basis, pccy } = r;
    const label = term("preischeck", "Preis-Check");
    if (!(r.price > 0)) return [label, "–", "Preis des Produkts eingeben, dann zeigt der Rechner, ob er über oder unter dem fairen Wert liegt"];
    const sigma = sigmaNow();
    const fair = M.fairValue(p, spot, T, sigma);
    if (!(fair > 0.0005)) return [label, "–", "fairer Wert praktisch null"];
    const check = basis / fair - 1;
    const value = `<span class="${check < 0 ? "good" : ""}">${signed(check)}</span>`;
    if (p.kind === "ko") {
      const what = p.openEnd ? "innerer Wert" : `Terminwert (Zins ${F.pct(p.r, 1)} bis zur Fälligkeit)`;
      return [label, value, `fairer Wert = ${what} ${money(fair, pccy)}${check >= 0 ? "; der Aufschlag ist der Preis für Spanne und Aufgeld" : ""}`];
    }
    const peer = st.product && st.product.kind === "os" && list ? list.peers(st.product) : null;
    return [label, value, `fairer Wert ${money(fair, pccy)} bei ${F.pct(sigma, 0)} Schwankung p. a.${peer
      ? ` · gegenüber ${peer.n} ähnlichen Scheinen anderer Emittenten ${signed(peer.check)}` : ""}`];
  }

  // Ihre Erwartung: Knöpfe, Hinweise und das Ergebnis für das Produkt im Rechner
  function paintView() {
    const now = parseNum(field("cp-spot").value);
    $("#cp-view").hidden = !(now > 0);
    const sc = scenario();
    const out = $("#cp-what");
    $("#cp-chg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(Boolean(sc) && Math.abs(sc.g - 1 - Number(b.dataset.chg)) < 0.0005)));
    $("#cp-hz").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(field("cp-wd").value === horizonDay(Number(b.dataset.hz)))));
    const u = st.under;
    $("#cp-sig-h").textContent = u ? `bisher: 1 Jahr ${F.pct(u.vola_1y, 0)}, 3 Monate ${F.pct(u.vola_3m, 0)}` : "";
    if (!sc) { $("#cp-ws-h").textContent = ""; $("#cp-range").textContent = ""; out.innerHTML = '<span class="muted">Kurs eingeben</span>'; return; }
    $("#cp-ws-h").textContent = `${signed(sc.g - 1)} gegenüber heute (${stock(now / fxNow())})`;
    const [a, b] = M.likelyRange(sc.S, sc.sigma, sc.t);
    $("#cp-range").textContent = sc.t > 0
      ? `Bei ${F.pct(sc.sigma, 0)} Schwankung p. a. liegt die Aktie am ${F.date(sc.day)} in 2 von 3 Fällen zwischen ${stock(a)} und ${stock(b)}. Je unsicherer Sie sind, desto höher die Schwankung.`
      : "Heute: Die Rechnung gilt genau für diesen Kurs.";
    if (!R) { out.innerHTML = '<span class="muted">Für ein Ergebnis oben ein Produkt laden oder seine Daten eingeben.</span>'; return; }
    const { p, spot, basis, pccy, T } = R;
    const end = R.expiry && sc.day > R.expiry ? R.expiry : sc.day;
    const el = years(today(), end);
    // endet der Schein vor Ihrem Tag: Kurs an seinem Fälligkeitstag anteilig (wie in M.outlook)
    const S = end < sc.day && sc.t > 0 ? spot * sc.g ** (el / sc.t) : sc.S;
    const v = M.value(p, S, R.expiry ? Math.max(0, T - el) : 0, el);
    const chg = v / basis - 1;
    const when = end === today() ? "sofort" : R.expiry && end === R.expiry ? `bei Fälligkeit am ${F.date(end)}` : `am ${F.date(end)}`;
    const B = p.B * M.drift(p, el);
    const ko = p.kind === "ko" && (p.call ? S <= B : S >= B);
    const o = M.outlook(p, spot, sc.g, sc.sigma, sc.t, T, basis);
    const pc = (x) => `<b class="num">${F.pct(x, 0)}</b>`;
    out.innerHTML = `<div><span class="muted">Genau so:</span> Aktie ${signed(S / spot - 1)} auf ${stock(S)} ${when} →
        ${ko ? "<b>ausgeknockt</b>, " : ""}${esc(productName())} ca. <b class="num">${money(v, pccy)}</b>
        <b class="num ${chg >= 0 ? "good" : "bad"}">${signed(chg)}</b>
        ${p.kind === "ko" && !ko ? '<span class="muted">(wenn die Schwelle bis dahin nie berührt wurde)</span>' : ""}</div>
      <div class="cp-outlook"><span class="muted">Mit Schwankung:</span> im Durchschnitt <b class="num ${o.mean >= 0 ? "good" : "bad"}">${signed(o.mean)}</b>
        · Gewinnchance ${pc(o.chance)} · Verlust über 50 % ${pc(o.loss50)}${o.ko != null ? ` · Knock-out-Risiko bis dahin ${pc(o.ko)}` : ""}
        ${R.expiry && sc.day > R.expiry ? `<span class="muted">(bei Fälligkeit am ${F.date(R.expiry)})</span>` : ""}</div>`;
  }

  function paintTable(r) {
    const { p, spot, T, basis, pccy } = r;
    const wd = field("cp-wd").value;
    const el = wd > today() ? years(today(), wd) : 0;
    const midT = p.kind === "os" && wd > today() && wd < r.expiry ? years(wd, r.expiry) : null;
    // [Überschrift, Restlaufzeit, vergangene Zeit (Finanzierung der Knock-outs)]
    const cols = p.kind === "os"
      ? [["sofort", T, 0], ...(midT != null ? [[`am ${F.date(wd)}`, midT, el]] : []), [`bei Fälligkeit ${F.date(r.expiry)}`, 0, 0]]
      : [["sofort", T, 0], ...((p.openEnd || T > 0) && el > 0 ? [[`am ${F.date(wd)}`, Math.max(0, T - el), el]] : [])];
    const cell = (S, tt, e) => {
      const v = M.value(p, S, tt, e);
      const chg = v / basis - 1;
      const B = p.B * M.drift(p, e);
      const ko = p.kind === "ko" && (p.call ? S <= B : S >= B);
      const label = ko ? (v > 0 ? `ausgeknockt, Restwert ${money(v, pccy)}` : "ausgeknockt") : v < 0.0005 ? "wertlos" : money(v, pccy);
      return `<td><b class="${chg >= 0 ? "good" : "bad"}">${F.signedPct(chg, chg <= -0.995 ? 0 : 1)}</b><span class="muted cp-v">${label}</span></td>`;
    };
    const rows = STEPS.map((s) => {
      const S = spot * (1 + s);
      return `<tr class="${s === 0 ? "cp-now" : ""}"><td>${stock(S)}</td><td>${s === 0 ? "heute" : F.signedPct(s, 0)}</td>${cols.map(([, tt, e]) => cell(S, tt, e)).join("")}</tr>`;
    }).join("");
    $("#cp-table").innerHTML = `<thead><tr><th>Aktie</th><th>Veränderung</th>${cols.map(([l]) => `<th>${esc(l)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody>`;
    $("#cp-table-note").textContent = `Gewinn oder Verlust gegenüber ${money(basis, pccy)} je Schein${p.kind === "ko" && cols.length > 1 ? "; spätere Tage mit Finanzierungskosten" : ""}`;
  }

  function chartOption(r, t) {
    const { p, spot, T, basis, pccy } = r;
    const sc = scenario();
    let lo = Math.min(spot * 0.7, p.K * 0.9);
    let hi = Math.max(spot * 1.3, p.K * 1.1);
    if (p.kind === "ko") { lo = Math.min(lo, p.B * 0.95); hi = Math.max(hi, p.B * 1.05); }
    if (sc) {
      const [a, b] = M.likelyRange(sc.S, sc.sigma, sc.t);
      lo = Math.min(lo, a * 0.9, sc.S * 0.95);
      hi = Math.max(hi, b * 1.1, sc.S * 1.05);
    }
    // ab hier Anzeige-Währung (Euro); Achsengrenzen auf glatte Werte, die Kurven füllen die ganze Breite
    const ax = axisRange(Math.max(lo, spot * 0.3) * p.fx, Math.min(hi, spot * 2.5) * p.fx);
    ({ lo, hi } = ax);
    const xs = Array.from({ length: 241 }, (_, i) => lo + ((hi - lo) * i) / 240);
    const curve = (tt, e = 0) => xs.map((x) => { const v = M.value(p, x / p.fx, tt, e); return [x, v / basis - 1, v]; });
    const wd = field("cp-wd").value;
    const el = wd > today() ? years(today(), wd) : 0;
    const series = p.kind === "os"
      ? [C.line("sofort", curve(T), t.series[0]),
        ...(wd > today() && wd < r.expiry ? [C.line(`am ${F.date(wd)}`, curve(years(wd, r.expiry)), t.series[1])] : []),
        C.line("bei Fälligkeit", curve(0), t.series[2])]
      : [C.line((p.openEnd || T > 0) && el > 0 ? "sofort" : productName(), curve(T), t.series[0]),
        ...((p.openEnd || T > 0) && el > 0 ? [C.line(`am ${F.date(wd)} (mit Finanzierung)`, curve(Math.max(0, T - el), el), t.series[1])] : [])];
    // senkrechte Marken, beschriftet über dem Diagramm; liegen zwei dicht beieinander, kommt die zweite eine Zeile höher
    const [now, K, B, be] = [spot, p.K, p.B, M.priceForValue(p, basis)].map((x) => x * p.fx);
    const marks = [
      [now, "Kurs jetzt", t.secondary],
      [K, p.kind === "ko" && p.B === p.K ? "Basispreis = Knock-out" : "Basispreis", t.muted],
      ...(p.kind === "ko" && p.B !== p.K ? [[B, "Knock-out", t.critical]] : []),
      ...(be > lo && be < hi && Math.abs(be - now) > (hi - lo) * 0.005 ? [[be, "Gewinnschwelle", t.good]] : []),
      ...(sc && Math.abs(sc.g - 1) > 0.005 ? [[sc.S * p.fx, "Ihre Erwartung", t.good]] : []),
    ].sort((a, b) => a[0] - b[0]);
    const rowEnds = [];
    const lines = marks.map(([x, label, color]) => {
      let row = rowEnds.findIndex((end) => x - end >= (hi - lo) * 0.14);
      if (row < 0) row = rowEnds.push(x) - 1; else rowEnds[row] = x;
      return { xAxis: x, label: { formatter: label, color, position: "end", distance: 4 + row * 16, fontSize: 11 }, lineStyle: { color, type: "dashed", width: 1 } };
    });
    series[0].markLine = {
      symbol: "none", silent: true,
      data: [...lines, { yAxis: 0, label: { show: false }, lineStyle: { color: t.baseline, type: "solid", width: 1 } }],
    };
    if (p.kind === "ko") {
      series[0].markArea = { silent: true, itemStyle: { color: t.critical, opacity: 0.08 },
        data: [[{ xAxis: p.call ? lo : B }, { xAxis: p.call ? B : hi }]] };
    }
    const dens = sc ? densitySeries(t, xs, sc.S, sc, p.fx) : null;
    const legend = series.length > 1;
    return {
      ...C.base(t),
      legend: { ...C.base(t).legend, show: legend },
      grid: { ...C.base(t).grid, top: (legend ? 34 : 8) + rowEnds.length * 16 + 6 },
      tooltip: {
        ...C.base(t).tooltip,
        formatter: (params) => {
          const list = (Array.isArray(params) ? params : [params]).filter((q) => q.seriesId !== "dichte");
          if (!list.length) return "";
          const x = list[0].value[0];
          const rows = list.map((q) => `<div style="display:flex;gap:12px;justify-content:space-between"><span>${q.marker}${esc(q.seriesName)}</span>
            <b>${F.signedPct(q.value[1], 0)} <span style="font-weight:400;opacity:.7">${money(q.value[2], pccy)}</span></b></div>`);
          return `<div style="min-width:220px"><div style="margin-bottom:4px;opacity:.7">Aktie ${F.money(x, pccy)} (${F.signedPct(x / now - 1, 1)})</div>${rows.join("")}</div>`;
        },
      },
      xAxis: C.valueAxis(t, { min: lo, max: hi, interval: ax.step, splitLine: { show: false }, axisLine: { show: true, lineStyle: { color: t.baseline } } }),
      yAxis: [C.valueAxis(t, { axisLabel: { color: t.muted, formatter: (v) => `${F.num(v * 100, 0)} %` } }), ...(dens ? [dens.axis] : [])],
      series: dens ? [...series, dens.series] : series,
    };
  }

  function emptyState() {
    return `<div class="card"><p class="muted">Laden Sie oben ein Produkt per ISIN oder WKN, oder wählen Sie eine Aktie bzw. einen Index –
      dann erscheinen darunter die passenden Optionsscheine und Knock-outs. Sie können den Kurs und die Daten aus dem Produktblatt
      auch selbst eingeben.</p>
      <div class="preset-row" style="margin-top:0">${EXAMPLES.map(([s, n]) => `<button class="btn" type="button" data-example="${esc(s)}">${esc(n)}</button>`).join("")}</div></div>`;
  }

  function syncHash() {
    const q = new URLSearchParams();
    if (st.product) q.set("p", st.product.isin);
    if (sym) q.set("s", sym);
    q.set("art", st.kind);
    q.set("typ", st.call ? "call" : "put");
    // mit Produkt nur die eigenen Änderungen; die Stammdaten kommen beim Öffnen frisch von onvista
    const userSet = st.product ? st.edited : st.touched;
    const keep = { k: "cp-k", b: "cp-b", bv: "cp-ratio", bis: "cp-exp", preis: "cp-price" };
    for (const [k, id] of Object.entries(keep)) {
      if (k === "b" && st.kind !== "ko") continue;
      if (k === "bis" && st.kind !== "os") continue;
      if (userSet.has(id) && field(id).value.trim()) q.set(k, field(id).value.trim());
    }
    const v = list ? list.selected() : compareInit;
    if (v.length) q.set("v", v.join(","));
    for (const [k, x] of Object.entries(viewParams())) q.set(k, x);
    history.replaceState(history.state, "", `#/callput?${q}`);
  }

  // ---- Eingaben
  $("#cp-msg").addEventListener("click", (e) => { const b = e.target.closest("[data-example]"); if (b) pick(b.dataset.example); });
  $("#cp-kind").addEventListener("click", (e) => {
    const b = e.target.closest("[data-kind]");
    if (!b || b.dataset.kind === st.kind) return;
    st.kind = b.dataset.kind;
    st.touched.delete("cp-k"); st.touched.delete("cp-b"); // anderer Produkttyp, anderer üblicher Basispreis
    dropProduct();
    list?.setKind(st.kind, st.call);
    paintSegments(); defaults(); calc();
  });
  $("#cp-dir").addEventListener("click", (e) => {
    const b = e.target.closest("[data-dir]");
    if (!b || (b.dataset.dir === "call") === st.call) return;
    st.call = b.dataset.dir === "call";
    st.touched.delete("cp-k"); st.touched.delete("cp-b");
    dropProduct();
    list?.setKind(st.kind, st.call);
    paintSegments(); defaults(); calc();
  });
  root.addEventListener("input", (e) => {
    const id = e.target.id;
    // Felder der Produktliste (Basispreis von/bis) und die Produktsuche gehören nicht zum Rechner
    if (!id || id === "cp-sym" || id === "cp-isin" || !id.startsWith("cp-")) return;
    if (id !== "cp-spot") st.touched.add(id);
    else { $("#cp-spot-h").textContent = ""; st.spotEdited = true; }
    if (st.product && id in REVERSE_KEEP) st.edited.add(id);
    if (id === "cp-k" || id === "cp-spot" || id === "cp-exp") defaults();
    if (id === "cp-ws" || id === "cp-wd" || id === "cp-sig") { viewChanged(); return; }
    calc();
  });
  // Erwartung geändert: Ergebnis, Tabelle, Diagramm, Liste und Vergleich neu rechnen (der Preis-Check hängt an der Schwankung)
  const viewChanged = () => {
    syncHash();
    paintView();
    if (R) { paintTiles(R); paintTable(R); paintChart(); }
    list?.repaint();
  };
  $("#cp-chg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-chg]");
    const now = parseNum(field("cp-spot").value);
    if (!b || !(now > 0)) return;
    field("cp-ws").value = inputNum(now * (1 + Number(b.dataset.chg)), 2);
    st.touched.add("cp-ws");
    viewChanged();
  });
  $("#cp-hz").addEventListener("click", (e) => {
    const b = e.target.closest("[data-hz]");
    if (!b) return;
    field("cp-wd").value = horizonDay(Number(b.dataset.hz));
    st.touched.add("cp-wd");
    viewChanged();
  });

  paintSegments();

  // ---- Produkt laden (ISIN/WKN aus der Adresse): bestimmt Produktart, Richtung und Basiswert
  if (pid) {
    $("#cp-prod").innerHTML = '<div class="cp-prod"><span class="muted"><span class="spinner inline"></span>Lade Produkt von onvista …</span></div>';
    try {
      st.product = await api.derivative(pid);
    } catch (e) {
      if (!isCurrent()) return;
      st.productError = e.message;
    }
    if (!isCurrent()) return;
    const d = st.product;
    if (d) {
      if (["os", "ko"].includes(d.kind)) { st.kind = d.kind; st.call = d.call; }
      sym = d.under?.symbol || sym;
      $("#cp-sym").value = sym;
      $("#cp-isin").value = d.isin;
      paintSegments();
    } else {
      applyParams();
    }
  }

  // ---- Produkte auf die Aktie (Liste und Vergleich)
  if (sym) {
    list = productList($("#cp-list"), $("#cp-cmp"), {
      symbol: sym, mode: "embedded", kind: () => st.kind, call: () => st.call, market, scenario,
      current: () => st.product?.isin, open: openProduct, compare: compareInit,
      bigLink: () => `#/hebel?${new URLSearchParams({ s: sym, art: st.kind, typ: st.call ? "call" : "put", ...viewParams() })}`,
      changed: () => { syncHash(); paintProduct(); },
      loaded: () => { if (R) paintTiles(R); }, // Preis-Check: ähnliche Scheine aus der Liste
    });
    list.load();
  }
  paintProduct();
  if (!sym) {
    if (st.product) {
      fillFromProduct();
      $("#cp-under").innerHTML = `<span class="muted">Den Basiswert ${esc(st.product.under?.name || "")} kennt Yahoo nicht unter seiner ISIN
        ${esc(st.product.under?.isin || "")}. Bitte Kurs und Volatilität selbst eingeben oder oben die Aktie suchen.</span>`;
    }
    applyView(); defaults(); calc(); return;
  }

  // ---- Basiswert laden
  $("#cp-under").innerHTML = '<span class="muted"><span class="spinner inline"></span>Lade Kurs und Volatilität …</span>';
  let u;
  try {
    u = await api.underlying(sym);
  } catch (e) {
    if (!isCurrent()) return;
    $("#cp-under").innerHTML = `<span class="bad">${esc(e.message)}</span> <span class="muted">Sie können den Kurs auch selbst eingeben.</span>`;
    if (st.product) fillFromProduct();
    applyView(); defaults(); calc();
    return;
  }
  if (!isCurrent()) return;
  st.under = u;
  st.ccy = u.currency || "EUR";
  st.eur = u.eur || null;
  const vol = u.vola_1y ?? u.vola_3m;
  st.volLabel = u.vola_1y != null ? "historisch, 1 Jahr" : "historisch, 3 Monate";
  field("cp-spot").value = inputNum(u.price * fxNow(), 2);
  field("cp-vol").value = inputNum((vol ?? 0.3) * 100, 1);
  if (vol == null) st.volLabel = "Annahme";
  field("cp-div").value = inputNum((u.div_yield ?? 0) * 100, 2);
  $("#cp-under").innerHTML = `<a href="#/aktie/${encodeURIComponent(u.symbol)}">${esc(u.name)}</a> <span class="muted">· ${esc(u.symbol)} ·</span>
    <b class="num">${stock(u.price)}</b>${foreign() ? ` <span class="muted">(${F.money(u.price, st.ccy)})</span>` : ""}
    <span class="${(u.change ?? 0) >= 0 ? "good" : "bad"}">${F.signedPct(u.change, 2)}</span>
    <span class="muted">· Volatilität 1 Jahr ${F.pct(u.vola_1y, 0)}, 3 Monate ${F.pct(u.vola_3m, 0)}${u.div_yield ? ` · Dividendenrendite ${F.pct(u.div_yield, 1)}` : ""}</span>`;
  if (st.product) fillFromProduct();
  applyView();
  defaults();
  calc();
}

// Eingabefelder, die in der Adresse stehen können (mit Produkt: nur nach eigener Änderung)
const REVERSE_KEEP = { "cp-k": "k", "cp-b": "b", "cp-ratio": "bv", "cp-exp": "bis", "cp-price": "preis" };

const money = (x, ccy) => F.money(x, ccy, Math.abs(x) < 1 ? 3 : 2);
