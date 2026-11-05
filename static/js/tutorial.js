// Tutorial: Strategie wählen, geführte Lektionen durch die echten Seiten, Kauf-Checkliste und Wissenstest.
// Die Lektionen 2–5 laufen als Tour: Ein Hinweisfenster erklärt den markierten Bereich der aktuellen Seite, stellt kleine
// Aufgaben und erkennt selbst, wann sie erledigt sind. Die Tour liest dafür nur das DOM der Seiten und ändert nichts daran;
// sie schaltet lediglich für ihre Dauer auf die Profi-Ansicht, weil sie alle Bereiche zeigt.
import { api } from "./api.js";
import * as F from "./format.js";
import { term } from "./glossary.js";
import { setTourOverride } from "./mode.js";
import { pageKeyOf, PAGE_TOURS } from "./pagetours.js";
import { attachSearch } from "./search.js";
import { PRESETS } from "./world.js";

const esc = F.escapeHtml;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const DEFAULT_SYMBOL = "MSFT";
const PRACTICE = [["MSFT", "Microsoft"], ["KO", "Coca-Cola"], ["RMS.PA", "Hermès"], ["ALV.DE", "Allianz", "nur ~4 Jahre Bilanzdaten"]];

// ---------------------------------------------------------------- Fortschritt
// Lektionen, Strategie und Übungsaktie bleiben im Browser, die laufende Tour nur für die Sitzung (übersteht ein Neuladen).
// Ohne Speicher (privates Fenster) funktioniert alles, beginnt aber jedes Mal von vorn.
const STORE_KEY = "tutorial";
const RUN_KEY = "tutorial-tour";

function readJson(kind, key) {
  try { return JSON.parse(window[kind].getItem(key)); } catch (e) { return null; }
}
function writeJson(kind, key, value) {
  try {
    if (value == null) window[kind].removeItem(key);
    else window[kind].setItem(key, JSON.stringify(value));
  } catch (e) { /* nur Komfort */ }
}

const store = { done: [], tours: [], strategy: null, symbol: null, quizBest: null, ...(readJson("localStorage", STORE_KEY) || {}) };
const changed = () => document.dispatchEvent(new CustomEvent("tutorial-changed"));
function persist() { writeJson("localStorage", STORE_KEY, store); changed(); }
function markDone(id) { if (!store.done.includes(id)) { store.done.push(id); persist(); } }
function markTour(id) { if (!store.tours.includes(id)) { store.tours.push(id); persist(); } }
function setSymbol(sym) { store.symbol = String(sym).trim().toUpperCase(); persist(); }
const practiceSymbol = () => store.symbol || DEFAULT_SYMBOL;

export function tutorialProgress() {
  return { done: LESSONS.filter((l) => store.done.includes(l.id)).length, total: LESSONS.length };
}

// ---------------------------------------------------------------- Strategien (wie die Scorecard, analysis/scorecard.py)
const STRATEGIES = {
  dividend_income: {
    label: "Dividendenertrag",
    quote: "Ich möchte schon heute regelmäßige, möglichst hohe Einnahmen aus meinen Aktien.",
    text: "Hohe Dividenden von Anfang an. Gesucht sind Firmen mit einer hohen, sicheren Dividende, die seit vielen Jahren nicht gekürzt wurde, und mit stabilen Gewinnen, aus denen sie bezahlt wird.",
    core: "Dividendenrendite (volle Punktzahl ab 5 %)",
    watch: ["Dividendenrendite, auch nach Steuern", "Ausschüttungsquote: Bleibt Luft nach oben?", "Jahre ohne Kürzung", "Stabilität von Gewinn und Dividende"],
    preset: "Dividendenperlen",
    presetWhy: "Sie verlangt mindestens 3 % Dividendenrendite, 10 Jahre Dividendensteigerungen in Folge und eine Ausschüttungsquote von höchstens 75 %.",
    more: ["Dividenden-Aristokraten"],
  },
  dividend_growth: {
    label: "Dividendenwachstum",
    quote: "Ich möchte Einnahmen, die Jahr für Jahr wachsen. Heute darf es dafür weniger sein.",
    text: "Niedrigere Startrendite, dafür kräftig steigende Dividenden. Wer eine Aktie mit 2 % Dividendenrendite und 10 % Dividendenwachstum pro Jahr kauft, bekommt nach gut sieben Jahren rund 4 % auf den Kaufpreis.",
    core: "Dividendenwachstum (volle Punktzahl ab 15 % pro Jahr)",
    watch: ["Dividendenwachstum pro Jahr", "Gewinnwachstum, das künftige Erhöhungen bezahlt", "Ausschüttungsquote", "Steigerungen in Folge"],
    preset: "Dividendenwachstum",
    presetWhy: "Sie zeigt alle Aktien mit einem Scorecard-Score für Dividendenwachstum von mindestens 8 von 10.",
    more: ["Dividenden-Aristokraten", "Rückkäufer mit Rückenwind"],
  },
  earnings_growth: {
    label: "Gewinnwachstum",
    quote: "Mein Vermögen soll langfristig wachsen. Ob es dabei Dividenden gibt, ist mir egal.",
    text: "Kursgewinne statt Dividende. Gesucht sind Firmen, deren Gewinn zuverlässig und kräftig steigt, mit wenig Schulden und zu einem Preis, der noch Rendite übrig lässt.",
    core: "Gewinnwachstum (volle Punktzahl ab 20 % pro Jahr)",
    watch: ["Gewinnstabilität und Gewinnwachstum", "Kapitalrendite (ROIC)", "Tilgungsjahre", "Kurs vs. fairer Wert und erwartete Rendite"],
    preset: "Hohe erwartete Rendite",
    presetWhy: "Sie verlangt eine erwartete Rendite von mindestens 12 % pro Jahr bei einer Gewinnstabilität von mindestens 0,7: Qualität zu einem Preis, der noch Luft nach oben lässt.",
    more: ["Stabil & unterbewertet", "Qualität zum fairen Preis", "Bilanzstark"],
  },
};
const strategyKey = () => (store.strategy in STRATEGIES ? store.strategy : "earnings_growth");
const strategy = () => STRATEGIES[strategyKey()];

// Einordnungen wie im Fazit des Profils (analysis/summary.py)
const reliability = (s) => (s < 0 ? "rückläufig" : s >= 0.9 ? "äußerst zuverlässig" : s >= 0.75 ? "zuverlässig" : s >= 0.5 ? "schwankend" : "unzuverlässig");
const growthLabel = (g) => (g >= 0.12 ? "dynamisch" : g >= 0.06 ? "solide" : g >= 0 ? "gering" : "schrumpfend");
const SUITABILITY = (s) => (s >= 9 ? "sehr gut" : s >= 7 ? "gut" : s >= 5 ? "eher mäßig" : s >= 3 ? "wenig" : "nicht");
const mark = (ok) => (ok ? ' <span class="good" title="erfüllt">✓</span>' : ' <span class="bad" title="nicht erfüllt">✗</span>');
const METRIC_NOM = { eps: "der bilanzierte Gewinn", eps_adj: "der bereinigte Gewinn", ocf_ps: "der operative Cashflow", eps_norm: "der normalisierte Gewinn", rev_ps: "der Umsatz" };

// Link auf eine Vorlage der Weltauswahl (Filter und Sortierung stehen in der Adresse)
function presetHref(name) {
  const p = PRESETS.find(([n]) => n === name)?.[1];
  if (!p) return "#/welt";
  return `#/welt?${new URLSearchParams({ f: p.rules.map((r) => r.join(":")).join("|"), ansicht: p.view, sort: p.sort })}`;
}

// ---------------------------------------------------------------- Was die Seiten gerade zeigen
const toNum = (s) => Number(String(s).replace(/\./g, ""));

function deepProgress() {
  const text = $("#w-deep")?.textContent || "";
  const m = text.match(/([\d.]+) von ([\d.]+) Aktien/);
  return m ? { done: toNum(m[1]), total: toNum(m[2]), running: /läuft|drosselt/.test(text), paused: text.includes("pausiert") } : null;
}

function hitCount() {
  const m = ($("#w-count")?.textContent || "").match(/^([\d.]+) von ([\d.]+)/);
  return m ? { n: toNum(m[1]), total: toNum(m[2]) } : null;
}

function rulesText() {
  const rules = $$("#w-rules .rule").map((r) => {
    const opt = (role) => r.querySelector(`[data-role="${role}"]`)?.selectedOptions[0]?.textContent || "";
    const unit = r.querySelector(".unit")?.textContent || "";
    const value = r.querySelector('[data-role="value"]')?.value || "…";
    return `${esc(opt("key"))} ${esc(opt("op"))} ${esc(value)}${unit ? ` ${esc(unit)}` : ""}`;
  });
  return rules.length ? `<p>Eingestellt ist jetzt: <b>${rules.join("</b>, <b>")}</b>.</p>` : "<p>Noch ist kein Kennzahl-Filter gesetzt.</p>";
}

