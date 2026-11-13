// Weltauswahl: die größten Aktien der Welt nach Kontinent, Land, Sektor und Branche filtern und nach Kennzahlen sortieren
import { api, getWatchlist, toggleWatch } from "./api.js";
import { takeRowToShow, trackBrowse } from "./browse.js";
import { NOT_TR_TAG, setTrOnly, trOnly } from "./broker.js";
import { rowScore, setStrategy, STRATEGY_LABELS, strategyKey } from "./checklist.js";
import { csvNum, downloadCsv, today } from "./csv.js";
import * as F from "./format.js";
import { term } from "./glossary.js";
import { setPageKeys } from "./keys.js";
import { isBasic, tourRunning } from "./mode.js";
import { cancelRestore } from "./nav.js";
import { removeFilter, restoreFilter, saveFilter, savedFilters } from "./savedfilters.js";
import { toast } from "./toast.js";
import { flipWatch } from "./watch.js";

const esc = F.escapeHtml;
const PAGE = 100;
const ANALYZE_MAX = 50;
const CUSTOM = "Eigene Liste";
const PANEL_KEY = "weltFilterZu";

// Filterbereich eingeklappt? Die Wahl bleibt im Browser; während einer Tutorial-Tour ist er immer offen, weil die Tour darauf zeigt
function readCollapsed() {
  try { return localStorage.getItem(PANEL_KEY) === "1"; } catch (e) { return false; }
}
function saveCollapsed(on) {
  try { localStorage.setItem(PANEL_KEY, on ? "1" : "0"); } catch (e) { /* nur Komfort */ }
}
let paintPanel = null; // Filterbereich der gerade angezeigten Weltauswahl neu einstellen (Tour beginnt oder endet)
document.addEventListener("mode-changed", () => paintPanel?.());

const pct = (d) => (v) => F.pct(v, d);
const signed = (d) => (v) => F.signedPct(v, d);
const num = (d) => (v) => F.num(v, d);
const RATINGS = [[1.5, "Starker Kauf"], [2.5, "Kaufen"], [3.5, "Halten"], [4.5, "Verkaufen"], [9, "Starker Verkauf"]];
const scoreFmt = (v) => (F.isNum(v)
  ? `<span class="score-cell"><span class="score-bar" style="--w:${v}%"></span><b>${F.int(v)}</b></span>` : "–");
const chipFmt = (v) => (F.isNum(v) ? `<span class="chip ${v >= 8 ? "hi" : v >= 6 ? "mid" : ""}">${v}</span>` : "–");
const DEEP = "Tiefenanalyse";
// Kauf-Checkliste: erfüllte von prüfbaren Punkten (checklist.js), in der Tabelle mit den nicht erfüllten als Tooltip
const checkFmt = (v, r) => {
  if (!F.isNum(v)) return "–";
  const share = r.c_n ? v / r.c_n : 0;
  const miss = r.c_miss?.length ? `Nicht erfüllt: ${r.c_miss.join(" · ")}` : "Alle prüfbaren Punkte erfüllt";
  const open = r.c_all > r.c_n ? ` (${r.c_all - r.c_n} mangels Daten nicht prüfbar)` : "";
  return `<span class="chip ${share >= 0.8 ? "hi" : share >= 0.6 ? "mid" : ""}" title="${esc(miss + open)}">${v}/${r.c_n}</span>`;
};
const WARN_LABEL = ["keine", "1 Warnzeichen", "2 Warnzeichen", "3 Warnzeichen"];

