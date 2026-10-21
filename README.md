# Aktientool

Lokales Analyse-Tool für Aktien nach dem Vorbild des [Aktienfinders](https://aktienfinder.net). Es läuft auf dem
eigenen Rechner im Browser und nutzt ausschließlich kostenlose Datenquellen ohne API-Key.

## Starten

```bash
.venv/bin/python -m pip install -r requirements.txt   # einmalig
.venv/bin/python run.py
```

Dann im Browser öffnen: <http://127.0.0.1:5050>. Beenden mit `Strg+C`.

## Was das Tool kann

**Aktien-Profil** (Suche oben nach Name oder Ticker; deutsche Aktien z. B. `ALV.DE`, Schweiz `NESN.SW`, London `ULVR.L`)

| Abschnitt | Inhalt |
| --- | --- |
| Kopf | Land, Sektor, Branche, Mitarbeiter, ISIN, Börsenwert, Kurs, Dividendenrendite, nächster Zahlentermin; Schaltflächen Watchlist, ＋ Depot, 🔔 Alarm, ⇄ Vergleichen |
| Scores & Nachrichten | Scores der Weltauswahl im Sektorvergleich, Anlagethemen; aktuelle Nachrichten deutsch (Google News) oder englisch (Yahoo Finance) |
| Qualität | Gewinnstabilität (0–1), Gewinnwachstum p. a., Analystenerwartung, Chart Gewinn je Aktie inkl. Prognose; Kapitalrendite (ROIC), Piotroski F-Score mit allen 9 Prüfpunkten, Aktienrückkäufe/Verwässerung, Free-Cashflow-Rendite |
| Signale | Revisionen der Gewinnschätzungen (30/90 Tage, Anhebungen/Senkungen), Gewinnüberraschungen der letzten Quartale, Insidergeschäfte (USA), Netto-Leerverkaufspositionen (Bundesanzeiger) |
| Kursentwicklung | Kurs, Total Return, 20/50/200-Tage-Linie, Zeiträume 1J–Max, log. Skala, Renditetabelle, Momentum (200 Tage und 12-1), Allzeithoch |
| Scorecard | Scores 1–10 für Dividendenertrag, Dividendenwachstum und Gewinnwachstum, je Kriterium mit Bandbreite |
| Bewertung | Stabilität von bilanziertem/bereinigtem Gewinn, operativem Cashflow, normalisiertem Gewinn und Umsatz; Verlauf von KGV, bereinigtem KGV, KCV, normalisiertem KGV und KUV mit Durchschnitt, umschaltbar (★ = Grundlage des fairen Werts) |
| Fairer Wert | Bewertungszeitraum 3/5/10 Jahre, Fair-Value-Linie, Prognosekorridor, Analysten-Kursziel, erwartete Rendite p. a., Reverse-DCF (eingepreistes Wachstum bei 8/9/10 % geforderter Rendite) |
| Dividende | Rendite, Wachstum, Stabilität, Ausschüttungsquote, Steigerungen in Folge, Rendite vs. Durchschnitt, Rendite nach Quellen- und Abgeltungsteuer, nächster Ex-Tag und Zahltag |
| Jahreswerte, Fazit | Alle Grunddaten als Tabelle mit Quelle; Zusammenfassung wie im Aktienfinder; eigene Notizen zur Aktie (Investment-These) |

**Weltauswahl** (`#/welt`): rund 6.000 Aktien ab 2 Mrd. € Börsenwert von den Börsen aus 47 Ländern. Die Liste ist
nicht fest hinterlegt, sondern wird live über den Yahoo-Screener geladen (ca. 20 Sekunden, danach einen Tag im Cache,
„aktualisieren“ lädt neu).

| Funktion | Inhalt |
| --- | --- |
| Filter | Kontinent, Land, Sektor, Branche, Anlagethema (Mehrfachauswahl mit Trefferzahlen), Suche nach Name/Ticker/ISIN, Mindest-Börsenwert |
| Kennzahl-Filter | beliebig viele Bedingungen „mindestens/höchstens“ auf jede Kennzahl und jeden Score; Vorlagen u. a. Stabil & unterbewertet, Hohe erwartete Rendite, Dividenden-Aristokraten, Dividendenwachstum, Bilanzstark, Rückkäufer mit Rückenwind, Attraktivste (Gesamt-Score), Magic Formula, Dividendenperlen |
| Tiefenanalyse | Gewinnstabilität, Gewinnwachstum, Kurs vs. fairer Wert, erwartete Rendite, Scorecard-Scores, Dividende netto, eigene Dividendensteigerungen, ROIC, Piotroski, Aktienzahl, Revisionen, Momentum 12-1, Reverse-DCF, FCF-Rendite für jede Aktie, im Hintergrund berechnet (siehe unten) |
| Scores (0–100) | Gesamt, Qualität, Bewertung, Wachstum, Momentum, Dividende, Magic Formula (Berechnung siehe Methodik) |
| Themen | Künstliche Intelligenz, Robotik & Automatisierung, Humanoide Robotik, Cybersecurity, Rechenzentren & Stromnetze, Elektromobilität & Batterien, Erneuerbare Energien, Rüstung & Verteidigung, Quantencomputing |
| Kennzahlen | Börsenwert, Umsatz, KGV, KGV erwartet, KBV, KUV, EV/EBITDA, PEG, Dividendenrendite, Dividendensteigerungen in Folge, Ausschüttungsquote, Eigen-/Gesamtkapitalrendite, Brutto-/EBITDA-/Nettomarge, Umsatz- und Gewinnwachstum, erwartetes Gewinnwachstum, Verschuldungsgrad, Nettoschulden/EBITDA, Altman-Z-Score, Beta, Kursentwicklung 1 Jahr, Momentum, Abstand zum Hoch, Analysten-Rating |
| Ansichten | Überblick, Scores, Bewertung, Rentabilität, Wachstum, Dividende, Qualität & fairer Wert, Signale, Bilanz & Risiko, Kurs & Analysten; Sortieren per Spaltenklick oder Auswahl |
| Weiter | Name öffnet das ausführliche Profil; „im Screener analysieren“ übergibt bis zu 50 Treffer an den Screener mit Scores |

Filter und Sortierung stehen in der Adresse (z. B. `#/welt?land=DE|AT|CH&sort=div_yield`) und lassen sich als
Lesezeichen speichern.

**Tiefenanalyse der Weltauswahl:** Damit sich alle rund 6.000 Aktien wie beim Aktienfinder nach Gewinnstabilität und
fairem Wert filtern lassen, berechnet das Tool im Hintergrund für jede Aktie das vollständige Profil. Das sind rund
zehn Abfragen je Aktie; damit Yahoo nicht drosselt, arbeitet der Lauf eine Aktie nach der anderen ab (größte zuerst,
etwa 4–5 Sekunden je Aktie, für die ganze Auswahl einige Stunden). Er startet automatisch, sobald der Server läuft,
speichert alle 25 Aktien, setzt nach einem Neustart fort und lässt sich in der Weltauswahl pausieren. Ein Ergebnis
gilt eine Woche. Abweichung vom fairen Wert und erwartete Rendite werden mit dem aktuellen Kurs neu berechnet. Aktien,
die noch nicht analysiert sind, fallen bei Filtern auf diese Kennzahlen heraus.

**Depot** (`#/depot`): Käufe mit Stückzahl, Kaufkurs (in der Kurswährung, Londoner Aktien in Pence) und Datum erfassen.
Wert und Gewinn/Verlust in Euro (Live-Kurse, aktuelle Wechselkurse), Dividenden pro Jahr brutto und nach Steuern,
Dividenden nach Monaten, Aufteilung nach Land, Sektor und Währung, Abweichung vom fairen Wert und Scorecard je Position,
nach Depotwert gewichtete Scores. Gespeichert in `data/depot.json`.

**Alarme** (`#/alarme`): Kurs fällt unter / steigt über eine Schwelle, Kurs mindestens x % unter dem fairen Wert,
Dividende gekürzt, Gesamt-Score fällt unter eine Schwelle. Geprüft wird alle 30 Minuten, solange der Server läuft
(„Jetzt prüfen“ sofort). Ausgelöste Alarme erscheinen als Zahl in der Kopfzeile und als macOS-Mitteilung, auf Wunsch
auch per E-Mail (siehe Einstellungen). Gespeichert in `data/alarme.json`.

**Termine** (`#/termine`): Quartalszahlen, Ex-Tage und Zahltage aller Aktien aus Watchlist und Depot, mit erwarteter
Dividende je Aktie und der Revision der Gewinnschätzung vor den Zahlen.

**Vergleich** (`#/vergleich?s=KO,PEP,NESN.SW`): bis zu vier Aktien nebeneinander mit rund 30 Kennzahlen (bester Wert
je Zeile hervorgehoben) und gemeinsamer Wertentwicklung inkl. Dividenden.

**Score-Check** (`#/score-check`): Die Weltauswahl speichert jeden Tag einen kompakten Stand (`data/snapshots/`,
rund 300 KB je Tag). Der Score-Check zeigt, wie sich die Aktien seit einem gewählten Tag entwickelt haben, aufgeteilt
in fünf Gruppen nach ihrem damaligen Score, dazu die Rangkorrelation. So lässt sich prüfen, ob ein Score tatsächlich
Rendite vorhersagt. Rückwirkend geht das mit kostenlosen Daten nicht, deshalb wird ab dem ersten Start gesammelt.

**Notizen**: Im Fazit jedes Profils lässt sich eine Investment-These festhalten (`data/notizen.json`).

**Anlagethemen** wie KI oder Robotik gibt es weder bei Yahoo noch in den Branchen-Klassifikationen. Die Zuordnung steht
in [`aktientool/themes.json`](aktientool/themes.json): eine redaktionelle Liste von Tickern je Thema, ergänzt um passende
Branchen (z. B. Solar) und Muster im Firmennamen (z. B. „Robot“). Die Datei lässt sich frei bearbeiten; Änderungen wirken
nach einem Neuladen der Seite, ohne die Börsen neu zu laden.

**Lexikon** (`#/lexikon`): Fachbegriffe sind im ganzen Tool gepunktet unterstrichen und zeigen beim Darüberfahren (oder
Antippen) eine Kurzerklärung mit Links ins Lexikon und zu Wikipedia. Im Lexikon lässt sich je Begriff die
Wikipedia-Zusammenfassung nachladen. Die Texte stehen in [`static/js/glossary.js`](static/js/glossary.js).

**Screener und Watchlist**: Kennzahlen für ganze Listen laden (DAX 40, Dow Jones 30, Qualitäts-Klassiker,
Watchlist oder eigene Tickerliste), filtern und nach Spalten bzw. Score sortieren. Die Vorlagen stehen in
[`aktientool/presets.json`](aktientool/presets.json) und lassen sich frei bearbeiten. Die Watchlist liegt in
`data/watchlist.json`.

## Datenquellen und Grenzen

| Quelle | Liefert | Reichweite |
| --- | --- | --- |
| Yahoo Finance (via `yfinance`) | Kurse, Dividenden, Splits, Stammdaten, Jahresabschlüsse, Analystenschätzungen und deren Revisionen, Gewinnüberraschungen, Insidergeschäfte (praktisch nur USA), Termine, Kursziele, Live-Kurse und Wechselkurse | Kurse/Dividenden jahrzehntelang, Abschlüsse nur ~4 Jahre |
| SEC EDGAR (XBRL „companyfacts“) | Gewinn je Aktie, Cashflow, Umsatz, Aktienzahl aus 10-K/20-F | ab ~2009, für US-Firmen und Firmen mit SEC-Berichten (z. B. SAP, ASML); gespeichert wird nur ein kompakter Auszug, 14 Tage |
| ESEF-Jahresberichte (filings.xbrl.org) und GLEIF | Gewinn je Aktie, Gewinn, Cashflow, Umsatz, Aktienzahl aus den offiziellen Konzernabschlüssen; ISIN → LEI über GLEIF | ab Geschäftsjahr ~2019, für Firmen mit Sitz u. a. in Frankreich, den Niederlanden, Italien, Spanien, Skandinavien, Österreich, Belgien, Polen, Großbritannien (nicht Deutschland, Irland, Schweiz); veröffentlichte Berichte bleiben dauerhaft im Cache |
| Bundesanzeiger (CSV) | Netto-Leerverkaufspositionen ab 0,5 % | Emittenten, für die die BaFin zuständig ist (vor allem deutsche Aktien), 12 Stunden im Cache |
| Yahoo-Screener (`/v1/finance/screener` und `/visualization`) | Weltauswahl: ganze Börsen mit Kurs, ISIN, Sektor, Branche und Kennzahlen der letzten 12 Monate | je Börse wenige Abfragen à 250 Aktien |
| Google News (RSS) und Yahoo Finance | Nachrichten im Profil (Suche nach Firmenname + „Aktie“ bzw. Ticker) | jeweils die neuesten rund 10 Meldungen, 30 Minuten im Cache |
| Wikipedia (REST-API) | Zusammenfassungen im Lexikon, Lizenz CC BY-SA | auf Klick, 7 Tage im Cache |

- **Weltauswahl, Heimatbörse und Land:** Yahoo führt alle Notierungen einer Firma (Heimatbörse, Zweitnotierungen,
  ADRs, BDRs, CDRs) unter derselben Kennung; zusätzlich wird über die ISIN zusammengeführt (z. B. NSE und BSE). Gezeigt
  wird die Heimatnotierung: ISIN-Land = Börsenland und nennenswerter Handel, US-ADRs ausländischer Firmen zählen
  nicht. Fehlt die Heimatnotierung im Screener (z. B. Allianz), wird der Ticker mit der Endung der Heimatbörse direkt
  nachgeladen. Das **Land** ist der rechtliche Sitz laut ISIN (Linde = Irland, Airbus = Niederlande), bei
  Offshore-Sitzen (Kaimaninseln, Bermuda, Jersey …) das Land der Heimatbörse; Festlandfirmen mit Bilanz in Renminbi
  (Tencent, Alibaba) zählen zu China. Vorzugsaktien mit fester Dividende und als Aktie geführte Anleihen fehlen.
- **Weltauswahl, Datenlücken:** Die Kennzahlen stammen aus Yahoos Screener und werden nicht nachgerechnet. Einzelne
  Werte können fehlen oder offensichtlich falsch sein; ein KGV unter 1 wird verworfen. Werte außerhalb plausibler
  Bereiche (Basiseffekte wie +1.432 % Gewinnwachstum nach einem Einbruch, Datenfehler wie eine Bruttomarge von
  −176.000 %) werden auf die Grenze gekappt und in der Tabelle als „≥“ bzw. „≤“ markiert, z. B. Wachstum −100 % bis
  +300 %, Margen −100 % bis +100 %, Ausschüttungsquote bis 300 %, Beta −2 bis 5 (alle Grenzen in `world.LIMITS`).
  Nettoschulden/EBITDA entfällt bei negativem EBITDA, der Verschuldungsgrad bei negativem Eigenkapital. „Dividendensteigerungen in
  Folge“ zählt höchstens rund 25 Jahre zurück (Coca-Cola: 23). Nicht abgedeckt sind u. a. Abu Dhabi, Ägypten,
  Philippinen und Russland.

- **Wichtigste Einschränkung:** Für Firmen ohne SEC- oder ESEF-Berichte (die meisten DAX-Werte, z. B. Allianz, BASF,
  sowie Schweizer und asiatische Firmen) gibt es kostenlos nur rund 4 Geschäftsjahre. Für deutsche Firmen liegen die
  ESEF-Berichte nur im Unternehmensregister, das keine freie Schnittstelle hat. Stabilität, Wachstum und historische Bewertung beziehen sich dann auf diesen
  kurzen Zeitraum. Das Profil zeigt einen Hinweis, der Screener markiert solche Werte mit „(4 J.)“. Weil so kurze
  Reihen leicht falsche Signale geben (BASF 2022–2025: Stabilität 0,92, +115 % Gewinnwachstum pro Jahr), zählen
  Stabilität und Wachstum unter 5 Jahren in der Scorecard höchstens neutral, und die Aktie wird nicht als über- oder
  unterbewertet eingeordnet (siehe Methodik).
- Bilanzwährung ≠ Kurswährung (z. B. ADRs, Londoner Kurse in Pence) wird zum Wechselkurs am Stichtag umgerechnet.
  Bei ADRs mit einem Bezugsverhältnis ungleich 1 können Werte je Aktie verzerrt sein.
- Den „bereinigten Gewinn“ gibt es nur von Yahoo (~4 Jahre). Bei langer SEC-Historie wird daher meist der
  bilanzierte Gewinn oder der operative Cashflow genutzt.
- Yahoo drosselt bei sehr vielen Abfragen. Der Screener lädt deshalb höchstens 3 Aktien parallel und wartet bei
  Drosselung. Alle Daten werden 6 Stunden im Ordner `data/cache` zwischengespeichert. „Aktualisieren“ im Profil
  lädt neu.

## Methodik

| Kennzahl | Berechnung |
| --- | --- |
| Stabilität (Gewinn, Cashflow, Dividende) | Bestimmtheitsmaß R² einer linearen Regression der Jahreswerte gegen die Zeit (letzte bis zu 11 Jahre), mit dem Vorzeichen der Steigung: 1 = perfekt steigend, negativ = fallend |
| Kurze Historie | Reihen über weniger als 5 Jahre (unter 6 Jahreswerten): Stabilität und Wachstum werden angezeigt, im Fazit aber „kaum beurteilbar“; in der Scorecard zählen sie höchstens zur Hälfte ihrer Bandbreite (schwache Werte zählen voll). Reicht die Bewertungsgrundlage weniger als 5 Jahre zurück, gibt es einen fairen Wert ohne Einordnung („unsicher (kurze Historie)“), und Zeiträume ohne zusätzliche Daten (10 Jahre bei 4 Jahren Historie) sind gesperrt |
| Wachstum p. a. | Regression der logarithmierten Jahreswerte; bei Verlustjahren Vergleich Ø erste 3 mit Ø letzte 3 Jahre |
| Bewertungskennzahl | die stabilste unter bilanziertem Gewinn, bereinigtem Gewinn und operativem Cashflow je Aktie. In Frage kommt nur eine überwiegend positive Kennzahl: positiv in den letzten 12 Monaten und im letzten Geschäftsjahr, in den letzten 5 Geschäftsjahren höchstens einmal negativ (bei 3 Jahren Historie nie), mindestens 2 Jahre Kursdaten bei positiver Kennzahl. Eine kürzere Reihe ersetzt keine längere (z. B. 4 Jahre bereinigter Gewinn statt 15 Jahre bilanzierter). Erfüllt keine Kennzahl die Regeln, gibt es keinen fairen Wert; die Kacheln im Profil nennen je Kennzahl den Grund |
| KGV/KCV-Historie | täglicher Kurs ÷ Kennzahl; die Kennzahl wird zwischen den Geschäftsjahresenden linear interpoliert, der jüngste Punkt sind die letzten 12 Monate |
| Ø Multiple | harmonisches Mittel der täglichen Multiples im Bewertungszeitraum (robust gegen Jahre mit Gewinneinbruch); nur Tage mit positiver und nicht eingebrochener Kennzahl (Kennzahl mindestens 60 % ihres Höchststands im Umkreis von ±1 Jahr; Verlust- und Erholungsjahre wie adidas 2023/24 fallen heraus, im Diagramm grau), mindestens rund 2 Jahre davon. Ist die Kennzahl aktuell selbst eingebrochen, wäre der faire Wert zu niedrig: Das Profil zeigt ihn mit Warnung, ordnet die Aktie aber nicht als über- oder unterbewertet ein (auch nicht in Screener und Scorecard) |
| KGV-/KCV-Verlauf | alle drei Kennzahlen umschaltbar, auch wenn nicht Bewertungsgrundlage; bei aktuellem Verlust endet der Verlauf, bei durchgehenden Verlusten ist die Schaltfläche gesperrt und begründet |
| Fairer Wert | Ø Multiple × Kennzahl der letzten 12 Monate; Einordnung: > +30 % stark überbewertet, > +10 % überbewertet, ±10 % fair, < −10 % unterbewertet, < −30 % stark unterbewertet (nicht bei eingebrochener Kennzahl oder kurzer Historie) |
| Prognose | letzter Jahreswert × erwartetes Gewinnwachstum der Analysten (laufendes und nächstes Geschäftsjahr, inkl. Spanne) |
| Momentum | Abstand des Kurses zur 200-Tage-Linie |
| Tilgungsjahre | Nettoverschuldung ÷ Free Cashflow (bei Banken/Versicherungen nicht berechnet) |
| Dividendenrendite | Dividenden der letzten 12 Monate ÷ Kurs; Vergleich mit dem 5- bzw. 10-Jahres-Durchschnitt |
| Scores der Weltauswahl (0–100) | je Kennzahl der Rang in Prozent innerhalb des Sektors (Sektoren unter 20 Werten: alle Aktien); Teil-Score = Mittel der Ränge, erneut als Rang im Sektor ausgedrückt (80 = besser als 80 % des Sektors). Qualität: Eigen- und Gesamtkapitalrendite, Netto- und EBITDA-Marge, Nettoschulden/EBITDA (niedriger besser). Bewertung: KGV, KGV erwartet, KBV, KUV, EV/EBITDA (jeweils niedriger besser). Wachstum: Umsatz-, Gewinn- und erwartetes Gewinnwachstum. Momentum: Kurs 1 Jahr, Abstand 200-Tage-Linie, Abstand zum Hoch. Dividende (nur Zahler): Rendite, Steigerungen in Folge, Ausschüttungsquote (niedriger besser). Mindestens die Hälfte der Kennzahlen muss vorliegen. Gesamt: Mittel aus Qualität, Bewertung, Wachstum und Momentum (mind. 3), als Rang über alle Aktien |
| Magic Formula | nach Greenblatt: Rang der Gewinnrendite (EBIT ÷ Unternehmenswert) plus Rang der Kapitalrendite, über alle Aktien ohne Finanzwerte und Versorger, als Rang 0–100 |
| Scorecard | jedes Kriterium linear auf 0–1 innerhalb seiner Bandbreite; Score = 1 + 9 × Mittelwert, gedämpft durch das Kernkriterium der Strategie (Rendite, Dividendenwachstum bzw. Gewinnwachstum), wenn es unter der Hälfte seiner Bandbreite liegt. Discount: Kurs 50 % über fairem Wert = 1, fair = 5,5, 50 % darunter = 10 |
| Normalisierter Gewinn (Zykliker) | Durchschnitt des Gewinns je Aktie der letzten 5 Geschäftsjahre (aktuell: letzte 4 Jahre + 12 Monate). Bewertungsgrundlage, wenn die beste Kennzahl eine Stabilität unter 0,5 hat, mindestens 8 Jahreswerte vorliegen und der Durchschnitt um mindestens 0,2 stabiler verläuft |
| KUV als Ersatz | Taugt weder Gewinn noch Cashflow (Regeln oben), wird über das Kurs-Umsatz-Verhältnis bewertet; ohne Analystenprognose |
| Erwartete Rendite | (Ø Multiple × Kennzahl × (1 + g)⁵ ÷ Kurs)^(1/5) − 1 + Dividendenrendite. g = Mittel aus Analystenwachstum (2 Jahre, aus den Schätzungen) und eigener Historie (bei kurzer Historie nur Analysten), begrenzt auf −10 % bis +15 % |
| Reverse-DCF | Wachstum des Free Cashflows je Aktie, bei dem der Barwert (10 Jahre Wachstum, danach 2,5 % ewig) dem Kurs entspricht; Basis Ø aus 12 Monaten und den 2 letzten Geschäftsjahren; geforderte Rendite 8/9/10 % |
| Kapitalrendite (ROIC) | EBIT × (1 − Steuersatz) ÷ Invested Capital laut Yahoo-Bilanz (Steuersatz ersatzweise 25 %); nicht bei Banken/Versicherungen |
| Piotroski F-Score | 9 Prüfpunkte, letztes vs. vorletztes Geschäftsjahr: Gesamtkapitalrendite > 0 und gestiegen, operativer Cashflow > 0 und > Gewinn, langfristige Schulden/Bilanzsumme gesunken, Liquidität 1. Grades gestiegen, keine neuen Aktien, Bruttomarge und Umsatz/Bilanzsumme gestiegen; Score nur ab 7 prüfbaren Punkten |
| Aktienzahl p. a. | jährliche Veränderung der verwässerten Ø-Aktienzahl über bis zu 10 Jahre (negativ = Rückkäufe) |
| Revisionen | Ø Gewinnschätzung heute vs. vor 30/90 Tagen (laufendes und nächstes Geschäftsjahr); Richtung „steigend“/„fallend“ nur, wenn die 30-Tage-Änderung und die Zahl der Anhebungen/Senkungen übereinstimmen |
| Momentum 12-1 | Kurs vor einem Monat ÷ Kurs vor 12 Monaten − 1 |
| Dividende nach Steuern | Quellensteuer + max(0, 25 % − anrechenbare Quellensteuer) × 1,055 (Soli); Sätze je Sitzland (ISIN) in [`aktientool/quellensteuer.json`](aktientool/quellensteuer.json), ohne Kirchensteuer und Sparerpauschbetrag |
| Score-Check | Kursrendite (ohne Dividenden) zwischen zwei Tagesständen je Fünftel nach Score; Rangkorrelation nach Spearman |

Die Werte weichen von denen des Aktienfinders ab, der kostenpflichtige Daten (FactSet, Morningstar) mit
30 Jahren Historie nutzt und seine genauen Formeln nicht veröffentlicht. Keine Anlageberatung.

## Einstellungen (Umgebungsvariablen)

| Variable | Standard | Zweck |
| --- | --- | --- |
| `AKTIENTOOL_PORT` | `5050` | Port des lokalen Servers |
| `AKTIENTOOL_SEC_USER_AGENT` | `Aktientool lokal aktientool@example.com` | Die SEC verlangt einen User-Agent mit Kontaktadresse; bitte eigene E-Mail eintragen |
| `AKTIENTOOL_TTL_YAHOO` | `21600` | Cache-Dauer der Yahoo-Daten in Sekunden |
| `AKTIENTOOL_DATA_DIR` | `./data` | Ort für Cache und Watchlist |
| `AKTIENTOOL_WELT_MIN_CAP` | `2e9` | Mindest-Börsenwert in Euro für die Weltauswahl (`2e9` ≈ 6.000 Aktien, `5e9` ≈ 3.200, `1e10` ≈ 1.900; kleinere Werte machen die Liste größer und den Aufbau langsamer) |
| `AKTIENTOOL_TTL_WELT` | `86400` | Cache-Dauer der Weltauswahl in Sekunden |
| `AKTIENTOOL_TIEFE_AUTO` | `1` | Tiefenanalyse automatisch starten (`0` = nur per Schaltfläche in der Weltauswahl) |
| `AKTIENTOOL_TIEFE_PAUSE` | `1.5` | Pause zwischen zwei Aktien der Tiefenanalyse in Sekunden (kleiner = schneller, aber eher gedrosselt) |
| `AKTIENTOOL_TTL_TIEFE` | `604800` | Gültigkeit eines Ergebnisses der Tiefenanalyse in Sekunden |
| `AKTIENTOOL_SNAPSHOT_DIR` | `./data/snapshots` | Ort der Tagesstände für den Score-Check |
| `AKTIENTOOL_ALARM_INTERVALL` | `1800` | Prüfabstand der Alarme in Sekunden |
| `AKTIENTOOL_MITTEILUNG` | `1` | macOS-Mitteilung bei ausgelösten Alarmen (`0` = aus) |
| `AKTIENTOOL_SMTP_HOST`, `_PORT`, `_USER`, `_PASSWORD`, `_TO` | – | Optional: Alarme zusätzlich per E-Mail über den eigenen SMTP-Zugang (STARTTLS, Port 587) |

## Aufbau

```
run.py                     Start
aktientool/
  server.py                Flask: Oberfläche + JSON-API (Profil, Weltauswahl, Depot, Notizen, Alarme, Kurse, Wechselkurse,
                           Tiefenanalyse, Tagesstände, Nachrichten, Lexikon)
  service.py               setzt alle Quellen zu einem Profil zusammen
  world.py                 Weltauswahl: Börsen laden, Notierungen zusammenführen, Land bestimmen, Aufbau im Hintergrund
  deep.py                  Tiefenanalyse der Weltauswahl im Hintergrund (fortsetzbar)
  snapshots.py             Tagesstände der Weltauswahl und Score-Check
  alerts.py                Alarme prüfen (Hintergrund), macOS-Mitteilung, E-Mail
  userdata.py              Depot, Notizen und Alarme als JSON-Dateien
  names.py                 deutsche Namen für Sektoren, Branchen, Länder und Kontinente
  themes.json              Anlagethemen der Weltauswahl (frei bearbeitbar)
  quellensteuer.json       Quellensteuersätze für Anleger in Deutschland (frei bearbeitbar)
  sources/yahoo.py         Yahoo Finance über yfinance
  sources/yahoo_screener.py  Yahoo-Screener für ganze Börsen, Sammelabfrage für Kurse
  sources/sec.py           SEC EDGAR companyfacts, Split-Bereinigung
  sources/esef.py          ESEF-Jahresberichte (filings.xbrl.org), ISIN → LEI über GLEIF
  sources/shorts.py        Netto-Leerverkaufspositionen (Bundesanzeiger)
  sources/news.py          Nachrichten (Google News, Yahoo Finance)
  sources/wiki.py          Wikipedia-Zusammenfassungen fürs Lexikon
  sources/fx.py            Währungsumrechnung (inkl. Pence)
  analysis/                Kennzahlen, Bewertung (inkl. normalisiertem Gewinn, KUV, erwarteter Rendite), Reverse-DCF,
                           ROIC/Piotroski/Rückkäufe/Revisionen, Dividenden, Steuern, Scorecard, Fazit
static/                    Oberfläche (HTML, CSS, JavaScript-Module, ECharts)
tests/                     pytest, ohne Netzwerk
```

Tests: `.venv/bin/python -m pytest`