function profileSymbol() {
  const m = location.hash.match(/^#\/aktie\/([^?]+)/);
  return m ? decodeURIComponent(m[1]).toUpperCase() : null;
}

const profileRoute = (c) => `#/aktie/${encodeURIComponent(c.symbol)}`;
const nm = (c) => esc(c.p?.name || c.symbol);
const selectedPeriod = (v) => $('#period-seg [aria-pressed="true"]')?.dataset.period || v.default_period;

// ---------------------------------------------------------------- Lektionen
// Schritt: route (Seite, die der Schritt braucht), target (markierter Bereich), title, text, tip, task oder quiz.
// task: { text, done(state, ctx), enter(ctx) → state beim Betreten, auto: nach Erledigung sofort weiter, after(ctx) }
// optional: Schritt entfällt, wenn es den Bereich bei dieser Aktie nicht gibt (z. B. keine Dividende).
const LESSONS = [
  {
    id: "strategie", n: 1, short: "Strategie", minutes: 3,
    title: "Die eigene Strategie festlegen",
    summary: "Welche Aktien „gut“ sind, hängt davon ab, was Ihr Geld leisten soll: Einnahmen heute, wachsende Einnahmen oder Vermögensaufbau.",
    learn: ["die drei Strategien der Scorecard", "welche Kennzahlen je Strategie zählen", "welche Vorlagen der Weltauswahl passen"],
  },
  {
    id: "welt", n: 2, short: "Kandidaten finden", minutes: 6,
    title: "Kandidaten finden in der Weltauswahl",
    summary: "Aus rund 6.000 Aktien weltweit eine kurze Kandidatenliste machen: Vorlagen, Kennzahl-Filter, Ansichten, Sortieren, Merken.",
    learn: ["Vorlagen passend zur Strategie", "Filter verstehen und anpassen", "die Tiefenanalyse und ihre Grenzen"],
    recap: ["Vorlage passend zur Strategie wählen", "Filter anpassen, bis 10–30 Treffer übrig sind", "Ansichten wechseln und nach der wichtigsten Kennzahl sortieren",
      "interessante Treffer mit ☆ merken und im Profil prüfen"],
    steps: [
      {
        route: () => "#/welt", target: "#w-status", title: "Die ganze Welt in einer Tabelle",
        text: () => `<p>Die Weltauswahl enthält die größten Aktien aller wichtigen Börsen, jede Firma einmal mit ihrer Heimatbörse. ${
          $("#w-status") ? `Aktuell: <b>${esc(($("#w-status").textContent.match(/^[\d.]+ Aktien aus \d+ Ländern/) || [""])[0])}</b>.` : ""}</p>
          <p>Ziel dieser Lektion: aus dieser Menge eine <b>kurze Liste von 10 bis 30 Kandidaten</b> machen, die Sie sich danach einzeln ansehen.
          Sie lernen dabei die Bedienung, die Sie künftig jedes Mal brauchen.</p>`,
      },
      {
        route: () => "#/welt", target: "#w-deep", title: "Die Tiefenanalyse",
        text: () => {
          const d = deepProgress();
          const state = !d || d.running || d.done >= d.total ? "" : d.paused ? ", die Analyse ist pausiert (mit „Starten“ geht es weiter)" : ", die Analyse ruht gerade (mit „Starten“ geht es weiter)";
          const now = d ? `<p>Stand: <b>${F.int(d.done)} von ${F.int(d.total)} Aktien</b> analysiert${state}.
            ${d.done < d.total * 0.9 ? "Bis sie durch ist, finden Filter auf diese Kennzahlen nur einen Teil der Treffer." : ""}</p>` : "";
          return `<p>Die wichtigsten Kennzahlen, ${term("gewinnstabilitaet", "Gewinnstabilität")}, ${term("fairer_wert", "fairer Wert")} und
            ${term("erwartete_rendite", "erwartete Rendite")}, berechnet das Tool im Hintergrund für jede Aktie einzeln (4–5 Sekunden je Aktie,
            größte zuerst). Aktien, die noch nicht analysiert sind, fallen bei Filtern auf diese Kennzahlen heraus.</p>${now}
            <p>Lassen Sie den Server deshalb ruhig ein paar Stunden laufen; die Analyse setzt nach einem Neustart fort.</p>`;
        },
      },
      {
        route: () => "#/welt", target: () => $("#app .filters"), title: "Grob eingrenzen",
        text: `<p>Mit Kontinent, Land, Sektor, Branche und Thema grenzen Sie ein, wo Sie suchen. Die Zahlen in den Listen zeigen,
          wie viele Aktien jeweils übrig bleiben. Fachbegriffe mit gepunkteter Linie erklären sich beim Darüberfahren.</p>
          <p>Für den Anfang: Lassen Sie Land und Sektor offen. Gute Unternehmen gibt es überall, und wer nur im Heimatmarkt sucht,
          verpasst die meisten.</p>`,
        tip: "Wählen Sie zum Ausprobieren bei Kontinent „Europa“ und heben Sie die Auswahl danach wieder auf.",
      },
      {
        route: () => "#/welt",
        target: () => $$(".rules-head [data-preset]").find((b) => b.textContent.trim() === strategy().preset) || $(".rules-head"),
        title: "Eine Vorlage für Ihre Strategie",
        text: () => `<p>Vorlagen sind fertige Filter-Kombinationen. Für Ihre Strategie <b>${esc(strategy().label)}</b> passt
          „${esc(strategy().preset)}“: ${esc(strategy().presetWhy)}</p>${store.strategy ? ""
          : '<p class="muted">Sie haben noch keine Strategie gewählt, deshalb gilt Gewinnwachstum. Das holen Sie in Lektion 1 nach.</p>'}`,
        task: {
          text: () => `Klicken Sie auf die Vorlage „${esc(strategy().preset)}“.`,
          enter: () => location.hash,
          done: (s) => location.hash !== s && $$("#w-rules .rule").length > 0,
        },
      },
      {
        route: () => "#/welt", target: "#w-rules", optional: true, title: "Was die Vorlage eingestellt hat",
        text: () => `${rulesText()}<p>Jede Zeile ist eine Bedingung: Kennzahl, „mindestens“ oder „höchstens“, Wert. Das ⓘ erklärt die Kennzahl.
          Werte lassen sich ändern, Zeilen mit ✕ entfernen und mit „+ Kennzahl-Filter“ weitere Bedingungen hinzufügen.</p>`,
        tip: "Ändern Sie einen Wert, z. B. die Gewinnstabilität, und beobachten Sie, wie sich die Trefferzahl darunter ändert.",
      },
      {
        route: () => "#/welt", target: "#w-count", title: "Wie viele bleiben übrig?",
        text: () => {
          const c = hitCount();
          const d = deepProgress();
          if (!c) return "<p>Hier steht gleich die Zahl der Treffer.</p>";
          let advice = "Eine gute Größe für eine Kandidatenliste.";
          if (c.n < 5) {
            advice = `Das ist sehr wenig${d && d.done < d.total * 0.9 ? `, vor allem weil die Tiefenanalyse erst ${F.int(d.done)} von ${F.int(d.total)} Aktien geschafft hat` : ""}.
              Lockern Sie einen Filter oder nehmen Sie zum Üben die Vorlage „Qualität zum fairen Preis“: Sie nutzt nur Scores, die für alle Aktien vorliegen.`;
          } else if (c.n > 50) {
            advice = "Für eine Prüfung Aktie für Aktie sind das zu viele. Machen Sie einen Filter strenger oder ergänzen Sie mit „+ Kennzahl-Filter“ z. B. „Kapitalrendite (ROIC) mindestens 12 %“.";
          }
          return `<p>Von ${F.int(c.total)} Aktien erfüllen <b>${F.int(c.n)}</b> alle Filter. ${advice}</p>
            <p>Faustregel: 10 bis 30 Treffer. So viele können Sie in Ruhe einzeln prüfen.</p>`;
        },
      },
      {
        route: () => "#/welt", target: () => $('#app .segmented[aria-label="Kennzahlen-Ansicht"]'), title: "Ansichten: andere Spalten",
        text: `<p>Jede Ansicht zeigt eine Gruppe von Kennzahlen. „Qualität &amp; fairer Wert“ und „Signale“ stammen aus der Tiefenanalyse,
          „Scores“ vergleicht jede Aktie mit ihrem Sektor (0–100, höher ist besser). Die Filter bleiben beim Wechseln erhalten.</p>`,
        task: { text: "Wechseln Sie zur Ansicht „Signale“.", done: () => Boolean($('[data-view="signals"][aria-pressed="true"]')) },
      },
      {
        route: () => "#/welt", target: "#w-head", title: "Sortieren",
        text: `<p>Ein Klick auf einen Spaltenkopf sortiert, ein zweiter dreht die Richtung um. Zuerst steht immer der bessere Wert:
          beim KGV der niedrigste, beim ROIC der höchste.</p>
          <p>Gute Sortierungen für den Start: ${term("roic", "ROIC")} (Qualität), ${term("piotroski", "Piotroski")} (Bilanz) oder in der Ansicht
          „Qualität &amp; fairer Wert“ die erwartete Rendite (Preis).</p>`,
        task: {
          text: "Sortieren Sie die Liste mit einem Klick auf einen Spaltenkopf um.",
          enter: () => `${$("#w-sort")?.value}|${$("#w-dir")?.textContent}`,
          done: (s) => `${$("#w-sort")?.value}|${$("#w-dir")?.textContent}` !== s,
        },
      },
      {
        route: () => "#/welt", target: () => $("#w-rows .star")?.closest("tr"), optional: true, title: "Kandidaten merken",
        text: `<p>Mit dem Stern am Zeilenende landet eine Aktie auf Ihrer Watchlist. Dort sehen Sie später alle Kandidaten mit ihren
          Kennzahlen in einer Tabelle, und ihre Termine erscheinen unter „Termine“.</p>`,
        task: { text: "Merken Sie sich eine interessante Aktie mit ☆.", done: () => Boolean($("#w-rows .star.on")) },
      },
      {
        route: () => "#/welt", target: "#w-analyze", title: "Viele auf einmal prüfen",
        text: `<p>„Im Screener analysieren“ übergibt bis zu 50 Treffer an den Screener. Der lädt für jede Aktie das ganze Profil und zeigt
          die Scorecard-Scores für alle drei Strategien in einer Tabelle; das dauert ein paar Minuten. Praktisch, wenn Sie eine
          Liste mit einem Blick vergleichen wollen. Für diese Lektion brauchen Sie es nicht.</p>`,
      },
      {
        route: () => "#/welt", target: () => $("#w-rows td.name a"), title: "Einen Kandidaten öffnen",
        text: `<p>Jetzt wird es konkret: Öffnen Sie eine Aktie aus Ihrer Trefferliste, die Sie interessiert. In den Lektionen 3 und 4
          prüfen Sie genau diese Aktie.</p>`,
        task: { text: "Klicken Sie auf den Namen einer Aktie.", done: () => Boolean(profileSymbol()), auto: true, after: (c) => { c.symbol = profileSymbol(); setSymbol(c.symbol); } },
      },
      {
        title: "Kurz geprüft",
        quiz: {
          q: "Ein Filter auf „Gewinnstabilität“ liefert kaum Treffer. Woran liegt das am wahrscheinlichsten?",
          options: ["Es gibt weltweit kaum Firmen mit stabilen Gewinnen", "Die Tiefenanalyse ist noch nicht durch; nicht analysierte Aktien fallen heraus", "Der Filter funktioniert nur für US-Aktien"],
          correct: 1,
          explain: "Gewinnstabilität, fairer Wert und erwartete Rendite berechnet die Tiefenanalyse Aktie für Aktie. Ihren Fortschritt zeigt die Leiste oben in der Weltauswahl.",
        },
      },
      {
        title: "Noch eine Frage",
        quiz: {
          q: "Wie viele Treffer sind ein guter Ausgangspunkt für die Prüfung Aktie für Aktie?",
          options: ["Ein bis zwei", "10 bis 30", "Mehrere Hundert"],
          correct: 1,
          explain: "Bei ein, zwei Treffern fehlt die Auswahl, bei Hunderten schaffen Sie die Einzelprüfung nicht. Passen Sie die Filter an, bis etwa 10 bis 30 übrig sind.",
        },
      },
    ],
  },
  {
    id: "qualitaet", n: 3, short: "Qualität", minutes: 7, profile: true,
    title: "Qualität prüfen: Ist das ein gutes Unternehmen?",
    summary: "Im Profil Ihrer Kandidatin prüfen Sie, ob die Daten belastbar sind, ob der Gewinn zuverlässig steigt und ob die Bilanz das bestätigt.",
    learn: ["Datenbasis richtig einschätzen", "Gewinnstabilität und Wachstum lesen", "ROIC, Piotroski, Signale und Scorecard"],
    recap: ["Zuerst das Geschäftsmodell verstehen und die Datenbasis prüfen", "Gewinnstabilität ab 0,75 und solides Wachstum ab 6 % pro Jahr",
      "ROIC, Piotroski und Schulden als Gegenprobe", "Scorecard Ihrer Strategie ab 7 von 10"],
    steps: [
      {
        route: profileRoute, target: () => $(".profile-head")?.closest(".card"), title: "Erst verstehen, dann kaufen",
        text: (c) => `<p>Sie sehen das Profil von <b>${nm(c)}</b>, Ihrer Übungsaktie. Bevor Sie auf Zahlen schauen: Wissen Sie, womit die Firma ihr Geld verdient?
          Kaufen Sie nur Geschäftsmodelle, die Sie in zwei Sätzen erklären können, und fragen Sie sich, warum Kunden auch in zehn Jahren
          noch dort kaufen werden.</p><p>Oben rechts setzen Sie die Aktie auf die Watchlist, erfassen sie im Depot, legen Alarme an oder vergleichen sie.</p>`,
        task: () => ($("details.about") ? { text: "Klappen Sie die Beschreibung „Was macht …?“ auf.", done: () => Boolean($("details.about[open]")) } : null),
      },
      {
        route: profileRoute, target: () => $(".profile-head")?.closest(".card")?.querySelector(".notice"), title: "Wie belastbar sind die Daten?",
        text: (c) => {
          const d = c.p?.data;
          let mine = "";
          if (d) {
            const years = d.fundamental_years ? `${d.fundamental_years[0]}–${d.fundamental_years[1]}` : "keine";
            mine = c.p.quality?.short || !d.fundamental_years
              ? `<p><b>${nm(c)}:</b> ${esc(d.fundamentals_source)}, Geschäftsjahre ${years}. Das ist kurz: Nehmen Sie Stabilität, Wachstum und
                fairen Wert hier nur als groben Anhaltspunkt. Das Tool ordnet die Aktie deshalb auch nicht als unter- oder überbewertet ein.</p>`
              : `<p><b>${nm(c)}:</b> ${esc(d.fundamentals_source)}, Geschäftsjahre ${years}${mark(true)} Eine gute Grundlage.</p>`;
          }
          return `<p>Diese Zeile entscheidet, wie viel Sie den folgenden Kennzahlen glauben dürfen. Mit Berichten an die US-Börsenaufsicht
            (SEC) oder europäischen Jahresberichten (${term("esef", "ESEF")}) reichen die Bilanzdaten 6 bis über 15 Jahre zurück. Für Firmen ohne
            solche Berichte (die meisten DAX-Werte, Schweiz, Asien) gibt es kostenlos nur rund 4 Jahre von Yahoo.</p>${mine}`;
        },
      },
      {
        route: profileRoute, target: "#world-card", title: "Scores: der schnelle Vergleich",
        text: `<p>Die Scores von 0 bis 100 zeigen, wie die Aktie im Vergleich zu ihrem Sektor dasteht: 80 heißt besser als 80 % der Aktien
          des Sektors. ${term("score_qualitaet", "Qualität")} misst Rentabilität und Schulden, ${term("score_bewertung", "Bewertung")} Kennzahlen wie das KGV,
          ${term("score_momentum", "Momentum")} den Kurstrend.</p><p>Scores sind ein guter Filter, aber kein Urteil: Sie beruhen nur auf den letzten 12 Monaten.
          Ob eine Firma dauerhaft gut ist, zeigen die nächsten Abschnitte.</p>`,
      },
      {
        route: profileRoute, target: () => $("#sec-quality .grid.tiles"), title: "Steigt der Gewinn zuverlässig?",
        text: (c) => {
          const q = c.p?.quality;
          let mine = "";
          if (q?.loss_making) mine = `<p><b>${nm(c)}:</b> Verlust in ${q.losses} von ${q.count} Geschäftsjahren, deshalb keine Gewinnstabilität${mark(false)}.</p>`;
          else if (q && !F.isNum(q.stability)) mine = `<p><b>${nm(c)}:</b> Für eine Aussage liegen zu wenige Geschäftsjahre vor.</p>`;
          else if (q) {
            mine = `<p><b>${nm(c)}:</b> Stabilität ${F.stability(q.stability)} (${reliability(q.stability)})${q.short ? "" : mark(q.stability >= 0.75)}${
              F.isNum(q.growth) ? `, Wachstum ${F.signedPct(q.growth, 1)} pro Jahr (${growthLabel(q.growth)})${q.short ? "" : mark(q.growth >= 0.06)}` : ""}${
              q.short ? `. Aber nur über ${Math.round(q.years)} Jahre, also kaum beurteilbar` : ""}.</p>`;
          }
          return `<p>Die wichtigste Frage zuerst: Nur wenn der Gewinn dauerhaft steigt, steigen auf Dauer auch Kurs und Dividende.</p>
            <ul class="coach-list"><li>${term("gewinnstabilitaet", "Gewinnstabilität")}: 1,0 heißt, der Gewinn ist jedes Jahr perfekt gleichmäßig gestiegen.
              Ab 0,9 äußerst zuverlässig, ab 0,75 zuverlässig, unter 0,5 unzuverlässig, negativ fallend.</li>
            <li>${term("wachstum_pa", "Gewinnwachstum pro Jahr")}: ab 6 % solide, ab 12 % dynamisch.</li></ul>${mine}`;
        },
      },
      {
        route: profileRoute, target: () => $("#ch-eps")?.closest(".card"), optional: true, title: "Der Gewinn im Zeitverlauf",
        text: `<p>Das Diagramm zeigt, woraus die Stabilität entsteht. Ideal ist eine Treppe, die gleichmäßig nach oben führt.
          Fragen Sie bei Einbrüchen: einmalig (Krise, Sondereffekt) oder wiederkehrend (zyklisches Geschäft wie Chemie, Autos, Rohstoffe)?</p>
          <p>Die hellen Balken rechts sind die Prognosen der Analysten für die kommenden Geschäftsjahre.</p>`,
      },
      {
        route: profileRoute, target: () => $$("#sec-quality .grid.tiles")[1], optional: true, title: "Die Gegenprobe",
        text: (c) => {
          const f = c.p?.fundamentals;
          const roic = f?.roic?.latest;
          const pio = f?.piotroski?.score;
          const sh = f?.shares?.cagr;
          const v = (x) => (x ? ` <b>${nm(c)}: ${x}</b>` : "");
          return `<p>Ein stabiler Gewinn sollte sich in der Bilanz wiederfinden:</p><ul class="coach-list">
            <li>${term("roic", "ROIC")}: Wie viel verdient die Firma auf das eingesetzte Kapital? Ab 8 % mehr als die Kapitalkosten, ab 15 % spricht
              man von einem Burggraben.${v(F.isNum(roic) ? `${F.pct(roic, 1)}${mark(roic >= 0.08)}` : "")}</li>
            <li>${term("piotroski", "Piotroski F-Score")}: 9 Prüfpunkte zur Bilanz; 8–9 stark, 5–7 solide, darunter schwach.${v(F.isNum(pio) ? `${pio} / 9${mark(pio >= 5)}` : "")}</li>
            <li>${term("aktienrueckkauf", "Aktienzahl pro Jahr")}: negativ heißt Rückkäufe (Ihr Anteil an der Firma wächst), positiv Verwässerung.${v(F.isNum(sh) ? F.signedPct(sh, 1) : "")}</li>
            <li>${term("fcf_rendite", "Free-Cashflow-Rendite")}: frei verfügbares Geld im Verhältnis zum Kurs; je höher, desto günstiger.</li></ul>`;
        },
        task: () => ($("#sec-quality details.table-view")
          ? { text: "Öffnen Sie „Piotroski-Prüfpunkte anzeigen“ und sehen Sie nach, welche Punkte erfüllt sind.", done: () => Boolean($("#sec-quality details.table-view[open]")) }
          : null),
      },
      {
        route: profileRoute, target: () => $("#sec-signals .grid"), optional: true, title: "Rückenwind von Analysten und Insidern",
        text: (c) => {
          const a = c.p?.analysts;
          const parts = [];
          if (a?.revisions?.trend) parts.push(`Schätzungen ${esc(a.revisions.trend)}${mark(a.revisions.trend !== "fallend")}`);
          else if (F.isNum(a?.revisions?.change90)) parts.push(`Schätzung ${F.signedPct(a.revisions.change90, 1)} in 90 Tagen`);
          if (F.isNum(a?.surprises?.beats)) parts.push(`${a.surprises.beats} von ${a.surprises.quarters.length} Quartalen über der Erwartung`);
          return `<p>Steigende ${term("revisionen", "Gewinnschätzungen")} und regelmäßig übertroffene Erwartungen gehören zu den am besten belegten
            Signalen für die nächsten Monate. Fallende Schätzungen bei einer scheinbar günstigen Aktie sind dagegen ein Warnzeichen: Oft ist sie
            nur billig, weil die Gewinne sinken.</p>
            <p>Insiderkäufe (praktisch nur für US-Aktien) zeigen, dass das Management an die Firma glaubt; hohe Leerverkaufspositionen
            (vor allem bei deutschen Aktien), dass Profis auf fallende Kurse setzen.</p>${parts.length ? `<p><b>${nm(c)}:</b> ${parts.join(" · ")}.</p>` : ""}`;
        },
      },
      {
        route: profileRoute, target: () => $$("#sec-price .grid.two > .card")[1], optional: true, title: "Stimmung: Wohin zeigt der Trend?",
        text: (c) => {
          const m = c.p?.price?.momentum;
          return `<p>Liegt der Kurs über der ${term("momentum", "200-Tage-Linie")}, ist die Stimmung positiv. Für langfristige Anleger ist das
            kein Muss, aber eine Regel hilft: Fällt der Kurs stark <i>und</i> sinken die Gewinnschätzungen, lieber abwarten, statt ins fallende
            Messer zu greifen.</p>${F.isNum(m) ? `<p><b>${nm(c)}:</b> ${F.pct(Math.abs(m), 1)} ${m >= 0 ? "über" : "unter"} der 200-Tage-Linie.</p>` : ""}`;
        },
      },
      {
        route: profileRoute, optional: true, title: "Passt die Aktie zu Ihrer Strategie?",
        target: () => $$("#sec-scorecard .grid.three > .card").find((x) => x.querySelector("h3")?.textContent === strategy().label) || $("#sec-scorecard .grid.three"),
        text: (c) => {
          const s = c.p?.scorecard?.find((x) => x.key === strategyKey());
          return `<p>Die ${term("scorecard", "Scorecard")} fasst die Prüfungen für jede der drei Strategien zu einem Score von 1 bis 10 zusammen.
            Die Balken zeigen, wo die Aktie bei jedem Kriterium liegt; das mit „!“ markierte Kernkriterium bremst den Score, wenn es schwach ist.</p>
            <p>Für Sie zählt die markierte Karte <b>${esc(strategy().label)}</b>. Ab 7 passt die Aktie gut.</p>${
            s ? `<p><b>${nm(c)}:</b> ${s.score} von 10, also ${SUITABILITY(s.score)} geeignet${mark(s.score >= 7)}</p>` : ""}`;
        },
      },
      {
        title: "Kurz geprüft",
        quiz: {
          q: "Die Bilanzdaten einer Aktie stammen nur von Yahoo und reichen 4 Jahre zurück. Was heißt das für Gewinnstabilität und fairen Wert?",
          options: ["Sie sind besonders aktuell und deshalb genauer", "Sie beruhen auf wenigen Jahren und sind kaum belastbar", "Für die Bewertung macht das keinen Unterschied"],
          correct: 1,
          explain: "Kurze Reihen hängen stark vom Startjahr ab: Nach einem Einbruchsjahr sieht jede Erholung wie perfektes Wachstum aus. Das Tool zählt sie in der Scorecard deshalb höchstens neutral.",
        },
      },
      {
        title: "Noch eine Frage",
        quiz: {
          q: "Welche Kombination spricht am deutlichsten für ein Qualitätsunternehmen?",
          options: ["Gewinnstabilität 0,92, ROIC 18 %, Piotroski 7", "Gewinnstabilität 0,35, Dividendenrendite 8 %", "KGV 6 und Kurs 40 % unter dem Hoch"],
          correct: 0,
          explain: "Zuverlässig steigender Gewinn, hohe Kapitalrendite und eine solide Bilanz. Eine hohe Dividende oder ein niedriges KGV allein sagen nichts über die Qualität.",
        },
      },
    ],
  },
  {
    id: "preis", n: 4, short: "Preis", minutes: 7, profile: true,
    title: "Preis prüfen: Ist die Aktie ihr Geld wert?",
    summary: "Fairer Wert, erwartete Rendite und Reverse-DCF: Auch die beste Firma ist ein schlechtes Investment, wenn Sie zu viel bezahlen.",
    learn: ["womit das Tool bewertet", "fairer Wert und erwartete Rendite lesen", "Dividende prüfen, These notieren"],
    recap: ["Bewertet wird mit der stabilsten Kennzahl, gemessen an der eigenen Geschichte", "Kurs höchstens 10 % über dem fairen Wert",
      "erwartete Rendite ab 8 % pro Jahr, sonst ist ein ETF einfacher", "Investment-These mit Verkaufsgrund aufschreiben"],
    steps: [
      {
        route: profileRoute, target: () => $("#sec-valuation .grid.tiles"), title: "Womit wird bewertet?",
        text: (c) => {
          const v = c.p?.valuation;
          let mine = "";
          if (v?.available) {
            mine = `<p><b>${nm(c)}:</b> Grundlage ist ${esc(METRIC_NOM[v.metric_key] || v.metric_label)} (blau umrandet), bewertet wird also mit dem
              ${esc(v.multiple_label)}.${v.basis_note === "normalized" ? " Weil der Gewinn stark schwankt, nimmt das Tool den Durchschnitt der letzten 5 Jahre." : ""}</p>`;
          } else if (v) {
            mine = `<p><b>${nm(c)}:</b> Keine Kennzahl taugt für einen fairen Wert (${esc(v.reason || "zu wenige Daten")}). Die Schritte zum fairen Wert
              entfallen deshalb; nehmen Sie für diese Lektion besser eine andere Aktie.</p>`;
          }
          return `<p>Ob eine Aktie günstig ist, misst das Tool an ihrer eigenen Vergangenheit: Was haben Anleger früher im Schnitt für einen Euro
            Gewinn (oder Cashflow) bezahlt, und was zahlen sie heute? Dafür nimmt es die Kennzahl, die am gleichmäßigsten verlief, denn nur sie
            liefert einen verlässlichen Maßstab.</p>${mine}`;
        },
      },
      {
        route: profileRoute, target: () => $("#ch-multiple")?.closest(".card"), optional: true, title: "Teurer oder billiger als üblich?",
        text: (c) => {
          const v = c.p?.valuation;
          const per = v?.available ? v.periods[selectedPeriod(v)] : null;
          return `<p>Die Linie zeigt das ${esc(v?.multiple_label || "KGV")} jedes Tages, die gestrichelte Linie seinen Durchschnitt. Liegt die Linie heute
            unter dem Durchschnitt, ist die Aktie gemessen an ihrer Geschichte günstig. Grau hinterlegte Phasen mit eingebrochenem Gewinn zählen
            nicht zum Durchschnitt, weil das ${esc(v?.multiple_label || "KGV")} dort künstlich hoch ist.</p>${per && F.isNum(v.current_multiple)
            ? `<p><b>${nm(c)}:</b> heute ${F.num(v.current_multiple, 1)}, Durchschnitt ${F.num(per.avg_multiple, 1)}${mark(v.current_multiple <= per.avg_multiple * 1.1)}</p>` : ""}`;
        },
      },
      {
        route: profileRoute, target: () => $("#period-seg")?.closest(".toolbar"), optional: true, title: "Der Bewertungszeitraum",
        text: `<p>Der faire Wert hängt davon ab, über wie viele Jahre der Durchschnitt gebildet wird. 10 Jahre umfassen mehrere Börsenphasen und
          sind meist am robustesten, 3 Jahre spiegeln eher die jüngste Stimmung. Gesperrte Schaltflächen bedeuten, dass die Daten nicht so weit
          zurückreichen.</p>`,
        task: {
          text: "Wechseln Sie den Zeitraum und beobachten Sie, wie sich der faire Wert darunter ändert.",
          enter: () => $('#period-seg [aria-pressed="true"]')?.dataset.period,
          done: (s) => $('#period-seg [aria-pressed="true"]')?.dataset.period !== s,
        },
      },
      {
        route: profileRoute, target: "#fv-tiles", optional: true, title: "Fairer Wert und erwartete Rendite",
        text: (c) => {
          const v = c.p?.valuation;
          let mine = "";
          if (v?.available) {
            const k = selectedPeriod(v);
            const per = v.periods[k];
            const er = v.expected?.by_period?.[k];
            mine = v.dip_now || v.short_history
              ? `<p><b>${nm(c)}:</b> ${F.signedPct(per.deviation, 0)} zum fairen Wert, aber ${v.dip_now ? "die Kennzahl ist gerade eingebrochen" : "die Historie ist kurz"};
                 die Einordnung ist deshalb unsicher.</p>`
              : `<p><b>${nm(c)}</b> (${k} Jahre): ${F.signedPct(per.deviation, 0)} zum fairen Wert, ${esc(per.rating.label)}${mark(per.deviation <= 0.1)}${
                F.isNum(er) ? `; erwartete Rendite ${F.signedPct(er, 1)} pro Jahr${mark(er >= 0.08)}` : ""}</p>`;
          }
          return `<ul class="coach-list"><li><b>Kurs vs. fairer Wert:</b> unter −10 % unterbewertet, ±10 % fair, über +10 % überbewertet, über +30 % stark überbewertet.</li>
            <li><b>${term("erwartete_rendite", "Erwartete Rendite pro Jahr")}:</b> was bei einem Kauf heute pro Jahr herauskäme, wenn der Gewinn wie erwartet
              wächst und die Bewertung zum Durchschnitt zurückkehrt, plus Dividende. Ein breiter Weltindex brachte historisch grob 7–8 % pro Jahr.
              Eine Einzelaktie sollte mehr versprechen, sonst ist ein ETF die einfachere Wahl.</li></ul>${mine}`;
        },
      },
      {
        route: profileRoute, target: () => $("#ch-fv")?.closest(".card"), optional: true, title: "Kurs und fairer Wert im Verlauf",
        text: `<p>Die Linie „Kurs“ zeigt den Aktienkurs, „Fairer Wert“ das Durchschnitts-Multiple mal der jeweiligen Kennzahl. Lag der Kurs lange über dem
          fairen Wert, war die Aktie teuer; fiel er darunter, wurde sie günstig.</p><p>Rechts: die Prognose (gestrichelt) mit dem Korridor aus der
          Spanne der Analystenschätzungen und das Kursziel der Analysten als Punkt. Je breiter der Korridor, desto unsicherer die Prognose.</p>`,
      },
      {
        route: profileRoute, target: () => $("#dcf-seg")?.closest(".card"), optional: true, title: "Welches Wachstum steckt im Kurs?",
        text: (c) => {
          const g = c.p?.dcf?.rates?.["0.09"];
          const hist = c.p?.quality?.short ? null : c.p?.quality?.growth;
          return `<p>Der ${term("reverse_dcf", "Reverse-DCF")} dreht die Frage um: Wie stark muss der Free Cashflow pro Jahr wachsen, damit sich der heutige
            Kurs bei 9 % geforderter Rendite rechnet? Liegt das deutlich über dem, was die Firma bisher geschafft hat, ist viel Optimismus eingepreist.</p>${
            F.isNum(g) ? `<p><b>${nm(c)}:</b> eingepreist sind ${F.signedPct(g, 1)} pro Jahr${F.isNum(hist) ? `, bisher wuchs der Gewinn um ${F.pct(hist, 1)} pro Jahr${mark(g <= hist + 0.03)}` : ""}.</p>` : ""}`;
        },
      },
      {
        route: profileRoute, target: () => $("#sec-dividend .grid.tiles"), optional: true, title: "Ist die Dividende sicher?",
        text: (c) => {
          const d = c.p?.dividends;
          const div = strategyKey() !== "earnings_growth";
          const mine = d?.pays ? `<p><b>${nm(c)}:</b> Rendite ${F.pct(d.yield, 2)}, Ausschüttungsquote ${F.pct(d.payout_eps, 0)}${F.isNum(d.payout_eps) ? mark(d.payout_eps >= 0 && d.payout_eps <= 0.75) : ""},
            ${F.int(d.increase_streak)} Steigerungen in Folge.</p>` : "";
          return `<p>${div ? "Für Ihre Dividendenstrategie ist das der wichtigste Abschnitt" : "Auch wenn Ihnen Dividenden weniger wichtig sind, lohnt ein Blick"}:
            Eine hohe Rendite nützt nur, wenn die Dividende sicher ist.</p><ul class="coach-list">
            <li>${term("ausschuettungsquote", "Ausschüttungsquote")} unter etwa 75 %: Die Firma zahlt aus dem Gewinn und hat Luft für Erhöhungen. Über 100 % zahlt sie mehr, als sie verdient.</li>
            <li>${term("dividendensteigerungen", "Steigerungen in Folge")} und Jahre ohne Kürzung zeigen, wie verlässlich die Dividende ist.</li>
            <li>${term("rendite_vs_durchschnitt", "Rendite vs. Durchschnitt")}: Deutlich über dem eigenen Schnitt kann eine Kaufgelegenheit sein, oder ein
              Warnsignal, wenn der Kurs aus gutem Grund fällt.</li>
            <li>${term("quellensteuer", "Rendite nach Steuern")}: was bei Anlegern in Deutschland tatsächlich ankommt.</li></ul>${mine}`;
        },
      },
      {
        route: profileRoute, target: () => $("#sec-verdict"), title: "Das Fazit",
        text: `<p>Ganz oben im Profil fasst „Auf einen Blick“ Gewinnentwicklung, Bewertung, die passende Strategie und die Stimmung zusammen.
          Nach dieser Lektion wissen Sie, woher jede dieser Aussagen stammt. Es ist eine Zusammenfassung der Kennzahlen, keine Empfehlung:
          Was die Zahlen nicht zeigen (Wettbewerb, Management, Risiken), müssen Sie selbst einschätzen.</p>`,
      },
      {
        route: profileRoute, target: () => $("#note-text")?.closest(".card"), title: "Ihre Investment-These",
        text: `<p>Jetzt der Schritt, den Ihnen kein Tool abnimmt: Schreiben Sie auf, warum Sie die Aktie kaufen würden. Drei Sätze reichen:</p>
          <ul class="coach-list"><li>Warum ist das ein gutes Unternehmen?</li><li>Warum ist der Preis vernünftig?</li>
          <li>Was müsste passieren, damit Sie verkaufen? Zum Beispiel „Gewinnstabilität fällt unter 0,7“ oder „Kurs 40 % über dem fairen Wert“.</li></ul>
          <p>Wer vorher festlegt, wann er verkauft, entscheidet später weniger aus dem Bauch.</p>`,
        task: {
          text: "Schreiben Sie eine kurze These und klicken Sie auf „Notiz speichern“.",
          done: () => /gespeichert/.test($("#note-status")?.textContent || "") && Boolean($("#note-text")?.value.trim()),
        },
      },
      {
        title: "Die Kauf-Checkliste für Ihre Aktie",
        text: (c) => (c.p ? checklistCompact(c.p) : "<p>Lade die Daten …</p>"),
      },
      {
        title: "Kurz geprüft",
        quiz: {
          q: "Kurs vs. fairer Wert liegt bei +35 %. Wie ordnet das Tool die Aktie ein?",
          options: ["fair bewertet", "überbewertet", "stark überbewertet"],
          correct: 2,
          explain: "Über +10 % gilt eine Aktie als überbewertet, über +30 % als stark überbewertet.",
        },
      },
      {
        title: "Noch eine Frage",
        quiz: {
          q: "Ein Qualitätsunternehmen hat eine erwartete Rendite von nur 3 % pro Jahr. Was ist ein sinnvoller nächster Schritt?",
          options: ["Sofort kaufen, Qualität setzt sich immer durch", "Auf die Watchlist setzen und einen Alarm „x % unter fairem Wert“ anlegen", "Die Aktie für immer streichen"],
          correct: 1,
          explain: "Auch die beste Firma kann zu teuer sein. Mit dem Alarm warten Sie, bis der Preis wieder eine ordentliche Rendite verspricht.",
        },
      },
    ],
  },
  {
    id: "dranbleiben", n: 5, short: "Entscheiden", minutes: 5, profile: true,
    title: "Entscheiden und dranbleiben",
    summary: "Kandidaten vergleichen, mit Watchlist und Alarm auf den richtigen Preis warten, nach dem Kauf Depot und Termine im Blick behalten.",
    learn: ["Vergleich mit Alternativen", "Alarm für den richtigen Kaufpreis", "Termine, Depot und Score-Check"],
    recap: ["Jeden Kandidaten mit Alternativen vergleichen", "Zu teuer? Watchlist und Alarm „x % unter fairem Wert“",
      "Nach Quartalszahlen die These prüfen", "Im Score-Check lernen, welchen Scores Sie trauen können"],
    steps: [
      {
        route: profileRoute, target: "#watch-btn", title: "Auf die Watchlist",
        text: (c) => `<p>Ob Sie ${nm(c)} kaufen oder erst beobachten: Auf der Watchlist haben Sie Ihre Kandidaten im Blick, mit allen Kennzahlen in einer
          Tabelle (Menü „Watchlist“), und ihre Quartalszahlen und Dividendentermine erscheinen unter „Termine“.</p>`,
        task: { text: "Klicken Sie auf „☆ Zur Watchlist“ (falls die Aktie noch nicht darauf steht).", done: () => /In der Watchlist/.test($("#watch-btn")?.textContent || "") },
      },
      {
        route: profileRoute, target: () => $('.actions a[href^="#/vergleich"]'), title: "Nie ohne Alternative",
        text: `<p>Allein wirkt eine Aktie oft besser als im Vergleich. Stellen Sie Ihren Kandidaten deshalb neben ein bis drei Alternativen:
          direkte Konkurrenten oder andere Treffer Ihrer Liste.</p>`,
        task: { text: "Klicken Sie auf „⇄ Vergleichen“.", done: () => location.hash.startsWith("#/vergleich"), auto: true },
      },
      {
        route: (c) => `#/vergleich?s=${encodeURIComponent(c.symbol)}`, target: "#c-form", title: "Alternativen hinzufügen",
        text: `<p>Fügen Sie bis zu drei weitere Aktien hinzu, etwa einen direkten Konkurrenten. Ideen liefert im Profil der Link
          „Andere Aktien der Branche vergleichen“ unter den Scores.</p>`,
        task: { text: "Suchen Sie eine zweite Aktie und wählen Sie sie aus der Liste.", done: () => $$("#c-chips .tag").length >= 2 },
      },
      {
        route: (c) => `#/vergleich?s=${encodeURIComponent(c.symbol)}`, target: () => $("#c-body table.compare")?.closest(".card"), optional: true,
        title: "Zeile für Zeile vergleichen",
        text: () => `<p>Fett ist jeweils der beste Wert der Zeile. Zählen Sie nicht einfach die fetten Werte: Entscheidend sind die Zeilen, die für Ihre
          Strategie (${esc(strategy().label)}) zählen, und die Bewertung. Die beste Firma zum schlechtesten Preis kann die schlechtere Wahl sein.</p>
          <p>Oben zeigt das Diagramm die Wertentwicklung inklusive Dividenden.</p>`,
      },
      {
        route: (c) => `#/alarme?neu=${encodeURIComponent(c.symbol)}`, target: "#a-form", title: "Auf den richtigen Preis warten",
        text: `<p>Gute Unternehmen sind selten billig. Statt den Kurs jeden Tag zu prüfen, lassen Sie das Tool warten: Der Alarm
          „Kurs mindestens x % unter fairem Wert“ meldet sich, sobald Ihr Kandidat günstig wird. Geprüft wird alle 30 Minuten, solange das Tool im Browser geöffnet ist.</p>
          <p>Für Aktien, die Sie schon besitzen, gibt es Warnsignale: Dividende gekürzt oder Gesamt-Score fällt unter eine Schwelle.</p>`,
        task: {
          text: "Wählen Sie bei „Art“ den Alarm „Kurs mindestens x % unter fairem Wert“, geben Sie z. B. 10 ein und klicken Sie auf „Alarm anlegen“.",
          done: (s, c) => $$("#a-rows tr").some((tr) => tr.textContent.toUpperCase().includes(c.symbol.toUpperCase()) && tr.textContent.includes("unter fairem Wert")),
        },
      },
      {
        route: () => "#/termine", target: "#k-body", title: "Termine: Die These überprüfen",
        text: `<p>Hier stehen Quartalszahlen, Ex-Tage und Zahltage aller Aktien aus Watchlist und Depot. Nach jeden Zahlen lohnt ein Blick ins Profil:
          Haben sich Gewinn und Schätzungen so entwickelt, wie Sie es in Ihrer These aufgeschrieben haben? Wenn nicht, wissen Sie, was zu tun ist.</p>`,
      },
      {
        route: () => "#/depot", target: "#depot-form", title: "Nach dem Kauf: das Depot",
        text: `<p>Gekaufte Aktien erfassen Sie hier mit Stückzahl, Kaufkurs und Datum. Das Depot zeigt Gewinn und Verlust in Euro, Dividenden
          nach Steuern und die Aufteilung nach Land, Sektor und Währung.</p><p>Achten Sie auf Streuung: Kein einzelner Wert, kein Sektor und kein
          Land sollte Ihr Depot dominieren, auch wenn die Aktien einzeln überzeugen.</p>`,
      },
      {
        route: () => "#/score-check", target: "#s-body", title: "Taugen die Scores?",
        text: `<p>Jeden Tag speichert das Tool einen Stand der Weltauswahl. Nach einigen Wochen bis Monaten zeigt der Score-Check, ob Aktien mit hohem
          Score danach tatsächlich besser liefen. So lernen Sie mit der Zeit, welchen Kennzahlen Sie vertrauen können. Kurzfristig dominiert der Zufall.</p>`,
      },
      {
        title: "Kurz geprüft",
        quiz: {
          q: "Wozu dienen die Notizen im Fazit eines Profils?",
          options: ["Sie werden an Yahoo Finance gesendet", "Um die Investment-These festzuhalten: warum kaufen, wann verkaufen", "Für die Steuererklärung"],
          correct: 1,
          explain: "Die Notizen bleiben in Ihrem Browser. Mit einer aufgeschriebenen These prüfen Sie nach jeden Quartalszahlen, ob Ihr Kaufgrund noch gilt.",
        },
      },
      {
        title: "Noch eine Frage",
        quiz: {
          q: "Was zeigt der Score-Check?",
          options: ["Wie oft Sie das Tool geöffnet haben", "Ob Aktien mit hohem Score danach tatsächlich besser liefen", "Den Score Ihres Depots bei der Bank"],
          correct: 1,
          explain: "Er teilt die Aktien nach ihrem damaligen Score in fünf Gruppen und vergleicht deren Kursentwicklung seitdem.",
        },
      },
    ],
  },
];

// Kurz-Touren je Seite (pagetours.js) laufen wie Lektionen; ihre Schritte gehören zur Seite, auf der sie gestartet wurden
const TOURS = PAGE_TOURS.map((t) => ({ ...t, id: `seite-${(t.key || "start").toLowerCase()}`, page: true }));
const findLesson = (id) => LESSONS.find((l) => l.id === id) || TOURS.find((t) => t.id === id);
const kickerOf = (L) => (L.page ? `Kurz-Tour · ${L.short}` : `Lektion ${L.n} · ${L.short}`);

// ---------------------------------------------------------------- Kauf-Checkliste
// Schwellen nach den Regeln des Tools (Fazit, Scorecard, Bewertung). ok: true erfüllt, false nicht erfüllt, null nicht prüfbar.
function checklist(p, key) {
  const items = [];
  const add = (group, label, ok, value, note = "") => items.push({ group, label, ok, value, note });
  const q = p.quality || {};
  const v = p.valuation || {};
  const f = p.fundamentals;
  const d = p.dividends || {};
  const years = p.data?.fundamental_years;
  const short = q.short || (!F.isNum(q.stability) && !q.loss_making);

  add("Datenbasis", "Bilanzdaten über mindestens 5 Jahre", F.isNum(q.years) && q.years >= 4.8, years ? `${years[0]}–${years[1]}` : "keine",
    esc(p.data?.fundamentals_source || ""));

  // überwiegend Verluste: klar nicht erfüllt (statt „nicht prüfbar“)
  add("Qualität", "Gewinnstabilität mindestens 0,75", q.loss_making ? false : short ? null : q.stability >= 0.75,
    q.loss_making ? `Verlust in ${q.losses} von ${q.count} Jahren` : F.isNum(q.stability) ? `${F.stability(q.stability)} · ${reliability(q.stability)}` : "–",
    short && F.isNum(q.stability) ? "kurze Historie, nicht beurteilbar" : "");
  add("Qualität", "Gewinnwachstum mindestens 6 % pro Jahr", short || !F.isNum(q.growth) ? null : q.growth >= 0.06,
    F.isNum(q.growth) ? `${F.signedPct(q.growth, 1)} p. a.` : "–");
  const roic = f?.roic;
  add("Qualität", "Kapitalrendite (ROIC) mindestens 8 %", F.isNum(roic?.latest) ? roic.latest >= 0.08 : null, F.pct(roic?.latest, 1),
    roic?.reason ? esc(roic.reason) : roic?.latest >= 0.15 ? "Burggraben-Niveau" : "");
  const pio = f?.piotroski?.score;
  add("Qualität", "Piotroski F-Score mindestens 5", F.isNum(pio) ? pio >= 5 : null, F.isNum(pio) ? `${pio} / 9` : "–");
  const debt = p.debt || {};
  add("Qualität", "Schulden in höchstens 4 Jahren tilgbar",
    debt.applicable === false ? null : debt.infinite ? false : F.isNum(debt.years) ? debt.years <= 4 : null,
    debt.infinite ? "∞" : F.isNum(debt.years) ? `${F.num(debt.years, 1)} J.` : "–",
    debt.applicable === false ? "bei Banken und Versicherungen nicht berechnet" : debt.infinite ? "Schulden ohne positiven Free Cashflow" : "");

  if (!v.available) {
    add("Preis", "Fairer Wert berechenbar", false, "nein", esc(v.reason || ""));
  } else {
    const per = v.periods[v.default_period];
    const unsure = v.dip_now || v.short_history;
    add("Preis", "Kurs höchstens 10 % über dem fairen Wert", unsure ? null : per.deviation <= 0.1,
      `${F.signedPct(per.deviation, 0)} · ${esc(per.rating?.label || "")}`, unsure ? "Einordnung unsicher" : `Durchschnitt ${v.default_period} Jahre`);
    const er = v.expected?.by_period?.[v.default_period];
    add("Preis", "Erwartete Rendite mindestens 8 % pro Jahr", unsure || !F.isNum(er) ? null : er >= 0.08, F.signedPct(er, 1), unsure ? "Einordnung unsicher" : "");
  }

  const rev = p.analysts?.revisions || {};
  add("Rückenwind", "Gewinnschätzungen nicht fallend",
    rev.trend === "fallend" ? false : rev.trend === "steigend" ? true : F.isNum(rev.change90) ? rev.change90 > -0.02 : null,
    rev.trend ? `Schätzungen ${esc(rev.trend)}` : F.isNum(rev.change90) ? `${F.signedPct(rev.change90, 1)} in 90 Tagen` : "keine Schätzungen");
  const mom = p.price?.momentum;
  add("Rückenwind", "Kurs über der 200-Tage-Linie", F.isNum(mom) ? mom > 0 : null, F.signedPct(mom, 1), "kein Muss für langfristige Anleger");

  const sc = (p.scorecard || []).find((s) => s.key === key);
  add("Strategie", `Scorecard ${STRATEGIES[key].label} mindestens 7 von 10`, sc ? sc.score >= 7 : null, sc ? `${sc.score} / 10` : "–");
  if (key !== "earnings_growth") {
    if (!d.pays) {
      add("Strategie", "Zahlt eine Dividende", false, "nein");
    } else {
      if (key === "dividend_income") {
        add("Strategie", "Dividendenrendite mindestens 3 %", F.isNum(d.yield) ? d.yield >= 0.03 : null, F.pct(d.yield, 2),
          p.tax && F.isNum(d.yield) ? `nach Steuern ${F.pct(d.yield * p.tax.net_share, 2)}` : "");
      } else {
        add("Strategie", "Dividendenwachstum mindestens 6 % pro Jahr", F.isNum(d.growth) ? d.growth >= 0.06 : null, `${F.signedPct(d.growth, 1)} p. a.`);
      }
      add("Strategie", "Ausschüttungsquote höchstens 75 %", F.isNum(d.payout_eps) ? d.payout_eps >= 0 && d.payout_eps <= 0.75 : null, F.pct(d.payout_eps, 0), "vom Gewinn");
      const streak = key === "dividend_income" ? d.no_cut_streak : d.increase_streak;
      add("Strategie", key === "dividend_income" ? "Mindestens 10 Jahre ohne Kürzung" : "Mindestens 10 Steigerungen in Folge",
        F.isNum(streak) ? streak >= 10 : null, F.isNum(streak) ? `${streak} J.` : "–");
    }
  }
  return items;
}

function rate(items) {
  const checked = items.filter((i) => i.ok !== null);
  const passed = checked.filter((i) => i.ok).length;
  const share = checked.length ? passed / checked.length : 0;
  const group = (g) => checked.filter((i) => i.group === g);
  const quality = group("Qualität");
  const qualityOk = quality.length > 0 && quality.filter((i) => i.ok).length / quality.length >= 0.75;
  const priceBad = group("Preis").some((i) => !i.ok);
  let verdict;
  if (checked.length < items.length / 2) {
    verdict = ["neutral", "Kaum prüfbar", "Für zu viele Punkte fehlen Daten. Sehen Sie sich das Profil genau an oder üben Sie mit einer Aktie mit längerer Historie."];
  } else if (qualityOk && priceBad) {
    verdict = ["warning", "Gute Firma, aber der Preis passt (noch) nicht", "Setzen Sie die Aktie auf die Watchlist und legen Sie einen Alarm „x % unter fairem Wert“ an."];
  } else if (share >= 0.8) {
    verdict = ["good", "Starker Kandidat", "Jetzt das Geschäftsmodell verstehen, die Risiken prüfen und mit Alternativen vergleichen."];
  } else if (share >= 0.6) {
    verdict = ["warning", "Kandidat mit Abstrichen", "Prüfen Sie die nicht erfüllten Punkte: Sind sie erklärbar (z. B. ein einmaliger Sondereffekt) oder ein Warnsignal?"];
  } else {
    verdict = ["serious", "Derzeit kein überzeugender Kandidat", "Zu viele Punkte sind nicht erfüllt. Suchen Sie in Ihrer Liste weiter."];
  }
  const [status, label, text] = verdict;
  return { passed, checked: checked.length, unchecked: items.length - checked.length, status, label, text };
}

function checklistCompact(p) {
  const items = checklist(p, strategyKey());
  const r = rate(items);
  const misses = items.filter((i) => i.ok === false);
  return `<p>Alles aus den Lektionen 3 und 4 in einer Liste, für Ihre Strategie ${esc(strategy().label)}:</p>
    <p><b>${r.passed} von ${r.checked}</b> Punkten erfüllt · <span class="badge ${r.status}">${esc(r.label)}</span></p>
    ${misses.length ? `<p style="margin-bottom:2px">Nicht erfüllt:</p><ul class="coach-list">${misses.map((i) => `<li>${esc(i.label)} <span class="muted">(${i.value})</span></li>`).join("")}</ul>` : ""}
    <p>${esc(r.text)}</p>
    <p><a href="#/tutorial?pruefen=${encodeURIComponent(p.symbol)}">Ganze Checkliste öffnen</a>: Dort prüfen Sie künftig jede Aktie mit einem Klick.</p>`;
}

function checklistHtml(p) {
  const items = checklist(p, strategyKey());
  const r = rate(items);
  const groups = [...new Set(items.map((i) => i.group))];
  const icon = (ok) => (ok === true ? ["ok", "✓", "erfüllt"] : ok === false ? ["no", "✗", "nicht erfüllt"] : ["na", "–", "nicht prüfbar"]);
  const rows = groups.map((g) => `<tr class="group"><td colspan="3">${esc(g)}</td></tr>${items.filter((i) => i.group === g).map((i) => {
    const [cls, sym, label] = icon(i.ok);
    return `<tr><td class="tc-mark ${cls}"><span aria-hidden="true">${sym}</span><span class="visually-hidden">${label}</span></td>
      <td class="tc-label">${esc(i.label)}${i.note ? `<div class="muted">${i.note}</div>` : ""}</td><td>${i.value}</td></tr>`;
  }).join("")}`).join("");
  return `
    <div class="tc-head">
      <div class="tc-score">${r.passed}<small>/${r.checked}</small></div>
      <div><h3><a href="#/aktie/${encodeURIComponent(p.symbol)}">${esc(p.name)}</a> <span class="muted">${esc(p.symbol)}</span></h3>
        <p style="margin:6px 0 0"><span class="badge ${r.status}">${esc(r.label)}</span> ${esc(r.text)}</p></div>
    </div>
    <div class="table-scroll"><table class="data tc" style="margin-top:12px"><tbody>${rows}</tbody></table></div>
    <p class="muted" style="font-size:13px;margin:10px 0 0">${r.unchecked ? `${r.unchecked} ${r.unchecked === 1 ? "Punkt ist" : "Punkte sind"} mangels Daten nicht prüfbar (–) und ${r.unchecked === 1 ? "zählt" : "zählen"} nicht mit. ` : ""}
      Strategie: ${esc(strategy().label)}${store.strategy ? "" : " (Standard, in Lektion 1 änderbar)"}. Schwellen nach den Regeln des Tools; keine Anlageberatung.</p>`;
}

// ---------------------------------------------------------------- Wissenstest
const FINAL_QUIZ = [
  {
    q: "Was bedeutet eine Gewinnstabilität von 0,95?",
    options: ["Die Firma hat eine Gewinnmarge von 95 %", "Der Gewinn ist über die Jahre sehr gleichmäßig gestiegen", "Die Aktie schwankt im Jahr nur um 5 %"],
    correct: 1,
    explain: "Die Gewinnstabilität misst, wie gut eine steigende Gerade die Jahresgewinne erklärt (1,0 = perfekt). Ab 0,9 gilt die Entwicklung als äußerst zuverlässig.",
  },
  {
    q: "Die Bilanzdaten einer Aktie reichen nur 4 Jahre zurück. Was folgt daraus?",
    options: ["Stabilität, Wachstum und fairer Wert sind kaum belastbar", "Die Werte sind besonders aktuell und deshalb genauer", "Nichts, 4 Jahre reichen völlig"],
    correct: 0,
    explain: "Kurze Reihen hängen stark vom Startjahr ab. Das Tool zählt Stabilität und Wachstum dann höchstens neutral und ordnet die Aktie nicht als unter- oder überbewertet ein.",
  },
  {
    q: "Kurs vs. fairer Wert liegt bei −25 %. Wie ordnet das Tool die Aktie ein?",
    options: ["fair bewertet", "unterbewertet", "stark unterbewertet"],
    correct: 1,
    explain: "Unter −10 % gilt eine Aktie als unterbewertet, erst unter −30 % als stark unterbewertet.",
  },
  {
    q: "Welche Strategie hat die Dividendenrendite als Kernkriterium?",
    options: ["Dividendenertrag", "Dividendenwachstum", "Gewinnwachstum"],
    correct: 0,
    explain: "Beim Dividendenertrag zählt die Rendite von Anfang an. Kernkriterium beim Dividendenwachstum ist das Wachstum der Dividende, beim Gewinnwachstum das Gewinnwachstum.",
  },
  {
    q: "Ein Autobauer hat im Boomjahr ein KGV von 4. Warum ist er deshalb nicht unbedingt billig?",
    options: ["Ein KGV unter 5 ist immer ein Datenfehler", "Im Boom ist der Gewinn außergewöhnlich hoch; über einen ganzen Zyklus sieht das KGV anders aus", "Autobauer werden vom Tool nicht bewertet"],
    correct: 1,
    explain: "Bei zyklischen Firmen täuscht das KGV am Gipfel. Stark schwankende Gewinne bewertet das Tool deshalb mit dem normalisierten Gewinn, dem Durchschnitt der letzten 5 Jahre.",
  },
  {
    q: "Eine Qualitätsaktie hat eine erwartete Rendite von 3 % pro Jahr. Was ist ein sinnvoller nächster Schritt?",
    options: ["Sofort kaufen, Qualität setzt sich immer durch", "Auf die Watchlist setzen und einen Alarm „x % unter fairem Wert“ anlegen", "Die Aktie für immer streichen"],
    correct: 1,
    explain: "Auch die beste Firma kann zu teuer sein. Mit dem Alarm warten Sie, bis der Preis wieder Rendite verspricht.",
  },
  {
    q: "Was sagt ein Gesamt-Score von 85 in der Weltauswahl?",
    options: ["Die Aktie steigt mit 85 % Wahrscheinlichkeit", "Sie schneidet bei Qualität, Bewertung, Wachstum und Momentum zusammen besser ab als 85 % aller Aktien", "85 % der Analysten empfehlen den Kauf"],
    correct: 1,
    explain: "Die Scores sind Ränge von 0 bis 100. Sie beruhen auf den Kennzahlen der letzten 12 Monate und sind ein Filter, kein Urteil.",
  },
  {
    q: "Ein Filter auf „Erwartete Rendite“ liefert viel weniger Treffer als gedacht. Woran liegt das wahrscheinlich?",
    options: ["Die Tiefenanalyse ist noch nicht durch; nicht analysierte Aktien fallen heraus", "Der Filter gilt nur für US-Aktien", "Yahoo sperrt den Filter"],
    correct: 0,
    explain: "Kennzahlen wie Gewinnstabilität, fairer Wert und erwartete Rendite berechnet die Tiefenanalyse im Hintergrund Aktie für Aktie.",
  },
  {
    q: "Die Ausschüttungsquote liegt bei 120 %. Was bedeutet das?",
    options: ["Die Dividende ist besonders sicher", "Die Firma schüttet mehr aus, als sie verdient; auf Dauer geht das nicht gut", "Die Dividende steigt nächstes Jahr um 20 %"],
    correct: 1,
    explain: "Über 100 % zahlt die Firma aus der Substanz oder auf Pump. Steigt der Gewinn nicht, droht eine Kürzung.",
  },
  {
    q: "Laut Reverse-DCF setzt der Kurs 15 % Wachstum pro Jahr voraus, bisher waren es 5 %. Wie ist das zu lesen?",
    options: ["Viel Optimismus ist eingepreist; enttäuscht die Firma, kann der Kurs deutlich fallen", "Die Aktie ist günstig", "Die Firma wird sicher 15 % wachsen"],
    correct: 0,
    explain: "Der Reverse-DCF zeigt, was der Markt erwartet. Liegt das weit über der bisherigen Entwicklung, braucht es sehr gute Nachrichten, damit sich der Kauf lohnt.",
  },
];

function quizHtml(q, answer) {
  const opts = q.options.map((o, i) => {
    const state = answer == null ? "" : i === q.correct ? " correct" : i === answer ? " wrong" : "";
    const icon = answer == null ? "" : i === q.correct ? "✓ " : i === answer ? "✗ " : "";
    return `<button type="button" class="quiz-opt${state}" data-act="answer" data-i="${i}" ${answer == null ? "" : "disabled"}>${icon}${esc(o)}</button>`;
  }).join("");
  const feedback = answer == null ? ""
    : `<p class="quiz-explain"><b>${answer === q.correct ? "Richtig." : "Nicht ganz."}</b> ${esc(q.explain)}</p>`;
  return `<div class="quiz"><p class="quiz-q">${esc(q.q)}</p><div class="quiz-opts">${opts}</div>${feedback}</div>`;
}

// ================================================================ Tour: Hinweisfenster und Markierung
let run = null;
let coach = null;
let ring = null;
let timer = 0;
let raf = 0;

const cur = () => run?.lesson.steps[run.i];
// Seite eines Schritts: eigene Route, bei Kurz-Touren die Seite, auf der die Tour begann
const routeOf = (step) => (step?.route ? step.route(run.ctx) : run?.lesson.page ? run.ctx.home : null);
const textOf = (x) => (typeof x === "function" ? x(run.ctx) : x || "");
const safe = (fn) => { try { return fn(); } catch (e) { return false; } };

// Seiten, die ihren Inhalt nachladen: Erst wenn dieses Element da ist, gilt ein fehlender Bereich als „gibt es hier nicht“
const READY = {
  AKTIE: "#sec-verdict", WELT: "#w-rows tr", VERGLEICH: "#c-body .card, #c-body table", ALARME: "#a-rows tr",
  TERMINE: "#k-body .card, #k-body table", DEPOT: "#depot-body .card, #depot-body table", "SCORE-CHECK": "#s-body .card",
  SCREENER: "#rows tr", WATCHLIST: "#rows tr", TRUSTS: "#h-body table", LEXIKON: ".lex-entry",
  CALLPUT: "#cp-tiles .tile, #cp-msg .notice, #cp-msg .card", HEBEL: "#hb-list .dl-table, #hb-list .notice, #hb-body .card",
};
const PAGE_NAMES = { "": "Übersicht", WELT: "Weltauswahl", VERGLEICH: "Vergleich", ALARME: "Alarme", TERMINE: "Termine", DEPOT: "Depot",
  "SCORE-CHECK": "Score-Check", SCREENER: "Screener", WATCHLIST: "Watchlist", TRUSTS: "Trusts & Holdings", LEXIKON: "Lexikon",
  CALLPUT: "Call/Put-Rechner", HEBEL: "Optionsscheine & Knock-outs" };

const pathOf = (h) => decodeURIComponent(((h || "").replace(/^#/, "") || "/").split("?")[0]).toUpperCase();
const samePage = (h) => pathOf(location.hash) === pathOf(h);
const pageKey = () => pathOf(location.hash).split("/")[1] || "";

function pageReady() {
  if ($("#app .error-block")) return true;
  const sel = READY[pageKey()];
  return sel ? Boolean($(sel)) : true;
}

function resolve(target) {
  if (!target) return null;
  const el = safe(() => (typeof target === "function" ? target(run.ctx) : $(target)));
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  return r.width || r.height ? el : null;
}

export function startLesson(id, i = 0, symbol = null, home = null) {
  const lesson = findLesson(id);
  if (!lesson?.steps) return;
  stopTour(false);
  run = { lesson, i: 0, ctx: { symbol: (symbol || practiceSymbol()).toUpperCase(), home: null, p: null, loading: false, failed: false } };
  // Kurz-Tour: auf der Seite, auf der sie gestartet wurde (samt Adresse), sonst auf ihrer Startseite
  if (lesson.page) run.ctx.home = home || (pageKeyOf(location.hash) === lesson.key ? location.hash : lesson.start(run.ctx));
  coach = document.createElement("aside");
  coach.className = "coach";
  coach.setAttribute("aria-label", "Tutorial");
  coach.setAttribute("aria-live", "polite");
  ring = document.createElement("div");
  ring.className = "tour-ring";
  ring.hidden = true;
  document.body.append(ring, coach);
  coach.addEventListener("click", onCoachClick);
  window.addEventListener("hashchange", tick);
  timer = setInterval(tick, 300);
  raf = requestAnimationFrame(frame);
  setTourOverride(true);
  const first = Math.min(Math.max(0, i), lesson.steps.length - 1);
  go(first, 1, first === 0 && !lesson.page); // beim Start genau die Ausgangsseite (z. B. Weltauswahl ohne alte Filter)
  changed();
}

export function stopTour(notify = true) {
  if (!run) return;
  clearInterval(timer);
  cancelAnimationFrame(raf);
  window.removeEventListener("hashchange", tick);
  coach?.remove();
  ring?.remove();
  run = null;
  coach = null;
  ring = null;
  writeJson("sessionStorage", RUN_KEY, null);
  setTourOverride(false);
  if (notify) changed();
}

// Kurz-Tour für eine Seite starten: ohne key die der aktuellen Seite, sonst die genannte (von der Tutorial-Seite aus)
export function startPageTour(key = null) {
  const t = TOURS.find((x) => x.key === (key ?? pageKeyOf(location.hash)));
  if (!t) return;
  const here = pageKeyOf(location.hash) === t.key;
  startLesson(t.id, 0, t.profilePage && here ? profileSymbol() : null);
}

// Für den Knopf in der Kopfzeile: Gibt es für diese Seite eine Kurz-Tour, ist sie schon gemacht, läuft sie gerade?
export function pageTourInfo(hash = location.hash) {
  const t = TOURS.find((x) => x.key === pageKeyOf(hash));
  return t ? { short: t.short, done: store.tours.includes(t.id), running: run?.lesson.id === t.id && !run.finished } : null;
}

// Nach einem Neuladen der Seite an derselben Stelle weitermachen
export function initTour() {
  const saved = readJson("sessionStorage", RUN_KEY);
  if (saved?.lesson) startLesson(saved.lesson, saved.i || 0, saved.symbol, saved.home);
}

function go(i, dir = 1, exact = false) {
  if (i < 0) { i = 0; dir = 1; }
  if (i >= run.lesson.steps.length) { finish(); return; }
  Object.assign(run, { i, dir, el: null, entered: false, task: null, state: undefined, taskDone: false, answer: null,
    since: Date.now(), missingSince: 0, scrolling: 0, pendingScroll: false, recheck: 0, finished: false, html: "" });
  writeJson("sessionStorage", RUN_KEY, { lesson: run.lesson.id, i, symbol: run.ctx.symbol, home: run.ctx.home });
  const h = routeOf(cur());
  if (h && (exact ? location.hash !== h : !samePage(h))) location.hash = h;
  tick();
}

function finish() {
  if (run.lesson.page) markTour(run.lesson.id); else markDone(run.lesson.id);
  Object.assign(run, { finished: true, el: null, min: false, html: "" });
  writeJson("sessionStorage", RUN_KEY, null);
  paintCoach();
}

function enter(step) {
  run.entered = true;
  run.task = (typeof step.task === "function" ? safe(() => step.task(run.ctx)) : step.task) || null;
  run.state = run.task?.enter ? safe(() => run.task.enter(run.ctx)) : undefined;
}

function tick() {
  if (!run) return;
  if (run.finished) { placeRing(); paintCoach(); return; }
  const step = cur();
  if (run.entered && run.task && !run.taskDone && safe(() => run.task.done(run.state, run.ctx))) {
    run.taskDone = true;
    safe(() => run.task.after?.(run.ctx));
    if (run.task.auto) { go(run.i + 1); return; }
  }
  const h = routeOf(step);
  run.offPage = Boolean(h) && !samePage(h);
  const el = run.offPage ? null : resolve(step.target);
  if (el && !run.entered) {
    enter(step);
    run.pendingScroll = true;
  } else if (!step.target && !run.offPage && !run.entered) {
    enter(step);
  }
  run.el = el;
  loadProfileData(step);
  // Bereiche, die es bei dieser Aktie nicht gibt (z. B. keine Dividende), werden übersprungen
  if (!el && step.optional && !run.offPage && pageReady()) {
    if (!run.missingSince) run.missingSince = Date.now();
    else if (Date.now() - run.missingSince > 700) { go(run.i + run.dir, run.dir); return; }
  }
  paintCoach();
  // Erst scrollen, wenn das Hinweisfenster seinen Text hat: Seine Höhe bestimmt, was frei sichtbar ist
  if (run.pendingScroll && el) {
    run.pendingScroll = false;
    run.recheck = Date.now() + 1200;
    coach.classList.remove("top");
    scrollToTarget(el);
  } else if (run.recheck && el && Date.now() > run.recheck) {
    // Der Browser kann das Scrollen abbrechen (z. B. beim Wiederherstellen der Position nach einem Neuladen): einmal nachfassen
    run.recheck = 0;
    const r = el.getBoundingClientRect();
    if (r.bottom < 60 || r.top > window.innerHeight - 60) scrollToTarget(el, false);
  }
  placeRing(); // falls der Browser keine Animationsbilder liefert (Tab im Hintergrund)
}

// Profildaten für die Texte („Bei Microsoft: …“). Erst laden, wenn die Seite das Profil selbst geholt hat: dann kommt es aus dem Cache.
function loadProfileData(step) {
  const c = run.ctx;
  if (!run.lesson.profile || c.p || c.loading || c.failed) return;
  const onProfile = profileSymbol() === c.symbol && $("#sec-verdict");
  if (!onProfile && step.route) return;
  c.loading = true;
  api.profile(c.symbol)
    .then((p) => { if (run?.ctx === c) { c.p = p; tick(); } })
    .catch(() => { c.failed = true; })
    .finally(() => { c.loading = false; });
}

// Klebende Leisten oben (Kopfzeile, im Profil die Abschnittsnavigation); auf dem Handy ist die Kopfzeile viel höher
const stickyBars = () => $$(".topbar, .subnav").filter((x) => getComputedStyle(x).position === "sticky");
const headerSpace = () => stickyBars().reduce((h, x) => h + x.offsetHeight, 0) + 12;
function stickyBottom() {
  let bottom = 0;
  for (const x of stickyBars()) {
    const r = x.getBoundingClientRect();
    if (r.top <= bottom + 2) bottom = Math.max(bottom, r.bottom);
  }
  return bottom;
}

// Bereich unter die Kopfzeile scrollen, wenn er nicht frei sichtbar ist (auch nicht hinter dem Hinweisfenster)
function scrollToTarget(el, animate = true) {
  const r = el.getBoundingClientRect();
  const top = headerSpace();
  const c = coach?.getBoundingClientRect();
  const behindCoach = c && !run.min && r.right > c.left && r.left < c.right;
  const bottom = (behindCoach ? Math.max(top + 80, c.top) : window.innerHeight) - 16;
  if (r.top >= top && (r.bottom <= bottom || r.top < bottom - 120)) return;
  // weite Sprünge ohne Animation: sie dauern sonst lange und werden leichter abgebrochen
  const smooth = animate && Math.abs(r.top) < window.innerHeight * 2 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  run.scrolling = Date.now() + (smooth ? 800 : 0); // währenddessen nicht ausweichen, sonst springt das Fenster hin und her
  window.scrollTo({ top: Math.max(0, window.scrollY + r.top - top), behavior: smooth ? "smooth" : "auto" });
}

// Markierung folgt dem Bereich bei jedem Bild (Scrollen, Nachladen, Neuzeichnen der Tabelle)
function frame() {
  if (!run) return;
  placeRing();
  raf = requestAnimationFrame(frame);
}

function placeRing() {
  let el = run.el;
  if (el && !el.isConnected) el = run.el = resolve(cur()?.target);
  let shown = false;
  if (el && !run.min && !run.finished) {
    const r = el.getBoundingClientRect();
    const left = Math.max(4, r.left - 6);
    // nicht über die Kopfzeile malen – außer der Bereich liegt selbst darin (Knöpfe der Kopfzeile)
    const top = el.closest(".topbar") ? Math.max(2, r.top - 6) : Math.max(stickyBottom() + 2, r.top - 6);
    const width = Math.min(window.innerWidth - 4, r.right + 6) - left;
    const height = Math.min(window.innerHeight - 4, r.bottom + 6) - top;
    if (width > 8 && height > 8) {
      shown = true;
      ring.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
      // Verdeckt das Hinweisfenster einen kleinen Bereich, weicht es an den anderen Bildschirmrand aus
      const c = coach.getBoundingClientRect();
      const overlaps = r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top;
      if (overlaps && r.height < window.innerHeight / 2 && Date.now() > run.scrolling) coach.classList.toggle("top", r.top + r.height / 2 > window.innerHeight / 2);
    }
  }
  ring.hidden = !shown;
}

function headHtml(kicker, count, share) {
  return `<div class="coach-head"><span class="coach-kicker">${esc(kicker)}</span>${count ? `<span class="coach-count">${count}</span>` : ""}
      <button class="coach-icon" type="button" data-act="restart" title="Von vorn beginnen" aria-label="Von vorn beginnen">↺</button>
      <button class="coach-icon" type="button" data-act="min" title="Minimieren" aria-label="Hinweisfenster minimieren">▾</button>
      <button class="coach-icon" type="button" data-act="close" title="Tutorial beenden" aria-label="Tutorial beenden">✕</button></div>
    <div class="coach-bar"><div style="width:${share * 100}%"></div></div>`;
}

function statusHtml(step) {
  if (run.offPage) {
    const h = routeOf(step);
    const other = profileSymbol();
    const name = pathOf(h).startsWith("/AKTIE/") ? `Profil von ${esc(run.ctx.symbol)}` : PAGE_NAMES[pathOf(h).slice(1)] || "einer anderen Seite";
    return `<div class="coach-note">Dieser Schritt gehört zur Seite <b>${name}</b>.
      <div class="coach-actions"><button class="btn small" type="button" data-act="goto">Dorthin wechseln</button>${
        pathOf(h).startsWith("/AKTIE/") && other && other !== run.ctx.symbol
          ? `<button class="btn small" type="button" data-act="switch">Mit ${esc(other)} weiterüben</button>` : ""}</div></div>`;
  }
  if (!step.target || run.el) return "";
  if ($("#app .error-block")) {
    return `<div class="coach-note">Die Seite meldet einen Fehler. ${run.lesson.profile
      ? '<button class="linklike" type="button" data-act="overview">Andere Übungsaktie wählen</button>' : "Sie können den Schritt überspringen."}</div>`;
  }
  if (pageReady()) return "";
  const slow = Date.now() - run.since > 15000;
  return `<div class="coach-note"><span class="spinner inline" aria-hidden="true"></span>Die Seite lädt …${slow
    ? " Beim ersten Aufruf einer Aktie oder der Weltauswahl sind 20 Sekunden normal." : ""}</div>`;
}

function stepHtml() {
  const L = run.lesson;
  const step = cur();
  const n = L.steps.length;
  const task = run.task ? `<div class="coach-task${run.taskDone ? " done" : ""}"><span class="coach-task-icon" aria-hidden="true">${run.taskDone ? "✓" : "→"}</span>
      <span><b>${run.taskDone ? "Geschafft" : "Ihre Aufgabe"}:</b> ${textOf(run.task.text)}</span></div>` : "";
  const tip = step.tip ? `<div class="coach-tip"><b>Zum Ausprobieren:</b> ${textOf(step.tip)}</div>` : "";
  const pending = (run.task && !run.taskDone) || (step.quiz && run.answer == null);
  const extra = run.offPage ? "" : `${task}${tip}${step.quiz ? quizHtml(step.quiz, run.answer) : ""}`;
  return `${headHtml(kickerOf(L), `${run.i + 1}/${n}`, (run.i + 1) / n)}
    <h3>${esc(step.title)}</h3>${statusHtml(step)}
    ${run.offPage ? "" : `<div class="coach-body">${textOf(step.text)}</div>`}${extra}
    <div class="coach-foot">
      <button class="btn small" type="button" data-act="back" ${run.i === 0 ? "disabled" : ""}>Zurück</button><span class="spacer"></span>
      <button class="btn small${pending ? "" : " primary"}" type="button" data-act="next">${pending ? "Überspringen" : run.i === n - 1 ? "Abschließen" : "Weiter"}</button>
    </div>`;
}

function finishedHtml() {
  const L = run.lesson;
  if (L.page) {
    return `${headHtml(kickerOf(L), "", 1)}
      <div class="coach-done"><span class="coach-done-mark" aria-hidden="true">✓</span><h3>Kurz-Tour geschafft</h3></div>
      <div class="coach-body"><p>Das Wichtigste:</p><ul class="coach-list">${L.recap.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      <div class="coach-foot"><button class="btn small" type="button" data-act="tours">Alle Kurz-Touren</button><span class="spacer"></span>
        <button class="btn small primary" type="button" data-act="close">Fertig</button></div>`;
  }
  const next = LESSONS[LESSONS.indexOf(L) + 1];
  return `${headHtml(`Lektion ${L.n} · ${L.short}`, "", 1)}
    <div class="coach-done"><span class="coach-done-mark" aria-hidden="true">✓</span><h3>Lektion ${L.n} geschafft</h3></div>
    <div class="coach-body"><p>Das nehmen Sie mit:</p><ul class="coach-list">${L.recap.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${next?.profile ? `<p>Weiter geht es mit <b>${esc(run.ctx.symbol)}</b>. Eine andere Übungsaktie wählen Sie in der Übersicht.</p>` : ""}</div>
    <div class="coach-foot"><button class="btn small" type="button" data-act="overview">Zur Übersicht</button><span class="spacer"></span>
      ${next ? `<button class="btn small primary" type="button" data-act="lesson" data-id="${next.id}">Lektion ${next.n} starten</button>`
        : '<button class="btn small primary" type="button" data-act="final">Zum Wissenstest</button>'}</div>`;
}

function pillHtml() {
  const L = run.lesson;
  const label = run.finished ? (L.page ? "geschafft" : `Lektion ${L.n} geschafft`) : `Schritt ${run.i + 1} von ${L.steps.length}`;
  return `<button class="coach-pill" type="button" data-act="expand" aria-label="Hinweisfenster öffnen">${L.page ? `Kurz-Tour ${esc(L.short)}` : "Tutorial"} · ${label} <span aria-hidden="true">▴</span></button>`;
}

function paintCoach() {
  if (!coach) return;
  const html = run.min ? pillHtml() : run.finished ? finishedHtml() : stepHtml();
  if (html === run.html) return;
  run.html = html;
  coach.classList.toggle("min", Boolean(run.min));
  coach.innerHTML = html;
}

function onCoachClick(e) {
  const b = e.target.closest("[data-act]");
  if (!b || !run) return;
  const act = b.dataset.act;
  if (act === "next") go(run.i + 1, 1);
  else if (act === "back") go(run.i - 1, -1);
  else if (act === "min" || act === "expand") { run.min = act === "min"; paintCoach(); }
  else if (act === "close") stopTour();
  else if (act === "overview") { stopTour(); location.hash = "#/tutorial"; }
  else if (act === "final") { stopTour(); location.hash = "#/tutorial?teil=abschluss"; }
  else if (act === "tours") { stopTour(); location.hash = "#/tutorial?teil=touren"; }
  else if (act === "lesson") startLesson(b.dataset.id, 0, run.ctx.symbol);
  else if (act === "restart") startLesson(run.lesson.id, 0, run.ctx.symbol, run.ctx.home);
  else if (act === "goto") location.hash = routeOf(cur());
  else if (act === "switch" && run.lesson.page) {
    // Kurz-Tour im Profil: mit der Aktie weitermachen, die gerade offen ist (die Übungsaktie bleibt)
    Object.assign(run.ctx, { symbol: profileSymbol(), home: location.hash });
    go(run.i, run.dir);
  } else if (act === "switch") {
    setSymbol(profileSymbol());
    run.ctx = { symbol: store.symbol, p: null, loading: false, failed: false };
    go(run.i, run.dir);
  } else if (act === "answer" && run.answer == null) {
    run.answer = Number(b.dataset.i);
    paintCoach();
  }
}

// ================================================================ Seite #/tutorial
const FUNNEL = [
  ["strategie", "Strategie", "Was soll Ihr Geld leisten?", "3 Strategien", 100],
  ["welt", "Vorfiltern", "Weltauswahl, Vorlagen, Filter", "≈ 6.000 → 10–30", 80],
  ["qualitaet", "Qualität", "Steigt der Gewinn zuverlässig?", "→ 5–10", 56],
  ["preis", "Preis", "Fairer Wert, erwartete Rendite", "→ 2–5", 36],
  ["dranbleiben", "Entscheiden", "Vergleich, Alarm, Depot", "Ihre Auswahl", 18],
];

const ROUTINE = [
  ["Kandidaten suchen", () => `Weltauswahl mit der Vorlage Ihrer Strategie öffnen (<a href="${presetHref(strategy().preset)}">„${esc(strategy().preset)}“</a>),
    bei Bedarf Land oder Sektor eingrenzen, bis 10–30 Treffer übrig sind.`],
  ["Sortieren und merken", () => "Nach erwarteter Rendite, ROIC oder Gesamt-Score sortieren und die interessantesten Treffer mit ☆ auf die Watchlist setzen."],
  ["Verstehen", () => "Im Profil „Was macht …?“ lesen. Nur weitermachen, wenn Sie das Geschäftsmodell in zwei Sätzen erklären können."],
  ["Qualität prüfen", () => "Datenbasis, Gewinnstabilität (ab 0,75) und Gewinnwachstum, dann ROIC, Piotroski und Tilgungsjahre als Gegenprobe, Scorecard Ihrer Strategie ab 7."],
  ["Preis prüfen", () => "Kurs höchstens 10 % über dem fairen Wert, erwartete Rendite ab 8 % pro Jahr, Reverse-DCF plausibel."],
  ["Checkliste", () => 'Die <button class="linklike" type="button" data-jump="tut-check">Kauf-Checkliste</button> laufen lassen und jeden ✗ erklären können.'],
  ["Vergleichen", () => "Die zwei bis vier besten Kandidaten im Vergleich nebeneinanderstellen."],
  ["These notieren", () => "In den Notizen festhalten: Warum kaufen? Was müsste passieren, damit Sie verkaufen?"],
  ["Kaufen oder warten", () => "Passt der Preis: kaufen und im Depot erfassen, auf Streuung über Länder und Sektoren achten. Zu teuer: Alarm „x % unter fairem Wert“ anlegen."],
  ["Dranbleiben", () => "Nach jeden Quartalszahlen (Termine) die These prüfen; alle paar Monate im Score-Check nachsehen, welche Scores wirklich Rendite brachten."],
];

function heroCta() {
  if (run && !run.finished) return `<button class="btn primary" type="button" data-start="${run.lesson.id}">Lektion ${run.lesson.n} fortsetzen</button>`;
  const next = LESSONS.find((l) => !store.done.includes(l.id));
  if (!next) return '<button class="btn primary" type="button" data-jump="tut-abschluss">Zum Wissenstest</button>';
  return `<button class="btn primary" type="button" data-start="${next.id}">${store.done.length ? `Weiter mit Lektion ${next.n}` : "Tutorial starten"}</button>`;
}

const hasProgress = () => Boolean(store.done.length || store.strategy || store.symbol || store.quizBest != null || (run && !run.finished));
const restartBtn = () => (hasProgress() ? '<button class="btn" type="button" data-restart>Von vorn beginnen</button>' : "");

// Alles auf Anfang: Lektionen, Strategie, Übungsaktie, Testergebnis, laufende Tour. Watchlist, Notizen und Alarme bleiben.
function resetTutorial() {
  stopTour(false);
  Object.assign(store, { done: [], strategy: null, symbol: null, quizBest: null });
  persist();
}

function progressHtml() {
  const { done, total } = tutorialProgress();
  return `<div class="progress"><div style="width:${(done / total) * 100}%"></div></div>
    <span>${done} von ${total} Lektionen abgeschlossen${store.quizBest != null ? ` · Wissenstest: ${store.quizBest} von ${FINAL_QUIZ.length}` : ""}</span>`;
}

function funnelHtml() {
  return FUNNEL.map(([id, title, sub, count, width], i) => `<li class="${store.done.includes(id) ? "done" : ""}">
      <div class="funnel-top"><span class="funnel-n" aria-hidden="true">${store.done.includes(id) ? "✓" : i + 1}</span><b>${title}</b></div>
      <span class="funnel-sub">${sub}</span>
      <span class="funnel-bar" style="--w:${width}%"></span><span class="funnel-count">${count}</span></li>`).join("");
}

function lessonsHtml() {
  return LESSONS.map((l) => {
    const done = store.done.includes(l.id);
    const active = run?.lesson.id === l.id && !run.finished;
    const where = l.profile ? ` · mit ${esc(practiceSymbol())}` : l.id === "welt" ? " · in der Weltauswahl" : " · hier auf der Seite";
    const label = l.id === "strategie" ? (done ? "Strategie ändern" : "Strategie wählen") : active ? "Fortsetzen" : done ? "Wiederholen" : "Starten";
    const state = done ? '<span class="badge good">abgeschlossen</span>' : active ? '<span class="badge warning">läuft</span>' : "";
    return `<article class="card lesson-card${done ? " done" : ""}">
      <div class="lesson-top"><span class="lesson-n" aria-hidden="true">${done ? "✓" : l.n}</span><span class="muted">Lektion ${l.n} · ${l.minutes} Min.${where}</span>${state}</div>
      <h3>${esc(l.title)}</h3><p class="secondary">${esc(l.summary)}</p>
      <ul class="tut-list">${l.learn.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <div class="lesson-actions"><button class="btn${done && !active ? "" : " primary"}" type="button" data-start="${l.id}">${label}</button>${
        active ? `<button class="btn" type="button" data-restart-lesson="${l.id}">Lektion von vorn</button>` : ""}</div></article>`;
  }).join("");
}

function toursHtml() {
  return TOURS.map((t) => {
    const done = store.tours.includes(t.id);
    return `<button type="button" class="tour-card${done ? " done" : ""}" data-tour="${esc(t.key)}">
      <span class="tour-card-top"><b>${esc(t.short)}</b><span class="muted">${done ? "✓ gemacht" : `${t.minutes} Min.`}</span></span>
      <span class="secondary">${esc(t.summary)}</span></button>`;
  }).join("");
}

function strategyResult() {
  if (!store.strategy) return "";
  const s = strategy();
  return `<div class="card" style="margin-top:12px">
      <h3>Ihre Strategie: ${esc(s.label)}</h3>
      <p style="margin-top:6px">${esc(s.text)}</p>
      <div class="grid two">
        <div><p class="field-label">Darauf kommt es an</p><ul class="tut-list">${s.watch.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
          <p class="muted" style="font-size:13px">Kernkriterium der Scorecard: ${esc(s.core)}. Ist es schwach, bremst es den Score, egal wie gut der Rest ist.</p></div>
        <div><p class="field-label">Passende Vorlagen der Weltauswahl</p>
          <div class="preset-row small">${[s.preset, ...s.more].map((n) => `<a class="btn small" href="${presetHref(n)}">${esc(n)}</a>`).join("")}</div>
          <p class="muted" style="font-size:13px;margin-top:8px">„${esc(s.preset)}“: ${esc(s.presetWhy)}</p></div>
      </div>
      <div class="toolbar" style="margin:12px 0 0"><span class="badge good">Lektion 1 abgeschlossen</span>
        <button class="btn primary small" type="button" data-start="welt">Weiter mit Lektion 2</button></div>
    </div>`;
}

function strategyCards() {
  return Object.entries(STRATEGIES).map(([k, s]) => `<button type="button" class="opt-card" data-strategy="${k}" aria-pressed="${k === store.strategy}">
      <span class="opt-title">${esc(s.label)}</span><span class="opt-quote">„${esc(s.quote)}“</span></button>`).join("");
}

export function renderTutorial(root, params, isCurrent) {
  document.title = "Tutorial – Aktientool";
  const answers = [];
  // Eigener Container: Der Klick-Handler verschwindet mit ihm, wenn der Router die Seite wechselt
  root.innerHTML = `<div class="tut-page">
    <section class="tut-hero">
      <p class="tut-kicker">Tutorial · etwa 30 Minuten</p>
      <h1>So finden Sie mit dem Aktientool lohnende Aktien</h1>
      <p class="secondary">In fünf Lektionen gehen Sie einmal den ganzen Weg: von rund 6.000 Aktien weltweit zu wenigen Kandidaten, deren Geschäft
        Sie verstehen, deren Qualität stimmt und deren Preis fair ist. Ab Lektion 2 führt Sie ein Hinweisfenster durch die echten Seiten des Tools,
        markiert die wichtigen Stellen und gibt Ihnen kleine Aufgaben. Sie können jederzeit pausieren und später weitermachen.</p>
      <div class="tut-progress" id="tut-progress">${progressHtml()}</div>
      <div class="toolbar" style="margin-top:14px"><span id="tut-cta">${heroCta()}</span><span id="tut-restart">${restartBtn()}</span>
        <button class="btn" type="button" data-jump="tut-check">Kauf-Checkliste</button>
        <button class="btn" type="button" data-jump="tut-routine">Ihr Ablauf für später</button></div>
      <div class="notice tut-confirm" id="tut-confirm" role="alertdialog" aria-labelledby="tut-confirm-title" hidden>
        <b id="tut-confirm-title">Tutorial wirklich von vorn beginnen?</b>
        <p style="margin:4px 0 0">Es geht dann wieder bei Lektion 1 los. Zurückgesetzt werden die abgeschlossenen Lektionen, Ihre Strategie, die Übungsaktie
          und das Ergebnis des Wissenstests; eine laufende Tour wird beendet. Was Sie dabei im Tool angelegt haben (Watchlist, Notizen, Alarme), bleibt erhalten.</p>
        <div class="toolbar" style="margin:10px 0 0"><button class="btn primary small" type="button" data-restart-yes>Ja, von vorn beginnen</button>
          <button class="btn small" type="button" data-restart-no>Abbrechen</button></div>
      </div>
    </section>

    <section class="section">
      <h2>Der Weg zur guten Aktie</h2>
      <p class="lead">Jede Stufe siebt aus. Am Ende stehen wenige Aktien, die zu Ihrer Strategie passen, solide sind und einen vernünftigen Preis haben.</p>
      <ol class="funnel" id="tut-funnel">${funnelHtml()}</ol>
    </section>

    <section class="section" id="tut-strategie">
      <h2>Lektion 1: Die eigene Strategie festlegen</h2>
      <p class="lead">Die Scorecard bewertet jede Aktie für drei Strategien, denn welche Aktie „gut“ ist, hängt davon ab, was Ihr Geld leisten soll.
        Welcher Satz trifft am ehesten auf Sie zu? Sie können die Wahl jederzeit ändern.</p>
      <div class="grid three" id="tut-strategies">${strategyCards()}</div>
      <div id="tut-strategy-result">${strategyResult()}</div>
    </section>

    <section class="section">
      <h2>Die Lektionen</h2>
      <div class="card tut-symbol">
        <div><b>Übungsaktie für die Lektionen 3 bis 5:</b> <span id="tut-symbol-cur">${esc(practiceSymbol())}</span>
          <p class="muted" style="font-size:13px;margin:4px 0 0">Am besten eine Aktie, die Sie in Lektion 2 selbst gefunden haben; sie wird dort automatisch übernommen.</p></div>
        <div class="tut-symbol-pick">
          <div class="search"><input id="tut-symbol" type="search" placeholder="Andere Aktie suchen …" autocomplete="off" aria-label="Übungsaktie suchen">
            <ul id="tut-symbol-results" class="search-results" role="listbox" hidden></ul></div>
          <div class="preset-row small">${PRACTICE.map(([s, n, note]) => `<button class="btn small" type="button" data-practice="${s}"${note ? ` title="${esc(note)}"` : ""}>${esc(n)}</button>`).join("")}</div>
        </div>
      </div>
      <div class="grid two lesson-grid" id="tut-lessons" style="margin-top:12px">${lessonsHtml()}</div>
    </section>

    <section class="section" id="tut-touren">
      <h2>Kurz-Touren für einzelne Seiten</h2>
      <p class="lead">Jede Seite hat ihre eigene kleine Führung (1–3 Minuten): Sie markiert die wichtigen Bereiche und erklärt, was sie tun.
        Starten lässt sie sich auch direkt auf der Seite mit „? Tour“ oben rechts.</p>
      <div class="tour-grid" id="tut-tours">${toursHtml()}</div>
    </section>

    <section class="section" id="tut-check">
      <h2>Ihre Kauf-Checkliste</h2>
      <p class="lead">Fasst die Prüfungen der Lektionen 3 und 4 für Ihre Strategie zusammen. Geben Sie eine Aktie ein, und das Tool hakt ab, was erfüllt ist.
        Ein ✗ ist kein Ausschluss, aber Sie sollten ihn erklären können.</p>
      <div class="card">
        <form class="filters" id="tc-form" autocomplete="off">
          <div class="field search" style="max-width:300px"><label for="tc-symbol">Aktie</label>
            <input id="tc-symbol" class="wide" placeholder="Name oder Ticker, z. B. MSFT" value="${esc(params.get("pruefen") || store.symbol || "")}">
            <ul id="tc-results" class="search-results" role="listbox" hidden></ul></div>
          <button class="btn primary" type="submit">Prüfen</button>
        </form>
        <div id="tc-out"></div>
      </div>
    </section>

    <section class="section" id="tut-abschluss">
      <h2>Wissenstest</h2>
      <p class="lead">Zehn Fragen zu allem, was Sie für die Suche nach guten Aktien brauchen. Nach jeder Antwort sehen Sie die Erklärung.</p>
      <div class="card"><ol class="quiz-list" id="tq-list">${FINAL_QUIZ.map((q, k) => `<li data-q="${k}">${quizHtml(q, null)}</li>`).join("")}</ol>
        <div id="tq-result" class="tq-result"></div></div>
    </section>

    <section class="section" id="tut-routine">
      <h2>Ihr Ablauf für später</h2>
      <p class="lead">So gehen Sie künftig vor, wenn Sie neue Aktien suchen. Mit etwas Übung dauert ein Durchgang für eine Kandidatin etwa zehn Minuten.</p>
      <div class="grid two">
        <div class="card"><ol class="routine" id="tut-routine-list">${ROUTINE.map(([t, d]) => `<li><div><b>${t}</b><div class="secondary">${d()}</div></div></li>`).join("")}</ol></div>
        <div class="card">
          <h3>Was das Tool nicht für Sie prüft</h3>
          <ul class="tut-list" style="margin-top:8px">
            <li><b>Geschäftsmodell und Wettbewerbsvorteil:</b> Warum kommen die Kunden wieder? Was hält Konkurrenten fern?</li>
            <li><b>Risiken hinter den Zahlen:</b> Klagen, Regulierung, Abhängigkeit von wenigen Kunden, hohe Schulden, die bald fällig werden.</li>
            <li><b>Sondereffekte:</b> einmalige Gewinne oder Verluste verzerren Kennzahlen; die Nachrichten im Profil helfen bei der Einordnung.</li>
            <li><b>Ihre Streuung:</b> Kein einzelner Wert, Sektor oder Land sollte Ihr Depot dominieren.</li>
            <li><b>Die Datenqualität:</b> Das Tool nutzt kostenlose Quellen. Für viele Firmen gibt es nur rund 4 Jahre Bilanzdaten, einzelne Werte können fehlen oder falsch sein.</li>
          </ul>
          <p class="muted" style="font-size:13px;margin:10px 0 0">Das Tool rechnet nach festen Regeln und ist keine Anlageberatung. Die Entscheidung und das Risiko liegen bei Ihnen.</p>
        </div>
      </div>
      <p style="margin-top:16px"><button class="linklike" type="button" data-restart>Tutorial von vorn beginnen</button></p>
    </section></div>`;

  const page = root.firstElementChild;
  const q = (sel) => page.querySelector(sel);
  const repaint = () => {
    q("#tut-progress").innerHTML = progressHtml();
    q("#tut-cta").innerHTML = heroCta();
    q("#tut-restart").innerHTML = restartBtn();
    q("#tut-funnel").innerHTML = funnelHtml();
    q("#tut-lessons").innerHTML = lessonsHtml();
    q("#tut-symbol-cur").textContent = practiceSymbol();
    q("#tut-strategies").innerHTML = strategyCards();
    q("#tut-strategy-result").innerHTML = strategyResult();
    q("#tut-tours").innerHTML = toursHtml();
    q("#tut-routine-list").innerHTML = ROUTINE.map(([t, d]) => `<li><div><b>${t}</b><div class="secondary">${d()}</div></div></li>`).join("");
  };
  const onChange = () => {
    if (!isCurrent()) { document.removeEventListener("tutorial-changed", onChange); return; }
    repaint();
  };
  document.addEventListener("tutorial-changed", onChange);

  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  let lastSymbol = null;
  async function check(sym) {
    const out = q("#tc-out");
    sym = sym.trim().toUpperCase();
    if (!sym) return;
    lastSymbol = sym;
    out.innerHTML = `<div class="loading-block"><div class="spinner"></div>Lade ${esc(sym)} …</div>`;
    let p;
    try { p = await api.profile(sym); } catch (e) {
      if (isCurrent() && lastSymbol === sym) out.innerHTML = `<div class="error-block" style="margin-top:12px">${esc(e.message)}</div>`;
      return;
    }
    if (isCurrent() && lastSymbol === sym) out.innerHTML = checklistHtml(p);
  }

  function paintQuizResult() {
    const n = answers.filter((a) => a != null).length;
    const right = answers.filter((a, k) => a === FINAL_QUIZ[k].correct).length;
    const box = q("#tq-result");
    if (!n) { box.innerHTML = ""; return; }
    if (n < FINAL_QUIZ.length) { box.innerHTML = `<p class="muted">${n} von ${FINAL_QUIZ.length} beantwortet, ${right} richtig.</p>`; return; }
    if (store.quizBest == null || right > store.quizBest) { store.quizBest = right; persist(); }
    const msg = right === FINAL_QUIZ.length ? "Alles richtig. Sie wissen, worauf es ankommt: Viel Erfolg bei der Suche!"
      : right >= 7 ? "Gut gemacht. Lesen Sie die Erklärungen zu den falschen Antworten noch einmal."
        : "Wiederholen Sie am besten die Lektionen 3 und 4 und versuchen Sie es dann noch einmal.";
    box.innerHTML = `<div class="tq-final"><div class="tc-score">${right}<small>/${FINAL_QUIZ.length}</small></div>
      <div><p style="margin:0 0 8px">${msg}</p><button class="btn small" type="button" id="tq-again">Noch einmal</button></div></div>`;
  }

  page.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.jump) { jump(b.dataset.jump); return; }
    if (b.dataset.tour != null) { startPageTour(b.dataset.tour); return; }
    if (b.dataset.start) {
      const id = b.dataset.start;
      if (id === "strategie") jump("tut-strategie");
      else if (run?.lesson.id === id && !run.finished) { run.min = false; go(run.i, 1); }
      else startLesson(id);
      return;
    }
    if (b.dataset.strategy) {
      store.strategy = b.dataset.strategy;
      markDone("strategie");
      persist();
      return;
    }
    if (b.dataset.practice) { setSymbol(b.dataset.practice); return; }
    if (b.dataset.act === "answer") {
      const li = b.closest("li[data-q]");
      const k = Number(li.dataset.q);
      if (answers[k] != null) return;
      answers[k] = Number(b.dataset.i);
      li.innerHTML = quizHtml(FINAL_QUIZ[k], answers[k]);
      paintQuizResult();
      return;
    }
    if (b.id === "tq-again") {
      answers.length = 0;
      q("#tq-list").innerHTML = FINAL_QUIZ.map((x, k) => `<li data-q="${k}">${quizHtml(x, null)}</li>`).join("");
      paintQuizResult();
      jump("tut-abschluss");
      return;
    }
    if (b.dataset.restartLesson) { startLesson(b.dataset.restartLesson, 0); return; }
    if (b.hasAttribute("data-restart")) { askRestart(); return; }
    if (b.hasAttribute("data-restart-no")) { q("#tut-confirm").hidden = true; return; }
    if (b.hasAttribute("data-restart-yes")) {
      resetTutorial();
      answers.length = 0;
      q("#tq-list").innerHTML = FINAL_QUIZ.map((x, k) => `<li data-q="${k}">${quizHtml(x, null)}</li>`).join("");
      paintQuizResult();
      q("#tc-out").innerHTML = "";
      q("#tc-symbol").value = "";
      q("#tut-confirm").hidden = true;
      jump("tut-strategie");
    }
  });

  function askRestart() {
    const box = q("#tut-confirm");
    box.hidden = false;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    box.querySelector("[data-restart-yes]").focus({ preventScroll: true });
  }

  attachSearch(q("#tut-symbol"), q("#tut-symbol-results"), (sym) => { q("#tut-symbol").value = ""; setSymbol(sym); });
  attachSearch(q("#tc-symbol"), q("#tc-results"), (sym) => { q("#tc-symbol").value = sym; check(sym); });
  q("#tc-form").addEventListener("submit", (e) => { e.preventDefault(); check(q("#tc-symbol").value); });

  const target = params.get("pruefen") ? "tut-check" : { abschluss: "tut-abschluss", touren: "tut-touren" }[params.get("teil")] || null;
  if (params.get("pruefen")) check(params.get("pruefen"));
  if (target) setTimeout(() => { if (isCurrent()) document.getElementById(target)?.scrollIntoView({ block: "start" }); }, 50);
  if (params.get("lektion")) startLesson(params.get("lektion"));
  // „Von vorn beginnen“ auf der Startseite: Rückfrage gleich offen; die Adresse ohne ?neu, damit ein Neuladen nicht erneut fragt
  if (params.get("neu") && hasProgress()) {
    history.replaceState(history.state, "", "#/tutorial");
    setTimeout(() => { if (isCurrent()) askRestart(); }, 50);
  }
}
