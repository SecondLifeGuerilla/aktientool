// Bewertung von Hebelprodukten aus der Produktliste von onvista: fairer Wert, Preis-Check, Erwartung, Vergleich mit
// ähnlichen Scheinen anderer Emittenten, Kennzahlen (Delta, Zeitwertverlust, Gewinnschwelle) und kleine Helfer für die
// Anzeige. Genutzt von der großen Tabelle (derivtable.js), dem Vergleich und dem Profil-Überblick (derivlist.js) und
// dem Call/Put-Rechner (callput.js).
// Gerechnet wird wie im Rechner (optionmath.js). Jedes Produkt wird mit dem Aktienkurs bewertet, mit dem onvista seine
// Kennzahlen gerechnet hat (zeitgleich mit dem Briefkurs, siehe sources/onvista.py); Kursbewegungen gelten prozentual.
import * as F from "./format.js";
import * as M from "./optionmath.js";

export const DEFAULT_RATE = 0.02; // Zins p. a. (Euro-Geldmarkt, gerundet)
export const DEFAULT_MARGIN = 0.03; // Finanzierungsmarge der Emittenten bei Open-End-Knock-outs p. a. (üblich 2–4 %)
const REF_TOLERANCE = 0.15; // weicht onvistas Kurs der Aktie stärker vom Kurs des Rechners ab, gilt der des Rechners
const PEER_STRIKE = 0.07; // ähnliche Scheine: Basispreis höchstens ±7 % (logarithmisch) entfernt

export const money = (x, ccy = "EUR") => F.money(x, ccy, Math.abs(x) < 1 ? 3 : 2);
export const level = (x) => F.num(x, x >= 1000 ? 0 : x >= 100 ? 1 : 2);
export const lev = (x) => F.num(x, 2); // Hebel immer mit zwei Nachkommastellen (wie in der Trade-Republic-App)

// Faktor von der Währung, in der onvista Basispreis und Schwelle angibt, zur Kurswährung bei Yahoo: London notiert
// bei Yahoo in Pence, onvista rechnet in Pfund oder (Shell) mit dem Euro-Kurs. eurUnder/eurQuote: Euro je Einheit.
// null: Faktor unbekannt, dann rechnet die Liste nicht.
const MINOR = { GBp: "GBP", ZAc: "ZAR", ILA: "ILS" };
const sameUnit = (c) => ({ GBX: "GBp", ZAC: "ZAc" }[c] || c);
export function unitScale(under, quote, eurUnder, eurQuote) {
  const u = sameUnit(under);
  const q = sameUnit(quote);
  if (!u || !q || u === q || u === "PKT") return 1;
  if (MINOR[q] === u) return 100;
  return eurUnder > 0 && eurQuote > 0 ? eurUnder / eurQuote : null;
}
const scaleOf = (d, mk) => unitScale(d.under_ccy, mk.ccy, d.eur_under, mk.eur);

export const productPrice = (d) => d.ask ?? d.bid ?? null;
export const isMini = (d) => d.kind === "ko" && /mit Stop Loss/i.test(d.sub || "");

export function kindLabel(d) {
  if (d.kind === "os") return "Optionsschein";
  if (d.kind === "ko") return `${isMini(d) ? "Mini-Future" : "Turbo"}${d.open_end ? " Open End" : ""}`;
  if (d.kind === "faktor") return "Faktor-Optionsschein";
  return d.sub || "Hebelprodukt";
}

// Kurzbeschreibung: „Call · Turbo Open End · Basis 211,2 · KO 211,2“
export function describe(d, unit = "") {
  const u = unit && unit !== "EUR" ? ` ${unit}` : "";
  const plain = d.kind === "os" || d.kind === "ko";
  return [d.call ? "Call" : "Put", kindLabel(d), plain && d.strike != null ? `Basis ${level(d.strike)}${u}` : null,
    d.kind === "ko" && d.barrier != null && d.barrier !== d.strike ? `KO ${level(d.barrier)}${u}` : null,
    d.kind === "os" && d.expiry ? `bis ${F.date(d.expiry)}` : null, d.quanto ? "Quanto" : null].filter(Boolean).join(" · ");
}

