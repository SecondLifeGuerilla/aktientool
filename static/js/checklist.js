// Kauf-Checkliste für eine Zeile der Weltauswahl: dieselben Prüfpunkte und Schwellen wie die Checkliste im Tutorial
// (tutorial.js, dort aus dem ganzen Profil), hier aus den Werten der Tiefenanalyse. So lässt sich die ganze
// Weltauswahl nach „erfüllt x von y Punkten“ sortieren und filtern. Wer eine Schwelle ändert, ändert sie an beiden Stellen.
import * as F from "./format.js";

export const STRATEGY_LABELS = {
  earnings_growth: "Gewinnwachstum", dividend_growth: "Dividendenwachstum", dividend_income: "Dividendenertrag",
};
const SCORE_FIELD = { earnings_growth: "d_sc_eg", dividend_growth: "d_sc_dg", dividend_income: "d_sc_inc" };
const STORE_KEY = "tutorial"; // dort merkt sich das Tutorial die gewählte Strategie

export function strategyKey() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}").strategy;
    return s in STRATEGY_LABELS ? s : "earnings_growth";
  } catch (e) { return "earnings_growth"; }
}

// Das Tutorial hält die Strategie im Speicher und schreibt sie zurück; es hört auf dieses Ereignis
export function setStrategy(key) {
  if (key in STRATEGY_LABELS) document.dispatchEvent(new CustomEvent("strategy-set", { detail: key }));
}

// ok: true erfüllt, false nicht erfüllt, null nicht prüfbar (zählt nicht mit)
export function rowChecklist(r, key = strategyKey()) {
  const items = [];
  if (r.d_t == null) return items; // von der Tiefenanalyse noch nicht erfasst
  const add = (group, label, ok) => items.push({ group, label, ok });
  const n = F.isNum;
  const short = Boolean(r.d_short) || (!n(r.d_stab) && !r.d_loss);

  add("Datenbasis", "Bilanzdaten über mindestens 5 Jahre", n(r.d_years) && r.d_years >= 4.8);

  add("Qualität", "Gewinnstabilität mindestens 0,75", r.d_loss ? false : short ? null : r.d_stab >= 0.75);
  add("Qualität", "Gewinnwachstum mindestens 6 % pro Jahr", short || !n(r.d_growth) ? null : r.d_growth >= 0.06);
  add("Qualität", "Kapitalrendite (ROIC) mindestens 8 %", n(r.d_roic) ? r.d_roic >= 0.08 : null);
  add("Qualität", "Piotroski F-Score mindestens 5", n(r.d_pio) ? r.d_pio >= 5 : null);
  add("Qualität", "Schulden in höchstens 4 Jahren tilgbar", n(r.d_debt) ? r.d_debt <= 4 : null);

  if (!n(r.d_dev) && !r.d_rating) {
    add("Preis", "Fairer Wert berechenbar", false);
  } else {
    const unsure = !n(r.d_dev); // Kennzahl gerade eingebrochen oder kurze Historie
    add("Preis", "Kurs höchstens 10 % über dem fairen Wert", unsure ? null : r.d_dev <= 0.1);
    add("Preis", "Erwartete Rendite mindestens 8 % pro Jahr", unsure || !n(r.d_exp) ? null : r.d_exp >= 0.08);
    add("Preis", "Keine Warnung vor einer Value-Falle", unsure || !n(r.d_warn) ? null : !r.d_trap);
  }

  add("Rückenwind", "Gewinnschätzungen nicht fallend", n(r.d_rev90) ? r.d_rev90 > -0.02 : null);
  add("Rückenwind", "Kurs über der 200-Tage-Linie", n(r.momentum) ? r.momentum > 0 : null);

  const sc = r[SCORE_FIELD[key]];
  add("Strategie", `Scorecard ${STRATEGY_LABELS[key]} mindestens 7 von 10`, n(sc) ? sc >= 7 : null);
  if (key !== "earnings_growth") {
    if (!(r.div_yield > 0)) {
      add("Strategie", "Zahlt eine Dividende", false);
    } else {
      const income = key === "dividend_income";
      if (income) add("Strategie", "Dividendenrendite mindestens 3 %", r.div_yield >= 0.03);
      else add("Strategie", "Dividendenwachstum mindestens 6 % pro Jahr", n(r.d_div_growth) ? r.d_div_growth >= 0.06 : null);
      add("Strategie", "Ausschüttungsquote höchstens 75 %", n(r.d_payout) ? r.d_payout >= 0 && r.d_payout <= 0.75 : null);
      const streak = income ? r.d_nocut : r.d_streak;
      add("Strategie", income ? "Mindestens 10 Jahre ohne Kürzung" : "Mindestens 10 Steigerungen in Folge", n(streak) ? streak >= 10 : null);
    }
  }
  return items;
}

// Zusammenfassung für die Tabelle: erfüllte, prüfbare und alle Punkte, dazu die nicht erfüllten als Text
export function rowScore(r, key = strategyKey()) {
  const items = rowChecklist(r, key);
  if (!items.length) return null;
  const checked = items.filter((i) => i.ok !== null);
  const misses = checked.filter((i) => !i.ok).map((i) => i.label);
  return { passed: checked.length - misses.length, checked: checked.length, total: items.length, misses };
}
