// Kurz-Touren: je Seite eine kleine Führung (3–8 Schritte), die nur diese Seite erklärt. Gestartet über „? Tour“ in der
// Kopfzeile oder auf der Tutorial-Seite; sie laufen mit derselben Technik wie die Lektionen (tutorial.js): Hinweisfenster,
// Markierung des Bereichs, kleine Aufgaben, die das Tool selbst als erledigt erkennt. Schritte ohne eigene Seite gehören
// zu der Seite, auf der die Tour gestartet wurde.
// key: erster Teil der Adresse in Großbuchstaben ("" = Übersicht); start(): Adresse, wenn die Tour von woanders startet.
import * as F from "./format.js";
import { term } from "./glossary.js";

const $ = (sel) => document.querySelector(sel);
const esc = F.escapeHtml;
const sorted = () => $('#hb-list .dl-table th[aria-sort="ascending"], #hb-list .dl-table th[aria-sort="descending"]');
const sortSig = () => `${sorted()?.dataset.key || ""}|${sorted()?.getAttribute("aria-sort") || ""}`;

export const PAGE_TOURS = [
  {
    key: "", short: "Übersicht", start: () => "#/", minutes: 1,
    summary: "Was die Startseite zeigt und wie Sie überall Hilfe bekommen.",
    recap: ["Suchen geht mit Name, Ticker oder ISIN – von überall mit der Taste /", "Depot, Alarme, Termine und Watchlist stehen auf einen Blick hier",
      "„? Tour“ erklärt jede Seite, Basis/Profi blendet Details ein oder aus", "Taste ? zeigt alle Tastenkürzel"],
    steps: [
      { target: "#hero-search", title: "Aktie suchen", text: `<p>Name, Ticker oder ISIN eintippen, mit ↓ wählen, Enter öffnet das Profil. Die Suche oben in der
          Kopfzeile funktioniert genauso – auf jeder Seite, und die Taste <kbd>/</kbd> springt von überall hinein. Bei leerem Feld schlägt sie
          die zuletzt angesehenen Aktien vor.</p>`, tip: "Tippen Sie „Allianz“ und schauen Sie, was vorgeschlagen wird." },
      { target: "#h-depot", title: "Depot heute", text: "<p>Wert Ihres Depots, Veränderung heute und seit dem Kauf, alles in Euro. Erfasst werden Käufe auf der Seite „Depot“.</p>" },
      { target: "#h-alerts", title: "Alarme", text: "<p>Ausgelöste und aktive Alarme. Das Tool prüft sie alle 30 Minuten, solange es läuft, und meldet sich mit einer Mitteilung.</p>" },
      { target: "#h-dates", title: "Nächste Termine", text: "<p>Quartalszahlen, Ex-Tage und Dividendenzahlungen Ihrer Watchlist- und Depotwerte.</p>" },
      { target: "#h-watch", title: "Watchlist", text: "<p>Ihre gemerkten Kandidaten mit Kurs und wichtigsten Kennzahlen. Merken geht mit ☆ im Profil oder in der Weltauswahl.</p>" },
      { target: "#mode-switch", title: "Basis oder Profi", text: `<p><b>Basis</b> zeigt nur das Wichtigste, <b>Profi</b> alle Kennzahlen und Werkzeuge.
          Umschalten geht jederzeit; nichts geht dabei verloren.</p>` },
      { target: "#tour-btn", title: "Hilfe auf jeder Seite", text: `<p>Dieser Knopf startet auf jeder Seite eine Kurz-Tour wie diese – nur für die Seite, auf der Sie gerade sind.
          Fachbegriffe mit gepunkteter Linie erklären sich beim Darüberfahren. Den ganzen Weg zur guten Aktie zeigt das Tutorial.</p>
          <p>Schneller geht vieles mit der Tastatur: <kbd>?</kbd> zeigt alle Kürzel, zum Beispiel <kbd>g</kbd> <kbd>w</kbd> für die Weltauswahl
          (auch unter „Mehr“ → Tastenkürzel).</p>` },
    ],
  },
  {
    key: "WELT", short: "Weltauswahl", start: () => "#/welt", minutes: 2,
    summary: "Rund 6.000 Aktien weltweit filtern, sortieren und Kandidaten merken.",
    recap: ["Erst grob eingrenzen (Region, Sektor), dann Vorlage oder Kennzahl-Filter", "Eigene Filter unter einem Namen speichern („Meine Filter“)",
      "Ansichten wechseln andere Spalten, Klick auf den Kopf sortiert", "Mit ☆ merken, mit Häkchen vergleichen, CSV für Excel",
      "Im Profil mit ← → durch die Treffer blättern"],
    steps: [
      { target: "#w-status", title: "Die ganze Welt in einer Tabelle", text: `<p>Die größten Aktien aller wichtigen Börsen, jede Firma einmal. Daneben sehen Sie, wie weit die
          Tiefenanalyse ist: Gewinnstabilität, fairer Wert und erwartete Rendite rechnet das Tool im Hintergrund Aktie für Aktie.</p>` },
      { target: () => $("#w-filter-card") || $("#app .filters"), title: "Filter", text: `<p>Kontinent, Land, Sektor, Branche, Thema und Börsenwert grenzen ein. Die aktiven Filter stehen
          als Chips oben und lassen sich mit ✕ einzeln entfernen.</p>` },
      { target: () => $(".rules-head") || $("#w-rules"), optional: true, title: "Vorlagen und Kennzahl-Filter", text: `<p>Vorlagen sind fertige Filter für eine Strategie
          (etwa „Qualität zum fairen Preis“). Mit „+ Kennzahl-Filter“ setzen Sie eigene Bedingungen: Kennzahl, mindestens/höchstens, Wert.</p>`,
        tip: "Klicken Sie eine Vorlage an und sehen Sie, wie sich die Trefferzahl ändert." },
      { target: "#w-saved-head", optional: true, title: "Meine Filter", text: `<p>Haben Sie eine Suche zusammengestellt, die Sie öfter brauchen, speichern Sie sie hier unter einem Namen.
          Ein Klick stellt später alles wieder ein – auch Ansicht und Sortierung. Ihre Filter stehen außerdem auf der Startseite.</p>` },
      { target: () => $("#w-tr-label") || $("#w-tr")?.closest("label"), optional: true, title: "Nur bei Trade Republic", text: "<p>Zeigt nur Aktien, die Sie bei Trade Republic kaufen können (laut Handelsliste der LS Exchange).</p>" },
      { target: () => $('#app .segmented[aria-label="Kennzahlen-Ansicht"]'), optional: true, title: "Ansichten", text: "<p>Jede Ansicht zeigt andere Spalten: Bewertung, Qualität & fairer Wert, Signale, Scores. Die Filter bleiben dabei.</p>" },
      { target: "#w-head", title: "Sortieren", text: "<p>Ein Klick auf einen Spaltenkopf sortiert, ein zweiter dreht die Richtung. Der bessere Wert steht immer oben.</p>" },
      { target: () => $("#w-rows .star")?.closest("tr"), optional: true, title: "Merken und blättern", text: `<p>☆ am Zeilenende setzt die Aktie auf die Watchlist; ein Klick auf den Namen öffnet das Profil.
          Dort blättern Sie mit ‹ › oder den Pfeiltasten durch alle Treffer, und „← Weltauswahl“ bringt Sie an dieselbe Stelle der Liste zurück.</p>` },
      { target: () => $("#w-rows td.pick")?.closest("tr") || $("#w-head .pick"), optional: true, title: "Mehrere auswählen", text: `<p>Mit den Häkchen links wählen Sie mehrere Aktien:
          Unten erscheint eine Leiste zum Vergleichen (2 bis 4), zum Analysieren im Screener oder um alle auf die Watchlist zu setzen.
          „CSV“ über der Tabelle speichert alle Treffer mit allen Kennzahlen für Excel.</p>` },
      { target: "#w-analyze", optional: true, title: "Viele auf einmal prüfen", text: `<p>Übergibt bis zu 50 Treffer an den Screener, der für jede das ganze Profil lädt.
          Ausführlich erklärt das Lektion 2 des Tutorials.</p>` },
    ],
  },
  {
    key: "SCREENER", short: "Screener", start: () => "#/screener", minutes: 1,
    summary: "Ganze Listen mit allen Kennzahlen laden und filtern.",
    recap: ["Liste wählen (Vorlagen oder eigene Ticker)", "Mindestwerte eintragen, Klick auf den Spaltenkopf sortiert", "Geladene Aktien bleiben 6 Stunden im Zwischenspeicher"],
    steps: [
      { target: "#list-select", title: "Liste wählen", text: `<p>Watchlist, fertige Listen (etwa DAX 40, Dow Jones 30) oder „Eigene Liste“ mit beliebigen Tickern.
          Das Tool lädt für jede Aktie das ganze Profil.</p>` },
      { target: "#strategy-select", optional: true, title: "Score-Strategie", text: `<p>Nach welcher Strategie die ${term("scorecard", "Scorecard")} bewertet:
          Dividende heute, wachsende Dividende oder Gewinnwachstum.</p>` },
      { target: () => $("#app .filters"), title: "Filtern", text: "<p>Mindestwerte (Score, Gewinnstabilität, Rendite …) und die Bewertung blenden alles aus, was nicht passt.</p>" },
      { target: "#status-line", title: "Fortschritt", text: "<p>Hier sehen Sie, wie viele Aktien geladen sind. Was schon einmal geladen wurde, kommt sofort aus dem Zwischenspeicher.</p>" },
      { target: () => $("#app table.screener thead"), title: "Sortieren", text: "<p>Klick auf eine Spaltenüberschrift sortiert; ein Klick auf den Namen öffnet das Profil.</p>" },
    ],
  },
  {
    key: "WATCHLIST", short: "Watchlist", start: () => "#/watchlist", minutes: 1,
    summary: "Ihre gemerkten Aktien mit allen wichtigen Kennzahlen.",
    recap: ["☆ im Profil oder in der Weltauswahl merkt eine Aktie", "Filter und Sortierung wie im Screener", "Termine der Watchlist stehen unter „Termine“"],
    steps: [
      { target: () => $("#app table.screener"), title: "Ihre Kandidaten", text: `<p>Alle gemerkten Aktien mit Score, Gewinnstabilität, fairem Wert und Dividende.
          Neu dazu kommen Aktien mit ☆ im Profil oder in der Weltauswahl; entfernen mit demselben Stern.</p>` },
      { target: () => $("#app .filters"), title: "Filtern", text: "<p>Mindestwerte blenden aus, was (noch) nicht passt – etwa „höchstens fair bewertet“, um Kaufkandidaten zu sehen.</p>" },
      { target: () => $("#app table.screener thead"), title: "Sortieren", text: "<p>Sortieren Sie nach der Kennzahl, die für Ihre Strategie zählt, etwa der erwarteten Rendite.</p>" },
      { target: () => $("#app table.screener th.pick"), optional: true, title: "Auswählen", text: `<p>Häkchen setzen, um 2 bis 4 Aktien zu vergleichen oder mehrere auf einmal von der Watchlist zu nehmen.
          „CSV“ speichert die Tabelle für Excel; versehentlich Entferntes holt „Rückgängig“ in der Meldung zurück.</p>` },
    ],
  },
  {
    key: "TRUSTS", short: "Trusts & Holdings", start: () => "#/trusts", minutes: 2,
    summary: "Fonds und Holdings mit Abschlag zum inneren Wert finden.",
    recap: ["Abschlag = Vermögen billiger kaufen, als es wert ist", "Entscheidend ist der Vergleich mit dem üblichen Abschlag (Einordnung)",
      "Zeile aufklappen: Beteiligungen und Verlauf des Abschlags"],
    steps: [
      { target: "#t-explain", title: "Worum es geht", text: `<p>Trusts und Holdings besitzen andere Firmen. Notiert die Aktie unter dem ${term("nav", "inneren Wert")},
          kaufen Sie das Vermögen mit ${term("abschlag_nav", "Abschlag")}. Hier steht, worauf es dabei ankommt.</p>` },
      { target: "#t-fresh", optional: true, title: "Wie aktuell?", text: "<p>Die Holdings-Werte stammen aus den Berichten der Firmen. Die Farbe zeigt, wie alt der letzte Bericht ist.</p>" },
      { target: "#h-body", title: "Holdings", text: `<p>Exor, Investor AB, Porsche SE & Co.: Der innere Wert wird mit aktuellen Kursen der Beteiligungen gerechnet.
          Ein Klick auf eine Zeile zeigt Beteiligungen und den Verlauf des Abschlags.</p>` },
      { target: () => $("#app .filter-card"), title: "Fonds weltweit filtern", text: "<p>Rund 770 Closed-End-Fonds aus aller Welt: nach Schwerpunkt, Börse, Größe, Trade Republic und Abschlag filtern.</p>",
        tip: "Haken Sie „nur günstiger als üblich“ an." },
      { target: () => $("#f-body table") || $("#f-body"), optional: true, title: "Einordnung", text: `<p>Die Spalte „Einordnung“ vergleicht den Abschlag mit seinem Durchschnitt.
          Interessant sind Fonds, die gerade deutlich billiger sind als sonst.</p>` },
    ],
  },
  {
    key: "DEPOT", short: "Depot", start: () => "#/depot", minutes: 1,
    summary: "Käufe erfassen, Gewinn, Dividenden nach Steuern und Verteilung sehen.",
    recap: ["Kaufkurs in Euro wie in der Abrechnung eintragen", "Dividenden nach Quellen- und Abgeltungsteuer", "Verteilung nach Ländern, Sektoren und Währungen prüfen"],
    steps: [
      { target: "#depot-form", title: "Kauf erfassen", text: `<p>Aktie, Stückzahl und Kaufkurs je Aktie in Euro – so, wie er in der Abrechnung Ihrer Bank steht.
          Ein Profil hat dafür auch den Knopf „＋ Depot“.</p>` },
      { target: "#depot-body", title: "Ihre Positionen", text: `<p>Wert, Gewinn seit Kauf und heute, alles in Euro. Die erwarteten Dividenden sind nach
          ${term("quellensteuer", "Quellensteuer")} und Abgeltungsteuer gerechnet.</p>` },
      { target: () => $("#alloc-seg")?.closest(".card") || $("#ch-alloc"), optional: true, title: "Streuung", text: "<p>Wie verteilt sich das Depot auf Länder, Sektoren und Währungen? Kein einzelner Bereich sollte dominieren.</p>" },
      { target: () => $("#ch-months")?.closest(".card"), optional: true, title: "Dividenden je Monat", text: "<p>Wann über das Jahr wie viel Dividende kommt – praktisch, wenn Sie Einnahmen planen.</p>" },
      { target: "#lots-box", optional: true, title: "Käufe korrigieren", text: `<p>Unter „Alle Käufe“ ändern Sie Stückzahl, Kurs, Datum oder Notiz eines Kaufs. Gelöschte Käufe holt
          „Rückgängig“ in der Meldung zurück; „Als CSV sichern“ speichert alle Käufe.</p>` },
      { target: "#import-box", optional: true, title: "Aus einer Tabelle übernehmen", text: `<p>Viele Käufe auf einmal: Zeilen aus Excel oder einer CSV-Datei einfügen
          (Ticker; Stück; Kaufkurs; Datum; Notiz). Das Tool prüft jede Zeile, bevor es etwas speichert.</p>` },
    ],
  },
  {
    key: "ALARME", short: "Alarme", start: () => "#/alarme", minutes: 1,
    summary: "Sich melden lassen, wenn ein Kurs, eine Bewertung oder die Dividende eine Schwelle erreicht.",
    recap: ["Alarmarten: Kurs, Abstand zum fairen Wert, Dividendenkürzung u. a.", "Geprüft wird alle 30 Minuten, solange das Tool läuft", "Ausgelöste Alarme zurücksetzen oder löschen"],
    steps: [
      { target: "#a-form", title: "Alarm anlegen", text: `<p>Aktie wählen, Art und Schwelle eintragen. Besonders nützlich: „x % unter fairem Wert“ – so meldet sich das Tool,
          wenn eine gute, aber zu teure Aktie günstig wird.</p>` },
      { target: "#a-type", title: "Arten", text: "<p>Kurs über/unter, Abstand zum fairen Wert, Dividendenrendite, Dividendenkürzung und mehr. Die Einheit der Schwelle steht darüber.</p>" },
      { target: "#a-status", title: "Wie geprüft wird", text: "<p>Alle 30 Minuten, solange das Tool läuft; „Jetzt prüfen“ sofort. Ausgelöste Alarme erscheinen auch als Zahl in der Kopfzeile.</p>" },
      { target: () => $("#a-rows")?.closest("table"), title: "Ihre Alarme", text: "<p>Aktive und ausgelöste Alarme. Ausgelöste lassen sich zurücksetzen, damit sie wieder scharf sind.</p>" },
    ],
  },
  {
    key: "TERMINE", short: "Termine", start: () => "#/termine", minutes: 1,
    summary: "Quartalszahlen und Dividendentermine von Watchlist und Depot.",
    recap: ["Termine kommen von Yahoo und können sich verschieben", "Nach Quartalszahlen die eigene These prüfen", "Ex-Tag: Wer davor kauft, bekommt die Dividende"],
    steps: [
      { target: "#k-body", title: "Ihr Kalender", text: `<p>Alle Aktien aus Watchlist und Depot: Quartalszahlen, Ex-Tage und Zahltage der Dividende, nach Monat.
          Wer bis zum Tag vor dem Ex-Tag kauft, bekommt die Dividende.</p>
          <p>Gute Gewohnheit: Nach jeden Quartalszahlen kurz ins Profil schauen, ob Ihre Kaufgründe noch gelten.</p>` },
    ],
  },
  {
    key: "VERGLEICH", short: "Vergleich", start: () => "#/vergleich?s=KO,PEP,NESN.SW", minutes: 1,
    summary: "Bis zu fünf Aktien Kennzahl für Kennzahl nebeneinander.",
    recap: ["Aktien oben hinzufügen oder mit × entfernen", "Fett ist der beste Wert jeder Zeile", "Die Adresse lässt sich als Lesezeichen speichern"],
    steps: [
      { target: "#c-form", title: "Aktien wählen", text: "<p>Suchen und hinzufügen; × entfernt eine Aktie. Die Auswahl steht in der Adresse und lässt sich als Lesezeichen speichern.</p>" },
      { target: () => $("#c-body table") || $("#c-body"), title: "Nebeneinander", text: `<p>Jede Zeile eine Kennzahl, fett der beste Wert. So sehen Sie schnell, wer bei Qualität,
          Bewertung und Dividende vorne liegt – und wo es Lücken gibt.</p>` },
      { target: "#ch-compare", optional: true, title: "Kursverlauf", text: "<p>Die Wertentwicklung im Vergleich, alle auf denselben Start gesetzt.</p>" },
    ],
  },
  {
    key: "SCORE-CHECK", short: "Score-Check", start: () => "#/score-check", minutes: 1,
    summary: "Prüfen, ob die Scores in der Vergangenheit Rendite gebracht haben.",
    recap: ["Aktien nach ihrem damaligen Score in Fünftel geteilt", "Steigen die Balken nach rechts, hatte der Score Vorhersagekraft", "Erst über Monate aussagekräftig"],
    steps: [
      { target: "#s-body", title: "Taugen die Scores etwas?", text: `<p>Das Tool speichert täglich die Weltauswahl. Hier teilt es die Aktien nach ihrem Score von damals in fünf Gruppen
          und zeigt, wie sie sich seitdem entwickelt haben.</p>` },
      { target: () => $("#s-body .filters"), optional: true, title: "Zeitraum und Score", text: "<p>Stand vom, bis und welcher Score geprüft wird.</p>" },
      { target: "#s-tiles", optional: true, title: "Ergebnis", text: `<p>Am wichtigsten: ${term("rangkorrelation", "Rangkorrelation")} und der Unterschied zwischen stärkstem und
          schwächstem Fünftel. Kurzfristig dominiert der Zufall.</p>` },
      { target: () => $("#ch-quint")?.closest(".card"), optional: true, title: "Fünftel", text: "<p>Steigen die Balken von links nach rechts, brachten höhere Scores höhere Renditen.</p>" },
    ],
  },
  {
    key: "CALLPUT", short: "Call/Put-Rechner", start: () => "#/callput?s=SAP.DE", minutes: 2,
    summary: "Einen Optionsschein oder Knock-out durchrechnen: Wert, Hebel, Preis-Check, Szenarien.",
    recap: ["Produkt per ISIN laden oder Daten selbst eingeben", "Preis-Check zeigt, ob der Preis fair ist – ohne Meinung", "„Ihre Erwartung“ rechnet Ø Rendite, Gewinnchance und KO-Risiko"],
    steps: [
      { target: "#cp-pform", title: "Produkt laden", text: "<p>ISIN oder WKN aus der Trade-Republic-App eintragen: Stammdaten und Briefkurs kommen von onvista.</p>" },
      { target: "#cp-form", title: "Oder selbst wählen", text: "<p>Basiswert, Produktart und Richtung. Call gewinnt, wenn die Aktie steigt, Put, wenn sie fällt.</p>" },
      { target: () => $("#app .cp-params"), title: "Produktdaten", text: `<p>${term("basispreis", "Basispreis")}, Knock-out-Schwelle, ${term("bezugsverhaeltnis", "Bezugsverhältnis")},
          Fälligkeit und Preis – wie im Produktblatt. Ein geladenes Produkt füllt alles selbst.</p>` },
      { target: "#cp-tiles", title: "Das Wichtigste", text: `<p>Wert, ${term("omega", "Hebel")}, ${term("preischeck", "Preis-Check")} (teurer oder günstiger als fair), Gewinnschwelle,
          Totalverlust- bzw. Knock-out-Marke und was Zeit oder Finanzierung kosten.</p>` },
      { target: "#cp-view", title: "Ihre Erwartung", text: `<p>Wo steht die Aktie an einem Tag, und wie stark schwankt sie bis dahin? Daraus rechnet das Tool Ø Rendite,
          Gewinnchance und Knock-out-Risiko – für dieses Produkt und alle in der Liste.</p>`,
        task: { text: "Klicken Sie auf eine Veränderung, z. B. „+10 %“.", enter: () => $("#cp-ws")?.value, done: (s) => $("#cp-ws")?.value !== s } },
      { target: () => $("#cp-chart")?.closest(".card"), optional: true, title: "Gewinn oder Verlust je Kurs", text: "<p>Die Kurven zeigen das Ergebnis sofort, an Ihrem Tag und bei Fälligkeit; die grüne Fläche, wo die Aktie nach Ihrer Erwartung liegen dürfte.</p>" },
      { target: "#cp-list", optional: true, title: "Alle Produkte auf die Aktie", text: `<p>Darunter alle Produkte auf die Aktie, nach jeder Spalte sortierbar. Häkchen vergleichen bis zu sechs, „Rechnen“
          übernimmt eins. „Große Ansicht“ öffnet die Tabelle mit allen Filtern, Matrix und Landkarte.</p>` },
    ],
  },
  {
    key: "HEBEL", short: "Optionsscheine & Knock-outs", start: () => "#/hebel?s=SAP.DE", minutes: 3,
    summary: "Alle Hebelprodukte auf eine Aktie filtern, sortieren, in Matrix und Landkarte vergleichen.",
    recap: ["Alle Produkte sind geladen: Filter und Sortierung gelten für alle", "Preis-Check, vs. ähnliche und Spanne ÷ Hebel sind neutral",
      "Ø Erwartung und Gewinnchance rechnen mit Ihrer Erwartung oben", "Matrix und Landkarte zeigen, wo es günstig ist"],
    steps: [
      { target: "#hb-form", title: "Aktie, Produkt, Richtung", text: "<p>Basiswert suchen, Optionsscheine oder Knock-outs, Call oder Put. Die Tabelle lädt dann alle Produkte darauf (bis 6.000).</p>" },
      { target: "#hb-view", title: "Ihre Erwartung", text: `<p>Zeitraum, Kursveränderung und Schwankung. Damit rechnen die Spalten Ø Erwartung, Gewinnchance und KO-Risiko.
          „±0“ mit der bisherigen Schwankung ist die neutrale Sicht.</p>` },
      { target: () => $("#hb-list .dl-quick"), title: "Schnell filtern", text: `<p>Laufzeit, Basispreis, Hebel und ${term("spanne", "Spanne")} mit einem Klick.
          „Weitere Filter“ darunter: eigene Bereiche, Emittent, Preis-Check, Briefkurs, WKN-Suche, ohne Quanto, nur neue Produkte.</p>` },
      { target: () => $("#hb-list .dl-table thead"), title: "Nach jeder Spalte sortieren", text: `<p>Ein Klick sortiert alle geladenen Produkte – nicht nur die erste Seite.
          ${term("preischeck", "Preis-Check")} und ${term("aehnliche", "vs. ähnliche")} zeigen günstige Produkte, ${term("spanne_aktie", "Spanne ÷ Hebel")} die günstigste Spanne über alle Hebel.</p>`,
        task: { text: "Sortieren Sie nach Preis-Check (Klick auf die Überschrift; ein zweiter Klick dreht die Richtung).",
          enter: () => sortSig(), done: (s) => sortSig() !== s && sorted()?.dataset.key === "check" } },
      { target: () => $("#hb-list .dl-colpick"), title: "Spalten und Export", text: "<p>„Spalten“ blendet Delta, Zeitwert pro Tag, Aufgeld, Geld, Veränderung heute und mehr ein. „CSV“ speichert die Liste für Excel.</p>" },
      { target: () => $("#hb-list .dl-table tbody tr"), optional: true, title: "Vergleichen und rechnen", text: `<p>Häkchen links: bis zu sechs Produkte im Vergleich unter der Tabelle (Diagramm und Kennzahlen).
          „Rechnen“ öffnet ein Produkt im Call/Put-Rechner.</p>` },
      { target: () => $("#hb-list .dl-views"), title: "Matrix und Landkarte", text: `<p><b>Matrix:</b> Optionsscheine nach Fälligkeit und Basispreis, Knock-outs nach Abstand und Art – je Feld der beste Wert;
          ein Klick filtert die Liste. <b>Landkarte:</b> jedes Produkt als Punkt, nach Emittent gefärbt.</p>`,
        task: { text: "Öffnen Sie die Matrix.", done: () => Boolean($('#hb-list [data-view="matrix"][aria-pressed="true"]')) } },
    ],
  },
  {
    key: "LEXIKON", short: "Lexikon", start: () => "#/lexikon", minutes: 1,
    summary: "Alle Fachbegriffe kurz erklärt, mit Wikipedia.",
    recap: ["Begriffe suchen oder nach Kategorie springen", "Gepunktete Begriffe erklären sich überall beim Darüberfahren"],
    steps: [
      { target: "#lex-q", title: "Begriff suchen", text: "<p>Filtert alle Einträge beim Tippen, z. B. „KGV“ oder „Spanne“.</p>" },
      { target: () => $('#app nav[aria-label="Kategorien"]'), title: "Kategorien", text: "<p>Springt zu Bewertung, Dividende, Hebelprodukte und den anderen Gruppen.</p>" },
      { target: () => $("#app .lex-entry"), title: "Ein Eintrag", text: `<p>Kurzfassung, Erklärung und auf Wunsch die Zusammenfassung aus Wikipedia. Dieselbe Kurzfassung erscheint im ganzen Tool,
          wenn Sie über einen gepunktet unterstrichenen Begriff fahren.</p>` },
    ],
  },
  {
    key: "AKTIE", short: "Aktienprofil", profilePage: true, start: (c) => `#/aktie/${encodeURIComponent(c.symbol)}`, minutes: 2,
    summary: "Was das Profil einer Aktie zeigt und wo Sie was finden.",
    recap: ["„Auf einen Blick“ fasst Qualität, Preis und Dividende zusammen", "Die Leiste springt zu jedem Abschnitt und zeigt, wo Sie lesen",
      "Watchlist, Depot, Alarm und Hebelprodukte direkt aus dem Profil", "Aus einer Liste geöffnet: mit ← → weiterblättern"],
    steps: [
      { target: () => $(".profile-head")?.closest(".card"), title: "Kopf", text: (c) => `<p>Kurs in Euro, Börse, ob Trade Republic die Aktie ${esc(c.symbol)} handelt, dazu ☆ Watchlist,
          ＋ Depot und Call/Put. Darunter: Was macht die Firma?</p>` },
      { target: "#sec-verdict", title: "Auf einen Blick", text: "<p>Das Fazit des Tools: Qualität, Preis gegenüber dem fairen Wert, Dividende und die wichtigsten Warnzeichen.</p>" },
      { target: () => $(".subnav"), title: "Abschnitte", text: "<p>Die Leiste springt zu Qualität, Bewertung, fairem Wert, Dividende, Jahreswerten, Hebelprodukten und Notizen.</p>" },
      { target: "#sec-quality", title: "Qualität", text: `<p>Steigt der Gewinn zuverlässig? ${term("gewinnstabilitaet", "Gewinnstabilität")}, Wachstum,
          ${term("roic", "ROIC")} und Bilanz. Ausführlich in Lektion 3 des Tutorials.</p>` },
      { target: "#sec-fairvalue", optional: true, title: "Fairer Wert", text: `<p>Was die Aktie bei ihrem üblichen Bewertungsniveau wert wäre, und die
          ${term("erwartete_rendite", "erwartete Rendite")}. Ausführlich in Lektion 4.</p>` },
      { target: "#sec-derivatives", optional: true, title: "Hebelprodukte", text: "<p>Die günstigsten typischen Optionsscheine und Knock-outs auf die Aktie, mit Link auf alle Produkte.</p>" },
      { target: "#sec-notes", title: "Notizen", text: `<p>Ihre Investment-These: Warum kaufen, wann verkaufen? Speichert sich beim Schreiben selbst und bleibt lokal.
          Die Taste <kbd>n</kbd> springt von überall im Profil hierher.</p>` },
      { target: () => $(".browse-bar"), optional: true, title: "Weiterblättern", text: `<p>Haben Sie das Profil aus einer Liste geöffnet (Weltauswahl, Watchlist, Depot …), führen ‹ › oder die
          Pfeiltasten zur vorigen und nächsten Aktie. „←“ links bringt Sie an dieselbe Stelle der Liste zurück, <kbd>m</kbd> merkt die Aktie.</p>` },
    ],
  },
];

// Seite der aktuellen Adresse: "" (Übersicht), "WELT", "AKTIE" …
export const pageKeyOf = (hash) => decodeURIComponent(((hash || "").replace(/^#/, "") || "/").split("?")[0]).toUpperCase().split("/")[1] || "";
export const pageTourFor = (hash) => PAGE_TOURS.find((t) => t.key === pageKeyOf(hash)) || null;
export const pageTourCount = () => PAGE_TOURS.length;
