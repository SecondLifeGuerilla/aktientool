// Lexikon: Erklärungen für Fachbegriffe. `short` erscheint im Tooltip, `long` zusätzlich im Lexikon.
// `wiki`: Wikipedia-Artikel (deutsch, "en:" für englisch), aus dem sich eine Zusammenfassung nachladen lässt.
import { escapeHtml as esc } from "./format.js";

export const GROUPS = ["Bewertung", "Rentabilität", "Wachstum", "Dividende", "Bilanz & Risiko", "Kurs & Markt", "Scores", "Allgemein"];

export const TERMS = {
  // ---- Bewertung
  boersenwert: {
    group: "Bewertung", term: "Börsenwert (Marktkapitalisierung)", wiki: "Marktkapitalisierung",
    short: "Aktienkurs × Anzahl der Aktien: So viel ist das ganze Unternehmen an der Börse wert.",
    long: "In der Weltauswahl wird der Börsenwert einheitlich in Euro umgerechnet, damit Firmen aus verschiedenen Ländern vergleichbar sind. Große Firmen (über 10 Mrd. €) gelten als „Large Caps“, unter 2 Mrd. € beginnt der Bereich der Nebenwerte.",
  },
  kgv: {
    group: "Bewertung", term: "KGV (Kurs-Gewinn-Verhältnis)", wiki: "Kurs-Gewinn-Verhältnis",
    short: "Aktienkurs ÷ Gewinn je Aktie der letzten 12 Monate. Gibt an, wie viele Jahresgewinne Anleger für die Aktie bezahlen.",
    long: "Beispiel: Kurs 100 €, Gewinn je Aktie 5 € → KGV 20. Ein niedriges KGV kann auf eine günstige Aktie hindeuten, ist aber nur im Vergleich mit der Branche und der eigenen Vergangenheit aussagekräftig: Wachstumsfirmen haben oft hohe KGVs, Banken und Versorger niedrige. Bei Verlusten ist das KGV nicht sinnvoll und wird nicht angezeigt; Werte unter 1 verwirft das Tool als Datenfehler.",
  },
  kgv_erwartet: {
    group: "Bewertung", term: "KGV erwartet (Forward-KGV)", wiki: "Kurs-Gewinn-Verhältnis",
    short: "Aktienkurs ÷ von Analysten erwarteter Gewinn je Aktie im nächsten Geschäftsjahr.",
    long: "Liegt das erwartete KGV deutlich unter dem aktuellen, rechnen Analysten mit steigenden Gewinnen. Es beruht auf Schätzungen und ist daher unsicherer als das KGV der letzten 12 Monate.",
  },
  kcv: {
    group: "Bewertung", term: "KCV (Kurs-Cashflow-Verhältnis)", wiki: "Cashflow",
    short: "Aktienkurs ÷ operativer Cashflow je Aktie. Ersetzt das KGV, wenn der Cashflow zuverlässiger verläuft als der Gewinn.",
    long: "Der operative Cashflow lässt sich durch Bilanzierung (Abschreibungen, Rückstellungen) kaum gestalten. Das Tool bewertet deshalb mit der Kennzahl, die in der Vergangenheit am gleichmäßigsten gestiegen ist; das kann das KCV statt des KGV sein. KCVs liegen meist niedriger als KGVs derselben Firma.",
  },
  bereinigter_gewinn: {
    group: "Bewertung", term: "Bereinigter Gewinn", wiki: "Gewinn je Aktie",
    short: "Gewinn ohne Sondereffekte wie Abschreibungen auf Übernahmen, Umbaukosten oder einmalige Verkaufserlöse.",
    long: "Der bereinigte Gewinn zeigt die laufende Ertragskraft oft besser als der bilanzierte. Was als Sondereffekt gilt, legt das Unternehmen aber selbst fest. Yahoo liefert ihn nur für die letzten rund 4 Jahre.",
  },
  kbv: {
    group: "Bewertung", term: "KBV (Kurs-Buchwert-Verhältnis)", wiki: "Kurs-Buchwert-Verhältnis",
    short: "Börsenwert ÷ Eigenkapital laut Bilanz. Unter 1 kostet die Aktie weniger als das bilanzielle Vermögen.",
    long: "Besonders aussagekräftig bei Banken, Versicherungen und Immobilienfirmen, deren Vermögen größtenteils in der Bilanz steht. Bei Software- oder Markenfirmen ist der Wert wenig hilfreich, weil ihr wichtigstes Kapital (Know-how, Marken) kaum bilanziert wird.",
  },
  kuv: {
    group: "Bewertung", term: "KUV (Kurs-Umsatz-Verhältnis)", wiki: "Kurs-Umsatz-Verhältnis",
    short: "Börsenwert ÷ Jahresumsatz. Auch für Firmen mit Verlust berechenbar.",
    long: "Weil die Margen je nach Branche sehr unterschiedlich sind (Supermarkt 3 %, Software 30 %), ist das KUV nur innerhalb einer Branche vergleichbar.",
  },
  ev_ebitda: {
    group: "Bewertung", term: "EV/EBITDA", wiki: "Unternehmenswert",
    short: "Unternehmenswert (Börsenwert + Nettoschulden) ÷ EBITDA. Berücksichtigt anders als das KGV auch die Schulden.",
    long: "Der Unternehmenswert (Enterprise Value) ist der Preis, den ein Käufer für die ganze Firma inklusive ihrer Schulden zahlen müsste. Geteilt durch das EBITDA eignet er sich gut, um Firmen mit unterschiedlicher Verschuldung und Steuerlast zu vergleichen. Für Banken nicht geeignet.",
  },
  ebitda: {
    group: "Bewertung", term: "EBITDA", wiki: "EBITDA",
    short: "Gewinn vor Zinsen, Steuern und Abschreibungen: das operative Ergebnis aus dem Kerngeschäft.",
  },
  peg: {
    group: "Bewertung", term: "PEG-Ratio", wiki: "en:PEG ratio",
    short: "KGV ÷ erwartetes jährliches Gewinnwachstum in Prozent (hier über 5 Jahre). Um 1 gilt als fair für das Wachstum.",
    long: "Beispiel: KGV 30 bei erwartet 30 % Wachstum pro Jahr → PEG 1. Ein hohes KGV ist so mit dem Wachstum vergleichbar. Die Wachstumsrate stammt aus Analystenschätzungen und ist entsprechend unsicher.",
  },
  fairer_wert: {
    group: "Bewertung", term: "Fairer Wert", wiki: "Innerer Wert",
    short: "Durchschnittliches historisches KGV (bzw. KCV) × aktueller Gewinn (bzw. Cashflow) je Aktie.",
    long: "Liegt der Kurs unter dem fairen Wert, ist die Aktie gemessen an ihrer eigenen Vergangenheit günstig. Der Durchschnitt wird über 3, 5 oder 10 Jahre gebildet; Phasen mit eingebrochenem Gewinn zählen nicht mit. Die Methode setzt voraus, dass die Firma künftig ähnlich bewertet wird wie bisher; bei Umbrüchen im Geschäft trifft das nicht zu.",
  },
  gewinndelle: {
    group: "Bewertung", term: "Eingebrochene Kennzahl (nicht im Durchschnitt)", wiki: "Kurs-Gewinn-Verhältnis",
    short: "Tage, an denen Gewinn bzw. Cashflow unter 60 % ihres Höchststands im Umkreis von einem Jahr lagen – etwa ein Verlustjahr und die Erholung danach. Das KGV ist dort künstlich hoch und zählt nicht zum Durchschnitts-KGV.",
    long: "Beispiel adidas: 2023 brach der Gewinn ein, das KGV stieg auf rund 180, 2024 während der Erholung auf rund 100. Ohne diese Phasen lag das durchschnittliche KGV der übrigen Zeit bei knapp 28 statt 39; mit ihnen wäre der faire Wert um rund ein Drittel zu hoch. Dieselbe Regel greift, wenn sich der Gewinn binnen eines Jahres mehr als verdoppelt: Auch dann ist das KGV auf Basis der letzten 12 Monate vorübergehend verzerrt.",
  },
  harmonisches_mittel: {
    group: "Bewertung", term: "Harmonisches Mittel", wiki: "Harmonisches Mittel",
    short: "Durchschnitt über die Kehrwerte. Beim KGV ist es der Kehrwert der durchschnittlichen Gewinnrendite; einzelne Jahre mit extrem hohem KGV verzerren es kaum.",
  },
  kursziel: {
    group: "Bewertung", term: "Analysten-Kursziel", wiki: "Kursziel",
    short: "Durchschnitt der Kursziele, die Analysten für die nächsten 12 Monate erwarten.",
    long: "Kursziele werden häufig dem aktuellen Kurs hinterhergeführt und sind keine verlässliche Prognose. Aufschlussreich ist auch die Spanne zwischen niedrigstem und höchstem Ziel.",
  },
  analysten_rating: {
    group: "Bewertung", term: "Analysten-Rating", wiki: "Finanzanalyse",
    short: "Durchschnittliche Empfehlung der Analysten: 1 = starker Kauf, 2 = Kaufen, 3 = Halten, 4 = Verkaufen, 5 = starker Verkauf.",
  },

  // ---- Rentabilität
  eigenkapitalrendite: {
    group: "Rentabilität", term: "Eigenkapitalrendite (ROE)", wiki: "Rentabilität",
    short: "Gewinn ÷ Eigenkapital: wie viel das Unternehmen mit dem Geld der Aktionäre verdient. Über 15 % gilt als stark.",
    long: "Vorsicht: Hohe Schulden oder Aktienrückkäufe verkleinern das Eigenkapital und treiben die Eigenkapitalrendite künstlich nach oben. Deshalb lohnt der Blick auf den Verschuldungsgrad.",
  },
  gesamtkapitalrendite: {
    group: "Rentabilität", term: "Gesamtkapitalrendite (ROA)", wiki: "Rentabilität",
    short: "Gewinn ÷ Bilanzsumme. Unabhängig davon, ob mit Eigen- oder Fremdkapital finanziert wird.",
    long: "Bei Banken liegt sie typischerweise um 1 %, bei Industrie- und Softwarefirmen deutlich höher.",
  },
  kapitalrendite: {
    group: "Rentabilität", term: "Kapitalrendite (ROC)", wiki: "Return on Capital Employed",
    short: "Operativer Gewinn ÷ eingesetztes Kapital (Eigen- und Fremdkapital). Teil der Magic Formula.",
  },
  bruttomarge: {
    group: "Rentabilität", term: "Bruttomarge", wiki: "Rohertrag",
    short: "(Umsatz − Herstellkosten) ÷ Umsatz. Hohe Bruttomargen deuten auf Preissetzungsmacht hin.",
  },
  ebitda_marge: {
    group: "Rentabilität", term: "EBITDA-Marge", wiki: "EBITDA",
    short: "EBITDA ÷ Umsatz: operative Marge vor Abschreibungen, Zinsen und Steuern.",
  },
  nettomarge: {
    group: "Rentabilität", term: "Nettomarge (Umsatzrendite)", wiki: "Rentabilität",
    short: "Gewinn ÷ Umsatz: wie viel von jedem Euro Umsatz am Ende als Gewinn übrig bleibt.",
  },

  // ---- Wachstum
  umsatzwachstum: {
    group: "Wachstum", term: "Umsatzwachstum", wiki: "Wachstumsrate",
    short: "Umsatz der letzten 12 Monate gegenüber dem Vorjahreszeitraum.",
  },
  gewinnwachstum: {
    group: "Wachstum", term: "Gewinnwachstum", wiki: "Gewinn je Aktie",
    short: "Gewinn je Aktie der letzten 12 Monate gegenüber dem Vorjahreszeitraum. Schwankt stark, wenn der Vorjahresgewinn klein war.",
  },
  gewinnwachstum_erwartet: {
    group: "Wachstum", term: "Erwartetes Gewinnwachstum", wiki: "Gewinn je Aktie",
    short: "Von Analysten erwarteter Gewinn je Aktie im nächsten Geschäftsjahr gegenüber den letzten 12 Monaten.",
  },
  wachstum_pa: {
    group: "Wachstum", term: "Wachstum pro Jahr (p. a.)", wiki: "Wachstumsrate",
    short: "Durchschnittliche jährliche Wachstumsrate über mehrere Jahre, aus einer Trendlinie durch die Jahreswerte berechnet.",
    long: "Die Trendlinie (Regression der logarithmierten Werte) ist robuster als ein reiner Vergleich von Anfangs- und Endjahr, weil ein einzelnes Ausreißerjahr das Ergebnis kaum verzerrt.",
  },
  gewinn_je_aktie: {
    group: "Wachstum", term: "Gewinn je Aktie (EPS)", wiki: "Gewinn je Aktie",
    short: "Jahresgewinn ÷ Anzahl der Aktien. Grundlage des KGV.",
  },
  gewinnstabilitaet: {
    group: "Wachstum", term: "Gewinnstabilität", wiki: "Bestimmtheitsmaß",
    short: "Wie gleichmäßig der Gewinn über die Jahre gestiegen ist: 1 = perfekt gleichmäßig steigend, 0 = kein Trend, negativ = fallend. Über 0,8 gilt als sehr zuverlässig.",
    long: "Berechnet als Bestimmtheitsmaß R² einer Trendgeraden durch die Jahreswerte der letzten bis zu 11 Jahre, mit dem Vorzeichen der Steigung. Firmen mit stabil steigenden Gewinnen lassen sich zuverlässiger bewerten.",
  },

  // ---- Dividende
  dividendenrendite: {
    group: "Dividende", term: "Dividendenrendite", wiki: "Dividende",
    short: "Jährliche Dividende ÷ Aktienkurs. Zeigt, wie viel Prozent des Kaufpreises jedes Jahr ausgezahlt werden.",
    long: "Eine sehr hohe Rendite kann ein Warnsignal sein: Oft ist der Kurs gefallen, weil der Markt eine Kürzung erwartet. Deshalb gemeinsam mit Ausschüttungsquote und Dividendenhistorie betrachten.",
  },
  ausschuettungsquote: {
    group: "Dividende", term: "Ausschüttungsquote", wiki: "Dividende",
    short: "Anteil des Gewinns, der als Dividende ausgezahlt wird. Bis etwa 70 % gilt als nachhaltig, über 100 % zahlt die Firma mehr aus, als sie verdient.",
  },
  dividendensteigerungen: {
    group: "Dividende", term: "Dividendensteigerungen in Folge", wiki: "Dividendenaristokrat",
    short: "Anzahl der Jahre in Folge mit erhöhter Dividende. Ab 25 Jahren spricht man von Dividenden-Aristokraten.",
    long: "In der Weltauswahl stammt der Wert von Yahoo, das höchstens rund 25 Jahre zurückzählt (Coca-Cola erscheint mit 23 statt über 60 Jahren). Das Profil berechnet die Steigerungen selbst aus der gesamten Dividendenhistorie.",
  },
  dividendenwachstum: {
    group: "Dividende", term: "Dividendenwachstum", wiki: "Dividende",
    short: "Durchschnittliche jährliche Steigerung der Dividende je Aktie.",
  },
  dividendenstabilitaet: {
    group: "Dividende", term: "Dividendenstabilität", wiki: "Bestimmtheitsmaß",
    short: "Wie gleichmäßig die Dividende gestiegen ist, von 0 bis 1 (wie die Gewinnstabilität).",
  },
  rendite_vs_durchschnitt: {
    group: "Dividende", term: "Rendite vs. Durchschnitt (Dividenden-Turbo)", wiki: "Dividende",
    short: "Aktuelle Dividendenrendite im Vergleich zum Durchschnitt der letzten 5 bzw. 10 Jahre.",
    long: "Liegt sie deutlich darüber, ist die Aktie gemessen an ihrer Dividende historisch günstig – oder der Markt rechnet mit einer Kürzung.",
  },

  // ---- Bilanz & Risiko
  verschuldungsgrad: {
    group: "Bilanz & Risiko", term: "Verschuldungsgrad", wiki: "Verschuldungsgrad",
    short: "Finanzschulden ÷ Eigenkapital. 100 % = so viele Schulden wie Eigenkapital.",
    long: "Negative Werte entstehen bei negativem Eigenkapital, etwa nach jahrelangen hohen Aktienrückkäufen (z. B. McDonald's). Das ist dann nicht automatisch ein Alarmzeichen.",
  },
  nettoschulden_ebitda: {
    group: "Bilanz & Risiko", term: "Nettoschulden / EBITDA", wiki: "Verschuldungsgrad",
    short: "Schulden minus flüssige Mittel, geteilt durch das EBITDA. Unter 2 gilt als solide, über 4 als hoch; negativ = mehr Geld als Schulden.",
  },
  tilgungsjahre: {
    group: "Bilanz & Risiko", term: "Tilgungsjahre", wiki: "Verschuldungsgrad",
    short: "Nettoverschuldung ÷ Free Cashflow: in wie vielen Jahren die Firma ihre Schulden aus dem freien Geldzufluss tilgen könnte.",
  },
  beta: {
    group: "Bilanz & Risiko", term: "Beta", wiki: "Betafaktor",
    short: "Schwankung der Aktie im Vergleich zum Gesamtmarkt: 1 = wie der Markt, 1,5 = 50 % stärkere Ausschläge, unter 1 = ruhiger.",
  },
  altman_z: {
    group: "Bilanz & Risiko", term: "Altman-Z-Score", wiki: "en:Altman Z-score",
    short: "Kennzahl für das Insolvenzrisiko aus Liquidität, Gewinnrücklagen, Ertragskraft, Börsenwert und Umsatz. Über 3 gilt als sicher, unter 1,8 als gefährdet.",
    long: "Entwickelt 1968 von Edward Altman für Industrieunternehmen. Für Banken, Versicherungen und Immobilienfirmen ist der Wert nicht aussagekräftig.",
  },
  free_cashflow: {
    group: "Bilanz & Risiko", term: "Free Cashflow", wiki: "Cashflow",
    short: "Operativer Cashflow minus Investitionen: das Geld, das für Dividenden, Aktienrückkäufe und Schuldenabbau übrig bleibt.",
  },
  operativer_cashflow: {
    group: "Bilanz & Risiko", term: "Operativer Cashflow", wiki: "Cashflow",
    short: "Geldzufluss aus dem laufenden Geschäft. Anders als der Gewinn kaum durch Bilanzierung beeinflussbar.",
  },

  // ---- Kurs & Markt
  kursentwicklung: {
    group: "Kurs & Markt", term: "Kursentwicklung 1 Jahr", wiki: "Rendite",
    short: "Veränderung des Aktienkurses in den letzten 52 Wochen, ohne Dividenden.",
  },
  momentum: {
    group: "Kurs & Markt", term: "Momentum (200-Tage-Linie)", wiki: "Gleitender Durchschnitt",
    short: "Abstand des Kurses zum Durchschnittskurs der letzten 200 Handelstage. Darüber gilt der Trend als intakt, darunter als angeschlagen.",
    long: "Die 200-Tage-Linie ist der bekannteste gleitende Durchschnitt der Chartanalyse. Aktien mit positivem Momentum entwickeln sich statistisch oft eine Zeit lang weiter besser als der Markt (Momentum-Effekt).",
  },
  abstand_hoch: {
    group: "Kurs & Markt", term: "Abstand zum 52-Wochen-Hoch", wiki: "Rendite",
    short: "Wie weit der Kurs unter seinem höchsten Stand der letzten 12 Monate liegt.",
  },
  total_return: {
    group: "Kurs & Markt", term: "Total Return", wiki: "Total Return",
    short: "Kursentwicklung inklusive wieder angelegter Dividenden: die tatsächliche Rendite eines Anlegers.",
  },
  allzeithoch: {
    group: "Kurs & Markt", term: "Allzeithoch",
    short: "Höchster Schlusskurs, den die Aktie je erreicht hat.",
  },
  isin: {
    group: "Kurs & Markt", term: "ISIN", wiki: "Internationale Wertpapierkennnummer",
    short: "Weltweit eindeutige Kennung eines Wertpapiers. Die ersten zwei Buchstaben stehen für das Sitzland des Herausgebers.",
  },
  heimatboerse: {
    group: "Kurs & Markt", term: "Heimatbörse",
    short: "Die Börse im Heimatland, an der die Aktie hauptsächlich gehandelt wird. Zweitnotierungen und Zertifikate wie ADRs fasst die Weltauswahl dort zusammen.",
  },
  adr: {
    group: "Kurs & Markt", term: "ADR (American Depositary Receipt)", wiki: "American Depositary Receipt",
    short: "In den USA gehandeltes Zertifikat auf eine ausländische Aktie, z. B. TSM für TSMC aus Taiwan.",
  },

  // ---- Scores
  score_gesamt: {
    group: "Scores", term: "Gesamt-Score", wiki: "Value Investing",
    short: "0–100: Mittel aus Qualitäts-, Bewertungs-, Wachstums- und Momentum-Score. Hoch = profitable, vernünftig bewertete, wachsende Firma mit intaktem Kurstrend.",
    long: "Jeder Teil-Score vergleicht die Aktie mit allen Aktien desselben Sektors der Weltauswahl. Der Gesamt-Score ist ein Startpunkt für die eigene Recherche, keine Kaufempfehlung: Er kennt weder die Zukunftsaussichten noch Sondereffekte in den Zahlen.",
  },
  score_qualitaet: {
    group: "Scores", term: "Qualitäts-Score", wiki: "Rentabilität",
    short: "0–100: Rang bei Eigenkapitalrendite, Gesamtkapitalrendite, Nettomarge, EBITDA-Marge und Verschuldung im Vergleich zum eigenen Sektor.",
  },
  score_bewertung: {
    group: "Scores", term: "Bewertungs-Score", wiki: "Kurs-Gewinn-Verhältnis",
    short: "0–100: Rang bei KGV, erwartetem KGV, KBV, KUV und EV/EBITDA im eigenen Sektor. Hoch = günstiger als die meisten Vergleichsfirmen.",
  },
  score_wachstum: {
    group: "Scores", term: "Wachstums-Score", wiki: "Wachstumsrate",
    short: "0–100: Rang bei Umsatzwachstum, Gewinnwachstum und erwartetem Gewinnwachstum im eigenen Sektor.",
  },
  score_dividende: {
    group: "Scores", term: "Dividenden-Score", wiki: "Dividende",
    short: "0–100: Rang bei Dividendenrendite, Steigerungen in Folge und Ausschüttungsquote (niedriger ist besser) unter den Dividendenzahlern des Sektors.",
  },
  score_momentum: {
    group: "Scores", term: "Momentum-Score", wiki: "Gleitender Durchschnitt",
    short: "0–100: Rang bei Kursentwicklung 1 Jahr, Abstand zur 200-Tage-Linie und Abstand zum Jahreshoch im eigenen Sektor.",
  },
  magic_formula: {
    group: "Scores", term: "Magic Formula (Greenblatt)", wiki: "en:Magic formula investing",
    short: "0–100: Rang aus Gewinnrendite (EBIT ÷ Unternehmenswert) und Kapitalrendite – gute Firmen zu günstigen Preisen. Ohne Banken, Versicherungen und Versorger.",
    long: "Die Strategie von Joel Greenblatt („The Little Book That Beats the Market“, 2005) sortiert alle Aktien nach beiden Kennzahlen und addiert die Ränge. Hier über alle Aktien der Weltauswahl berechnet und auf 0–100 umgerechnet.",
  },
  perzentil: {
    group: "Scores", term: "Rang in Prozent (Perzentil)", wiki: "Quantil (Wahrscheinlichkeitstheorie)",
    short: "80 bedeutet: 80 % der verglichenen Aktien schneiden bei dieser Kennzahl schlechter ab.",
  },
  scorecard: {
    group: "Scores", term: "Scorecard (Strategie-Scores 1–10)",
    short: "Drei Scores von 1 bis 10 dafür, wie gut eine Aktie zu den Strategien Dividendenertrag, Dividendenwachstum und Gewinnwachstum passt.",
    long: "Jedes Kriterium wird innerhalb einer festen Bandbreite eingeordnet; das Kernkriterium der Strategie bremst den Score, wenn es schwach ausfällt. Die Scorecard bewertet die Aktie absolut, die Scores der Weltauswahl dagegen im Vergleich zum Sektor.",
  },

  // ---- Allgemein
  sektor: {
    group: "Allgemein", term: "Sektor", wiki: "Global Industry Classification Standard",
    short: "Grobe Einteilung der Wirtschaft in 11 Bereiche, z. B. Informationstechnologie oder Gesundheitswesen.",
  },
  branche: {
    group: "Allgemein", term: "Branche", wiki: "Global Industry Classification Standard",
    short: "Feinere Einteilung innerhalb eines Sektors, z. B. Halbleiter innerhalb der Informationstechnologie (rund 145 Branchen).",
  },
  thema: {
    group: "Allgemein", term: "Anlagethema",
    short: "Themen wie KI oder Robotik liegen quer zu Sektoren und Branchen. Die Zuordnung stammt aus einer frei bearbeitbaren Liste (themes.json), ergänzt um passende Branchen und Schlagworte im Firmennamen.",
  },
  bilanzwaehrung: {
    group: "Allgemein", term: "Bilanzwährung",
    short: "Währung, in der eine Firma ihre Abschlüsse erstellt. Kann von der Kurswährung abweichen (z. B. Shell: Bilanz in US-Dollar, Kurs in Pence).",
  },
  esef: {
    group: "Allgemein", term: "ESEF-Jahresberichte", wiki: "European Single Electronic Format",
    short: "Seit 2020 müssen Firmen an EU-Börsen ihre Konzernabschlüsse maschinenlesbar veröffentlichen. Das Tool liest sie kostenlos über filings.xbrl.org.",
    long: "Jeder Bericht enthält auch das Vorjahr; zusammen mit Yahoo ergeben sich so meist 6 und mehr Geschäftsjahre statt 4. Abgedeckt sind u. a. Frankreich, die Niederlande, Italien, Spanien, Skandinavien, Österreich, Belgien, Polen und Großbritannien, nicht aber Deutschland und Irland (dort nur im Unternehmensregister ohne freie Schnittstelle).",
  },
  tiefenanalyse: {
    group: "Allgemein", term: "Tiefenanalyse",
    short: "Im Hintergrund berechnet das Tool für jede Aktie der Weltauswahl das vollständige Profil (Gewinnstabilität, fairer Wert, Scorecard …), damit sich danach filtern lässt.",
    long: "Je Aktie sind rund zehn Abfragen nötig; damit Yahoo nicht drosselt, arbeitet der Lauf eine Aktie nach der anderen ab (größte zuerst) und braucht für die ganze Weltauswahl einige Stunden. Ergebnisse gelten eine Woche. Der Lauf setzt nach einem Neustart fort und lässt sich in der Weltauswahl pausieren.",
  },
  rangkorrelation: {
    group: "Scores", term: "Rangkorrelation (Spearman)", wiki: "Rangkorrelationskoeffizient",
    short: "Wie gut die Reihenfolge nach Score zur Reihenfolge nach Rendite passt: +1 perfekt, 0 kein Zusammenhang, −1 umgekehrt.",
    long: "In der Praxis gelten schon Werte von 0,05 bis 0,1 über viele Zeiträume als nützlich; einzelne Zeiträume schwanken stark.",
  },
  roic: {
    group: "Rentabilität", term: "Kapitalrendite (ROIC)", wiki: "Return on Invested Capital",
    short: "Operativer Gewinn nach Steuern ÷ eingesetztes Kapital (Eigenkapital + Schulden − Kasse). Zeigt, wie viel ein Unternehmen mit jedem investierten Euro verdient.",
    long: "Dauerhaft über rund 15 % gilt als Zeichen eines Burggrabens (Marke, Netzwerkeffekt, Patente). Unter den Kapitalkosten von etwa 8 % vernichtet Wachstum sogar Wert. Grundlage sind die letzten rund 4 Yahoo-Jahresabschlüsse; bei Banken und Versicherungen ist die Kennzahl nicht sinnvoll.",
  },
  piotroski: {
    group: "Bilanz & Risiko", term: "Piotroski F-Score", wiki: "Piotroski F-Score",
    short: "Neun Ja/Nein-Prüfungen der Bilanzqualität (Gewinn, Cashflow, Schulden, Liquidität, Verwässerung, Marge, Umschlag). 8–9 gilt als stark, 0–2 als schwach.",
    long: "Entwickelt von Joseph Piotroski (2000), um unter günstig bewerteten Aktien die finanziell gesunden herauszufiltern. Verglichen wird das letzte mit dem vorletzten Geschäftsjahr. Fehlen Angaben, zählt das Tool nur die prüfbaren Punkte und zeigt unter 7 prüfbaren Punkten keinen Score.",
  },
  aktienrueckkauf: {
    group: "Bilanz & Risiko", term: "Aktienzahl pro Jahr (Rückkäufe)", wiki: "Aktienrückkauf",
    short: "Wie sich die Zahl der Aktien jährlich verändert. Negativ heißt Rückkäufe: Jeder Aktionär besitzt danach einen größeren Teil der Firma.",
    long: "Positive Werte bedeuten Verwässerung durch neue Aktien, etwa für Mitarbeiterprogramme, Übernahmen oder Kapitalerhöhungen. Gerechnet wird mit der durchschnittlichen verwässerten Aktienzahl der Geschäftsjahre.",
  },
  fcf_rendite: {
    group: "Bewertung", term: "Free-Cashflow-Rendite", wiki: "Free Cashflow",
    short: "Free Cashflow je Aktie ÷ Kurs: So viel frei verfügbares Geld erwirtschaftet die Firma im Verhältnis zum Kaufpreis (Kehrwert des Kurs-FCF-Verhältnisses).",
  },
  revisionen: {
    group: "Kurs & Markt", term: "Revisionen der Gewinnschätzungen",
    short: "Wie sich die durchschnittliche Gewinnschätzung der Analysten in den letzten 30 bzw. 90 Tagen verändert hat.",
    long: "Steigende Schätzungen gehören zu den am besten belegten Signalen für die Kursentwicklung der folgenden Monate: Die Analysten passen ihre Erwartungen meist schrittweise an, der Kurs folgt mit Verzögerung.",
  },
  gewinnueberraschung: {
    group: "Kurs & Markt", term: "Gewinnüberraschung",
    short: "Abweichung des gemeldeten Quartalsgewinns von der durchschnittlichen Analystenerwartung. Firmen, die die Erwartungen regelmäßig übertreffen, sind oft konservativ geführt.",
  },
  insider: {
    group: "Kurs & Markt", term: "Insidergeschäfte", wiki: "Directors’ Dealings",
    short: "Käufe und Verkäufe von Vorständen, Aufsichtsräten und Großaktionären. Käufe mit eigenem Geld gelten als starkes Vertrauenssignal; Verkäufe haben oft private Gründe.",
  },
  leerverkauf: {
    group: "Kurs & Markt", term: "Leerverkäufer (Netto-Leerverkaufspositionen)", wiki: "Leerverkauf",
    short: "Investoren, die auf fallende Kurse setzen. Positionen ab 0,5 % der Aktien müssen veröffentlicht werden (Bundesanzeiger).",
    long: "Hohe Leerverkaufsquoten (über rund 5 %) zeigen, dass professionelle Investoren Probleme erwarten. Steigt der Kurs dennoch, müssen sie Aktien zurückkaufen, was den Anstieg verstärken kann (Short Squeeze).",
  },
  momentum_12_1: {
    group: "Kurs & Markt", term: "Momentum 12-1", wiki: "Momentum (Finanzmarkt)",
    short: "Kursentwicklung der letzten 12 Monate ohne den jüngsten Monat. In der Forschung schneiden Aktien mit hohem 12-1-Momentum im Schnitt auch in den Folgemonaten besser ab.",
    long: "Der letzte Monat wird ausgelassen, weil Kurse kurzfristig zur Gegenbewegung neigen. Momentum wirkt über Monate, kann aber abrupt drehen (z. B. bei Marktwenden).",
  },
  erwartete_rendite: {
    group: "Bewertung", term: "Erwartete Rendite",
    short: "Modellrechnung: Rendite pro Jahr, wenn die Kennzahl 5 Jahre mit dem erwarteten Wachstum steigt und das KGV (bzw. KCV) zu seinem Durchschnitt zurückkehrt, plus Dividende.",
    long: "Das Wachstum ist das Mittel aus Analystenerwartung (2 Jahre) und eigener Historie, begrenzt auf −10 % bis +15 % pro Jahr. Die Rechnung zeigt, welche Rendite aus heutiger Sicht plausibel ist, wenn sich die Firma wie bisher entwickelt – keine Prognose.",
  },
  reverse_dcf: {
    group: "Bewertung", term: "Reverse-DCF", wiki: "Discounted-Cashflow-Verfahren",
    short: "Umgekehrtes Discounted-Cashflow-Modell: Welches Wachstum des Free Cashflows muss eintreten, damit der heutige Kurs bei einer geforderten Rendite gerechtfertigt ist?",
    long: "Gerechnet wird mit 10 Jahren Wachstum und danach 2,5 % pro Jahr. Liegt das eingepreiste Wachstum deutlich über dem bisherigen und dem erwarteten, steckt viel Optimismus im Kurs; liegt es darunter, ist die Aktie eher günstig. Die geforderte Rendite (8–10 %) entspricht der Rendite, die Anleger für das Risiko verlangen.",
  },
  normalisierter_gewinn: {
    group: "Bewertung", term: "Normalisierter Gewinn", wiki: "Shiller-KGV",
    short: "Durchschnitt des Gewinns je Aktie der letzten 5 Geschäftsjahre. Ersetzt bei zyklischen Firmen den stark schwankenden Jahresgewinn, wie beim Shiller-KGV.",
    long: "Zykliker (Chemie, Stahl, Autos, Rohstoffe) haben im Boom niedrige KGVs und im Abschwung hohe; ein KGV-Vergleich führt dann leicht in Value-Fallen. Das Tool nimmt den normalisierten Gewinn, wenn die Gewinnstabilität unter 0,5 liegt, mindestens 8 Jahreswerte vorliegen und der Durchschnitt deutlich gleichmäßiger verläuft.",
  },
  quellensteuer: {
    group: "Dividende", term: "Dividende nach Steuern (Quellensteuer)", wiki: "Quellensteuer",
    short: "Dividendenrendite nach ausländischer Quellensteuer und deutscher Abgeltungsteuer (25 % plus Soli, ohne Kirchensteuer und Freibetrag).",
    long: "Viele Länder behalten auf Dividenden eine Quellensteuer ein. Bis zum Satz des Doppelbesteuerungsabkommens (meist 15 %) wird sie auf die deutsche Abgeltungsteuer angerechnet; was darüber liegt (Schweiz 35 % − 15 % = 20 %), ist nur per Antrag im Ausland zurückzuholen. Die Sätze stehen in quellensteuer.json und lassen sich anpassen; Angaben ohne Gewähr.",
  },
};

