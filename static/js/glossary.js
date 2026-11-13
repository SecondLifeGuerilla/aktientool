// Lexikon: Erklärungen für Fachbegriffe. `short` erscheint im Tooltip, `long` zusätzlich im Lexikon.
// `wiki`: Wikipedia-Artikel (deutsch, "en:" für englisch), aus dem sich eine Zusammenfassung nachladen lässt.
import { escapeHtml as esc } from "./format.js";

export const GROUPS = ["Bewertung", "Rentabilität", "Wachstum", "Dividende", "Bilanz & Risiko", "Kurs & Markt", "Scores", "Trusts & Holdings", "Hebelprodukte", "Allgemein"];

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
  operative_marge: {
    group: "Rentabilität", term: "Operative Marge (EBIT-Marge)", wiki: "EBIT",
    short: "Operativer Gewinn ÷ Umsatz: was das Kerngeschäft vor Zinsen und Steuern verdient.",
    long: "Steigt die operative Marge mit dem Umsatz, wachsen die Kosten langsamer als das Geschäft (Skaleneffekte). Bei Firmen in der Verlustphase ist das das wichtigste Zeichen, dass sie sich der Gewinnschwelle nähern.",
  },
  fcf_marge: {
    group: "Rentabilität", term: "Free-Cashflow-Marge", wiki: "Cashflow",
    short: "Free Cashflow ÷ Umsatz: wie viel vom Umsatz als frei verfügbares Geld übrig bleibt. Negativ heißt: Das Geschäft verbraucht Geld.",
  },
  fe_quote: {
    group: "Rentabilität", term: "F&E-Quote", wiki: "Forschung und Entwicklung",
    short: "Aufwand für Forschung und Entwicklung ÷ Umsatz. Hoch bei Technologie- und Pharmafirmen.",
    long: "Eine hohe F&E-Quote drückt heute den Gewinn, kann aber künftiges Wachstum sichern. Sinkt sie, während der Umsatz wächst, verteilen sich die Entwicklungskosten auf mehr Umsatz.",
  },

  // ---- Wachstum
  umsatzwachstum: {
    group: "Wachstum", term: "Umsatzwachstum", wiki: "Wachstumsrate",
    short: "Umsatz der letzten 12 Monate gegenüber dem Vorjahreszeitraum.",
  },
  umsatzerwartung: {
    group: "Wachstum", term: "Umsatz- und Gewinnschätzungen", wiki: "Finanzanalyst",
    short: "Durchschnitt der Analystenschätzungen für Umsatz und Gewinn je Aktie im laufenden und nächsten Geschäftsjahr, mit der Spanne von der niedrigsten bis zur höchsten Schätzung (Quelle: Yahoo).",
    long: "Je weniger Analysten schätzen und je größer die Spanne, desto unsicherer ist die Prognose. Bei Firmen in der Verlustphase zeigen die Gewinnschätzungen, wann der Markt mit der Gewinnschwelle rechnet.",
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
    long: "Berechnet als Bestimmtheitsmaß R² einer Trendgeraden durch die Jahreswerte der letzten bis zu 11 Jahre, mit dem Vorzeichen der Steigung. Firmen mit stabil steigenden Gewinnen lassen sich zuverlässiger bewerten. War mindestens die Hälfte der Jahre ein Verlust, gibt es keinen Wert: Schrumpfende Verluste ergäben sonst eine steigende Trendlinie und damit eine scheinbar gute Stabilität.",
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
  nettoliquiditaet: {
    group: "Bilanz & Risiko", term: "Nettoliquidität / Nettoverschuldung", wiki: "Nettofinanzverschuldung",
    short: "Flüssige Mittel minus Finanzschulden. Positiv: mehr Geld als Schulden (Nettoliquidität), negativ: Nettoverschuldung. Stand nach dem letzten Quartal.",
  },
  eigenkapitalquote: {
    group: "Bilanz & Risiko", term: "Eigenkapitalquote", wiki: "Eigenkapitalquote",
    short: "Eigenkapital ÷ Bilanzsumme. Über 30 % gilt bei Industrie- und Technologiefirmen als solide; Banken und Versicherungen haben naturgemäß niedrige Quoten.",
  },
  cash_reichweite: {
    group: "Bilanz & Risiko", term: "Cash-Reichweite", wiki: "Cash Burn Rate",
    short: "Wie viele Jahre die flüssigen Mittel reichen, wenn der Free Cashflow so negativ bleibt wie in den letzten 12 Monaten. Unter 2 Jahren wird meist bald neues Geld nötig.",
    long: "Rechnerischer Wert: Kasse ÷ Mittelabfluss. Wachsende Umsätze und bessere Margen verlängern die Reichweite. Reicht sie nicht, folgen oft Kredite oder Kapitalerhöhungen; Kapitalerhöhungen verwässern die bisherigen Aktionäre.",
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
  aktionaersstruktur: {
    group: "Kurs & Markt", term: "Aktionärsstruktur", wiki: "Streubesitz",
    short: "Anteil der Aktien bei Insidern (Gründer, Management, Großaktionäre) und bei institutionellen Anlegern (Fonds, Versicherungen, Pensionskassen). Quelle: Yahoo.",
    long: "Viel Insiderbesitz bindet das Management an den Erfolg der Aktionäre, kann aber auch bedeuten, dass wenige Großaktionäre das Sagen haben. Ein hoher Anteil institutioneller Anleger zeigt, dass professionelle Investoren die Firma beobachten.",
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
  trade_republic: {
    group: "Kurs & Markt", term: "Handelbar bei Trade Republic", wiki: "Lang & Schwarz",
    short: "Laut Handelsliste der LS Exchange (Lang & Schwarz), die jeden Börsentag neu erscheint. Trade Republic veröffentlicht keine eigene Liste.",
    long: "Trade Republic hat bis Ende Juni 2026 alle Aktienorders über die LS Exchange ausgeführt; seitdem vergleicht „Best Price“ zusätzlich andere Börsen. Die Liste der LS Exchange ist deshalb eine gute, aber keine amtliche Annäherung. Manche Firmen gibt es nur als ADR oder GDR (z. B. TSMC, Samsung); das Profil nennt dann die ISIN, unter der man sie in der App findet. Stimmt die Angabe einmal nicht, lässt sie sich im Profil korrigieren. Ob nur handelbare Aktien gezeigt werden, stellt der Schalter „nur Trade Republic“ in der Weltauswahl ein.",
  },

  // ---- Trusts & Holdings
  nav: {
    group: "Trusts & Holdings", term: "Innerer Wert (NAV, Net Asset Value)", wiki: "Nettoinventarwert",
    short: "Was alle Beteiligungen und sonstigen Vermögenswerte abzüglich Schulden wert sind, geteilt durch die Zahl der Aktien.",
    long: "Bei Investment Trusts und Closed-End-Fonds rechnet die Fondsgesellschaft den NAV meist täglich aus; das Tool übernimmt ihn von Morningstar bzw. der AIC (Stand Vortag). Holdings veröffentlichen ihn nur mit den Quartalsberichten. Das Tool rechnet ihn deshalb selbst: börsennotierte Beteiligungen zum aktuellen Kurs, nicht börsennotierte Beteiligungen, Kasse und Schulden mit den Werten aus dem letzten Bericht. Bei Private Equity, Immobilien und Infrastruktur ist der NAV eine Schätzung, die nur alle drei bis sechs Monate aktualisiert wird.",
  },
  abschlag_nav: {
    group: "Trusts & Holdings", term: "Abschlag / Aufschlag zum NAV", wiki: "Closed-End-Fonds",
    short: "Kurs ÷ NAV − 1. Negativ = Abschlag: Die Aktie kostet weniger, als die Beteiligungen wert sind. Positiv = Aufschlag.",
    long: "Bei −10 % zahlt man 90 € für 100 € Vermögen. Weil ein Trust (anders als ein ETF) keine Anteile zurücknimmt, bestimmt allein die Börse den Kurs; Abschläge von 5 bis 15 % sind normal, bei Holdings oft 20 bis 50 %. Der Abschlag bringt zusätzlichen Gewinn nur, wenn er kleiner wird, etwa durch Aktienrückkäufe, ein Übernahmeangebot oder bessere Stimmung; wird er größer, verliert man trotz steigendem NAV. Deshalb zählt vor allem der Vergleich mit dem üblichen Abschlag.",
  },
  ueblicher_abschlag: {
    group: "Trusts & Holdings", term: "Üblicher Abschlag und Einordnung",
    short: "Durchschnittlicher Abschlag der Vergangenheit (5, 3 oder 1 Jahr). „Günstiger als üblich“ heißt: heute mindestens 2 Prozentpunkte mehr Abschlag als im Schnitt.",
    long: "Für britische Trusts liefert die AIC den Durchschnitt über 1, 3 und 5 Jahre, das Tool nimmt den längsten. Für Londoner Fonds ohne AIC-Daten nimmt es den 12-Monats-Schnitt von Morningstar (erst nach dem Aufklappen bekannt). Für Fonds anderer Börsen und für Holdings gibt es keinen kostenlosen Durchschnitt; dort zählt nur der heutige Abschlag. Ein ungewöhnlich großer Abschlag kann eine Chance sein, aber auch auf Probleme hindeuten (Zweifel an Bewertungen, Schulden, Mittelabflüsse).",
  },
  closed_end_fonds: {
    group: "Trusts & Holdings", term: "Investment Trust / Closed-End-Fonds", wiki: "Closed-End-Fonds",
    short: "Börsennotierte Gesellschaft, die das Geld ihrer Aktionäre in andere Wertpapiere oder Firmen investiert, mit fester Zahl an Aktien.",
    long: "Anders als bei einem ETF oder offenen Fonds werden keine Anteile neu ausgegeben oder zurückgenommen, wenn Anleger kaufen oder verkaufen. Der Börsenkurs kann deshalb dauerhaft vom inneren Wert abweichen. Britische Investment Trusts (z. B. Scottish Mortgage, Polar Capital Technology) und US-Closed-End-Fonds sind die größten Gruppen; in Deutschland sind sie Aktien und werden auch so besteuert. Viele dürfen Kredite aufnehmen („Gearing“) und zahlen Dividenden aus Rücklagen.",
  },
  gearing: {
    group: "Trusts & Holdings", term: "Fremdkapital (Gearing)", wiki: "Leverage-Effekt",
    short: "Kredite eines Trusts in % seines Nettovermögens. 10 % heißt: Für je 100 € Eigenkapital sind 110 € angelegt.",
    long: "Gearing verstärkt Gewinne und Verluste: Steigt das Portfolio um 10 %, steigt der NAV bei 10 % Gearing um rund 11 % (abzüglich Zinsen); fällt es, fällt der NAV stärker. Negative Werte bedeuten, dass der Trust Kasse hält.",
  },
  laufende_kosten: {
    group: "Trusts & Holdings", term: "Laufende Kosten (Ongoing Charge)", wiki: "Total Expense Ratio",
    short: "Jährliche Verwaltungskosten in % des NAV, ohne Erfolgsgebühren. Sie mindern die Rendite jedes Jahr.",
    long: "Bei aktiv verwalteten Trusts sind 0,5 bis 1 % üblich, bei Spezialthemen und Private Equity deutlich mehr. Ein Trust mit 1,5 % Kosten muss jedes Jahr 1,5 Prozentpunkte besser sein als ein ETF für 0,2 %, um mitzuhalten. Ein dauerhafter Abschlag gleicht hohe Kosten teilweise aus, weil man weniger als den NAV bezahlt.",
  },

  // ---- Scores
  score_gesamt: {
    group: "Scores", term: "Gesamt-Score", wiki: "Value Investing",
    short: "0–100: Mittel aus Qualitäts-, Bewertungs-, Wachstums-, Momentum- und Beständigkeits-Score. Hoch = profitable, vernünftig bewertete, wachsende Firma mit intaktem Kurstrend und verlässlichen Gewinnen.",
    long: "Jeder Teil-Score vergleicht die Aktie mit allen Aktien desselben Sektors der Weltauswahl. Die Beständigkeit bremst Firmen, die nur auf dem Hoch eines Zyklus glänzen. Der Gesamt-Score ist ein Startpunkt für die eigene Recherche, keine Kaufempfehlung: Er kennt weder die Zukunftsaussichten noch Sondereffekte in den Zahlen.",
  },
  score_bestaendigkeit: {
    group: "Scores", term: "Beständigkeits-Score", wiki: "Bestimmtheitsmaß",
    short: "0–100: Rang bei Gewinnstabilität über viele Jahre und durchschnittlicher Kapitalrendite (ROIC, bis 4 Jahre) im eigenen Sektor.",
    long: "Ölkonzerne, Chiphersteller oder Reedereien haben auf dem Hoch ihres Zyklus zugleich hohe Margen, ein niedriges KGV, starkes Wachstum und einen steigenden Kurs. Die Beständigkeit fragt, ob das über Jahre so war. Gewinnstabilität aus weniger als fünf Jahren Bilanzdaten zählt höchstens neutral; fehlt die Tiefenanalyse noch, bleibt der Score leer und der Gesamt-Score nutzt die übrigen vier.",
  },
  kauf_checkliste: {
    group: "Scores", term: "Kauf-Checkliste",
    short: "Die Prüfungen aus dem Tutorial in einer Zahl: so viele Punkte zu Datenbasis, Qualität, Preis, Rückenwind und Ihrer Strategie erfüllt die Aktie.",
    long: "Geprüft werden unter anderem: mindestens 5 Jahre Bilanzdaten, Gewinnstabilität ab 0,75, Gewinnwachstum ab 6 % pro Jahr, Kapitalrendite ab 8 %, Kurs höchstens 10 % über dem fairen Wert, erwartete Rendite ab 8 %, keine Warnung vor einer Value-Falle, Scorecard Ihrer Strategie ab 7. „9/11“ heißt: 9 von 11 prüfbaren Punkten erfüllt. Punkte ohne Daten zählen nicht mit; die nicht erfüllten zeigt der Tooltip in der Tabelle, die ganze Liste das Profil unter „Kauf-Checkliste für diese Aktie“. Die Strategie wählen Sie in der Weltauswahl neben den Vorlagen oder im Tutorial.",
  },
  rendite_vorsichtig: {
    group: "Bewertung", term: "Erwartete Rendite, vorsichtig gerechnet",
    short: "Wie die erwartete Rendite, aber mit der niedrigeren Wachstumsannahme (Analysten oder Historie) und ohne dass die Aktie wieder so hoch bewertet wird wie früher.",
    long: "Das Modell rechnet damit, dass das KGV (bzw. KCV) zu seinem Durchschnitt zurückkehrt und der Gewinn mit dem Mittel aus Analystenerwartung und Historie wächst. Beides kann ausbleiben, gerade bei Aktien, die stark gefallen sind. Die vorsichtige Variante lässt das Multiple, wo es heute steht (liegt es über dem Durchschnitt, fällt es dorthin zurück), und nimmt die niedrigere der beiden Wachstumsquellen. Übrig bleiben Wachstum plus Dividende. Liegen beide Werte weit auseinander, hängt die Rendite an der Bewertungsaufholung.",
  },
  value_falle: {
    group: "Bewertung", term: "Value-Falle und Warnzeichen", wiki: "Value Investing",
    short: "Eine Aktie, die gemessen an ihrer Vergangenheit billig aussieht, es aber zu Recht ist, weil das Wachstum abbricht.",
    long: "Der faire Wert schreibt die Vergangenheit fort. Drei Warnzeichen prüfen, ob das noch trägt: (1) Analysten erwarten sinkende Gewinne oder weniger als die Hälfte des bisherigen Wachstums, (2) die Gewinnschätzungen wurden in 90 Tagen um mindestens 3 % gesenkt, (3) der Kurs liegt unter der 200-Tage-Linie und das Momentum 12-1 ist negativ. Liegt der Kurs mindestens 10 % unter dem fairen Wert und treffen zwei Warnzeichen zu, markiert das Tool die Aktie als mögliche Value-Falle. Das ist kein Urteil, sondern die Aufforderung, den Grund für den niedrigen Kurs zu verstehen.",
  },
  datenjahre: {
    group: "Allgemein", term: "Datenjahre",
    short: "So viele Jahre reicht die Gewinnreihe zurück, aus der Stabilität, Wachstum und fairer Wert berechnet sind. Dahinter die Quelle: SEC (US-Pflichtberichte), ESEF (europäische Jahresberichte) oder Yahoo.",
    long: "Yahoo liefert kostenlos nur drei bis vier Jahre. Für US-Firmen und ausländische Firmen mit US-Listing kommen die Pflichtberichte der SEC dazu (oft 15 Jahre), für viele europäische Firmen die ESEF-Berichte ab 2020. Unter fünf Jahren gelten Gewinnstabilität und -wachstum als nicht belastbar: Filter „mindestens …“ erfüllen solche Aktien nicht, die Scorecard zählt sie höchstens neutral, und einen fairen Wert mit Einordnung gibt es nicht.",
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
    long: "Angezeigt wird trotzdem alles in Euro: Kurse, Renditen und das Allzeithoch zum Wechselkurs des jeweiligen Tages (wie ein Euro-Chart beim Broker), Gewinn, Umsatz und Dividende je Jahr zum heutigen Wechselkurs. So bleiben die Wachstumsraten frei von Währungsschwankungen. Intern rechnet das Tool Bewertung, Momentum und Scores in der Originalwährung, damit sie mit der Weltauswahl übereinstimmen.",
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

  // ---- Hebelprodukte (Call/Put-Rechner)
  optionsschein: {
    group: "Hebelprodukte", term: "Optionsschein (Call/Put)", wiki: "Optionsschein",
    short: "Ein Call gewinnt, wenn die Aktie steigt, ein Put, wenn sie fällt – mit Hebel. Bei Fälligkeit zählt nur, wie weit die Aktie über (Call) bzw. unter (Put) dem Basispreis steht.",
    long: "Vor der Fälligkeit enthält der Preis zusätzlich einen Zeitwert: die Chance, dass sich die Aktie bis dahin noch günstig bewegt. Dieser Zeitwert schmilzt Tag für Tag ab, am schnellsten in den letzten Wochen. Steht die Aktie bei Fälligkeit unter dem Basispreis (Call) bzw. darüber (Put), verfällt der Schein wertlos. Der Rechner bewertet Optionsscheine mit dem Black-Scholes-Modell, das auch die Emittenten verwenden.",
  },
  knockout: {
    group: "Hebelprodukte", term: "Knock-out-Produkt (Turbo, Mini-Future)", wiki: "Knock-out-Zertifikat",
    short: "Hebelprodukt ohne Zeitwert: Der Wert ist (Aktienkurs − Basispreis) × Bezugsverhältnis beim Call, umgekehrt beim Put. Berührt die Aktie die Knock-out-Schwelle, ist das Produkt sofort (fast) wertlos.",
    long: "Bei Turbos liegt die Schwelle auf dem Basispreis, dann bleibt nach dem Knock-out nichts übrig. Bei Mini-Futures liegt sie etwas davor; dann wird ein kleiner Restwert ausgezahlt. Wichtig: Schon eine kurze Berührung der Schwelle, auch nachbörslich, beendet das Produkt – selbst wenn die Aktie danach wieder dreht. Die meisten Knock-outs laufen unbegrenzt; dafür verschiebt der Emittent den Basispreis täglich um Finanzierungskosten, die der Rechner nicht berücksichtigt.",
  },
  basispreis: {
    group: "Hebelprodukte", term: "Basispreis (Strike)", wiki: "Ausübungspreis",
    short: "Der Aktienkurs, ab dem ein Call (darüber) oder Put (darunter) bei Fälligkeit bzw. beim Knock-out-Produkt einen inneren Wert hat.",
    long: "Beim Optionsschein entscheidet der Basispreis über Chance und Risiko: Ein Basispreis weit über dem Kurs (Call) macht den Schein billig und stark gehebelt, aber die Aktie muss bis zur Fälligkeit weit steigen. Beim Knock-out-Produkt bestimmt der Abstand zwischen Kurs und Basispreis den Hebel.",
  },
  bezugsverhaeltnis: {
    group: "Hebelprodukte", term: "Bezugsverhältnis", wiki: "Bezugsverhältnis",
    short: "Auf wie viele Aktien sich ein Schein bezieht. 0,1 heißt: 10 Scheine entsprechen einer Aktie; der Schein bewegt sich dann um 10 Cent, wenn die Aktie um 1 € steigt (bei einem Hebel ohne Zeitwert).",
    long: "Steht im Produktdatenblatt oft als „10:1“ (= 0,1) oder „100:1“ (= 0,01). Der Rechner versteht beide Schreibweisen. Das Bezugsverhältnis ändert nicht den Hebel, nur den Preis je Schein.",
  },
  implizite_volatilitaet: {
    group: "Hebelprodukte", term: "Volatilität (historisch und implizit)", wiki: "Implizite Volatilität",
    short: "Wie stark eine Aktie schwankt, als Prozent pro Jahr. Je höher, desto teurer der Optionsschein, weil große Kurssprünge wahrscheinlicher sind.",
    long: "Die historische Volatilität misst die Schwankung der vergangenen Tage (der Rechner zeigt 1 Jahr und 3 Monate). Die implizite Volatilität ist die Schwankung, die im Preis eines Optionsscheins steckt; der Rechner bestimmt sie, wenn Sie den aktuellen Preis des Scheins eingeben. Ändert der Emittent die implizite Volatilität (etwa nach Quartalszahlen), ändert sich der Preis des Scheins auch bei gleichem Aktienkurs.",
  },
  omega: {
    group: "Hebelprodukte", term: "Hebel (Omega)", wiki: "Griechen (Finanzmathematik)",
    short: "Um wie viel Prozent sich das Produkt ungefähr bewegt, wenn die Aktie um 1 % steigt oder fällt. Hebel 8: Aktie +1 % → Produkt etwa +8 %, Aktie −1 % → etwa −8 %.",
    long: "Der Hebel gilt nur für kleine Bewegungen und ändert sich laufend: Steigt die Aktie, sinkt beim Call der Hebel, fällt sie, steigt er – bis zum Knock-out oder Wertlosverfall. Beim Optionsschein heißt der tatsächliche Hebel Omega; er berücksichtigt, dass der Schein nicht jede Aktienbewegung voll mitmacht.",
  },
  zeitwert: {
    group: "Hebelprodukte", term: "Zeitwert und Aufgeld", wiki: "Optionsschein",
    short: "Der Teil des Preises über dem inneren Wert. Beim Optionsschein schmilzt er bis zur Fälligkeit auf null ab; beim Knock-out-Produkt ist er klein (Spanne und Finanzierungskosten).",
    long: "Innerer Wert = (Aktienkurs − Basispreis) × Bezugsverhältnis beim Call, umgekehrt beim Put, mindestens null. Bewegt sich die Aktie nicht, verliert ein Optionsschein jeden Tag ein Stück seines Zeitwerts; der Rechner zeigt den Verlust pro Tag. Darum kann ein Call auch bei leicht gestiegener Aktie im Minus sein.",
  },
  spanne: {
    group: "Hebelprodukte", term: "Spanne (Spread)", wiki: "Geld-Brief-Spanne",
    short: "Abstand zwischen Brief (Kaufkurs) und Geld (Verkaufskurs) des Emittenten, in Prozent des Briefkurses. Um so viel liegt ein Produkt direkt nach dem Kauf im Minus.",
    long: "Bei Hebelprodukten stellt der Emittent beide Kurse selbst. Je kleiner die Spanne, desto günstiger: 1 % Spanne kostet bei jedem Kauf und Verkauf zusammen etwa 1 % des Einsatzes. Billige, weit aus dem Geld liegende Scheine haben oft große Spannen, weil der Emittent in festen Cent-Schritten quotiert. Abends und am Wochenende stellen manche Emittenten keinen Briefkurs.",
  },
  preischeck: {
    group: "Hebelprodukte", term: "Preis-Check (fairer Wert)", wiki: "Black-Scholes-Modell",
    short: "Wie viel teurer (oder günstiger) ein Hebelprodukt ist als sein fairer Wert – ganz ohne Meinung über die Aktie. +10 % heißt: Sie zahlen 10 % mehr, als das Produkt nach der bisherigen Schwankung der Aktie wert ist.",
    long: "Optionsschein: fairer Wert nach Black-Scholes mit der Schwankung der Aktie im letzten Jahr (einstellbar unter „Ihre Erwartung“). Liegt die implizite Volatilität des Scheins darüber, ist er teurer als fair; das ist bei Optionsscheinen üblich, weil die Emittenten daran verdienen und weil Puts weit unter dem Kurs als Absicherung gefragt sind. Unabhängig davon zeigt „ähnliche Scheine“, ob derselbe Schein bei anderen Emittenten billiger ist. Knock-out: fairer Wert ist der innere Wert; der Preis-Check zeigt, was Spanne und Aufgeld kosten. Bei Knock-outs mit Fälligkeit steckt der Zins bis dahin im Preis, fair ist dann der Terminwert: Ein Long kostet etwas mehr als den inneren Wert, ein Short etwas weniger. Bei hohem Hebel wirkt schon ein kleiner Unterschied stark.",
  },
  erwartung: {
    group: "Hebelprodukte", term: "Ihre Erwartung (Durchschnitt, Gewinnchance, Knock-out-Risiko)", wiki: "Log-Normalverteilung",
    short: "Sie sagen, wo die Aktie an einem Tag im Durchschnitt steht und wie stark sie schwankt. Der Rechner spielt alle dann möglichen Kurse durch: durchschnittliche Rendite des Produkts, Chance auf Gewinn, Risiko eines Verlusts über 50 % und beim Knock-out die Wahrscheinlichkeit, dass die Aktie die Schwelle unterwegs berührt.",
    long: "Die Kurse am Tag sind lognormal verteilt, ihr Durchschnitt ist Ihr Kurs, ihre Breite die Schwankung (voreingestellt: wie im letzten Jahr). Mit „±0“ ist das die neutrale Sicht: Ein fair bepreistes Produkt kommt dann im Durchschnitt auf etwa 0 %, ein teures liegt darunter. Hebelprodukte mit viel Hebel haben oft eine hohe Durchschnittsrendite bei kleiner Gewinnchance: wenige große Gewinne, viele Verluste. Das Knock-out-Risiko gilt für den Weg bis zu Ihrem Tag; Kurslücken über Nacht sind darin nicht enthalten.",
  },
  spanne_aktie: {
    group: "Hebelprodukte", term: "Spanne ÷ Hebel (Spanne auf die Aktie umgerechnet)", wiki: "Geld-Brief-Spanne",
    short: "Die Spanne geteilt durch den Hebel: So viel Prozent muss sich die Aktie in die richtige Richtung bewegen, bis die Spanne wieder drin ist. Damit lassen sich Produkte mit verschiedenem Hebel fair vergleichen.",
    long: "Ein Turbo mit Hebel 20 und 2 % Spanne kostet die Aktie 0,1 %, einer mit Hebel 5 und 1 % Spanne 0,2 % – der zweite ist trotz kleinerer Spanne teurer, gemessen an dem, was man an Aktienbewegung „kauft“. Andere Portale nennen das „homogenisierte Spanne“. Für die Kosten im Verhältnis zum Einsatz zählt dagegen die Spanne selbst.",
  },
  delta: {
    group: "Hebelprodukte", term: "Delta", wiki: "Griechen (Finanzmathematik)",
    short: "Um wie viel sich ein Optionsschein (je Aktie gerechnet) bewegt, wenn die Aktie um 1 Einheit steigt: beim Call zwischen 0 und 1, beim Put zwischen −1 und 0. Grob auch die Wahrscheinlichkeit, dass der Schein bei Fälligkeit im Geld liegt.",
    long: "Ein Call mit Delta 0,5 und Bezugsverhältnis 0,1 steigt um 5 Cent, wenn die Aktie um 1 € steigt. Weit im Geld liegt Delta nahe 1 (der Schein bewegt sich fast wie die Aktie), weit aus dem Geld nahe 0. Omega (der Hebel) ist Delta mal Aktienkurs geteilt durch den Preis des Scheins.",
  },
  gewinnschwelle: {
    group: "Hebelprodukte", term: "Gewinnschwelle (Break-even)", wiki: "Break-even",
    short: "Um wie viel Prozent sich die Aktie bewegen muss, damit sich der Kauf lohnt. Beim Optionsschein bei Fälligkeit (Basispreis plus Preis je Aktie), beim Knock-out sofort.",
    long: "Beim Optionsschein steckt im Preis der Zeitwert; bis zur Fälligkeit muss die Aktie ihn wieder hereinholen. Vorher kann der Schein schon bei einer kleineren Bewegung im Plus sein, weil er dann noch Zeitwert hat. Beim Knock-out liegt die Gewinnschwelle fast beim aktuellen Kurs; der Abstand zeigt, was Spanne und Aufgeld kosten.",
  },
  aehnliche: {
    group: "Hebelprodukte", term: "vs. ähnliche Scheine (Emittentenvergleich)", wiki: "Implizite Volatilität",
    short: "Wie teuer ein Optionsschein gegenüber Scheinen anderer Emittenten mit ähnlichem Basispreis (±7 %) und ähnlicher Laufzeit (±25 %) ist – gemessen an deren mittlerer impliziter Volatilität. Ganz ohne Annahme über die Aktie.",
    long: "Der Preis-Check vergleicht mit der bisherigen Schwankung der Aktie; die liegt aber oft unter der Volatilität, die alle Emittenten verlangen (vor allem weit aus dem Geld: das „Vola-Lächeln“). „vs. ähnliche“ fragt deshalb: Ist dieser Schein günstiger oder teurer als der Markt für genau diese Art Schein? −5 % heißt: 5 % billiger als bei den anderen. Gerechnet wird mit mindestens drei ähnlichen Scheinen aus der geladenen Liste.",
  },
  quanto: {
    group: "Hebelprodukte", term: "Quanto (währungsgesichert)", wiki: "Quanto",
    short: "Hebelprodukt auf eine ausländische Aktie, das zum festen Kurs 1 Einheit = 1 € abrechnet. Der Wechselkurs spielt dann keine Rolle.",
    long: "Bei einem normalen Call auf eine US-Aktie zählt der Gewinn in Dollar und wird zum aktuellen Kurs in Euro umgerechnet; fällt der Dollar, verliert der Schein. Ein Quanto-Produkt rechnet 1 Dollar als 1 Euro ab. Die Absicherung kostet etwas, sie steckt im Preis (beim Optionsschein) bzw. in den Finanzierungskosten (beim Knock-out).",
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