// dir: Standard-Sortierung (-1 = große Werte zuerst); pct: Eingabe in Prozent; scale: Eingabe in Mrd.;
// signed: Vorzeichen einfärben; term: Eintrag im Lexikon (Tooltip)
const METRICS = {
  score_total: { label: "Gesamt", long: "Gesamt-Score", group: "Scores", fmt: scoreFmt, dir: -1, unit: "Punkte", term: "score_gesamt" },
  score_quality: { label: "Qualität", long: "Qualitäts-Score", group: "Scores", fmt: scoreFmt, dir: -1, unit: "Punkte", term: "score_qualitaet" },
  score_value: { label: "Bewertung", long: "Bewertungs-Score", group: "Scores", fmt: scoreFmt, dir: -1, unit: "Punkte", term: "score_bewertung" },
  score_growth: { label: "Wachstum", long: "Wachstums-Score", group: "Scores", fmt: scoreFmt, dir: -1, unit: "Punkte", term: "score_wachstum" },
  score_dividend: { label: "Dividende", long: "Dividenden-Score", group: "Scores", fmt: scoreFmt, dir: -1, unit: "Punkte", term: "score_dividende" },
  score_momentum: { label: "Momentum", long: "Momentum-Score", group: "Scores", fmt: scoreFmt, dir: -1, unit: "Punkte", term: "score_momentum" },
  score_stability: { label: "Beständigkeit", long: "Beständigkeits-Score", group: "Scores", fmt: scoreFmt, dir: -1, unit: "Punkte", term: "score_bestaendigkeit" },
  magic_formula: { label: "Magic Formula", long: "Magic Formula (Greenblatt)", group: "Scores", fmt: scoreFmt, dir: -1, unit: "Punkte", term: "magic_formula" },
  c_ok: { label: "Checkliste", long: "Kauf-Checkliste: erfüllte Punkte", group: "Kauf-Checkliste", fmt: checkFmt, dir: -1, unit: "Punkte", term: "kauf_checkliste" },
  market_cap: { label: "Börsenwert", group: "Größe", fmt: (v) => F.big(v, "€"), dir: -1, unit: "Mrd. €", scale: 1e9, term: "boersenwert" },
  revenue: { label: "Umsatz", long: "Umsatz (12 Monate)", group: "Größe", fmt: (v) => F.big(v, "€"), dir: -1, unit: "Mrd. €", scale: 1e9 },
  pe: { label: "KGV", long: "KGV (12 Monate)", group: "Bewertung", fmt: num(1), dir: 1, term: "kgv" },
  forward_pe: { label: "KGV erw.", long: "KGV erwartet", group: "Bewertung", fmt: num(1), dir: 1, term: "kgv_erwartet" },
  pb: { label: "KBV", long: "Kurs-Buchwert-Verhältnis", group: "Bewertung", fmt: num(2), dir: 1, term: "kbv" },
  ps: { label: "KUV", long: "Kurs-Umsatz-Verhältnis", group: "Bewertung", fmt: num(2), dir: 1, term: "kuv" },
  ev_ebitda: { label: "EV/EBITDA", group: "Bewertung", fmt: num(1), dir: 1, term: "ev_ebitda" },
  ev_ebit: { label: "EV/EBIT", group: "Bewertung", fmt: num(1), dir: 1, term: "magic_formula" },
  peg: { label: "PEG", long: "PEG-Ratio", group: "Bewertung", fmt: num(2), dir: 1, term: "peg" },
  div_yield: { label: "Div.-Rendite", long: "Dividendenrendite", group: "Dividende", fmt: pct(2), dir: -1, pct: true, term: "dividendenrendite" },
  div_years: { label: "Div.-Steig.", long: "Dividendensteigerungen in Folge", group: "Dividende", fmt: (v) => (F.isNum(v) ? `${F.int(v)} J.` : "–"), dir: -1, unit: "Jahre", term: "dividendensteigerungen" },
  payout: { label: "Ausschüttung", long: "Ausschüttungsquote", group: "Dividende", fmt: pct(0), dir: 1, pct: true, term: "ausschuettungsquote" },
  roe: { label: "EK-Rendite", long: "Eigenkapitalrendite", group: "Rentabilität", fmt: pct(1), dir: -1, pct: true, signed: true, term: "eigenkapitalrendite" },
  roa: { label: "GK-Rendite", long: "Gesamtkapitalrendite", group: "Rentabilität", fmt: pct(1), dir: -1, pct: true, signed: true, term: "gesamtkapitalrendite" },
  roc: { label: "Kapitalrendite", long: "Kapitalrendite (ROC)", group: "Rentabilität", fmt: pct(1), dir: -1, pct: true, signed: true, term: "kapitalrendite" },
  gross_margin: { label: "Bruttomarge", group: "Rentabilität", fmt: pct(1), dir: -1, pct: true, term: "bruttomarge" },
  ebitda_margin: { label: "EBITDA-Marge", group: "Rentabilität", fmt: pct(1), dir: -1, pct: true, signed: true, term: "ebitda_marge" },
  net_margin: { label: "Nettomarge", group: "Rentabilität", fmt: pct(1), dir: -1, pct: true, signed: true, term: "nettomarge" },
  revenue_growth: { label: "Umsatzwachst.", long: "Umsatzwachstum (1 Jahr)", group: "Wachstum", fmt: signed(1), dir: -1, pct: true, signed: true, term: "umsatzwachstum" },
  eps_growth: { label: "Gewinnwachst.", long: "Gewinnwachstum je Aktie (1 Jahr)", group: "Wachstum", fmt: signed(1), dir: -1, pct: true, signed: true, term: "gewinnwachstum" },
  eps_growth_next: { label: "Gewinnw. erw.", long: "Erwartetes Gewinnwachstum", group: "Wachstum", fmt: signed(1), dir: -1, pct: true, signed: true, term: "gewinnwachstum_erwartet" },
  debt_equity: { label: "Verschuldung", long: "Verschuldungsgrad", group: "Bilanz & Risiko", fmt: pct(0), dir: 1, pct: true, term: "verschuldungsgrad" },
  net_debt_ebitda: { label: "Nettoschulden/EBITDA", group: "Bilanz & Risiko", fmt: num(1), dir: 1, term: "nettoschulden_ebitda" },
  altman_z: { label: "Altman-Z", long: "Altman-Z-Score (Insolvenzrisiko)", group: "Bilanz & Risiko", fmt: num(1), dir: -1, term: "altman_z" },
  beta: { label: "Beta", group: "Bilanz & Risiko", fmt: num(2), dir: 1, term: "beta" },
  perf_1y: { label: "Perf. 1 J.", long: "Kursentwicklung 1 Jahr", group: "Kurs & Analysten", fmt: signed(1), dir: -1, pct: true, signed: true, term: "kursentwicklung" },
  momentum: { label: "Momentum", long: "Abstand zur 200-Tage-Linie", group: "Kurs & Analysten", fmt: signed(1), dir: -1, pct: true, signed: true, term: "momentum" },
  from_high: { label: "Abst. Hoch", long: "Abstand zum 52-Wochen-Hoch", group: "Kurs & Analysten", fmt: signed(1), dir: -1, pct: true, term: "abstand_hoch" },
  rating: {
    label: "Analysten", long: "Analysten-Rating (1 = Kaufen … 5 = Verkaufen)", group: "Kurs & Analysten", dir: 1, term: "analysten_rating",
    fmt: (v) => (F.isNum(v) ? `${F.num(v, 1)} <span class="muted">${RATINGS.find(([max]) => v <= max)[1]}</span>` : "–"),
  },
  // ---- Tiefenanalyse (aus dem vollständigen Profil jeder Aktie, im Hintergrund berechnet)
  d_stab: { label: "Gewinnstab.", long: "Gewinnstabilität (bis 10 Jahre)", group: DEEP, dir: -1, term: "gewinnstabilitaet",
    fmt: (v, r) => (F.isNum(v) ? `${F.stability(v)}${r?.d_short ? ' <span class="muted" title="weniger als 5 Jahre Daten">(kurz)</span>' : ""}` : "–") },
  d_growth: { label: "Gewinnw. p. a.", long: "Gewinnwachstum p. a. (bis 10 Jahre)", group: DEEP, fmt: signed(1), dir: -1, pct: true, signed: true, term: "wachstum_pa" },
  d_dev: { label: "vs. fairer Wert", long: "Kurs vs. fairer Wert", group: DEEP, dir: 1, pct: true, term: "fairer_wert",
    fmt: (v, r) => (F.isNum(v) ? `<span class="badge ${v > 0.3 ? "critical" : v > 0.1 ? "serious" : v >= -0.1 ? "neutral" : "good"}">${F.signedPct(v, 0)}</span>`
      : r?.d_rating ? `<span class="muted" title="${esc(r.d_rating)}">unsicher</span>` : "–") },
  d_exp: { label: "Erw. Rendite", long: "Erwartete Rendite p. a. (5 Jahre)", group: DEEP, fmt: signed(1), dir: -1, pct: true, signed: true, term: "erwartete_rendite" },
  d_exp_lo: { label: "Rendite vorsichtig", long: "Erwartete Rendite p. a., vorsichtig gerechnet", group: DEEP, fmt: signed(1), dir: -1, pct: true, signed: true, term: "rendite_vorsichtig" },
  d_warn: { label: "Warnzeichen", long: "Warnzeichen (0–3) für eine Value-Falle", group: DEEP, dir: 1, unit: "0–3", term: "value_falle",
    fmt: (v, r) => (!F.isNum(v) ? "–" : r?.d_trap ? '<span class="badge serious" title="Wirkt günstig, hat aber mindestens zwei Warnzeichen">Value-Falle?</span>'
      : `<span class="${v >= 2 ? "bad" : v === 1 ? "" : "muted"}">${WARN_LABEL[v] || v}</span>`) },
  d_years: { label: "Datenjahre", long: "Jahre mit Bilanzdaten (Gewinnreihe)", group: DEEP, dir: -1, unit: "Jahre", term: "datenjahre",
    fmt: (v, r) => (F.isNum(v) ? `${F.num(v, 0)} J.${r?.d_src ? ` <span class="muted">${esc(r.d_src)}</span>` : ""}` : "–") },
  d_sc_eg: { label: "Score Gewinnw.", long: "Scorecard Gewinnwachstum (1–10)", group: DEEP, fmt: chipFmt, dir: -1, unit: "1–10", term: "scorecard" },
  d_sc_dg: { label: "Score Div.-W.", long: "Scorecard Dividendenwachstum (1–10)", group: DEEP, fmt: chipFmt, dir: -1, unit: "1–10", term: "scorecard" },
  d_sc_inc: { label: "Score Div.-Ertrag", long: "Scorecard Dividendenertrag (1–10)", group: DEEP, fmt: chipFmt, dir: -1, unit: "1–10", term: "scorecard" },
  d_net_yield: { label: "Div. netto", long: "Dividendenrendite nach Steuern (Anleger in Deutschland)", group: DEEP, fmt: pct(2), dir: -1, pct: true, term: "quellensteuer" },
  d_streak: { label: "Steig. (eigene)", long: "Dividendensteigerungen in Folge (aus der Zahlungshistorie)", group: DEEP, dir: -1, unit: "Jahre", term: "dividendensteigerungen",
    fmt: (v) => (F.isNum(v) ? `${F.int(v)} J.` : "–") },
  d_div_growth: { label: "Div.-Wachst.", long: "Dividendenwachstum p. a. (bis 10 Jahre)", group: DEEP, fmt: signed(1), dir: -1, pct: true, signed: true, term: "dividendenwachstum" },
  d_debt: { label: "Tilgungsj.", long: "Tilgungsjahre (Nettoschulden ÷ Free Cashflow)", group: DEEP, dir: 1, unit: "Jahre", term: "tilgungsjahre",
    fmt: (v) => (F.isNum(v) ? (v >= 99 ? "∞" : F.num(v, 1)) : "–") },
  d_roic: { label: "ROIC", long: "Kapitalrendite (ROIC)", group: DEEP, fmt: pct(1), dir: -1, pct: true, signed: true, term: "roic" },
  d_roic_avg: { label: "ROIC Ø", long: "Kapitalrendite (ROIC), Durchschnitt bis 4 Jahre", group: DEEP, fmt: pct(1), dir: -1, pct: true, signed: true, term: "roic" },
  d_pio: { label: "Piotroski", long: "Piotroski F-Score (0–9)", group: DEEP, dir: -1, unit: "0–9", term: "piotroski", fmt: (v) => (F.isNum(v) ? `${v} / 9` : "–") },
  d_shares: { label: "Aktienzahl p. a.", long: "Veränderung der Aktienzahl p. a. (negativ = Rückkäufe)", group: DEEP, fmt: signed(1), dir: 1, pct: true, term: "aktienrueckkauf" },
  d_rev90: { label: "Revision 90 T.", long: "Änderung der Gewinnschätzung in 90 Tagen", group: DEEP, fmt: signed(1), dir: -1, pct: true, signed: true, term: "revisionen" },
  d_mom121: { label: "Mom. 12-1", long: "Momentum 12-1 (12 Monate ohne letzten Monat)", group: DEEP, fmt: signed(1), dir: -1, pct: true, signed: true, term: "momentum_12_1" },
  d_dcf: { label: "Eingepreistes Wachst.", long: "Im Kurs eingepreistes FCF-Wachstum (Reverse-DCF, 9 %)", group: DEEP, fmt: signed(1), dir: 1, pct: true, term: "reverse_dcf" },
  d_fcfy: { label: "FCF-Rendite", long: "Free-Cashflow-Rendite", group: DEEP, fmt: pct(1), dir: -1, pct: true, term: "fcf_rendite" },
};
const TEXT_SORT = { name: "Name", country: "Land", industry: "Branche" };
const TEXT_TERMS = { industry: "branche" };

const VIEWS = [
  ["overview", "Überblick", ["market_cap", "score_total", "pe", "div_yield", "revenue_growth", "net_margin", "perf_1y"]],
  ["check", "Kauf-Checkliste", ["c_ok", "d_stab", "d_growth", "d_roic", "d_dev", "d_exp_lo", "d_warn"]],
  ["scores", "Scores", ["score_total", "score_quality", "score_value", "score_growth", "score_momentum", "score_stability", "score_dividend", "magic_formula"]],
  ["valuation", "Bewertung", ["market_cap", "pe", "forward_pe", "pb", "ps", "ev_ebitda", "peg"]],
  ["profit", "Rentabilität", ["revenue", "gross_margin", "ebitda_margin", "net_margin", "roe", "roa"]],
  ["growth", "Wachstum", ["revenue_growth", "eps_growth", "eps_growth_next", "pe", "peg"]],
  ["dividend", "Dividende", ["div_yield", "d_net_yield", "d_streak", "d_div_growth", "payout", "pe"]],
  ["deep", "Qualität & fairer Wert", ["d_years", "d_stab", "d_growth", "d_dev", "d_exp", "d_exp_lo", "d_warn", "d_sc_eg", "d_sc_dg", "d_sc_inc"]],
  ["signals", "Signale", ["d_roic", "d_pio", "d_shares", "d_rev90", "d_mom121", "d_dcf", "d_fcfy"]],
  ["balance", "Bilanz & Risiko", ["debt_equity", "net_debt_ebitda", "altman_z", "beta", "market_cap"]],
  ["price", "Kurs & Analysten", ["perf_1y", "momentum", "from_high", "rating", "forward_pe"]],
];

