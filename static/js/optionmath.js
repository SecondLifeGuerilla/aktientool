// Bewertung von Hebelprodukten für den Call/Put-Rechner.
// Optionsscheine: Black-Scholes mit stetiger Dividendenrendite (Merton-Modell), wie es auch die Emittenten verwenden.
// Knock-out-Produkte: innerer Wert × Bezugsverhältnis; nach Berührung der Schwelle bleibt nur der Restwert
// (bei Turbos mit Schwelle = Basispreis null, bei Mini-Futures der Abstand zwischen Stop-Loss und Basispreis).

// Verteilungsfunktion der Standardnormalverteilung (Abramowitz/Stegun 26.2.17, Fehler unter 1e-7)
export function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = (Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)) * poly;
  return x >= 0 ? 1 - tail : tail;
}

// Preis einer europäischen Option je Aktie. T Restlaufzeit in Jahren; vol, r (Zins), q (Dividendenrendite) p. a.
export function blackScholes(call, S, K, T, vol, r = 0, q = 0) {
  if (T <= 0 || vol <= 0) {
    const fwd = S * Math.exp(-q * Math.max(T, 0)) - K * Math.exp(-r * Math.max(T, 0));
    return Math.max(0, call ? fwd : -fwd);
  }
  const sd = vol * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (vol * vol) / 2) * T) / sd;
  const d2 = d1 - sd;
  const spot = S * Math.exp(-q * T);
  const strike = K * Math.exp(-r * T);
  return call ? spot * normCdf(d1) - strike * normCdf(d2) : strike * normCdf(-d2) - spot * normCdf(-d1);
}