export const wikiUrl = (wiki) => {
  const [lang, title] = wiki.startsWith("en:") ? ["en", wiki.slice(3)] : ["de", wiki];
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
};

// Begriff mit Tooltip: <span data-term="kgv">KGV</span>
export function term(key, label) {
  const t = TERMS[key];
  if (!t) return label ?? key;
  return `<span class="term" data-term="${key}" tabindex="0">${label ?? esc(t.term)}</span>`;
}

// ---- Ein gemeinsamer Tooltip für alle Begriffe (Maus, Tastatur, Touch)
let tip;
let current;
let hideTimer;

function show(el) {
  const t = TERMS[el.dataset.term];
  if (!t) return;
  clearTimeout(hideTimer);
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "term-tip";
    tip.className = "term-tip";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
    tip.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    tip.addEventListener("mouseleave", () => hide());
    tip.addEventListener("click", (e) => { if (e.target.closest("a")) hide(true); });
  }
  if (current && current !== el) current.removeAttribute("aria-describedby");
  current = el;
  el.setAttribute("aria-describedby", "term-tip");
  tip.innerHTML = `<strong>${esc(t.term)}</strong><p>${esc(t.short)}</p>
    <div class="tip-links"><a href="#/lexikon?begriff=${el.dataset.term}">Mehr im Lexikon</a>
    ${t.wiki ? `<a href="${wikiUrl(t.wiki)}" target="_blank" rel="noopener">Wikipedia ↗</a>` : ""}</div>`;
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const w = Math.min(320, window.innerWidth - 16);
  tip.style.width = `${w}px`;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  tip.style.left = `${left + window.scrollX}px`;
  const below = r.bottom + 8;
  const h = tip.offsetHeight;
  const top = below + h > window.innerHeight - 8 && r.top - h - 8 > 0 ? r.top - h - 8 : below;
  tip.style.top = `${top + window.scrollY}px`;
}

function hide(now = false) {
  clearTimeout(hideTimer);
  const run = () => {
    if (tip) tip.hidden = true;
    current?.removeAttribute("aria-describedby");
    current = null;
  };
  if (now) run(); else hideTimer = setTimeout(run, 200);
}

export function initTooltips() {
  let showTimer;
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest?.("[data-term]");
    if (!el) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(el), 250);
  });
  document.addEventListener("mouseout", (e) => {
    const el = e.target.closest?.("[data-term]");
    if (!el || el.contains(e.relatedTarget)) return;
    clearTimeout(showTimer);
    hide();
  });
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest?.("[data-term]");
    if (el) show(el);
    else if (!tip?.contains(e.target)) hide(true);
  });
  // Touch: Tippen auf einen Begriff zeigt die Erklärung (Tippen auf Spaltenköpfe sortiert zusätzlich)
  document.addEventListener("click", (e) => {
    const el = e.target.closest?.("[data-term]");
    if (el) show(el);
    else if (!tip?.contains(e.target)) hide(true);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && current) hide(true); });
  window.addEventListener("hashchange", () => hide(true));
}
