// Große Tabelle der Hebelprodukte auf eine Aktie: alle Produkte (bis 6.000, siehe derivate.listing_all) liegen im
// Browser, werden hier gefiltert und nach jeder Spalte sortiert – auch nach Preis-Check, „vs. ähnliche“ und Ihrer
// Erwartung. Drei Ansichten: Liste, Matrix (Optionsscheine: Laufzeit × Basispreis, Knock-outs: Abstand × Art) und
// Landkarte (jedes Produkt als Punkt, nach Emittent gefärbt).
// Genutzt auf der Seite „Optionsscheine & Knock-outs“ (hebel.js, mode "page") und im Call/Put-Rechner ("embedded").
// Filter, Sortierung und Spalten bleiben im Browser gespeichert (je Produktart), der Basispreis-Bereich nur für die Aktie,
// für die er eingegeben wurde. Gibt es mehr Produkte, als auf einmal geladen werden (Dax), gehen die Filter, die onvista
// kennt, mit an den Server.
import { api } from "./api.js";
import { NOT_TR_TAG, setTrOnly, trOnly } from "./broker.js";
import * as C from "./charts.js";
import {
  expect, figures, isMini, lev, level, model, money, peersAll, productPrice, stamp,
} from "./derivmodel.js";
import * as F from "./format.js";
import { term } from "./glossary.js";
import * as M from "./optionmath.js";

const esc = F.escapeHtml;
const NEW_DAYS = 7;
const PAGE_SIZES = [25, 50, 100, 250];
const SPREAD_OPTS = [["", "alle"], ["1", "bis 1 %"], ["2", "bis 2 %"], ["5", "bis 5 %"]];
const LEVERAGE_OPTS = [["", "alle"], ["5", "bis 5"], ["10", "5–10"], ["20", "10–20"], ["20+", "über 20"]];
const RANGES = {
  hb: { 5: [null, 5], 10: [5, 10], 20: [10, 20], "20+": [20, null] },
  ab: { 5: [null, 5], 10: [5, 10], 20: [10, 20], "20+": [20, null] },
  lz: { "3m": [0, 3], "6m": [3, 6], "12m": [6, 12], lang: [12, null] }, // Monate ab heute (Optionsscheine)
};
// Schnellfilter je Produktart: [Schlüssel, Überschrift, [[Wert, Beschriftung]]]
const QUICK = {
  os: [
    ["lz", "Laufzeit", [["", "alle"], ["3m", "bis 3 Mon."], ["6m", "3–6 Mon."], ["12m", "6–12 Mon."], ["lang", "über 1 Jahr"]]],
    ["gm", "Basispreis", [["", "alle"], ["itm", "im Geld"], ["atm", "am Geld"], ["otm", "aus dem Geld"]]],
    ["hb", "Hebel (Omega)", LEVERAGE_OPTS],
    ["sp", "Spanne", SPREAD_OPTS],
  ],
  ko: [
    ["ty", "Art", [["", "alle"], ["turbo", "Turbo"], ["mini", "Mini-Future"]]],
    ["lz", "Laufzeit", [["", "alle"], ["open", "Open End"], ["fix", "mit Fälligkeit"]]],
    ["ab", "Abstand zur Schwelle", [["", "alle"], ["5", "bis 5 %"], ["10", "5–10 %"], ["20", "10–20 %"], ["20+", "über 20 %"]]],
    ["hb", "Hebel", LEVERAGE_OPTS],
    ["sp", "Spanne", SPREAD_OPTS],
  ],
};
const FILTER_KEYS = ["lz", "gm", "hb", "ab", "ty", "bp", "em", "sp", "pc", "pr", "au", "qu", "neu", "q"];
const SESSION_ONLY = ["bp", "q"]; // gelten nur für die aktuelle Aktie bzw. Sitzung
const blank = () => Object.fromEntries(FILTER_KEYS.map((k) => [k, ""]));
const DEFAULT_SORT = { os: ["near", 1], ko: ["barrier", 1] }; // am Geld zuerst bzw. kleinster Abstand zur Schwelle
const DEFAULT_COLS = {
  page: {
    os: ["issuer", "strike", "expiry", "ask", "spread", "spreadU", "leverage", "iv", "be", "check", "peer", "mean", "chance"],
    ko: ["issuer", "barrier", "expiry", "ask", "spread", "spreadU", "leverage", "be", "check", "mean", "chance", "ko"],
  },
  embedded: {
    os: ["issuer", "strike", "expiry", "ask", "spread", "leverage", "iv", "check", "peer", "mean", "chance"],
    ko: ["issuer", "barrier", "strike", "expiry", "ask", "spread", "leverage", "check", "mean", "chance", "ko"],
  },
};

// ---------------------------------------------------------------- gespeicherte Einstellungen
function readStore(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }
function writeStore(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* nur für diese Sitzung */ } }
const saved = readStore("hebelFilter") || {};
const S = {
  os: { ...blank(), ...(saved.os || {}) }, ko: { ...blank(), ...(saved.ko || {}) },
  sort: { ...DEFAULT_SORT, ...(readStore("hebelSort") || {}) },
  cols: readStore("hebelSpalten") || {},
  symbol: null,
};
for (const k of SESSION_ONLY) { S.os[k] = ""; S.ko[k] = ""; }
const persist = () => {
  // gespeichert werden Knöpfe und Grenzwerte; eigene Bereiche („von;bis“, etwa aus der Matrix) gelten nur, solange man sucht
  const strip = (f) => Object.fromEntries(Object.entries(f).filter(([k, v]) => !SESSION_ONLY.includes(k) && !String(v).includes(";")));
  writeStore("hebelFilter", { os: strip(S.os), ko: strip(S.ko) });
  writeStore("hebelSort", S.sort);
};

// ---------------------------------------------------------------- Filter
const splitRange = (v) => { const [a = "", b = ""] = String(v).split(";"); return [a.trim(), b.trim()]; };
const numOrNull = (x) => (x === "" || x == null ? null : F.parseNum(x));
// Bereich aus Knopf-Kürzel oder eigener Eingabe "von;bis" (Zahlen; null = offen)
function numRange(key, v) {
  if (!v) return null;
  if (RANGES[key]?.[v]) return RANGES[key][v];
  if (!String(v).includes(";")) return null;
  const [a, b] = splitRange(v).map(numOrNull);
  return a == null && b == null ? null : [a, b];
}
// Laufzeit der Optionsscheine als Tage [von, bis] (JJJJ-MM-TT; null = offen)
function dateRange(v) {
  if (!v) return null;
  const m = RANGES.lz[v];
  if (m) return [m[0] ? M.addMonths(m[0]) : null, m[1] != null ? M.addMonths(m[1]) : null];
  const [a, b] = splitRange(v);
  const ok = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  return ok(a) || ok(b) ? [ok(a), ok(b)] : null;
}
const inRange = (x, r) => x != null && Number.isFinite(x) && (r[0] == null || x >= r[0]) && (r[1] == null || x <= r[1]);
const fmtNum = (x) => (x == null ? "" : F.num(x, Number.isInteger(x) ? 0 : 2).replace("-", "−"));
const rangeText = (r, unit = "") => (r[0] != null && r[1] != null ? `${fmtNum(r[0])}${r[0] < 0 || r[1] < 0 ? " bis " : "–"}${fmtNum(r[1])}${unit}`
  : r[0] != null ? `ab ${fmtNum(r[0])}${unit}` : `bis ${fmtNum(r[1])}${unit}`);