// Basis-Ansicht: nur die wichtigsten Kennzahlen, Ansichten und Vorlagen. Filter, Sortierung oder Auswahl aus der
// Profi-Ansicht bleiben sichtbar, damit nichts unbemerkt filtert.
const BASIC_METRICS = new Set(["score_total", "c_ok", "market_cap", "pe", "div_yield", "payout", "d_stab", "d_growth", "d_dev", "d_exp",
  "d_exp_lo", "d_warn", "d_net_yield", "d_streak", "d_div_growth"]);
const BASIC_VIEWS = [
  ["overview", "Überblick", ["score_total", "c_ok", "pe", "div_yield", "d_stab", "d_dev", "d_exp_lo"]],
  ["check", "Kauf-Checkliste", ["c_ok", "d_stab", "d_growth", "d_dev", "d_exp_lo", "d_warn"]],
  ["dividend", "Dividende", ["div_yield", "d_net_yield", "d_streak", "d_div_growth", "payout", "d_dev"]],
];
const BASIC_PRESETS = new Set(["Kauf-Checkliste", "Stabil & unterbewertet", "Hohe erwartete Rendite", "Dividenden-Aristokraten", "Attraktivste (Gesamt-Score)"]);
const views = () => (isBasic() ? BASIC_VIEWS : VIEWS);
// gewählte Ansicht; gibt es sie in der Basis-Ansicht nicht (z. B. „Qualität & fairer Wert“ aus einer Vorlage), der Überblick
const viewOf = (key) => views().find(([k]) => k === key) || views()[0];

// auch vom Tutorial genutzt (Links auf eine Vorlage)
export const PRESETS = [
  // die Prüfungen aus dem Tutorial auf einen Blick: mindestens 9 Punkte für die gewählte Strategie erfüllt
  ["Kauf-Checkliste", { rules: [["c_ok", "min", "9"]], sort: "c_ok", view: "check" }],
  // ohne Aktien, die nur wegen eines Wachstumsbruchs billig aussehen
  ["Stabil & unterbewertet", { rules: [["d_stab", "min", "0,9"], ["d_dev", "max", "-10"], ["d_warn", "max", "1"]], sort: "d_dev", view: "deep" }],
  // vorsichtig gerechnet: niedrigere Wachstumsquelle, keine Rückkehr zu einem höheren Multiple
  ["Hohe erwartete Rendite", { rules: [["d_exp_lo", "min", "8"], ["d_stab", "min", "0,7"]], sort: "d_exp_lo", view: "deep" }],
  ["Dividenden-Aristokraten", { rules: [["d_streak", "min", "25"]], sort: "d_streak", view: "dividend" }],
  ["Dividendenwachstum", { rules: [["d_sc_dg", "min", "8"]], sort: "d_sc_dg", view: "deep" }],
  ["Bilanzstark", { rules: [["d_pio", "min", "8"], ["d_roic", "min", "15"]], sort: "d_roic", view: "signals" }],
  ["Rückkäufer mit Rückenwind", { rules: [["d_shares", "max", "-1"], ["d_rev90", "min", "0"], ["d_mom121", "min", "0"]], sort: "d_shares", view: "signals" }],
  ["Attraktivste (Gesamt-Score)", { rules: [["score_total", "min", "90"], ["market_cap", "min", "5"]], sort: "score_total", view: "scores" }],
  ["Qualität zum fairen Preis", { rules: [["score_quality", "min", "70"], ["score_value", "min", "60"]], sort: "score_quality", view: "scores" }],
  ["Magic Formula", { rules: [["magic_formula", "min", "90"]], sort: "magic_formula", view: "scores" }],
  ["Dividendenperlen", { rules: [["div_yield", "min", "3"], ["div_years", "min", "10"], ["payout", "max", "75"]], sort: "div_yield", view: "dividend" }],
  ["Qualität", { rules: [["roe", "min", "15"], ["net_margin", "min", "10"], ["net_debt_ebitda", "max", "2"], ["revenue_growth", "min", "0"]], sort: "roe", view: "profit" }],
  ["Günstig bewertet", { rules: [["pe", "max", "15"], ["pb", "max", "2"], ["roe", "min", "10"]], sort: "pe", view: "valuation" }],
  ["Wachstum", { rules: [["revenue_growth", "min", "15"], ["eps_growth", "min", "15"], ["net_margin", "min", "5"]], sort: "revenue_growth", view: "growth" }],
];

// Link auf die Weltauswahl mit einer Vorlage (Startseite, leere Listen)
export function presetHref(name) {
  const p = PRESETS.find(([n]) => n === name)?.[1];
  if (!p) return "#/welt";
  const q = new URLSearchParams({ f: p.rules.map((r) => r.join(":")).join("|"), ansicht: p.view, sort: p.sort });
  return `#/welt?${q}`;
}

const CAP_STEPS = [5, 10, 25, 50, 100, 250, 1000];