/**
 * Bewertung eines Produkts. mk (Markt des Rechners): spot (Kurswährung), fx (Euro je Einheit für die Anzeige), ccy,
 * dccy (Anzeigewährung), eur, r, q, vol (Volatilität, falls der Schein keinen Preis hat), sigma (Schwankung der Aktie
 * für fairen Wert und Erwartung), margin. Ergebnis: p (Produkt für optionmath), S0 (Kurs der Aktie, mit dem onvista
 * gerechnet hat), T, price (Briefkurs), fair, check (Preis gegenüber fair). null, wenn Daten fehlen.
 */
export function model(d, mk) {
  if (!mk || !(mk.spot > 0) || !["os", "ko"].includes(d.kind) || !(d.strike > 0) || !(d.ratio > 0)) return null;
  const price = productPrice(d);
  const s = scaleOf(d, mk);
  if (!(price > 0) || s == null) return null;
  const ref = d.under_price > 0 ? d.under_price * s : null;
  const S0 = ref && Math.abs(ref / mk.spot - 1) < REF_TOLERANCE ? ref : mk.spot;
  const p = { kind: d.kind, call: d.call, K: d.strike * s, B: (d.barrier ?? d.strike) * s, ratio: d.ratio,
    fx: mk.fx, pfx: d.quanto ? 1 / s : mk.fx, vol: mk.vol, r: mk.r, q: mk.q,
    openEnd: d.kind === "ko" && (d.open_end || !d.expiry), fin: M.financing(d.call, mk.r, mk.margin ?? DEFAULT_MARGIN) };
  // Restlaufzeit: Optionsschein und Knock-out mit Fälligkeit (dessen Wert ist bis dahin der Terminwert)
  const expiry = d.kind === "os" || !p.openEnd ? d.expiry : null;
  const T = expiry ? Math.max(0, M.years(M.today(), expiry)) : 0;
  if (d.kind === "os") p.vol = M.impliedVol(p.call, price / (p.ratio * p.pfx), S0, p.K, T, p.r, p.q) ?? d.iv ?? mk.vol;
  const fair = M.fairValue(p, S0, T, mk.sigma ?? mk.vol);
  return { p, T, S0, price, expiry, knocked: M.knockedOut(p, S0), fair, check: fair > 0.0005 ? price / fair - 1 : null };
}

// Wert an einem Tag beim Aktienkurs S (in der Kurswährung des Rechners): dieselbe prozentuale Bewegung ab S0
export const valueAt = (m, mk, S, day) => M.value(m.p, m.S0 * (S / mk.spot),
  m.expiry ? Math.max(0, M.years(day, m.expiry)) : 0, Math.max(0, M.years(M.today(), day)));

// Erwartung (sc: g = Kursfaktor bis zum Tag, t in Jahren, sigma) für ein bewertetes Produkt
export const expect = (m, sc) => (m && sc ? M.outlook(m.p, m.S0, sc.g, sc.sigma, sc.t, m.T, m.price) : null);

// Kennzahlen eines bewerteten Produkts: Hebel (Angabe des Emittenten, sonst gerechnet), Gewinnschwelle als
// Kursänderung der Aktie (Optionsschein: bei Fälligkeit), beim Optionsschein Delta und Zeitwertverlust pro Tag
// (Anteil des Preises, negativ), Spanne umgerechnet auf die Aktie (Spanne ÷ Hebel).
export function figures(d, m) {
  const leverage = Math.abs(d.leverage ?? (m ? M.leverage(m.p, m.S0, m.T, m.price) : NaN));
  const out = { leverage: Number.isFinite(leverage) ? leverage : null, be: null, delta: null, theta: null, spreadU: null };
  if (d.spread != null && out.leverage > 0) out.spreadU = d.spread / out.leverage;
  if (!m) return out;
  const be = M.priceForValue(m.p, m.price);
  out.be = be > 0 ? be / m.S0 - 1 : null;
  if (m.p.kind === "os" && m.T > 0) {
    const day = Math.min(1 / 365, m.T);
    out.delta = M.delta(m.p, m.S0, m.T);
    out.theta = (M.value(m.p, m.S0, m.T - day) - M.value(m.p, m.S0, m.T)) / m.price * (1 / 365 / day);
  }
  return out;
}