const daysSince = (day) => (day ? (Date.parse(`${M.today()}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000 : Infinity);
const moneyness = (it) => (it.m ? it.m.p.K / it.m.S0 - 1 : null);
const koDistance = (it) => (it.m ? Math.abs(it.m.p.B / it.m.S0 - 1) : null);

/** Aktive Filter einer Produktart: [{key, label, test(it)}]. issuers: Kennung -> Name (für die Beschriftung). */
function activeFilters(kind, f, issuers = {}) {
  const out = [];
  const add = (key, label, test) => out.push({ key, label, test });
  if (f.lz) {
    if (kind === "os") {
      const r = dateRange(f.lz);
      const preset = QUICK.os[0][2].find(([v]) => v === f.lz);
      if (r) add("lz", preset ? `Laufzeit ${preset[1]}` : `Fälligkeit ${r[0] ? `ab ${F.date(r[0])}` : ""}${r[0] && r[1] ? " " : ""}${r[1] ? `bis ${F.date(r[1])}` : ""}`,
        (it) => it.d.expiry && (!r[0] || it.d.expiry >= r[0]) && (!r[1] || it.d.expiry <= r[1]));
    } else if (f.lz === "open") add("lz", "Open End", (it) => it.d.open_end || !it.d.expiry);
    else if (f.lz === "fix") add("lz", "mit Fälligkeit", (it) => !it.d.open_end && Boolean(it.d.expiry));
  }
  if (kind === "ko" && f.ty) add("ty", f.ty === "mini" ? "Mini-Futures" : "Turbos", (it) => isMini(it.d) === (f.ty === "mini"));
  if (kind === "os" && f.gm) {
    const r = ["itm", "atm", "otm"].includes(f.gm) ? null : numRange("gm", f.gm);
    if (r) add("gm", `Basispreis ${rangeText(r, " %")} vom Kurs`, (it) => inRange(moneyness(it) * 100, r));
    else if (!r && ["itm", "atm", "otm"].includes(f.gm)) {
      const label = { itm: "im Geld", atm: "am Geld (±5 %)", otm: "aus dem Geld" }[f.gm];
      add("gm", `Basispreis ${label}`, (it) => {
        const k = moneyness(it);
        if (k == null) return false;
        if (f.gm === "atm") return Math.abs(k) <= 0.05;
        return (f.gm === "itm") === (it.d.call ? k < -0.05 : k > 0.05) && Math.abs(k) > 0.05;
      });
    }
  }
  const hb = numRange("hb", f.hb);
  if (hb) add("hb", `${kind === "os" ? "Omega" : "Hebel"} ${rangeText(hb)}`, (it) => inRange(it.f.leverage, hb));
  const ab = kind === "ko" ? numRange("ab", f.ab) : null;
  if (ab) add("ab", `Abstand ${rangeText(ab, " %")}`, (it) => inRange(koDistance(it) * 100, ab));
  const bp = numRange("bp", f.bp);
  if (bp) add("bp", `Basispreis ${rangeText(bp)}`, (it) => inRange(it.d.strike, bp));
  const em = f.em ? f.em.split(",").filter(Boolean) : [];
  if (em.length) add("em", em.length === 1 ? `Emittent ${issuers[em[0]] || em[0]}` : `${em.length} Emittenten`, (it) => em.includes(String(it.d.issuer_id)));
  const sp = numOrNull(f.sp);
  if (sp != null) add("sp", `Spanne höchstens ${fmtNum(sp)} %`, (it) => it.d.spread != null && it.d.spread * 100 <= sp + 1e-9);
  const pc = numOrNull(f.pc);
  if (pc != null) add("pc", `Preis-Check höchstens ${F.signedPct(pc / 100, Number.isInteger(pc) ? 0 : 1)}`, (it) => it.m?.check != null && it.m.check * 100 <= pc + 1e-9);
  const pr = numRange("pr", f.pr);
  if (pr) add("pr", `Brief ${rangeText(pr, " €")}`, (it) => inRange(productPrice(it.d), pr));
  if (kind === "os" && f.au) add("au", f.au === "a" ? "amerikanisch" : "europäisch", (it) => it.d.american === (f.au === "a"));
  if (f.qu) add("qu", "ohne Quanto", (it) => !it.d.quanto);
  if (f.neu) add("neu", `neu (seit ${NEW_DAYS} Tagen)`, (it) => daysSince(it.d.first_day) <= NEW_DAYS);
  const q = (f.q || "").trim().toUpperCase();
  if (q) add("q", `„${f.q.trim()}“`, (it) => [it.d.wkn, it.d.isin, it.d.issuer].some((x) => String(x || "").toUpperCase().includes(q)));
  return out;
}

// Filter, die onvista selbst kennt (siehe derivate.filters_from): gehen nur mit, wenn nicht alle Produkte geladen sind
function serverParams(kind, f) {
  const p = {};
  const put = (a, b, r) => { if (r?.[0] != null) p[a] = String(r[0]); if (r?.[1] != null) p[b] = String(r[1]); };
  if (kind === "os") {
    const r = dateRange(f.lz);
    if (r) { if (r[0]) p.faellig_von = r[0]; if (r[1]) p.faellig_bis = r[1]; }
  } else {
    if (f.lz) p.laufzeit = f.lz;
    if (f.ty) p.ko = f.ty;
    put("abstand_von", "abstand_bis", numRange("ab", f.ab));
  }
  put("hebel_von", "hebel_bis", numRange("hb", f.hb));
  put("von", "bis", numRange("bp", f.bp));
  const em = f.em ? f.em.split(",").filter(Boolean) : [];
  if (em.length === 1) p.emittent = em[0];
  return p;
}

// ---------------------------------------------------------------- Spalten
const signed = (x, d = 1) => (F.isNum(x) ? F.signedPct(x, Math.abs(x) >= 0.995 ? 0 : d) : "–");
const retCell = (x) => `<td>${F.isNum(x) ? `<b class="${x >= 0 ? "good" : "bad"}">${signed(x)}</b>` : "–"}</td>`;
const checkCell = (x, title = "") => `<td${title}>${F.isNum(x) ? `<span class="${x < 0 ? "good" : ""}">${signed(x)}</span>` : "–"}</td>`;
const distance = (x, m) => (m ? `<span class="muted cp-v">${F.signedPct(x / m.S0 - 1, 0)}</span>` : "");
const isNew = (d) => daysSince(d.first_day) <= NEW_DAYS;
const eur = (x) => money(x, "€");
const csvNum = (x, digits = 4) => (F.isNum(x) ? String(Number(x.toFixed(digits))).replace(".", ",") : "");

// key, label, Lexikon-Eintrag, Produktarten, erste Sortierrichtung, Wert zum Sortieren, Zelle, CSV, Erklärung
const COLUMNS = [
  { key: "issuer", label: "Emittent", left: true, dir: 1, value: (it) => it.d.issuer || "",
    cell: ({ d }) => `<td class="txt">${esc(d.issuer || "–")}<div class="sub">WKN ${esc(d.wkn || "–")}${d.tr ? "" : NOT_TR_TAG}${
      isMini(d) ? '<span class="tag">Mini-Future</span>' : ""}${d.quanto ? '<span class="tag" title="Währungsgesichert: 1 Einheit der Aktienwährung = 1 €">Quanto</span>' : ""}${
      isNew(d) ? `<span class="tag" title="Erster Handelstag ${F.date(d.first_day)}">neu</span>` : ""}${
      d.ask == null ? '<span class="tag off" title="Der Emittent stellt gerade keinen Briefkurs: zurzeit nicht kaufbar. Gerechnet wird mit dem Geldkurs.">kein Brief</span>' : ""}</div></td>`,
    csv: (it) => it.d.issuer || "" },
  { key: "strike", label: "Basispreis", term: "basispreis", unit: true, dir: 1, value: (it) => it.d.strike,
    cell: ({ d, m }) => `<td>${level(d.strike)}${distance(m?.p.K, m)}</td>`, csv: (it) => csvNum(it.d.strike) },
  { key: "barrier", label: "Knock-out", term: "knockout", unit: true, kinds: "ko", dir: 1, value: koDistance,
    title: "Schwelle und ihr Abstand zum Kurs; sortiert nach Abstand",
    cell: ({ d, m }) => `<td>${level(d.barrier)}${distance(m?.p.B, m)}${m?.knocked ? ' <span class="tag off">ausgeknockt?</span>' : ""}</td>`,
    csv: (it) => csvNum(it.d.barrier) },
  { key: "expiry", label: "Fälligkeit", dir: 1, value: (it) => (it.d.open_end || !it.d.expiry ? "9999-12-31" : it.d.expiry),
    cell: ({ d }) => (d.open_end || !d.expiry ? "<td>Open End</td>"
      : `<td title="noch ${F.int(Math.max(0, Math.round(M.years(M.today(), d.expiry) * 365)))} Tage">${F.date(d.expiry)}</td>`),
    csv: (it) => (it.d.open_end || !it.d.expiry ? "Open End" : it.d.expiry) },
  { key: "bid", label: "Geld", dir: 1, value: (it) => it.d.bid, cell: ({ d }) => `<td>${d.bid != null ? eur(d.bid) : "–"}</td>`, csv: (it) => csvNum(it.d.bid) },
  { key: "ask", label: "Brief", dir: 1, value: (it) => productPrice(it.d), title: "Kaufkurs des Emittenten in Euro",
    cell: ({ d }) => `<td title="Geld ${d.bid != null ? money(d.bid) : "–"} · Brief ${d.ask != null ? money(d.ask) : "–"}${d.time ? ` · ${esc(stamp(d.time))}` : ""}">${
      d.ask != null ? eur(d.ask) : d.bid != null ? `${eur(d.bid)} <span class="muted cp-v">Geld</span>` : "–"}</td>`,
    csv: (it) => csvNum(it.d.ask) },
  { key: "spread", label: "Spanne", term: "spanne", dir: 1, value: (it) => it.d.spread, cell: ({ d }) => `<td>${F.pct(d.spread, 1)}</td>`, csv: (it) => csvNum(it.d.spread * 100, 2) },
  { key: "spreadU", label: "Spanne ÷ Hebel", term: "spanne_aktie", dir: 1, value: (it) => it.f.spreadU,
    title: "Spanne auf die Aktie umgerechnet: so viel Prozent muss sich die Aktie bewegen, bis die Spanne wieder drin ist",
    cell: ({ f }) => `<td>${F.pct(f.spreadU, 2)}</td>`, csv: (it) => csvNum(it.f.spreadU * 100, 3) },
  { key: "leverage", label: { os: "Omega", ko: "Hebel" }, term: "omega", dir: -1, value: (it) => it.f.leverage,
    cell: ({ f }) => `<td>${lev(f.leverage)}</td>`, csv: (it) => csvNum(it.f.leverage, 2) },
  { key: "delta", label: "Delta", term: "delta", kinds: "os", dir: -1, value: (it) => it.f.delta,
    cell: ({ f }) => `<td>${F.num(f.delta, 2)}</td>`, csv: (it) => csvNum(it.f.delta, 3) },
  { key: "theta", label: "Zeitwert/Tag", term: "zeitwert", kinds: "os", dir: -1, value: (it) => it.f.theta,
    title: "Wertverlust pro Tag, wenn die Aktie stillsteht, in % des Preises",
    cell: ({ f }) => `<td>${F.isNum(f.theta) ? F.signedPct(f.theta, 2) : "–"}</td>`, csv: (it) => csvNum(it.f.theta * 100, 3) },
  { key: "iv", label: "Vola", term: "implizite_volatilitaet", kinds: "os", dir: 1, value: (it) => it.m?.p.vol ?? it.d.iv,
    title: "Implizite Volatilität zum Briefkurs", cell: ({ d, m }) => `<td>${F.pct(m?.p.vol ?? d.iv, 0)}</td>`, csv: (it) => csvNum((it.m?.p.vol ?? it.d.iv) * 100, 1) },
  { key: "premium", label: "Aufgeld", term: "zeitwert", kinds: "os", dir: 1, value: (it) => it.d.premium,
    title: "Um so viel Prozent liegt der Preis über dem inneren Wert, bezogen auf den Aktienkurs (Angabe von onvista)",
    cell: ({ d }) => `<td>${F.pct(d.premium, 1)}</td>`, csv: (it) => csvNum(it.d.premium * 100, 2) },
  { key: "be", label: "Gewinnschwelle", term: "gewinnschwelle", dir: 1, value: (it) => (it.f.be == null ? null : Math.abs(it.f.be)),
    title: "Kursänderung der Aktie, ab der das Produkt im Plus ist (Optionsschein: bei Fälligkeit)",
    cell: ({ f }) => `<td>${F.isNum(f.be) ? F.signedPct(f.be, 1) : "–"}</td>`, csv: (it) => csvNum(it.f.be * 100, 2) },
  { key: "check", label: "Preis-Check", term: "preischeck", dir: 1, value: (it) => it.m?.check ?? null,
    cell: ({ m }) => checkCell(m?.check, m ? ` title="fairer Wert ${money(m.fair)}"` : ""), csv: (it) => csvNum(it.m?.check * 100, 2) },
  { key: "peer", label: "vs. ähnliche", term: "aehnliche", kinds: "os", dir: 1, value: (it) => it.peer?.check ?? null,
    title: "Preis gegenüber ähnlichen Scheinen anderer Emittenten (Basispreis ±7 %, Laufzeit ±25 %)",
    cell: ({ m, peer }) => checkCell(peer?.check, peer ? ` title="${peer.n} ähnliche Scheine, deren mittlere Volatilität ${F.pct(peer.iv, 1)}; dieser ${F.pct(m.p.vol, 1)}"` : ' title="zu wenige ähnliche Scheine anderer Emittenten"'),
    csv: (it) => csvNum(it.peer?.check * 100, 2) },
  { key: "mean", label: "Ø Erwartung", term: "erwartung", scenario: true, dir: -1, value: (it, T) => T.outlook(it)?.mean ?? null,
    cell: (it, T) => retCell(T.outlook(it)?.mean), csv: (it, T) => csvNum(T.outlook(it)?.mean * 100, 2) },
  { key: "chance", label: "Gewinnchance", term: "erwartung", scenario: true, dir: -1, value: (it, T) => T.outlook(it)?.chance ?? null,
    cell: (it, T) => `<td>${F.pct(T.outlook(it)?.chance, 0)}</td>`, csv: (it, T) => csvNum(T.outlook(it)?.chance * 100, 1) },
  { key: "loss50", label: "Verlust > 50 %", term: "erwartung", scenario: true, dir: 1, value: (it, T) => T.outlook(it)?.loss50 ?? null,
    cell: (it, T) => `<td>${F.pct(T.outlook(it)?.loss50, 0)}</td>`, csv: (it, T) => csvNum(T.outlook(it)?.loss50 * 100, 1) },
  { key: "ko", label: "KO-Risiko", term: "erwartung", scenario: true, kinds: "ko", dir: 1, value: (it, T) => T.outlook(it)?.ko ?? null,
    cell: (it, T) => `<td>${F.pct(T.outlook(it)?.ko, 0)}</td>`, csv: (it, T) => csvNum(T.outlook(it)?.ko * 100, 1) },
  { key: "change", label: "Heute", dir: -1, value: (it) => it.d.change, title: "Veränderung des Produkts seit dem Vortag (onvista)",
    cell: ({ d }) => `<td>${F.isNum(d.change) ? `<span class="${d.change >= 0 ? "good" : "bad"}">${F.signedPct(d.change, 1)}</span>` : "–"}</td>`,
    csv: (it) => csvNum(it.d.change * 100, 2) },
  { key: "ratio", label: "Bezugsv.", term: "bezugsverhaeltnis", dir: 1, value: (it) => it.d.ratio,
    cell: ({ d }) => `<td>${F.isNum(d.ratio) ? String(Number(d.ratio.toFixed(6))).replace(".", ",") : "–"}</td>`, csv: (it) => csvNum(it.d.ratio, 6) },
  { key: "first", label: "Seit", dir: -1, value: (it) => it.d.first_day || "", title: "Erster Handelstag",
    cell: ({ d }) => `<td>${d.first_day ? F.date(d.first_day) : "–"}</td>`, csv: (it) => it.d.first_day || "" },
];
// Ohne Briefkurs (abends, bei manchen Emittenten) lässt sich ein Produkt gerade nicht kaufen: Preis-Check und Erwartung
// rechnen dann mit dem Geldkurs und sähen zu günstig aus. Beim Sortieren nach diesen Spalten kommen solche Produkte ans Ende.
const PRICE_BASED = ["check", "peer", "mean", "chance", "loss50", "ko", "be", "spreadU"];
for (const c of COLUMNS) {
  if (!PRICE_BASED.includes(c.key)) continue;
  const raw = c.value;
  c.value = (it, T) => (it.d.ask == null ? null : raw(it, T));
}
const COL = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));
const colsFor = (kind) => COLUMNS.filter((c) => !c.kinds || c.kinds === kind);
const labelOf = (c, kind) => (typeof c.label === "object" ? c.label[kind] : c.label);
// virtuelle Sortierung „am Geld zuerst“ (Abstand des Basispreises zum Kurs, ohne Vorzeichen)
const NEAR = { value: (it) => (it.m ? Math.abs(Math.log(it.m.p.K / it.m.S0)) : null) };

// ---------------------------------------------------------------- Matrix
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const OS_MONEY = [-Infinity, -0.3, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.3, 0.5, Infinity];
const KO_DIST = [0, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, Infinity];
const KO_TYPES = [["turbo-open", "Turbo Open End"], ["turbo-fix", "Turbo mit Fälligkeit"], ["mini", "Mini-Future"]];
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // m: 1–12
// Fälligkeiten: je Monat bis zum Ende des Quartals in fünf Monaten, je Quartal bis Ende des übernächsten Jahres, danach je Jahr
function expiryBucket(day) {
  const [y, m] = day.split("-").map(Number);
  const soon = M.addMonths(5);
  const [sy, sm] = soon.split("-").map(Number);
  const monthsUntil = lastDay(sy, Math.ceil(sm / 3) * 3);
  const quartersUntil = `${new Date().getFullYear() + 2}-12-31`;
  if (day <= monthsUntil) return { key: `${y}-${String(m).padStart(2, "0")}`, label: `${MONTHS[m - 1]} ${String(y).slice(2)}`, from: `${y}-${String(m).padStart(2, "0")}-01`, to: lastDay(y, m) };
  if (day <= quartersUntil) {
    const qn = Math.ceil(m / 3);
    return { key: `${y}-Q${qn}`, label: `Q${qn} ${String(y).slice(2)}`, from: `${y}-${String(qn * 3 - 2).padStart(2, "0")}-01`, to: lastDay(y, qn * 3) };
  }
  return { key: `${y}`, label: String(y), from: `${y}-01-01`, to: `${y}-12-31` };
}
const pctEdge = (x) => (Number.isFinite(x) ? fmtNum(Math.round(x * 1000) / 10) : "");

/**
 * Tabelle. ctx: symbol, name, mode ("page" | "embedded"), kind(), call(), market() und scenario() (siehe derivmodel),
 * current() (ISIN des Produkts im Rechner), open(isin), selection ({has, toggle(d), size(), max}), bigLink() (nur
 * eingebettet: Adresse der großen Ansicht), initial (URLSearchParams der Seite), onState() (Filter geändert),
 * onLoaded() (Produkte geladen), onSelect() (Auswahl geändert).
 */
export function productTable(el, ctx) {
  const mode = ctx.mode === "page" ? "page" : "embedded";
  if (S.symbol !== ctx.symbol) { S.symbol = ctx.symbol; S.os.bp = ""; S.ko.bp = ""; S.os.q = ""; S.ko.q = ""; }
  const L = {
    kind: ctx.kind(), call: ctx.call(), rows: [], total: 0, complete: true, partial: false, under: null, loading: false,
    error: null, token: 0, version: 0, items: [], itemsKey: null, scKey: null, sc: null, page: 0,
    pageSize: mode === "page" ? 50 : 25, needServer: false, sentServer: "{}", reloadTimer: 0, chart: null,
    matrixMetric: { os: "check", ko: "check" }, mapY: { os: "iv", ko: "check" }, issuers: {}, view: "list",
  };
  if (ctx.initial) applyInitial(ctx.initial);

  el.innerHTML = `<div class="card dl-card">
      <div class="dl-head">
        <div><h3 class="dl-title"></h3><div class="muted dl-count"></div></div>
        <span class="spacer"></span>
        <div class="segmented dl-views" role="group" aria-label="Ansicht">
          <button type="button" data-view="list">Liste</button><button type="button" data-view="matrix">Matrix</button><button type="button" data-view="map">Landkarte</button></div>
        <details class="ms dl-colpick"><summary>Spalten</summary><div class="ms-panel"><ul class="ms-list dl-collist"></ul>
          <div class="ms-foot"><button class="linklike" type="button" data-cols-reset>Standard</button></div></div></details>
        <button class="btn small" type="button" data-csv title="Gefilterte Liste als CSV-Datei (für Excel) speichern">CSV</button>
        <button class="btn small" type="button" data-reload title="Kurse neu laden">Aktualisieren</button>
        ${mode === "embedded" ? '<a class="btn small primary dl-big" href="#">Große Ansicht →</a>' : ""}
      </div>
      <div class="filters dl-quick"></div>
      <div class="dl-active"></div>
      <div class="filters dl-more" hidden></div>
      <div class="dl-status"></div>
      <div class="dl-body table-scroll"></div>
      <div class="dl-pager"></div>
      <p class="muted dl-note"></p>
    </div>`;
  const $ = (s) => el.querySelector(s);
  let moreOpen = false;

  function applyInitial(params) {
    const f = S[L.kind];
    let any = false;
    for (const k of FILTER_KEYS) if (params.has(k)) { f[k] = params.get(k) || ""; any = true; }
    if (any) for (const k of FILTER_KEYS) if (!params.has(k)) f[k] = "";
    const sort = params.get("sort");
    if (sort) S.sort[L.kind] = [sort.replace(/^-/, ""), sort.startsWith("-") ? -1 : 1];
    if (["list", "matrix", "map"].includes(params.get("ansicht"))) L.view = params.get("ansicht");
  }

  // ---- Zustand für die Adresse der Seite
  function state() {
    const f = S[L.kind];
    const out = {};
    for (const k of FILTER_KEYS) if (f[k]) out[k] = f[k];
    const [key, dir] = S.sort[L.kind];
    if (key !== DEFAULT_SORT[L.kind][0] || dir !== DEFAULT_SORT[L.kind][1]) out.sort = `${dir < 0 ? "-" : ""}${key}`;
    if (L.view !== "list") out.ansicht = L.view;
    return out;
  }

  // ---- Bewertung (nur neu, wenn sich Produkte, Markt oder Erwartung geändert haben)
  function evaluate() {
    const mk = ctx.market();
    const key = JSON.stringify([L.version, mk && [mk.spot, mk.fx, mk.r, mk.q, mk.sigma, mk.margin, mk.ccy, mk.eur]]);
    if (key !== L.itemsKey) {
      L.items = L.rows.map((d) => { const m = model(d, mk); return { d, m, f: figures(d, m), peer: null, o: undefined }; });
      peersAll(L.items);
      L.itemsKey = key;
      L.scKey = null;
    }
    const sc = ctx.scenario();
    const sk = JSON.stringify([L.itemsKey, sc && [sc.g, sc.t, sc.sigma]]);
    if (sk !== L.scKey) { for (const it of L.items) it.o = undefined; L.sc = sc; L.scKey = sk; }
    return mk;
  }
  const T = { outlook: (it) => { if (it.o === undefined) it.o = expect(it.m, L.sc); return it.o; } };

  const visibleCols = () => {
    const stored = S.cols[mode]?.[L.kind];
    const keys = Array.isArray(stored) && stored.length ? stored : DEFAULT_COLS[mode][L.kind];
    return colsFor(L.kind).filter((c) => keys.includes(c.key));
  };

  function filtered(skip = []) {
    const tests = activeFilters(L.kind, S[L.kind], L.issuers).filter((x) => !skip.includes(x.key));
    return tests.length ? L.items.filter((it) => tests.every((x) => x.test(it))) : L.items;
  }

  function sorted(items) {
    const [key, dir] = S.sort[L.kind];
    const col = key === "near" ? NEAR : COL[key];
    if (!col) return items;
    const vals = new Map(items.map((it) => [it, col.value(it, T)]));
    return items.slice().sort((a, b) => {
      const va = vals.get(a);
      const vb = vals.get(b);
      const na = va == null || (typeof va === "number" && !Number.isFinite(va));
      const nb = vb == null || (typeof vb === "number" && !Number.isFinite(vb));
      if (na && nb) return 0;
      if (na) return 1;
      if (nb) return -1;
      return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * dir;
    });
  }

  // ---- Laden: erste Seite sofort, alle Produkte danach
  async function load() {
    const token = ++L.token;
    clearTimeout(L.reloadTimer);
    const base = { art: L.kind, typ: L.call ? "call" : "put", tr: trOnly() ? "1" : "0" };
    const extra = L.needServer ? serverParams(L.kind, S[L.kind]) : {};
    L.sentServer = JSON.stringify(extra);
    Object.assign(L, { loading: true, error: null, rows: [], total: 0, complete: true, partial: false, page: 0 });
    L.version++;
    paint();
    api.derivatives(ctx.symbol, { ...base, ...extra, sort: L.kind === "ko" ? "differenceKnockOutPct" : "strikeAbs" }).then((res) => {
      if (token !== L.token || !L.loading) return;
      Object.assign(L, { rows: res.rows, total: res.total, under: res.under, partial: res.rows.length < res.total });
      L.version++;
      paint();
    }).catch(() => { /* die vollständige Liste meldet Fehler selbst */ });
    try {
      const res = await api.derivativesAll(ctx.symbol, { ...base, ...extra });
      if (token !== L.token) return;
      Object.assign(L, { rows: res.rows, total: res.total, complete: res.complete, under: res.under, partial: false });
      if (!res.complete && !L.needServer) {
        L.needServer = true;
        if (Object.keys(serverParams(L.kind, S[L.kind])).length) { load(); return; }
      }
    } catch (e) {
      if (token !== L.token) return;
      L.error = e.message;
    }
    L.loading = false;
    L.version++;
    L.issuers = Object.fromEntries(L.rows.filter((d) => d.issuer_id != null).map((d) => [String(d.issuer_id), d.issuer]));
    paintFilters();
    paint();
    ctx.onLoaded?.();
  }

  // Filter geändert: im Browser filtern; sind nicht alle Produkte geladen, mit den neuen Filtern neu laden
  function filtersChanged(repaintFilters = true) {
    persist();
    L.page = 0;
    if (repaintFilters) paintFilters();
    ctx.onState?.();
    if (L.needServer && JSON.stringify(serverParams(L.kind, S[L.kind])) !== L.sentServer) {
      clearTimeout(L.reloadTimer);
      L.reloadTimer = setTimeout(load, 350);
    }
    paint();
  }

  // ---- Filterbereich
  function paintFilters() {
    const f = S[L.kind];
    const seg = ([key, label, opts]) => `<div class="field"><span class="field-label">${label}</span>
      <div class="segmented" role="group" aria-label="${esc(label)}">${opts.map(([v, l]) =>
        `<button type="button" data-f="${key}" data-v="${v}" aria-pressed="${f[key] === v}">${l}</button>`).join("")}</div></div>`;
    $(".dl-quick").innerHTML = `${QUICK[L.kind].map(seg).join("")}
      <label class="check dl-tr"><input type="checkbox" data-tr${trOnly() ? " checked" : ""}> nur bei Trade Republic handelbar</label>`;
    const active = activeFilters(L.kind, f, L.issuers);
    $(".dl-active").innerHTML = `<div class="filter-chips">${active.map((a) => `<span class="fchip">${esc(a.label)}<button type="button" data-clear="${a.key}" aria-label="Filter ${esc(a.label)} entfernen">✕</button></span>`).join("")}</div>
      <button class="linklike" type="button" data-more aria-expanded="${moreOpen}">${moreOpen ? "Weniger Filter ▴" : "Weitere Filter ▾"}</button>
      ${active.length ? '<button class="linklike" type="button" data-clear-all>Alle Filter entfernen</button>' : ""}`;
    const unit = L.rows.find((d) => d.under_ccy)?.under_ccy || ctx.market()?.ccy || "";
    const u = unit && unit !== "EUR" ? ` (${esc(unit)})` : " (€)";
    const custom = (key) => (f[key] && String(f[key]).includes(";") ? splitRange(f[key]) : ["", ""]);
    const pair = (key, label, attrs = 'inputmode="decimal"', width = 80) => {
      const [a, b] = custom(key);
      return `<div class="field"><label>${label}</label><span class="dl-pair"><input data-range="${key}" data-side="0" ${attrs} value="${esc(a)}" style="width:${width}px" aria-label="${esc(label)} von">
        <span class="muted">bis</span><input data-range="${key}" data-side="1" ${attrs} value="${esc(b)}" style="width:${width}px" aria-label="${esc(label)} bis"></span></div>`;
    };
    const ems = Object.entries(L.issuers).sort((a, b) => a[1].localeCompare(b[1]));
    const counts = {};
    for (const d of L.rows) counts[d.issuer_id] = (counts[d.issuer_id] || 0) + 1;
    const chosen = f.em ? f.em.split(",") : [];
    $(".dl-more").innerHTML = `
      ${L.kind === "os" ? pair("lz", "Fälligkeit", 'type="date"', 140) : pair("ab", "Abstand zur Schwelle (%)")}
      ${L.kind === "os" ? pair("gm", "Basispreis in % vom Kurs") : ""}
      ${pair("bp", `Basispreis${u}`)}
      ${pair("hb", L.kind === "os" ? "Omega" : "Hebel")}
      ${pair("pr", "Briefkurs (€)")}
      <div class="field"><label for="dl-sp">Spanne höchstens %</label><input id="dl-sp" data-one="sp" inputmode="decimal" value="${esc(f.sp)}" style="width:70px"></div>
      <div class="field"><label for="dl-pc">Preis-Check höchstens %</label><input id="dl-pc" data-one="pc" inputmode="decimal" value="${esc(f.pc)}" style="width:70px" placeholder="z. B. 5"></div>
      <div class="field"><span class="field-label">Emittent</span><details class="ms${chosen.length ? " active" : ""}"><summary>${chosen.length ? chosen.map((id) => esc(L.issuers[id] || id)).join(", ") : "alle"}</summary>
        <div class="ms-panel"><ul class="ms-list">${ems.map(([id, name]) => `<li><label><input type="checkbox" data-em="${id}"${chosen.includes(id) ? " checked" : ""}>
          <span class="ms-text">${esc(name)}</span><span class="ms-count">${F.int(counts[id] || 0)}</span></label></li>`).join("") || '<li class="empty"><span class="ms-text">noch keine Produkte geladen</span></li>'}</ul></div></details></div>
      ${L.kind === "os" ? `<div class="field"><span class="field-label">Ausübung</span><div class="segmented" role="group" aria-label="Ausübung">${[["", "alle"], ["a", "amerikanisch"], ["e", "europäisch"]].map(([v, l]) =>
        `<button type="button" data-f="au" data-v="${v}" aria-pressed="${f.au === v}">${l}</button>`).join("")}</div></div>` : ""}
      <div class="field"><label for="dl-q">WKN, ISIN, Emittent</label><input id="dl-q" data-one="q" value="${esc(f.q)}" style="width:150px" autocomplete="off"></div>
      <label class="check"><input type="checkbox" data-flag="qu"${f.qu ? " checked" : ""}> ohne Quanto</label>
      <label class="check"><input type="checkbox" data-flag="neu"${f.neu ? " checked" : ""}> nur neue (${NEW_DAYS} Tage)</label>`;
    $(".dl-more").hidden = !moreOpen;
  }

  el.addEventListener("click", (e) => {
    const t = e.target;
    const fb = t.closest("[data-f]");
    if (fb) { S[L.kind][fb.dataset.f] = fb.dataset.v; filtersChanged(); return; }
    const clear = t.closest("[data-clear]");
    if (clear) { S[L.kind][clear.dataset.clear] = ""; filtersChanged(); return; }
    if (t.closest("[data-clear-all]")) { for (const k of FILTER_KEYS) S[L.kind][k] = ""; filtersChanged(); return; }
    if (t.closest("[data-more]")) { moreOpen = !moreOpen; paintFilters(); return; }
    const view = t.closest("[data-view]");
    if (view) { L.view = view.dataset.view; ctx.onState?.(); paint(); return; }
    if (t.closest("[data-csv]")) { exportCsv(); return; }
    if (t.closest("[data-reload]")) { load(); return; }
    if (t.closest("[data-cols-reset]")) { setCols(null); return; }
    const pg = t.closest("[data-page]");
    if (pg) { L.page = Number(pg.dataset.page); paint(); $(".dl-head").scrollIntoView({ block: "nearest" }); return; }
    const open = t.closest("[data-open]");
    if (open) { ctx.open(open.dataset.open); return; }
    const mm = t.closest("[data-metric]");
    if (mm) { L.matrixMetric[L.kind] = mm.dataset.metric; paint(); return; }
    const my = t.closest("[data-mapy]");
    if (my) { L.mapY[L.kind] = my.dataset.mapy; paint(); return; }
    const cellBtn = t.closest("[data-cell]");
    if (cellBtn) { applyCell(JSON.parse(cellBtn.dataset.cell)); return; }
    const th = t.closest("th[data-key]");
    if (th && !t.closest(".term")) {
      const key = th.dataset.key;
      const [cur, dir] = S.sort[L.kind];
      S.sort[L.kind] = [key, cur === key ? -dir : COL[key]?.dir ?? 1];
      persist();
      L.page = 0;
      ctx.onState?.();
      paint();
    }
  });
  el.addEventListener("change", (e) => {
    const t = e.target;
    const f = S[L.kind];
    if (t.matches("[data-tr]")) { setTrOnly(t.checked); L.needServer = false; load(); return; }
    if (t.matches("[data-range]")) {
      const inputs = el.querySelectorAll(`[data-range="${t.dataset.range}"]`);
      const [a, b] = [...inputs].map((x) => x.value.trim());
      f[t.dataset.range] = a || b ? `${a};${b}` : "";
      filtersChanged();
      return;
    }
    if (t.matches("[data-one]") && t.dataset.one !== "q") { f[t.dataset.one] = t.value.trim(); filtersChanged(); return; }
    if (t.matches("[data-flag]")) { f[t.dataset.flag] = t.checked ? "1" : ""; filtersChanged(); return; }
    if (t.matches("[data-em]")) {
      const set = new Set(f.em ? f.em.split(",") : []);
      if (t.checked) set.add(t.dataset.em); else set.delete(t.dataset.em);
      f.em = [...set].join(",");
      filtersChanged(false);
      paintFiltersKeepOpen();
      return;
    }
    if (t.matches("[data-col]")) {
      const keys = visibleCols().map((c) => c.key);
      const next = t.checked ? colsFor(L.kind).map((c) => c.key).filter((k) => keys.includes(k) || k === t.dataset.col)
        : keys.filter((k) => k !== t.dataset.col);
      setCols(next);
      return;
    }
    const sel = t.closest("[data-cmp]");
    if (sel) {
      const it = L.items.find((x) => x.d.isin === sel.dataset.cmp);
      if (it) ctx.selection.toggle(it.d);
      paint();
      ctx.onSelect?.();
    }
    if (t.matches("[data-pagesize]")) { L.pageSize = Number(t.value); L.page = 0; paint(); }
  });
  // Textsuche filtert beim Tippen (ohne den Filterbereich neu aufzubauen)
  let qTimer = 0;
  el.addEventListener("input", (e) => {
    if (!e.target.matches('[data-one="q"]')) return;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      S[L.kind].q = e.target.value;
      L.page = 0;
      el.querySelector(".dl-active .filter-chips").innerHTML = activeFilters(L.kind, S[L.kind], L.issuers)
        .map((a) => `<span class="fchip">${esc(a.label)}<button type="button" data-clear="${a.key}" aria-label="Filter ${esc(a.label)} entfernen">✕</button></span>`).join("");
      paint();
    }, 200);
  });
  // Emittenten-Auswahl bleibt beim Anklicken offen
  function paintFiltersKeepOpen() {
    const wasOpen = el.querySelector(".dl-more details.ms")?.open;
    paintFilters();
    if (wasOpen) el.querySelector(".dl-more details.ms").open = true;
  }
  document.addEventListener("click", function closeMenus(e) {
    if (!el.isConnected) { document.removeEventListener("click", closeMenus); return; }
    for (const d of el.querySelectorAll("details.ms[open]")) if (!d.contains(e.target)) d.open = false;
  });

  function setCols(keys) {
    S.cols[mode] = { ...(S.cols[mode] || {}), [L.kind]: keys };
    if (!keys) delete S.cols[mode][L.kind];
    writeStore("hebelSpalten", S.cols);
    paint();
  }

  // Matrix-Zelle angeklickt: deren Bereich als Filter, dann die Liste
  function applyCell(c) {
    const f = S[L.kind];
    if (L.kind === "os") { f.lz = `${c.from};${c.to}`; f.gm = `${c.lo};${c.hi}`; }
    else { f.ab = `${c.lo};${c.hi}`; f.ty = c.ty; f.lz = c.lz; }
    L.view = "list";
    filtersChanged();
  }

  // ---- Zeichnen
  function paint() {
    const kindName = L.kind === "os" ? "Optionsscheine" : "Knock-outs";
    const name = L.under?.name || ctx.name || ctx.symbol;
    $(".dl-title").textContent = `${kindName} ${L.kind === "ko" ? (L.call ? "Long (Call)" : "Short (Put)") : `(${L.call ? "Call" : "Put"})`} auf ${name}`;
    el.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === L.view)));
    if (mode === "embedded") $(".dl-big").href = ctx.bigLink?.() || "#";
    paintColPicker();
    const body = $(".dl-body");
    C.unmountWithin(body);
    L.chart = null;
    $(".dl-pager").innerHTML = "";
    $(".dl-note").innerHTML = noteHtml();
    if (L.error) {
      $(".dl-status").innerHTML = "";
      $(".dl-count").textContent = "";
      body.innerHTML = `<div class="notice"><span class="bad">${esc(L.error)}</span> <button class="linklike" type="button" data-reload>Erneut laden</button></div>`;
      return;
    }
    if (L.loading && !L.rows.length) {
      $(".dl-count").textContent = "";
      $(".dl-status").innerHTML = "";
      body.innerHTML = '<p class="muted"><span class="spinner inline"></span>Lade Produkte von onvista …</p>';
      return;
    }
    if (!L.under && !L.loading) {
      $(".dl-count").textContent = "";
      $(".dl-status").innerHTML = "";
      body.innerHTML = `<p class="muted">Zu ${esc(ctx.symbol)} findet onvista keinen Basiswert (die Aktie ließ sich über ihre ISIN nicht
        zuordnen). Ein einzelnes Produkt lässt sich im Call/Put-Rechner per ISIN oder WKN laden.</p>`;
      return;
    }
    const mk = evaluate();
    const shown = sorted(filtered());
    const where = trOnly() ? " bei Trade Republic" : "";
    const active = activeFilters(L.kind, S[L.kind], L.issuers).length;
    $(".dl-count").innerHTML = `${F.int(L.total)} Produkte${where}${active ? ` · <b>${F.int(shown.length)}</b> passen zu den Filtern` : ""}${
      S.sort[L.kind][0] === "near" ? " · sortiert: am Geld zuerst" : ""}`;
    $(".dl-status").innerHTML = L.partial && L.loading
      ? `<p class="muted dl-loading"><span class="spinner inline"></span>Die ersten ${F.int(L.rows.length)} sind da; lade alle ${F.int(L.total)}, damit Filter und Sortierung für alle gelten …</p>`
      : !L.complete ? `<div class="notice">Es gibt ${F.int(L.total)} Produkte – zu viele auf einmal. Geladen sind die ${F.int(L.rows.length)} mit dem Basispreis am
          nächsten am Kurs. Grenzen Sie mit Laufzeit, Hebel${L.kind === "ko" ? ", Abstand" : ""} oder Basispreis ein; dann lädt die Tabelle genau die passenden.</div>` : "";
    if (!L.rows.length) {
      body.innerHTML = '<p class="muted">Keine Produkte. Probieren Sie die andere Richtung oder schalten Sie „nur bei Trade Republic handelbar“ aus.</p>';
      return;
    }
    if (L.view === "matrix") { body.innerHTML = matrixHtml(mk); return; }
    if (L.view === "map") { paintMap(body, mk, shown); return; }
    paintList(body, shown, mk);
  }

  function paintColPicker() {
    const keys = visibleCols().map((c) => c.key);
    $(".dl-collist").innerHTML = colsFor(L.kind).map((c) => `<li><label><input type="checkbox" data-col="${c.key}"${keys.includes(c.key) ? " checked" : ""}${c.key === "issuer" ? " disabled" : ""}>
      <span class="ms-text">${esc(labelOf(c, L.kind))}${c.scenario ? ' <span class="muted">(Erwartung)</span>' : ""}</span></label></li>`).join("");
  }

  function paintList(body, shown, mk) {
    const cols = visibleCols();
    const pages = Math.max(1, Math.ceil(shown.length / L.pageSize));
    L.page = Math.min(L.page, pages - 1);
    const rows = shown.slice(L.page * L.pageSize, (L.page + 1) * L.pageSize);
    const units = [...new Set(L.rows.map((d) => d.under_ccy).filter(Boolean))];
    const unit = units.length === 1 && units[0] !== "EUR" ? ` (${esc(units[0])})` : "";
    const [sk, sd] = S.sort[L.kind];
    const sc = L.sc;
    const head = cols.map((c) => {
      const text = `${labelOf(c, L.kind)}${c.unit ? unit : ""}`;
      const tip = c.scenario ? sc?.label : c.key === "check" ? checkTitle(mk) : c.title;
      return `<th scope="col" data-key="${c.key}" class="${c.left ? "txt" : ""}${sk === c.key ? " sorted" : ""}" aria-sort="${sk === c.key ? (sd > 0 ? "ascending" : "descending") : "none"}"${
        tip ? ` title="${esc(tip)}"` : ""}>${c.term ? term(c.term, text) : text}</th>`;
    }).join("");
    const cur = ctx.current?.();
    const sel = ctx.selection;
    const full = sel.size() >= sel.max;
    if (!shown.length) {
      body.innerHTML = '<p class="muted">Kein Produkt passt zu allen Filtern. Entfernen Sie oben einen Filter.</p>';
      return;
    }
    body.innerHTML = `<table class="data screener dl-table"><thead><tr><th scope="col" class="txt" title="zum Vergleich auswählen (bis ${sel.max})">Vergl.</th>${head}
        <th scope="col"><span class="visually-hidden">Rechnen</span></th></tr></thead>
      <tbody>${rows.map((it) => `<tr class="${it.d.isin === cur ? "cp-cur" : ""}">
        <td class="txt"><input type="checkbox" data-cmp="${esc(it.d.isin)}" aria-label="${esc(it.d.wkn || it.d.isin)} vergleichen"${sel.has(it.d.isin) ? " checked" : full ? " disabled" : ""}></td>
        ${cols.map((c) => c.cell(it, T)).join("")}
        <td><button class="btn small" type="button" data-open="${esc(it.d.isin)}">Rechnen</button></td></tr>`).join("")}</tbody></table>`;
    $(".dl-pager").innerHTML = pagerHtml(pages, shown.length);
  }

  function pagerHtml(pages, n) {
    const p = L.page;
    const nums = [...new Set([0, p - 2, p - 1, p, p + 1, p + 2, pages - 1])].filter((x) => x >= 0 && x < pages).sort((a, b) => a - b);
    const btns = [];
    nums.forEach((x, i) => {
      if (i && x - nums[i - 1] > 1) btns.push('<span class="muted">…</span>');
      btns.push(`<button type="button" class="btn small${x === p ? " primary" : ""}" data-page="${x}"${x === p ? ' aria-current="page"' : ""}>${x + 1}</button>`);
    });
    return `<div class="dl-pages">${pages > 1 ? `<button type="button" class="btn small" data-page="${Math.max(0, p - 1)}"${p === 0 ? " disabled" : ""} aria-label="vorige Seite">‹</button>
        ${btns.join("")}<button type="button" class="btn small" data-page="${Math.min(pages - 1, p + 1)}"${p >= pages - 1 ? " disabled" : ""} aria-label="nächste Seite">›</button>` : ""}
      <span class="muted">${F.int(p * L.pageSize + 1)}–${F.int(Math.min(n, (p + 1) * L.pageSize))} von ${F.int(n)}</span><span class="spacer"></span>
      <label class="muted">Zeilen je Seite <select class="plain" data-pagesize>${PAGE_SIZES.map((s) => `<option${s === L.pageSize ? " selected" : ""}>${s}</option>`).join("")}</select></label></div>`;
  }

  const checkTitle = (mk) => `Briefkurs gegenüber dem fairen Wert. Optionsschein: Black-Scholes mit ${F.pct(mk?.sigma, 0)} Schwankung p. a.; Knock-out: innerer Wert, mit Fälligkeit der Terminwert. +10 % = 10 % teurer als fair, negativ = günstiger.`;

  function noteHtml() {
    return `<b>Preis-Check</b> (neutral): Briefkurs gegenüber dem fairen Wert – beim Optionsschein bei der bisherigen Schwankung der Aktie, beim
      Knock-out der innere Wert. <b>vs. ähnliche</b>: gegenüber Scheinen anderer Emittenten mit ähnlichem Basispreis und ähnlicher Laufzeit, ohne Annahme.
      <b>Spanne ÷ Hebel</b> vergleicht die Spanne über alle Hebel hinweg. <b>Ø Erwartung</b>, <b>Gewinnchance</b> und <b>KO-Risiko</b> rechnen mit
      Ihrer Erwartung (oben). Ein Klick auf eine Spaltenüberschrift sortiert alle geladenen Produkte. Kurse: Geld/Brief der Emittenten über onvista,
      drei Minuten zwischengespeichert. Häkchen setzen, um bis zu ${ctx.selection.max} Produkte zu vergleichen; „Rechnen“ öffnet ein Produkt im Call/Put-Rechner.`;
  }

  // ---- Matrix
  function matrixHtml(mk) {
    const base = filtered(L.kind === "os" ? ["lz", "gm", "bp"] : ["ab", "ty", "lz"]).filter((it) => it.m);
    const metric = L.matrixMetric[L.kind];
    const metrics = L.kind === "os"
      ? [["check", "bester Preis-Check"], ["peer", "bester vs. ähnliche"], ["iv", "niedrigste Vola"], ["n", "Anzahl"]]
      : [["check", "bester Preis-Check"], ["spreadU", "kleinste Spanne ÷ Hebel"], ["n", "Anzahl"]];
    const valueOf = { check: (it) => it.m.check, peer: (it) => it.peer?.check, iv: (it) => it.m.p.vol, spreadU: (it) => it.f.spreadU };
    const fmt = { check: (x) => signed(x), peer: (x) => signed(x), iv: (x) => F.pct(x, 0), spreadU: (x) => F.pct(x, 2) };
    let cols;
    let rows;
    let place;
    if (L.kind === "os") {
      const buckets = new Map();
      for (const it of base) if (it.d.expiry) { const b = expiryBucket(it.d.expiry); if (!buckets.has(b.key)) buckets.set(b.key, b); }
      cols = [...buckets.values()].sort((a, b) => a.from.localeCompare(b.from));
      rows = OS_MONEY.slice(0, -1).map((lo, i) => ({ lo, hi: OS_MONEY[i + 1] }));
      place = (it) => {
        const k = moneyness(it);
        return [rows.findIndex((r) => k >= r.lo && k < r.hi), cols.findIndex((c) => c.key === expiryBucket(it.d.expiry).key)];
      };
    } else {
      cols = KO_TYPES.map(([key, label]) => ({ key, label }));
      rows = KO_DIST.slice(0, -1).map((lo, i) => ({ lo, hi: KO_DIST[i + 1] }));
      const type = (d) => (isMini(d) ? "mini" : d.open_end || !d.expiry ? "turbo-open" : "turbo-fix");
      place = (it) => [rows.findIndex((r) => koDistance(it) >= r.lo && koDistance(it) < r.hi), cols.findIndex((c) => c.key === type(it.d))];
    }
    if (!cols.length) return '<p class="muted">Keine Produkte für die Matrix.</p>';
    const grid = rows.map(() => cols.map(() => ({ n: 0, best: null })));
    for (const it of base) {
      const [r, c] = place(it);
      if (r < 0 || c < 0) continue;
      const g = grid[r][c];
      g.n++;
      const v = metric === "n" ? null : valueOf[metric](it);
      if (F.isNum(v) && (g.best == null || v < g.best)) g.best = v;
    }
    const used = rows.map((_, i) => grid[i].some((g) => g.n));
    const first = used.indexOf(true);
    const last = used.lastIndexOf(true);
    if (first < 0) return '<p class="muted">Keine Produkte für die Matrix.</p>';
    const maxN = Math.max(...grid.flat().map((g) => g.n));
    const spot = mk.spot * mk.fx;
    const side = (r) => {
      if (L.kind !== "os") return "";
      const mid = Number.isFinite(r.lo) && Number.isFinite(r.hi) ? (r.lo + r.hi) / 2 : Number.isFinite(r.lo) ? r.lo + 0.01 : r.hi - 0.01;
      if (Math.abs(mid) <= 0.05 && r.lo >= -0.05 && r.hi <= 0.05) return "am Geld";
      return (L.call ? mid < 0 : mid > 0) ? "im Geld" : "aus dem Geld";
    };
    const rowLabel = (r) => {
      if (L.kind === "os") {
        const pct = Number.isFinite(r.lo) && Number.isFinite(r.hi) ? `${F.signedPct(r.lo, 0)} bis ${F.signedPct(r.hi, 0)}`
          : Number.isFinite(r.lo) ? `über ${F.signedPct(r.lo, 0)}` : `unter ${F.signedPct(r.hi, 0)}`;
        const abs = [r.lo, r.hi].map((x) => (Number.isFinite(x) ? F.num(spot * (1 + x), spot >= 100 ? 0 : 2) : null));
        return `${pct}<div class="sub">${abs[0] && abs[1] ? `${abs[0]}–${abs[1]}` : abs[0] ? `ab ${abs[0]}` : `bis ${abs[1]}`} € · ${side(r)}</div>`;
      }
      return Number.isFinite(r.hi) ? `${F.num(r.lo * 100, 0)}–${F.num(r.hi * 100, 0)} %` : `über ${F.num(r.lo * 100, 0)} %`;
    };
    const cellData = (r, c) => (L.kind === "os"
      ? { from: c.from < M.today() ? M.today() : c.from, to: c.to, lo: pctEdge(r.lo), hi: pctEdge(r.hi) }
      : { lo: pctEdge(r.lo), hi: pctEdge(r.hi), ty: c.key === "mini" ? "mini" : "turbo", lz: c.key === "turbo-open" ? "open" : c.key === "turbo-fix" ? "fix" : "" });
    const body = rows.slice(first, last + 1).map((r, i) => `<tr><th scope="row" class="txt">${rowLabel(r)}</th>${cols.map((c, j) => {
      const g = grid[first + i][j];
      if (!g.n) return '<td class="dl-mx-empty">·</td>';
      const heat = 0.08 + 0.32 * (g.n / maxN);
      const main = metric === "n" ? F.int(g.n) : g.best != null ? fmt[metric](g.best) : "–";
      const good = metric !== "n" && metric !== "iv" && g.best != null && g.best < 0;
      return `<td><button type="button" class="dl-mx" style="--heat:${heat.toFixed(2)}" data-cell='${esc(JSON.stringify(cellData(r, c)))}'
        title="${F.int(g.n)} Produkte – Klick zeigt sie in der Liste"><b class="${good ? "good" : ""}">${main}</b>${metric === "n" ? "" : `<span class="muted">${F.int(g.n)}</span>`}</button></td>`;
    }).join("")}</tr>`).join("");
    const pick = `<div class="dl-mx-head"><span class="muted">${L.kind === "os" ? "Zeilen: Basispreis gegenüber dem Kurs · Spalten: Fälligkeit" : "Zeilen: Abstand zur Schwelle · Spalten: Art"}
        · je Feld:</span> <div class="segmented" role="group" aria-label="Wert je Feld">${metrics.map(([k, l]) =>
      `<button type="button" data-metric="${k}" aria-pressed="${metric === k}">${l}</button>`).join("")}</div></div>`;
    return `${pick}<table class="data dl-matrix"><thead><tr><th class="txt">${L.kind === "os" ? "Basispreis" : "Abstand"}</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead>
      <tbody>${body}</tbody></table>
      <p class="muted dl-note">Ein Klick auf ein Feld zeigt dessen Produkte in der Liste (als Filter, oben wieder entfernbar). Die übrigen Filter gelten auch hier.</p>`;
  }

  // ---- Landkarte: jedes Produkt ein Punkt, x = Basispreis bzw. Schwelle in % vom Kurs, y wählbar, Farbe = Emittent
  function paintMap(body, mk, shown) {
    const ys = L.kind === "os"
      ? [["iv", "Volatilität", (it) => it.m?.p.vol, (x) => F.pct(x, 1)], ["check", "Preis-Check", (it) => it.m?.check, (x) => signed(x)],
        ["peer", "vs. ähnliche", (it) => it.peer?.check, (x) => signed(x)], ["spread", "Spanne", (it) => it.d.spread, (x) => F.pct(x, 1)],
        ["leverage", "Omega", (it) => it.f.leverage, (x) => lev(x)]]
      : [["check", "Preis-Check", (it) => it.m?.check, (x) => signed(x)], ["spreadU", "Spanne ÷ Hebel", (it) => it.f.spreadU, (x) => F.pct(x, 2)],
        ["spread", "Spanne", (it) => it.d.spread, (x) => F.pct(x, 1)], ["leverage", "Hebel", (it) => it.f.leverage, (x) => lev(x)]];
    const yk = ys.find((y) => y[0] === L.mapY[L.kind]) || ys[0];
    body.innerHTML = `<div class="dl-mx-head"><span class="muted">Hochachse:</span> <div class="segmented" role="group" aria-label="Hochachse">${ys.map(([k, l]) =>
      `<button type="button" data-mapy="${k}" aria-pressed="${yk[0] === k}">${l}</button>`).join("")}</div></div>
      <div class="chart dl-map"></div>
      <p class="muted dl-note">Jeder Punkt ist ein Produkt (nach den Filtern oben), die Farbe zeigt den Emittenten. ${L.kind === "os"
        ? "Bei der Volatilität liegen die günstigen Scheine unten; vergleichen Sie Punkte mit gleicher Laufzeit (Laufzeit-Filter setzen). Die gestrichelte Linie ist die bisherige Schwankung der Aktie."
        : "Je näher ein Punkt an 0 % liegt, desto näher ist die Schwelle am Kurs (höherer Hebel); günstig sind Punkte unten, über 0 % zahlen Sie mehr als den inneren Wert."} Ein Klick auf einen Punkt nimmt das Produkt in den Vergleich.</p>`;
    const pts = shown.filter((it) => it.m && F.isNum(yk[2](it)));
    const byIssuer = new Map();
    for (const it of pts) {
      const k = it.d.issuer || "?";
      if (!byIssuer.has(k)) byIssuer.set(k, []);
      byIssuer.get(k).push(it);
    }
    const names = [...byIssuer.keys()].sort();
    const xOf = (it) => ((L.kind === "ko" ? it.m.p.B : it.m.p.K) / it.m.S0 - 1) * 100;
    const sel = ctx.selection;
    L.chart = C.mount(body.querySelector(".dl-map"), (t) => ({
      ...C.base(t),
      legend: { ...C.base(t).legend, show: true, type: "scroll" },
      grid: { ...C.base(t).grid, top: 36, bottom: 24 },
      tooltip: {
        ...C.base(t).tooltip, trigger: "item",
        formatter: (q) => {
          const it = q.data?.it;
          if (!it) return "";
          return `<div style="min-width:220px"><b>${esc(it.d.issuer || "")} ${esc(it.d.wkn || "")}</b><div style="opacity:.75">${
            L.kind === "ko" ? `Schwelle ${level(it.d.barrier)}` : `Basispreis ${level(it.d.strike)}`} (${F.signedPct(xOf(it) / 100, 1)}) · ${
            it.d.open_end || !it.d.expiry ? "Open End" : F.date(it.d.expiry)}</div>
            <div>${esc(yk[1])}: <b>${yk[3](yk[2](it))}</b> · Brief ${money(productPrice(it.d))}</div></div>`;
        },
      },
      xAxis: C.valueAxis(t, { name: `${L.kind === "ko" ? "Schwelle" : "Basispreis"} in % vom Kurs`, nameLocation: "middle", nameGap: 26,
        nameTextStyle: { color: t.muted }, axisLabel: { color: t.muted, formatter: (v) => `${F.num(v, 0)} %` }, splitLine: { show: false },
        axisLine: { show: true, lineStyle: { color: t.baseline } } }),
      yAxis: C.valueAxis(t, { axisLabel: { color: t.muted, formatter: (v) => (yk[0] === "leverage" ? F.num(v, 0) : `${F.num(v * 100, yk[0] === "spreadU" ? 1 : 0)} %`) } }),
      series: names.map((n, i) => ({
        name: n, type: "scatter", symbolSize: (v, p) => (sel.has(p.data.it.d.isin) ? 13 : 6),
        itemStyle: { color: t.series[i % 8], opacity: 0.75 },
        data: byIssuer.get(n).map((it) => ({ value: [xOf(it), yk[2](it)], it,
          ...(sel.has(it.d.isin) ? { itemStyle: { borderColor: t.text, borderWidth: 2, opacity: 1 } } : {}) })),
        ...(i === 0 ? { markLine: { symbol: "none", silent: true, data: [
          { xAxis: 0, label: { formatter: "Kurs", color: t.secondary, position: "end", fontSize: 11 }, lineStyle: { color: t.secondary, type: "dashed", width: 1 } },
          ...(yk[0] === "iv" && mk?.sigma ? [{ yAxis: mk.sigma, label: { formatter: "Schwankung bisher", color: t.good, position: "insideEndTop", fontSize: 11 }, lineStyle: { color: t.good, type: "dashed", width: 1 } }] : []),
          ...(["check", "peer"].includes(yk[0]) ? [{ yAxis: 0, label: { show: false }, lineStyle: { color: t.baseline, type: "solid", width: 1 } }] : []),
        ] } } : {}),
      })),
    }));
    L.chart.chart.off("click");
    L.chart.chart.on("click", (q) => {
      const it = q.data?.it;
      if (!it || (!sel.has(it.d.isin) && sel.size() >= sel.max)) return;
      sel.toggle(it.d);
      ctx.onSelect?.();
      L.chart.update();
    });
  }

  // ---- CSV (Excel, deutsch: Semikolon, Dezimalkomma)
  function exportCsv() {
    evaluate();
    const cols = visibleCols();
    const items = sorted(filtered());
    const cell = (x) => { const s = String(x ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ["WKN", "ISIN", ...cols.map((c) => labelOf(c, L.kind))];
    const lines = [head.map(cell).join(";"), ...items.map((it) => [it.d.wkn, it.d.isin, ...cols.map((c) => c.csv(it, T))].map(cell).join(";"))];
    const blob = new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${L.kind === "os" ? "Optionsscheine" : "Knock-outs"}_${L.call ? "Call" : "Put"}_${ctx.symbol}_${M.today()}.csv`.replace(/[^\w.-]/g, "_");
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  paintFilters();

  return {
    setKind(kind, call) {
      if (kind === L.kind && call === L.call) return;
      L.kind = kind;
      L.call = call;
      L.needServer = false;
      moreOpen = false;
      paintFilters();
      ctx.onState?.();
      load();
    },
    load,
    repaint() { if (!L.loading || L.rows.length) paint(); },
    items: () => { evaluate(); return L.items; },
    under: () => L.under,
    state,
  };
}