function parseNum(s) {
  if (s == null || String(s).trim() === "") return null;
  const n = Number(String(s).trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const defaultDir = (key) => (key in TEXT_SORT ? 1 : METRICS[key]?.dir ?? -1);

// ---- Zustand <-> URL (#/welt?land=DE|FR&sort=pe …), damit Zurück-Navigation und Lesezeichen funktionieren
function readState(params) {
  const list = (k) => new Set((params.get(k) || "").split("|").filter(Boolean));
  const sort = params.get("sort");
  const view = params.get("ansicht");
  const s = {
    q: params.get("q") || "",
    continents: list("kontinent"), countries: list("land"), sectors: list("sektor"), industries: list("branche"),
    themes: list("thema"),
    minCap: parseNum(params.get("mcap")),
    rules: (params.get("f") || "").split("|").filter(Boolean).map((r) => {
      const [key, op, value = ""] = r.split(":");
      return key in METRICS && (op === "min" || op === "max") ? { key, op, value } : null;
    }).filter(Boolean),
    view: VIEWS.some(([k]) => k === view) ? view : "overview",
    sort: sort in METRICS || sort in TEXT_SORT ? sort : "market_cap",
    // „Weitere anzeigen“ steht in der Adresse, damit Zurück aus einem Profil an dieselbe Stelle der langen Liste führt
    limit: Math.min(6000, Math.max(PAGE, Math.ceil((parseNum(params.get("n")) || PAGE) / PAGE) * PAGE)),
  };
  const dir = params.get("dir");
  s.dir = dir === "asc" ? 1 : dir === "desc" ? -1 : defaultDir(s.sort);
  return s;
}

// Adresse der Weltauswahl ohne Seitenzahl (auch für „Meine Filter“)
function stateQuery(S) {
  const p = new URLSearchParams();
  if (S.q) p.set("q", S.q);
  for (const [k, set] of [["kontinent", S.continents], ["land", S.countries], ["sektor", S.sectors], ["branche", S.industries], ["thema", S.themes]]) {
    if (set.size) p.set(k, [...set].join("|"));
  }
  if (S.minCap) p.set("mcap", String(S.minCap));
  if (S.rules.length) p.set("f", S.rules.map((r) => `${r.key}:${r.op}:${r.value}`).join("|"));
  if (S.view !== "overview") p.set("ansicht", S.view);
  if (S.sort !== "market_cap") p.set("sort", S.sort);
  if (S.dir !== defaultDir(S.sort)) p.set("dir", S.dir > 0 ? "asc" : "desc");
  return p;
}

function writeState(S) {
  const p = stateQuery(S);
  if (S.limit > PAGE) p.set("n", String(S.limit));
  const qs = p.toString();
  // replaceState löst kein hashchange aus: die Seite wird nicht neu aufgebaut
  history.replaceState(history.state, "", `#/welt${qs ? `?${qs}` : ""}`);
}

// ---- Mehrfachauswahl (Kontinent, Land, Sektor, Branche) als aufklappbare Liste mit Trefferzahlen
let outsideClickBound = false;
function bindOutsideClick() {
  if (outsideClickBound) return;
  outsideClickBound = true;
  document.addEventListener("click", (e) => {
    document.querySelectorAll("details.ms[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = document.querySelector("details.ms[open]");
    if (open) { open.open = false; open.querySelector("summary").focus(); }
  });
}

function multiSelect(container, { id, label, termKey, allText, items, selected, onChange }) {
  const byValue = new Map(items.map((it) => [it.value, it]));
  container.innerHTML = `
    <span class="field-label" id="${id}-l">${termKey ? term(termKey, label) : label}</span>
    <details class="ms" id="${id}">
      <summary aria-labelledby="${id}-l ${id}-v"><span class="ms-value" id="${id}-v"></span></summary>
      <div class="ms-panel">
        ${items.length > 10 ? `<input type="search" class="ms-search" placeholder="${label} suchen …" aria-label="${label} suchen">` : ""}
        <ul class="ms-list" role="group" aria-label="${label}">
          ${items.map((it) => `<li data-value="${esc(it.value)}"${it.title ? ` title="${esc(it.title)}"` : ""}><label>
            <input type="checkbox" value="${esc(it.value)}"><span class="ms-text">${esc(it.text)}</span><span class="ms-count"></span></label></li>`).join("")}
        </ul>
        <div class="ms-foot"><button type="button" class="btn small" data-clear>Auswahl aufheben</button></div>
      </div>
    </details>`;
  const det = container.querySelector("details");
  const lis = [...det.querySelectorAll("li")];
  const search = det.querySelector(".ms-search");
  let allowed = null;

  const filterVisible = () => {
    const q = search ? search.value.trim().toLowerCase() : "";
    for (const li of lis) {
      const v = li.dataset.value;
      li.hidden = Boolean((allowed && !allowed.has(v) && !selected.has(v)) || (q && !byValue.get(v).text.toLowerCase().includes(q)));
    }
  };
  det.addEventListener("toggle", () => {
    if (!det.open) return;
    document.querySelectorAll("details.ms[open]").forEach((d) => { if (d !== det) d.open = false; });
    search?.focus();
  });
  det.addEventListener("change", (e) => {
    const cb = e.target;
    if (cb.type !== "checkbox") return;
    if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
    onChange();
  });
  det.querySelector("[data-clear]").addEventListener("click", () => { selected.clear(); onChange(); });
  search?.addEventListener("input", filterVisible);

  return {
    update(counts, allowedValues) {
      allowed = allowedValues;
      for (const li of lis) {
        const v = li.dataset.value;
        const n = counts.get(v) || 0;
        li.querySelector(".ms-count").textContent = F.int(n);
        li.classList.toggle("empty", n === 0);
        li.querySelector("input").checked = selected.has(v);
      }
      filterVisible();
      const names = [...selected].map((v) => byValue.get(v)?.text || v);
      det.querySelector(".ms-value").textContent = !names.length ? allText : names.length <= 2 ? names.join(", ") : `${names.length} ausgewählt`;
      det.classList.toggle("active", names.length > 0);
    },
  };
}

// ---- Daten: Status abfragen, bei Bedarf auf den Aufbau warten, Ergebnis im Speicher halten
let memo = null; // { version, data }
// serverlos: Weltauswahl und Tiefenanalyse baut ein täglicher Workflow, nicht der Server auf Knopfdruck
let managed = false;

async function waitForData(root, isCurrent) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (;;) {
    const st = await api.worldStatus();
    if (!isCurrent()) return null;
    managed = !!st.managed;
    if (!st.ready && managed) {
      root.innerHTML = `<h1>Weltauswahl</h1>
        <div class="loading-block"><div class="spinner"></div>
          Die Weltauswahl wird einmal am Tag automatisch vorberechnet und ist gerade noch nicht verfügbar.
          <p class="muted" style="margin-top:12px;font-size:13px;max-width:560px;margin-left:auto;margin-right:auto">${esc(st.error || "")}
            Die Seite versucht es jede Minute von selbst erneut.</p>
        </div>`;
      await sleep(60000);
      if (!isCurrent()) return null;
      continue;
    }
    if (st.ready) {
      if (!memo || memo.version !== st.version) memo = { version: st.version, data: await api.worldData() };
      return { status: st, data: memo.data };
    }
    if (st.error && !st.running) {
      root.innerHTML = `<h1>Weltauswahl</h1><div class="error-block" style="margin-top:14px">${esc(st.error)}
        <div style="margin-top:12px"><button class="btn primary" id="w-retry" type="button">Erneut versuchen</button></div></div>`;
      await new Promise((resolve) => root.querySelector("#w-retry").addEventListener("click", resolve, { once: true }));
      if (!isCurrent()) return null;
      await api.worldRefresh();
    }
    root.innerHTML = `<h1>Weltauswahl</h1>
      <div class="loading-block"><div class="spinner"></div>
        Lade die größten Aktien aller wichtigen Börsen von Yahoo Finance …<br>
        <span class="num">${st.running ? `Schritt ${st.done} von ${st.total}` : ""}</span>
        <div class="progress" style="max-width:320px;margin:14px auto 0"><div style="width:${st.total ? (st.done / st.total) * 100 : 0}%"></div></div>
        <p class="muted" style="margin-top:12px;font-size:13px">Das dauert beim ersten Mal etwa 20 Sekunden. Danach liegt die Auswahl einen Tag im Cache.</p>
      </div>`;
    await sleep(1000);
    if (!isCurrent()) return null;
  }
}

export async function renderWorld(root, params, isCurrent) {
  document.title = "Weltauswahl – Aktientool";
  root.innerHTML = '<div class="loading-block"><div class="spinner"></div>Lade Weltauswahl …</div>';
  let loaded, watch;
  try {
    [loaded, watch] = await Promise.all([waitForData(root, isCurrent), getWatchlist()]);
  } catch (e) {
    if (isCurrent()) root.innerHTML = `<h1>Weltauswahl</h1><div class="error-block" style="margin-top:14px">${esc(e.message)}</div>`;
    return;
  }
  if (!loaded || !isCurrent()) return;
  bindOutsideClick();

  const S = readState(params);
  S.tr = trOnly(); // keine URL-Angabe: gilt dauerhaft, bis man den Schalter umlegt
  const basic = isBasic();
  let data;
  let rows = [];
  let trReady = false; // Handelsliste der LS Exchange geladen und auf die Daten angewendet
  let trCount = 0;
  let industrySector = new Map();
  let facets = {};
  const $ = (sel) => root.querySelector(sel);

  root.innerHTML = `
    <div class="page-head">
      <h1>Weltauswahl</h1>
      <p class="muted" id="w-status"></p>
    </div>
    <div class="page-sub">
      <p class="secondary">Die größten Aktien aller wichtigen Börsen, jede Firma einmal mit ihrer Heimatbörse. Ein Klick auf den Namen öffnet die Analyse.</p>
      <div class="deep-bar" id="w-deep"></div>
    </div>
    <div class="card filter-card" id="w-filter-card">
      <div class="filter-head">
        <span class="filter-title">Filter</span>
        <span class="filter-chips" id="w-chips"></span>
        <span class="spacer"></span>
        <span class="tr-only"><label class="check" id="w-tr-label"><input type="checkbox" id="w-tr"> nur bei Trade Republic handelbar</label>
          ${term("trade_republic", '<span aria-hidden="true">ⓘ</span><span class="visually-hidden">Erklärung</span>')}</span>
        <button class="linklike" id="w-save-open" type="button" title="Die aktuellen Filter unter einem Namen merken">Filter speichern</button>
        <button class="linklike" id="w-reset" type="button">Alle zurücksetzen</button>
        <button class="btn small" id="w-toggle" type="button" aria-controls="w-filter-body"></button>
      </div>
      <div id="w-filter-body">
        <div class="filters">
          <div class="field"><label for="w-q">Suche</label><input id="w-q" type="search" placeholder="Name, Ticker, ISIN" autocomplete="off"></div>
          <div class="field" id="w-cont"></div>
          <div class="field" id="w-country"></div>
          <div class="field" id="w-sector"></div>
          <div class="field" id="w-industry"></div>
          <div class="field" id="w-theme"></div>
          <div class="field"><label for="w-cap">${term("boersenwert", "Börsenwert")}</label><select id="w-cap"></select></div>
        </div>
        <div class="rules-head">
          <span class="field-label">Vorlagen</span>
          <span class="preset-row small">${PRESETS.map(([name], i) => (basic && !BASIC_PRESETS.has(name) ? ""
            : `<button type="button" class="btn small" data-preset="${i}">${esc(name)}</button>`)).join("")}
            <button class="btn small add-rule" id="w-add" type="button">+ Kennzahl-Filter</button></span>
          <label class="check strategy-pick" for="w-strategy" title="Die Kauf-Checkliste prüft je nach Strategie andere Punkte (Tutorial, Lektion 1)">
            ${term("kauf_checkliste", "Checkliste")} für Strategie
            <select id="w-strategy" class="plain">${Object.entries(STRATEGY_LABELS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></label>
        </div>
        <div id="w-rules" class="rules"></div>
        <div class="rules-head" id="w-saved-head">
          <span class="field-label">Meine Filter</span>
          <span class="saved-row" id="w-saved"></span>
        </div>
      </div>
    </div>
    <div class="toolbar results-bar">
      <div class="segmented scroll" role="group" aria-label="Kennzahlen-Ansicht">
        ${views().map(([k, l]) => `<button type="button" data-view="${k}">${l}</button>`).join("")}
      </div>
      <span class="spacer"></span>
      <span id="w-count" class="secondary"></span>
      <label class="check" for="w-sort">Sortieren nach</label>
      <select id="w-sort" class="plain"></select>
      <button class="icon-btn" id="w-dir" type="button"></button>
      <button class="btn small" id="w-csv" type="button" title="Alle Treffer mit allen Kennzahlen als CSV-Datei (für Excel, Numbers, Google Sheets)">CSV</button>
      <button class="btn primary adv" id="w-analyze" type="button"></button>
    </div>
    <p class="muted coverage-note" id="w-note" hidden></p>
    <div class="card table-scroll" style="padding:8px 8px 4px">
      <table class="data screener world">
        <thead><tr id="w-head"></tr></thead>
        <tbody id="w-rows"></tbody>
      </table>
      <div class="more" id="w-more-wrap"><button class="btn" id="w-more" type="button">Weitere ${PAGE} anzeigen</button></div>
    </div>
    <div class="select-bar" id="w-select" hidden></div>`;

  // ---- Kauf-Checkliste je Zeile für die gewählte Strategie (erfüllte, prüfbare, alle Punkte)
  function applyChecklist() {
    const key = strategyKey();
    for (const r of rows) {
      const c = rowScore(r, key);
      if (c) { r.c_ok = c.passed; r.c_n = c.checked; r.c_all = c.total; r.c_miss = c.misses; }
      else { delete r.c_ok; delete r.c_n; delete r.c_all; delete r.c_miss; }
    }
    $("#w-strategy").value = key;
  }

  // ---- Daten vorbereiten (auch nach einer Aktualisierung im Hintergrund)
  function setData(d) {
    data = d;
    rows = d.stocks;
    applyChecklist();
    for (const r of rows) {
      const c = d.countries[r.country] || {};
      r._country = c.name || r.country;
      r._cont = c.continent || "Sonstige";
      r._search = `${r.name} ${r.symbol} ${r.isin || ""}`.toLowerCase();
      r._themes = r.themes || [];
    }
    industrySector = new Map();
    for (const r of rows) if (r.industry && !industrySector.has(r.industry)) industrySector.set(r.industry, r.sector);
    const trInfo = d.trade_republic || {};
    trReady = Boolean(trInfo.ready) && rows.some((r) => "tr" in r);
    trCount = rows.filter((r) => r.tr).length;
    const box = $("#w-tr");
    box.checked = S.tr;
    box.disabled = !trReady;
    $("#w-tr-label").title = trReady
      ? `Laut Handelsliste der LS Exchange vom ${new Date(trInfo.date).toLocaleDateString("de-DE")}: ${F.int(trCount)} von ${F.int(rows.length)} Aktien der Weltauswahl sind bei Trade Republic handelbar.`
      : trInfo.error ? `Handelsliste der LS Exchange nicht geladen (${trInfo.error}); es werden alle Aktien gezeigt.`
        : "Die Handelsliste der LS Exchange wird noch geladen; bis dahin werden alle Aktien gezeigt.";
    const byName = (a, b) => a.text.localeCompare(b.text, "de");
    const onFacet = () => { normalizeFacets(); changed(); };
    facets = {
      cont: multiSelect($("#w-cont"), { id: "ms-cont", label: "Kontinent", allText: "Alle Kontinente", selected: S.continents, onChange: onFacet,
        items: d.continents.filter((k) => rows.some((r) => r._cont === k)).map((k) => ({ value: k, text: k })) }),
      country: multiSelect($("#w-country"), { id: "ms-country", label: "Land", allText: "Alle Länder", selected: S.countries, onChange: onFacet,
        items: Object.entries(d.countries).map(([k, c]) => ({ value: k, text: c.name, title: c.continent })).sort(byName) }),
      sector: multiSelect($("#w-sector"), { id: "ms-sector", label: "Sektor", termKey: "sektor", allText: "Alle Sektoren", selected: S.sectors, onChange: onFacet,
        items: d.sectors.map((k) => ({ value: k, text: k })) }),
      industry: multiSelect($("#w-industry"), { id: "ms-industry", label: "Branche", termKey: "branche", allText: "Alle Branchen", selected: S.industries, onChange: onFacet,
        items: [...industrySector].map(([k, sec]) => ({ value: k, text: k, title: sec })).sort(byName) }),
      theme: multiSelect($("#w-theme"), { id: "ms-theme", label: "Thema", termKey: "thema", allText: "Alle Themen", selected: S.themes, onChange: onFacet,
        items: Object.entries(d.themes || {}).map(([k, t]) => ({ value: k, text: k, title: t.description })) }),
    };
    const date = new Date(d.built_at);
    const nCountries = Object.keys(d.countries).length;
    $("#w-status").innerHTML = `${F.int(d.count)} Aktien aus ${nCountries} Ländern ab ${F.big(d.min_cap_eur, "€")} Börsenwert ·
      Stand ${esc(date.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }))} Uhr ·
      ${managed ? '<span title="Ein Workflow baut die Weltauswahl jede Nacht neu">wird täglich aktualisiert</span>'
        : '<button class="linklike" id="w-refresh" type="button">aktualisieren</button>'}
      ${d.warnings?.length ? `<br><span class="bad">${d.warnings.map(esc).join(" ")}</span>` : ""}`;
    $("#w-refresh")?.addEventListener("click", refresh);
  }

  // Länder außerhalb der gewählten Kontinente bzw. Branchen außerhalb der gewählten Sektoren abwählen
  function normalizeFacets() {
    if (S.continents.size) {
      for (const c of [...S.countries]) if (!S.continents.has(data.countries[c]?.continent)) S.countries.delete(c);
    }
    if (S.sectors.size) {
      for (const i of [...S.industries]) if (!S.sectors.has(industrySector.get(i))) S.industries.delete(i);
    }
  }

  // ---- Filtern
  function compiledRules() {
    return S.rules.map((r) => {
      const m = METRICS[r.key];
      const v = parseNum(r.value);
      return v == null ? null : { key: r.key, op: r.op, v: v * (m.pct ? 0.01 : 1) * (m.scale || 1) };
    }).filter(Boolean);
  }

  function matcher(skip) {
    const q = S.q.trim().toLowerCase();
    const rules = compiledRules();
    const minCap = S.minCap ? S.minCap * 1e9 : null;
    const trFilter = S.tr && trReady;
    return (r) => {
      if (trFilter && !r.tr) return false;
      if (q && !r._search.includes(q)) return false;
      if (skip !== "cont" && S.continents.size && !S.continents.has(r._cont)) return false;
      if (skip !== "country" && S.countries.size && !S.countries.has(r.country)) return false;
      if (skip !== "sector" && S.sectors.size && !S.sectors.has(r.sector)) return false;
      if (skip !== "industry" && S.industries.size && !S.industries.has(r.industry)) return false;
      if (skip !== "theme" && S.themes.size && !r._themes.some((t) => S.themes.has(t))) return false;
      if (minCap && !(r.market_cap >= minCap)) return false;
      for (const rule of rules) {
        const v = ruleValue(r, rule);
        if (v == null || (rule.op === "min" ? v < rule.v : v > rule.v)) return false;
      }
      return true;
    };
  }

  // Wert, gegen den eine Bedingung prüft. Gewinnstabilität und -wachstum aus weniger als fünf Jahren sind nicht
  // belastbar (drei Jahreswerte liegen leicht auf einer Geraden): „mindestens x“ erfüllen solche Aktien nicht.
  function ruleValue(r, rule) {
    if (r.d_short && rule.op === "min" && (rule.key === "d_stab" || rule.key === "d_growth")) return null;
    return r[rule.key];
  }

  // Hinweis, wenn eine gefilterte Kennzahl nur für einen kleinen Teil der Aktien vorliegt (sonst wirkt eine kurze
  // Trefferliste wie ein strenger Filter, obwohl schlicht die Daten fehlen)
  function coverageNote() {
    const trFilter = S.tr && trReady;
    const base = trFilter ? rows.filter((r) => r.tr) : rows;
    const notes = [];
    for (const rule of compiledRules()) {
      const have = base.reduce((n, r) => n + (ruleValue(r, rule) != null ? 1 : 0), 0);
      if (!base.length || have / base.length >= 0.5) continue;
      const m = METRICS[rule.key];
      const name = (m.long || m.label).replace(/\s*\(.*\)$/, "");
      const why = rule.key === "d_stab" || rule.key === "d_growth" ? "mit mindestens 5 Jahren Bilanzdaten"
        : rule.key === "c_ok" ? "von der Tiefenanalyse erfasst" : "berechenbar";
      notes.push(`„${name}“ ist nur für ${F.int(have)} von ${F.int(base.length)} Aktien ${why}`);
    }
    const el = $("#w-note");
    el.hidden = !notes.length;
    if (notes.length) {
      el.innerHTML = `Hinweis: ${notes.map(esc).join("; ")}. Aktien ohne diesen Wert fallen aus der Liste.
        ${pendingDeep ? ` Die Tiefenanalyse rechnet ${F.int(pendingDeep)} Aktien neu; die Liste wächst ${managed ? "in den nächsten Nächten" : "mit jedem Durchgang (oben „Starten“)"}.` : ""}`;
    }
  }

  function countBy(skip, field) {
    const ok = matcher(skip);
    const m = new Map();
    for (const r of rows) {
      if (!ok(r)) continue;
      for (const v of Array.isArray(r[field]) ? r[field] : [r[field]]) m.set(v, (m.get(v) || 0) + 1);
    }
    return m;
  }

  function sorted(list) {
    const k = S.sort;
    const d = S.dir;
    if (k in TEXT_SORT) {
      const field = k === "country" ? "_country" : k;
      return list.sort((a, b) => (a[field] || "").localeCompare(b[field] || "", "de") * d);
    }
    return list.sort((a, b) => {
      const va = a[k];
      const vb = b[k];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * d;
    });
  }

  // ---- Darstellung
  function columns() {
    const metrics = [...viewOf(S.view)[2]];
    if (S.sort in METRICS && !metrics.includes(S.sort)) metrics.push(S.sort);
    return ["pick", "name", "country", ...(basic ? [] : ["industry"]), ...metrics, "watch"];
  }

  function headCell(key) {
    if (key === "watch") return '<th scope="col"><span class="visually-hidden">Watchlist</span></th>';
    if (key === "pick") {
      const shown = lastList.slice(0, S.limit);
      const all = shown.length > 0 && shown.every((r) => picked.has(r.symbol));
      return `<th scope="col" class="pick"><input type="checkbox" id="w-pick-all" ${all ? "checked" : ""}
        title="Alle angezeigten Zeilen auswählen" aria-label="Alle angezeigten Zeilen auswählen"></th>`;
    }
    const m = METRICS[key];
    const label = esc(m ? m.label : TEXT_SORT[key] === "Name" ? "Aktie" : TEXT_SORT[key]);
    const termKey = m ? m.term : TEXT_TERMS[key];
    const sort = S.sort === key ? (S.dir > 0 ? "ascending" : "descending") : "none";
    return `<th scope="col" data-key="${key}" aria-sort="${sort}">${termKey ? term(termKey, label) : label}</th>`;
  }

  function cell(key, r) {
    switch (key) {
      case "pick":
        return `<td class="pick"><input type="checkbox" data-pick="${esc(r.symbol)}" ${picked.has(r.symbol) ? "checked" : ""} aria-label="${esc(r.name)} auswählen"></td>`;
      case "name":
        // „nicht bei TR“ nur, wenn auch nicht handelbare Aktien gezeigt werden
        const notTr = r.tr === 0 && !(S.tr && trReady);
        return `<td class="name"><a href="#/aktie/${encodeURIComponent(r.symbol)}">${esc(r.name)}</a><span class="sym">${esc(r.symbol)}</span>${
          r._themes.length || notTr ? `<div class="tags">${notTr ? NOT_TR_TAG : ""}${r._themes.map((t) => `<span class="tag" title="${esc(t)}">${esc(data.themes?.[t]?.short || t)}</span>`).join("")}</div>` : ""}</td>`;
      case "country": return `<td class="txt" title="${esc(r._cont)}">${esc(r._country)}</td>`;
      case "industry": return `<td class="txt ind" title="${esc(r.sector || "")}">${esc(r.industry || "–")}</td>`;
      case "watch": {
        const on = watch.has(r.symbol);
        return `<td><button class="star ${on ? "on" : ""}" data-watch="${esc(r.symbol)}" title="${on ? "Aus Watchlist entfernen" : "Zur Watchlist"}" aria-label="${on ? "Aus Watchlist entfernen" : "Zur Watchlist"}">${on ? "★" : "☆"}</button></td>`;
      }
      default: {
        const m = METRICS[key];
        const v = r[key];
        const cls = [S.sort === key ? "sorted" : "", m.signed && F.isNum(v) ? (v > 0 ? "good" : v < 0 ? "bad" : "") : ""].filter(Boolean).join(" ");
        // auf den plausiblen Bereich gekappt (Basiseffekt oder Datenfehler bei Yahoo)
        const capped = r.capped?.includes(key)
          ? ` title="Yahoo meldet einen Wert ${v > 0 ? "über" : "unter"} dieser Grenze; gekappt, weil er nicht plausibel ist"` : "";
        return `<td${cls ? ` class="${cls}"` : ""}${capped}>${capped ? (v > 0 ? "≥ " : "≤ ") : ""}${m.fmt(v, r)}</td>`;
      }
    }
  }

  function metricOptions(selectedKey) {
    const groups = new Map();
    for (const [k, m] of Object.entries(METRICS)) {
      if (basic && !BASIC_METRICS.has(k) && k !== selectedKey) continue;
      if (!groups.has(m.group)) groups.set(m.group, []);
      groups.get(m.group).push(`<option value="${k}" ${k === selectedKey ? "selected" : ""}>${esc(m.long || m.label)}</option>`);
    }
    return [...groups].map(([g, opts]) => `<optgroup label="${esc(g)}">${opts.join("")}</optgroup>`).join("");
  }

  function renderRules() {
    $("#w-rules").innerHTML = S.rules.map((r, i) => {
      const m = METRICS[r.key];
      return `<div class="rule" data-i="${i}">
        <select data-role="key" aria-label="Kennzahl">${metricOptions(r.key)}</select>
        <select data-role="op" aria-label="Bedingung">
          <option value="min" ${r.op === "min" ? "selected" : ""}>mindestens</option>
          <option value="max" ${r.op === "max" ? "selected" : ""}>höchstens</option>
        </select>
        <input data-role="value" inputmode="decimal" value="${esc(r.value)}" aria-label="Wert für ${esc(m.long || m.label)}">
        <span class="unit">${m.pct ? "%" : esc(m.unit || "")}</span>
        ${m.term ? term(m.term, '<span aria-hidden="true">ⓘ</span><span class="visually-hidden">Erklärung</span>') : ""}
        <button type="button" class="icon-btn" data-role="remove" title="Filter entfernen" aria-label="Filter ${esc(m.long || m.label)} entfernen">✕</button>
      </div>`;
    }).join("");
  }

  function renderControls() {
    $("#w-q").value = S.q;
    $("#w-cap").innerHTML = `<option value="">alle (ab ${F.big(data.min_cap_eur, "€")})</option>` +
      CAP_STEPS.map((v) => `<option value="${v}" ${S.minCap === v ? "selected" : ""}>ab ${F.int(v)} Mrd. €</option>`).join("");
    root.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === viewOf(S.view)[0])));
    // Basis-Ansicht: Branche und Thema nur, wenn dort schon etwas ausgewählt ist
    $("#w-industry").hidden = basic && !S.industries.size;
    $("#w-theme").hidden = basic && !S.themes.size;
    $("#w-sort").innerHTML = Object.entries(TEXT_SORT).map(([k, l]) => `<option value="${k}" ${k === S.sort ? "selected" : ""}>${l}</option>`).join("") + metricOptions(S.sort);
    renderRules();
  }

  function paint() {
    const ok = matcher(null);
    const list = sorted(rows.filter(ok));
    const cols = columns();

    // Trefferzahlen je Auswahl, jeweils ohne den eigenen Filter (sonst zeigt jede Liste nur noch sich selbst)
    const allowedCountries = S.continents.size ? new Set(Object.keys(data.countries).filter((k) => S.continents.has(data.countries[k].continent))) : null;
    const allowedIndustries = S.sectors.size ? new Set([...industrySector].filter(([, s]) => S.sectors.has(s)).map(([k]) => k)) : null;
    facets.cont.update(countBy("cont", "_cont"), null);
    facets.country.update(countBy("country", "country"), allowedCountries);
    facets.sector.update(countBy("sector", "sector"), null);
    facets.industry.update(countBy("industry", "industry"), allowedIndustries);
    facets.theme.update(countBy("theme", "_themes"), null);

    lastList = list;
    $("#w-head").innerHTML = cols.map(headCell).join("");
    const shown = list.slice(0, S.limit);
    $("#w-rows").innerHTML = shown.map((r) => `<tr data-sym="${esc(r.symbol)}"${picked.has(r.symbol) ? ' class="picked"' : ""}>${cols.map((c) => cell(c, r)).join("")}</tr>`).join("") ||
      `<tr><td colspan="${cols.length}" class="muted" style="text-align:left">Keine Aktie erfüllt alle Filter.</td></tr>`;
    $("#w-more-wrap").hidden = list.length <= S.limit;
    $("#w-more").textContent = `Weitere ${F.int(Math.min(PAGE, list.length - S.limit))} anzeigen`;
    $("#w-count").textContent = (S.tr && trReady ? `${F.int(list.length)} von ${F.int(trCount)} bei Trade Republic handelbaren Aktien`
      : `${F.int(list.length)} von ${F.int(rows.length)} Aktien`) +
      (list.length > S.limit ? ` · die ersten ${F.int(Math.min(S.limit, list.length))} angezeigt` : "");
    const n = Math.min(ANALYZE_MAX, list.length);
    const which = n === list.length ? (n === 1 ? "Diesen Treffer" : `Alle ${n} Treffer`) : `Erste ${n} Treffer`;
    $("#w-analyze").textContent = n ? `${which} im Screener analysieren` : "Im Screener analysieren";
    $("#w-analyze").disabled = n === 0;
    $("#w-analyze").dataset.symbols = list.slice(0, n).map((r) => r.symbol).join(",");
    $("#w-dir").textContent = S.dir > 0 ? "↑ aufsteigend" : "↓ absteigend";
    $("#w-dir").setAttribute("aria-label", `Sortierrichtung: ${S.dir > 0 ? "aufsteigend" : "absteigend"}, umschalten`);
    paintChips();
    paintSelect();
    coverageNote();
    writeState(S);
  }

  // ---- Mehrfachauswahl: vergleichen, im Screener analysieren, auf die Watchlist
  const picked = new Set();
  let lastList = [];
  function paintSelect() {
    const bar = $("#w-select");
    bar.hidden = picked.size === 0;
    if (!picked.size) return;
    const n = picked.size;
    const canCompare = n >= 2 && n <= 4;
    bar.innerHTML = `<b>${F.int(n)} ausgewählt</b>
      <button class="btn small primary" type="button" data-act="compare" ${canCompare ? "" : "disabled"}
        title="${canCompare ? "Die ausgewählten Aktien nebeneinander vergleichen" : "Zum Vergleichen 2 bis 4 Aktien auswählen"}">Vergleichen</button>
      <button class="btn small" type="button" data-act="screener" ${n > 100 ? "disabled" : ""} title="Für jede ausgewählte Aktie das ganze Profil laden (höchstens 100)">Im Screener analysieren</button>
      <button class="btn small" type="button" data-act="watch">Auf die Watchlist</button>
      <button class="linklike" type="button" data-act="clear">Auswahl aufheben</button>`;
  }

  // ---- Meine Filter: aktuelle Filter unter einem Namen merken
  function paintSaved(editing = false) {
    const list = savedFilters();
    const current = stateQuery(S).toString();
    $("#w-saved").innerHTML = list.map((f, i) => `<span class="saved-chip"${f.query === current ? ' title="gerade aktiv"' : ""}>
        <button type="button" class="btn small" data-saved="${i}">${f.query === current ? "✓ " : ""}${esc(f.name)}</button>
        <button type="button" class="x" data-saved-rm="${i}" aria-label="Filter „${esc(f.name)}“ löschen" title="löschen">✕</button></span>`).join("") +
      (editing
        ? `<form class="save-form" id="w-save-form"><input id="w-save-name" maxlength="60" placeholder="Name, z. B. Europa günstig & stabil" aria-label="Name für die Filter">
            <button class="btn small primary" type="submit">Speichern</button><button class="linklike" type="button" id="w-save-cancel">Abbrechen</button></form>`
        : `<button type="button" class="btn small add-rule" id="w-save-new">+ Aktuelle Filter speichern</button>
           ${list.length ? "" : '<span class="muted" style="font-size:13px">noch keine – stellen Sie Filter ein und speichern Sie sie hier</span>'}`);
    if (!editing) return;
    const input = $("#w-save-name");
    input.value = activeFilters().slice(0, 2).map(([, text]) => text).join(", ").slice(0, 60);
    input.focus();
    input.select();
    $("#w-save-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      const replaced = saveFilter(name, stateQuery(S).toString());
      toast(replaced ? `Filter „${name}“ aktualisiert.` : `Filter „${name}“ gespeichert. Sie finden ihn hier und auf der Startseite.`, { kind: "good" });
      paintSaved();
    });
    $("#w-save-cancel").addEventListener("click", () => paintSaved());
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); paintSaved(); } });
  }

  function openSaveForm() {
    if (collapsed) { collapsed = false; saveCollapsed(false); applyPanel(); }
    paintSaved(true);
    $("#w-saved-head").scrollIntoView({ block: "nearest" });
  }

  // gespeicherten Zustand übernehmen, ohne die Seite neu aufzubauen (die Auswahllisten halten die Mengen in S)
  function applyQuery(query) {
    const ns = readState(new URLSearchParams(query));
    for (const k of ["continents", "countries", "sectors", "industries", "themes"]) {
      S[k].clear();
      for (const v of ns[k]) S[k].add(v);
    }
    Object.assign(S, { q: ns.q, minCap: ns.minCap, rules: ns.rules, view: ns.view, sort: ns.sort, dir: ns.dir });
    normalizeFacets();
    renderControls();
    changed();
  }

  // ---- CSV mit allen Treffern und allen Kennzahlen (Rohwerte: Prozent als Zahl, Börsenwert und Umsatz in Mrd. €)
  function exportCsv() {
    const keys = Object.keys(METRICS);
    const header = ["Name", "Ticker", "ISIN", "Land", "Kontinent", "Sektor", "Branche", "bei Trade Republic",
      ...keys.map((k) => { const m = METRICS[k]; return `${m.long || m.label}${m.pct ? " (%)" : m.scale ? " (Mrd. €)" : ""}`; })];
    const rows = lastList.map((r) => [r.name, r.symbol, r.isin || "", r._country, r._cont, r.sector || "", r.industry || "",
      r.tr == null ? "" : r.tr ? "ja" : "nein",
      ...keys.map((k) => { const m = METRICS[k]; const v = r[k]; return csvNum(typeof v === "number" ? v * (m.pct ? 100 : 1) / (m.scale || 1) : null, 4); })]);
    downloadCsv(`weltauswahl-${today()}.csv`, header, rows);
    toast(`${F.int(rows.length)} Aktien als CSV gespeichert (Ordner „Downloads“).`, { kind: "good" });
  }

  // ---- Aktive Filter als Chips in der Kopfzeile des Filterbereichs; ✕ entfernt den Filter (auch bei eingeklapptem Bereich)
  function activeFilters() {
    const out = [];
    const names = (set, name = (k) => k) => {
      const all = [...set].map(name);
      return [all.length <= 2 ? all.join(", ") : `${all.slice(0, 2).join(", ")} +${all.length - 2}`, all.join(", ")];
    };
    const facet = (key, label, set, name) => {
      if (!set.size) return;
      const [short, full] = names(set, name);
      out.push([key, `${label}: ${short}`, full]);
    };
    if (S.q.trim()) out.push(["q", `Suche: „${S.q.trim()}“`]);
    facet("cont", "Kontinent", S.continents);
    facet("country", "Land", S.countries, (k) => data.countries[k]?.name || k);
    facet("sector", "Sektor", S.sectors);
    facet("industry", "Branche", S.industries);
    facet("theme", "Thema", S.themes);
    if (S.minCap) out.push(["cap", `Börsenwert ab ${F.int(S.minCap)} Mrd. €`]);
    S.rules.forEach((r, i) => {
      if (parseNum(r.value) == null) return; // leere Bedingung filtert nicht
      const m = METRICS[r.key];
      const unit = m.pct ? " %" : ["Mrd. €", "Jahre"].includes(m.unit) ? ` ${m.unit}` : "";
      const name = (m.long || m.label).replace(/\s*\(.*\)$/, "");
      out.push([`rule:${i}`, `${name} ${r.op === "min" ? "≥" : "≤"} ${r.value.trim().replace(/^-/, "−")}${unit}`]);
    });
    return out;
  }

  function paintChips() {
    const list = activeFilters();
    $("#w-chips").innerHTML = list.length
      ? list.map(([k, text, title]) => `<span class="fchip"${title ? ` title="${esc(title)}"` : ""}>${esc(text)}<button type="button"
          data-clear="${k}" aria-label="Filter „${esc(text)}“ entfernen" title="Filter entfernen">✕</button></span>`).join("")
      : `<span class="muted">${S.tr && trReady ? "keine weiteren" : "keine, es werden alle Aktien gezeigt"}</span>`;
    $("#w-reset").hidden = !list.length && !S.rules.length;
    $("#w-save-open").hidden = !list.length;
    if (!$("#w-save-form")) paintSaved(); // offenes Namensfeld nicht beim Tippen in anderen Filtern neu aufbauen
  }

  // ---- Filterbereich ein- und ausklappen
  let collapsed = readCollapsed();
  function applyPanel() {
    const shut = collapsed && !tourRunning();
    $("#w-filter-body").hidden = shut;
    $("#w-filter-card").classList.toggle("collapsed", shut);
    const t = $("#w-toggle");
    t.textContent = shut ? "Filter bearbeiten ▾" : "Einklappen ▴";
    t.setAttribute("aria-expanded", String(!shut));
    t.hidden = tourRunning();
  }
  paintPanel = () => { if (isCurrent()) applyPanel(); };

  // Nach jeder Filteränderung wieder oben anfangen
  function changed() {
    S.limit = PAGE;
    paint();
  }

  function setSort(key, dir) {
    S.sort = key;
    S.dir = dir ?? defaultDir(key);
    $("#w-sort").value = key;
    changed();
  }

  // ---- Aktualisieren im Hintergrund: Fortschritt in der Statuszeile, danach neue Daten einsetzen
  async function refresh() {
    try { await api.worldRefresh(); } catch (e) { /* Status zeigt den Fehler */ }
    pollRefresh();
  }

  async function pollRefresh() {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (;;) {
      if (!isCurrent()) return;
      let st;
      try { st = await api.worldStatus(); } catch (e) { return; }
      if (!isCurrent()) return;
      if (st.running) {
        const btn = $("#w-refresh");
        if (btn) { btn.disabled = true; btn.textContent = `wird aktualisiert (${st.done}/${st.total}) …`; }
        await sleep(1500);
        continue;
      }
      if (st.error) {
        $("#w-status").insertAdjacentHTML("beforeend", `<br><span class="bad">${esc(st.error)}</span>`);
        const btn = $("#w-refresh");
        if (btn) { btn.disabled = false; btn.textContent = "aktualisieren"; }
        return;
      }
      if (st.ready && memo?.version !== st.version) {
        memo = { version: st.version, data: await api.worldData() };
        if (!isCurrent()) return;
        setData(memo.data);
        normalizeFacets();
        renderControls();
        paint();
      }
      return;
    }
  }

  // ---- Tiefenanalyse: Fortschritt anzeigen, starten/pausieren, neue Ergebnisse auf Wunsch übernehmen
  let pendingDeep = 0; // Aktien, deren Tiefenwerte fehlen oder neu berechnet werden
  function paintDeep(st, version) {
    const d = st?.deep;
    const el = $("#w-deep");
    if (!d) { el.innerHTML = ""; return; }
    const universe = d.universe || rows.length;
    const analysed = Math.min(d.analysed, universe);
    const pctDone = universe ? analysed / universe : 0;
    pendingDeep = Math.min(d.stale || 0, universe) + Math.max(0, universe - analysed);
    const long = F.isNum(d.long_history) ? ` · ${F.int(Math.min(d.long_history, universe))} mit mindestens 5 Jahren Bilanzdaten` : "";
    const state = managed ? (pendingDeep ? `${F.int(pendingDeep)} werden in den nächsten Nächten neu berechnet` : "vollständig")
      : d.running
        ? (d.throttled_until ? "Yahoo drosselt, kurze Pause …" : `läuft${d.current ? ` (gerade ${esc(d.current)})` : ""}`)
        : d.paused ? "pausiert" : pendingDeep ? `${F.int(pendingDeep)} zu erneuern` : analysed >= universe ? "vollständig" : "wartet";
    const fresh = version && memo?.version !== version
      ? ' · <button class="linklike" id="w-deep-load" type="button">neue Ergebnisse übernehmen</button>' : "";
    el.innerHTML = `<span>${term("tiefenanalyse", "Tiefenanalyse")}: ${F.int(analysed)} von ${F.int(universe)} Aktien (${F.pct(pctDone, 0)})${long} · ${state}${d.errors ? ` · ${F.int(d.errors)} Fehler` : ""}${fresh}</span>
      <div class="progress"><div style="width:${pctDone * 100}%"></div></div>
      ${managed ? "" : `<button class="btn small" id="w-deep-toggle" type="button">${d.running ? "Pausieren" : analysed >= universe && !d.stale ? "Erneut prüfen" : "Starten"}</button>`}`;
    $("#w-deep-toggle")?.addEventListener("click", async () => {
      try { paintDeep({ deep: d.running ? await api.deepPause() : await api.deepStart() }); } catch (e) { /* Anzeige bleibt */ }
      pollDeep();
    });
    $("#w-deep-load")?.addEventListener("click", async () => {
      memo = { version, data: await api.worldData() };
      if (!isCurrent()) return;
      setData(memo.data);
      normalizeFacets();
      renderControls();
      paint();
      paintDeep(st, version);
    });
  }

  let deepPolling = false;
  async function pollDeep() {
    if (deepPolling) return;
    deepPolling = true;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      for (;;) {
        await sleep(15000);
        if (!isCurrent()) return;
        let st;
        try { st = await api.worldStatus(); } catch (e) { return; }
        if (!isCurrent()) return;
        paintDeep(st, st.version);
        if (!st.deep?.running) return;
      }
    } finally { deepPolling = false; }
  }

  // Rückkehr aus dem Profil über „← Weltauswahl“: Zeile der zuletzt angesehenen Aktie zeigen und kurz hervorheben
  function showReturnRow() {
    const sym = takeRowToShow();
    if (!sym) return;
    const i = lastList.findIndex((r) => r.symbol === sym);
    if (i < 0) return;
    if (i >= S.limit) { S.limit = Math.ceil((i + 1) / PAGE) * PAGE; paint(); }
    const tr = [...$("#w-rows").children].find((x) => x.dataset.sym === sym);
    if (!tr) return;
    cancelRestore();
    tr.scrollIntoView({ block: "center" });
    tr.classList.add("flash");
  }

  // ---- Ereignisse
  let searchTimer;
  $("#w-q").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { S.q = e.target.value; changed(); }, 120);
  });
  $("#w-cap").addEventListener("change", (e) => { S.minCap = parseNum(e.target.value); changed(); });
  $("#w-tr").addEventListener("change", (e) => { S.tr = e.target.checked; setTrOnly(S.tr); changed(); });
  $("#w-strategy").addEventListener("change", (e) => setStrategy(e.target.value));
  // Strategie hier oder im Tutorial geändert: Checkliste neu rechnen
  const onStrategy = () => {
    if (!isCurrent()) { document.removeEventListener("tutorial-changed", onStrategy); return; }
    if (strategyKey() === $("#w-strategy").dataset.applied) return;
    applyChecklist();
    $("#w-strategy").dataset.applied = strategyKey();
    changed();
  };
  document.addEventListener("tutorial-changed", onStrategy);
  $("#w-add").addEventListener("click", () => {
    const used = new Set(S.rules.map((r) => r.key));
    const candidates = basic ? ["d_dev", "d_stab", "pe", "div_yield", "d_exp", "d_growth"] : ["pe", "div_yield", "roe", "revenue_growth", "net_margin", "net_debt_ebitda"];
    const key = candidates.find((k) => !used.has(k)) || candidates[0];
    S.rules.push({ key, op: METRICS[key].dir > 0 ? "max" : "min", value: "" });
    renderRules();
    $(`#w-rules .rule[data-i="${S.rules.length - 1}"] [data-role="value"]`).focus();
    changed();
  });
  $("#w-toggle").addEventListener("click", () => {
    collapsed = !collapsed;
    saveCollapsed(collapsed);
    applyPanel();
  });
  $("#w-chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-clear]");
    if (!b) return;
    const k = b.dataset.clear;
    if (k === "q") S.q = "";
    else if (k === "cap") S.minCap = null;
    else if (k.startsWith("rule:")) S.rules.splice(Number(k.slice(5)), 1);
    else ({ cont: S.continents, country: S.countries, sector: S.sectors, industry: S.industries, theme: S.themes })[k].clear();
    normalizeFacets();
    renderControls();
    changed();
  });
  $("#w-reset").addEventListener("click", () => {
    S.q = "";
    S.minCap = null;
    S.rules = [];
    for (const set of [S.continents, S.countries, S.sectors, S.industries, S.themes]) set.clear();
    renderControls();
    changed();
  });
  root.querySelector(".rules-head").addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (!b) return;
    const p = PRESETS[Number(b.dataset.preset)][1];
    S.rules = p.rules.map(([key, op, value]) => ({ key, op, value }));
    S.view = p.view;
    S.sort = p.sort;
    S.dir = defaultDir(p.sort);
    renderControls();
    changed();
  });
  $("#w-rules").addEventListener("input", (e) => {
    if (e.target.dataset.role !== "value") return;
    S.rules[Number(e.target.closest(".rule").dataset.i)].value = e.target.value;
    changed();
  });
  $("#w-rules").addEventListener("change", (e) => {
    const rule = S.rules[Number(e.target.closest(".rule")?.dataset.i)];
    if (!rule) return;
    if (e.target.dataset.role === "key") {
      rule.key = e.target.value;
      rule.op = METRICS[rule.key].dir > 0 ? "max" : "min";
      renderRules();
    } else if (e.target.dataset.role === "op") {
      rule.op = e.target.value;
    }
    changed();
  });
  $("#w-rules").addEventListener("click", (e) => {
    const b = e.target.closest('[data-role="remove"]');
    if (!b) return;
    S.rules.splice(Number(b.closest(".rule").dataset.i), 1);
    renderRules();
    changed();
  });
  root.querySelector(".segmented").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (!b) return;
    S.view = b.dataset.view;
    root.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    paint();
  });
  $("#w-sort").addEventListener("change", (e) => setSort(e.target.value));
  $("#w-dir").addEventListener("click", () => { S.dir *= -1; changed(); });
  $("#w-head").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-key]");
    if (!th) return;
    const key = th.dataset.key;
    setSort(key, S.sort === key ? -S.dir : undefined);
  });
  $("#w-more").addEventListener("click", () => { S.limit += PAGE; paint(); });
  $("#w-analyze").addEventListener("click", (e) => {
    const symbols = e.currentTarget.dataset.symbols;
    if (symbols) location.hash = `#/screener?list=${encodeURIComponent(CUSTOM)}&symbols=${encodeURIComponent(symbols)}`;
  });
  $("#w-rows").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-watch]");
    if (!b) return;
    b.disabled = true;
    const sym = b.dataset.watch;
    const name = rows.find((r) => r.symbol === sym)?.name;
    try {
      await flipWatch(sym, name, async () => { watch = await getWatchlist(); if (isCurrent()) paint(); });
    } catch (err) { toast(err.message, { kind: "bad" }); b.disabled = false; }
  });
  $("#w-rows").addEventListener("change", (e) => {
    const cb = e.target.closest("input[data-pick]");
    if (!cb) return;
    if (cb.checked) picked.add(cb.dataset.pick); else picked.delete(cb.dataset.pick);
    cb.closest("tr").classList.toggle("picked", cb.checked);
    const all = $("#w-pick-all");
    if (all) all.checked = lastList.slice(0, S.limit).every((r) => picked.has(r.symbol));
    paintSelect();
  });
  $("#w-head").addEventListener("change", (e) => {
    if (e.target.id !== "w-pick-all") return;
    for (const r of lastList.slice(0, S.limit)) { if (e.target.checked) picked.add(r.symbol); else picked.delete(r.symbol); }
    paint();
  });
  $("#w-select").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const syms = [...picked];
    if (b.dataset.act === "clear") { picked.clear(); paint(); return; }
    if (b.dataset.act === "compare") { location.hash = `#/vergleich?s=${encodeURIComponent(syms.join(","))}`; return; }
    if (b.dataset.act === "screener") { location.hash = `#/screener?list=${encodeURIComponent(CUSTOM)}&symbols=${encodeURIComponent(syms.join(","))}`; return; }
    if (b.dataset.act === "watch") {
      const add = syms.filter((s) => !watch.has(s));
      if (!add.length) { toast("Alle ausgewählten Aktien stehen schon auf der Watchlist."); return; }
      b.disabled = true;
      try {
        for (const s of add) await toggleWatch(s);
      } catch (err) { toast(err.message, { kind: "bad" }); }
      watch = await getWatchlist();
      if (isCurrent()) paint();
      toast(`${F.int(add.length)} ${add.length === 1 ? "Aktie" : "Aktien"} auf die Watchlist gesetzt.`, {
        kind: "good", action: "Rückgängig",
        onAction: async () => {
          for (const s of add) if ((await getWatchlist()).has(s)) await toggleWatch(s);
          watch = await getWatchlist();
          if (isCurrent()) paint();
        },
      });
    }
  });
  $("#w-csv").addEventListener("click", exportCsv);
  $("#w-save-open").addEventListener("click", openSaveForm);
  $("#w-saved").addEventListener("click", (e) => {
    if (e.target.id === "w-save-new") { paintSaved(true); return; }
    const use = e.target.closest("[data-saved]");
    if (use) { const f = savedFilters()[Number(use.dataset.saved)]; if (f) applyQuery(f.query); return; }
    const rm = e.target.closest("[data-saved-rm]");
    if (rm) {
      const f = savedFilters()[Number(rm.dataset.savedRm)];
      if (!f) return;
      const { item, index } = removeFilter(f.name);
      paintSaved();
      toast(`Filter „${f.name}“ gelöscht.`, { action: "Rückgängig", onAction: () => { restoreFilter(item, index); if (isCurrent()) paintSaved(); } });
    }
  });
  // Profil aus der Tabelle öffnen: die ganze Trefferliste merken, damit man im Profil weiterblättern kann
  trackBrowse($("#w-rows"), () => `Weltauswahl (${F.int(lastList.length)} Treffer)`, () => lastList.map((r) => [r.symbol, r.name]));
  setPageKeys({
    f: () => $("#w-toggle").click(),
    s: () => {
      if (collapsed) { collapsed = false; saveCollapsed(false); applyPanel(); }
      $("#w-q").focus();
      $("#w-q").select();
    },
  });

  setData(loaded.data);
  $("#w-strategy").dataset.applied = strategyKey();
  normalizeFacets();
  renderControls();
  applyPanel();
  paintDeep(loaded.status);
  paint();
  showReturnRow();
  if (loaded.status.running) pollRefresh();
  if (loaded.status.deep?.running) pollDeep();
}