// Optionsschein gegenüber ähnlichen Scheinen anderer Emittenten (gleiche Richtung, Basispreis ±7 %, Laufzeit ±25 %,
// mindestens drei): Preis bei deren mittlerer impliziter Volatilität. Unabhängig von jeder Annahme über die Schwankung.
const similar = (a, b) => b.m && b.d.kind === "os" && b.d.call === a.d.call && b.d.isin !== a.d.isin
  && !(a.d.issuer_id != null && b.d.issuer_id === a.d.issuer_id)
  && Math.abs(Math.log(b.m.p.K / b.m.S0) - Math.log(a.m.p.K / a.m.S0)) <= PEER_STRIKE
  && Math.abs(b.m.T - a.m.T) <= Math.max(0.25 * a.m.T, 30 / 365);

function peerFromVols(m, vols) {
  vols.sort((a, b) => a - b);
  const mid = vols.length >> 1;
  const iv = vols.length % 2 ? vols[mid] : (vols[mid - 1] + vols[mid]) / 2;
  const fair = M.blackScholes(m.p.call, m.S0, m.p.K, m.T, iv, m.p.r, m.p.q) * m.p.ratio * (m.p.pfx ?? m.p.fx);
  return fair > 0.0005 ? { check: m.price / fair - 1, n: vols.length, iv } : null;
}

export function peerCheck(item, pool) {
  if (!item.m || item.d.kind !== "os") return null;
  const vols = pool.filter((x) => similar(item, x)).map((x) => x.m.p.vol);
  return vols.length >= 3 ? peerFromVols(item.m, vols) : null;
}

// Für alle Optionsscheine einer Liste auf einmal (it.peer); nach Basispreis sortiert, damit jeder nur seine Nachbarn prüft
export function peersAll(items) {
  const list = items.filter((x) => x.m && x.d.kind === "os").map((x) => ({ x, k: Math.log(x.m.p.K / x.m.S0) }))
    .sort((a, b) => a.k - b.k);
  let lo = 0;
  for (const a of list) {
    while (list[lo].k < a.k - PEER_STRIKE) lo++;
    const vols = [];
    for (let j = lo; j < list.length && list[j].k <= a.k + PEER_STRIKE; j++) if (similar(a.x, list[j].x)) vols.push(list[j].x.m.p.vol);
    a.x.peer = vols.length >= 3 ? peerFromVols(a.x.m, vols) : null;
  }
}

// Achsengrenzen auf glatte Werte (etwa sechs Abschnitte)
export function axisRange(lo, hi) {
  const rough = (hi - lo) / 6;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].find((x) => x * mag >= rough) * mag;
  return { lo: Math.max(step, Math.floor(lo / step) * step), hi: Math.ceil(hi / step) * step, step };
}

// Schattierte Verteilung des Kurses am Tag der Erwartung (eigene, unsichtbare y-Achse); xs in Anzeigewährung
export function densitySeries(t, xs, X, sc, fx) {
  if (!(sc.sigma > 0) || !(sc.t > 0)) return null;
  const data = xs.map((x) => [x, M.density(x / fx, X, sc.sigma, sc.t)]);
  const max = Math.max(...data.map((d) => d[1]));
  if (!(max > 0)) return null;
  return {
    axis: { type: "value", show: false, min: 0, max: max * 1.15 },
    series: { id: "dichte", name: "Ihre Erwartung (Verteilung)", type: "line", yAxisIndex: 1, data, showSymbol: false, silent: true,
      smooth: true, lineStyle: { width: 0 }, areaStyle: { color: t.good, opacity: 0.1 }, z: 0, tooltip: { show: false } },
  };
}

export function stamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `Stand ${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}

// Markt für die Bewertung aus den Daten des Basiswerts (/api/basiswert): Kurs von Yahoo, Schwankung wie im letzten Jahr
export function marketOf(u, sigma = null) {
  const ccy = u.currency || "EUR";
  const fx = ccy !== "EUR" && u.eur ? u.eur : 1;
  const vol = u.vola_1y ?? u.vola_3m ?? 0.3;
  return { spot: u.price, fx, ccy, dccy: fx !== 1 || ccy === "EUR" ? "EUR" : ccy, eur: ccy === "EUR" ? 1 : u.eur,
    r: DEFAULT_RATE, q: u.div_yield ?? 0, vol, sigma: sigma ?? vol, margin: DEFAULT_MARGIN };
}