// Volatilität, bei der Black-Scholes den beobachteten Preis je Aktie ergibt; null, wenn kein Wert passt
// (etwa wenn der Preis unter dem inneren Wert liegt)
export function impliedVol(call, price, S, K, T, r = 0, q = 0) {
  let lo = 0.001;
  let hi = 5;
  if (!(T > 0) || !(price > blackScholes(call, S, K, T, lo, r, q)) || price >= blackScholes(call, S, K, T, hi, r, q)) return null;
  while (hi - lo > 1e-6) {
    const mid = (lo + hi) / 2;
    if (blackScholes(call, S, K, T, mid, r, q) < price) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Produkt: { kind: "os" | "ko", call, K (Basispreis), B (Knock-out-Schwelle), ratio (Bezugsverhältnis),
// fx (Produktwährung je Einheit der Aktienwährung), pfx (Umrechnung der Auszahlung; fehlt = fx, bei Quanto-Produkten
// fest 1 Euro je Einheit), vol, r, q, openEnd und fin (Knock-out ohne Laufzeit: Finanzierung p. a., siehe drift) }

export const knockedOut = (p, S) => p.kind === "ko" && (p.call ? S <= p.B : S >= p.B);
const payFx = (p) => p.pfx ?? p.fx;

// Knock-outs ohne Laufzeit: Der Emittent verschiebt Basispreis und Schwelle täglich um die Finanzierungskosten,
// beim Call um Zins + Marge nach oben, beim Put um Zins − Marge (bei kleinem Zins also nach unten). Faktor nach
// `elapsed` Jahren. Knock-outs mit Fälligkeit haben die Finanzierung schon im Preis (Aufgeld).
export const drift = (p, elapsed) => (p.kind === "ko" && p.openEnd && p.fin && elapsed > 0 ? 1 + p.fin * elapsed : 1);
export const financing = (call, r, margin) => (call ? r + margin : r - margin);

// Wert in Produktwährung beim Aktienkurs S und der Restlaufzeit T (Jahre); elapsed: Zeit bis zu diesem Tag.
// Knock-out ohne Laufzeit: innerer Wert, Basispreis um die Finanzierung bis dahin verschoben. Knock-out mit
// Fälligkeit: Terminwert S·e^(−qT) − K·e^(−rT) (Call; Put umgekehrt) – die Finanzierung bis zur Fälligkeit steckt im
// Preis, darum liegt ein Long über, ein Short unter dem inneren Wert; bei Fälligkeit bleibt der innere Wert.
export function value(p, S, T, elapsed = 0) {
  if (p.kind === "ko") {
    const f = drift(p, elapsed);
    const K = p.K * f;
    const B = p.B * f;
    const knocked = p.call ? S <= B : S >= B;
    const at = knocked ? B : S;
    const tau = !p.openEnd && T > 0 && !knocked ? T : 0;
    const fwd = at * Math.exp(-(p.q || 0) * tau) - K * Math.exp(-(p.r || 0) * tau);
    return Math.max(0, p.call ? fwd : -fwd) * p.ratio * payFx(p);
  }
  return blackScholes(p.call, S, p.K, T, p.vol, p.r, p.q) * p.ratio * payFx(p);
}

// Fairer Wert heute: Optionsschein nach Black-Scholes mit der Schwankung `sigma` (etwa der bisherigen der Aktie),
// Knock-out der innere Wert bzw. (mit Fälligkeit) der Terminwert
export const fairValue = (p, S, T, sigma) => (p.kind === "ko" ? value(p, S, T)
  : blackScholes(p.call, S, p.K, T, sigma, p.r, p.q) * p.ratio * payFx(p));

// Standardnormalverteilung auf einem Raster (z von −5 bis 5) für Erwartungswerte
const GRID = (() => {
  const n = 201;
  const z = Array.from({ length: n }, (_, i) => -5 + (10 * i) / (n - 1));
  const raw = z.map((x) => Math.exp(-x * x / 2));
  const sum = raw.reduce((a, b) => a + b, 0);
  return { z, w: raw.map((x) => x / sum) };
})();

/**
 * Was bringt das Produkt, wenn die Aktie nach t Jahren im Durchschnitt beim g-Fachen von S0 steht und dabei mit
 * sigma p. a. schwankt (lognormal, Mittelwert S0·g)? price: heutiger Kaufpreis; T: Restlaufzeit des Optionsscheins.
 * Endet der Optionsschein vorher, zählt sein Wert bei Fälligkeit (die Erwartung wird auf diesen Tag umgerechnet).
 * Knock-outs: Wahrscheinlichkeit, dass die Aktie die Schwelle unterwegs berührt, über die Brownsche Brücke zwischen
 * heute und dem jeweiligen Endkurs (exakt für lognormale Kurse mit konstanter Schwankung, die Schwelle wird mit ihrem
 * Stand zur Mitte des Zeitraums gerechnet); danach bleibt der Restwert (Mini-Future) oder nichts (Turbo).
 * Ergebnis als Renditen: mean (Durchschnitt), chance (Wahrscheinlichkeit für Gewinn), loss50 (für mehr als 50 %
 * Verlust), ko (für einen Knock-out; null beim Optionsschein).
 */
export function outlook(p, S0, g, sigma, t, T, price) {
  let h = Math.max(0, t);
  let gg = g;
  const ends = p.kind === "os" || !p.openEnd; // Produkt mit Fälligkeit (T = Restlaufzeit)
  if (ends && T < h) { gg = h > 0 ? g ** (Math.max(T, 0) / h) : 1; h = Math.max(T, 0); }
  const sd = Math.max(0, sigma) * Math.sqrt(h);
  const mid = S0 * gg;
  let mean = 0;
  let chance = 0;
  let loss50 = 0;
  let ko = 0;
  const f = drift(p, h / 2);
  const Bm = p.kind === "ko" ? p.B * f : null;
  const rest = p.kind === "ko" ? Math.max(0, p.call ? Bm - p.K * f : p.K * f - Bm) * p.ratio * payFx(p) : 0;
  const a = p.kind === "ko" ? (p.call ? Math.log(S0 / Bm) : Math.log(Bm / S0)) : 0;
  for (let i = 0; i < GRID.z.length; i++) {
    const w = GRID.w[i];
    const s = mid * Math.exp(sd * GRID.z[i] - (sd * sd) / 2);
    if (p.kind === "os") {
      const v = value(p, s, Math.max(0, T - h));
      mean += w * v;
      if (v > price) chance += w;
      if (v < price / 2) loss50 += w;
      continue;
    }
    const b = p.call ? Math.log(s / Bm) : Math.log(Bm / s);
    const hit = a <= 0 || b <= 0 ? 1 : sd > 0 ? Math.exp((-2 * a * b) / (sd * sd)) : 0;
    const alive = value(p, s, ends ? Math.max(0, T - h) : 0, h);
    mean += w * ((1 - hit) * alive + hit * rest);
    chance += w * ((1 - hit) * (alive > price) + hit * (rest > price));
    loss50 += w * ((1 - hit) * (alive < price / 2) + hit * (rest < price / 2));
    ko += w * hit;
  }
  return { mean: mean / price - 1, chance, loss50, ko: p.kind === "ko" ? ko : null };
}

// Kursspanne, in der die Aktie nach t Jahren in 2 von 3 Fällen liegt (Mittelwert X, Schwankung sigma p. a.)
export function likelyRange(X, sigma, t) {
  const sd = Math.max(0, sigma) * Math.sqrt(Math.max(0, t));
  return [X * Math.exp(-sd - (sd * sd) / 2), X * Math.exp(sd - (sd * sd) / 2)];
}

// Dichte des Kurses nach t Jahren (für die Schattierung in den Diagrammen)
export function density(S, X, sigma, t) {
  const sd = Math.max(0, sigma) * Math.sqrt(Math.max(0, t));
  if (!(sd > 0) || !(S > 0)) return 0;
  const z = (Math.log(S / X) + (sd * sd) / 2) / sd;
  return Math.exp(-z * z / 2) / (S * sd * Math.sqrt(2 * Math.PI));
}

// Tage als JJJJ-MM-TT in Ortszeit; Restlaufzeit in Jahren zwischen zwei solchen Tagen
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const today = () => localDay(new Date());
export const addMonths = (n) => { const d = new Date(); d.setMonth(d.getMonth() + n); return localDay(d); };
export const years = (from, to) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 / 365;

// Aktienkurs, bei dem das Produkt bei Fälligkeit (Knock-out: jederzeit) genau `target` wert ist
export const priceForValue = (p, target) => p.K + (p.call ? 1 : -1) * (target / (p.ratio * payFx(p)));

// Hebel: Um wie viel Prozent ändert sich das Produkt, wenn die Aktie um 1 % steigt (bezogen auf den Preis `basis`)
export function leverage(p, S, T, basis) {
  const h = S * 0.001;
  return (value(p, S + h, T) - value(p, S - h, T)) / (2 * h) * S / basis;
}

// Delta: Wie viel sich das Produkt je Einheit Aktienkurs bewegt, je Aktie (ohne Bezugsverhältnis und Währung);
// beim Call zwischen 0 und 1, beim Put zwischen −1 und 0
export function delta(p, S, T) {
  const h = S * 0.001;
  return (value(p, S + h, T) - value(p, S - h, T)) / (2 * h) / (p.ratio * payFx(p));
}
