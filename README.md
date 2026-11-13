# Aktientool

Analyse-Tool für Aktien nach dem Vorbild des [Aktienfinders](https://aktienfinder.net). Es läuft im Browser – online
auf Vercel oder auf dem eigenen Rechner – und nutzt ausschließlich kostenlose Datenquellen ohne API-Key.

**Eigene Eingaben bleiben im Browser.** Watchlist, Gruppen, Depot, Notizen, Alarme, Korrekturen zur Handelbarkeit und
eigene Holdings speichert jeder Browser für sich (localStorage), ohne Konto; der Server merkt sich nichts über Nutzer.
Unter „Mehr → Meine Daten“ lassen sie sich als JSON-Datei sichern, auf ein anderes Gerät übertragen und löschen. Dort lassen
sich auch die Dateien aus dem Ordner `data/` der früheren lokalen Fassung (depot.json, watchlist.json …) importieren.

## Online auf Vercel

Die serverlose Fassung besteht aus drei Teilen:

- **Oberfläche** (`static/`): liefert Vercel als statische Dateien aus (`vercel.json`).
- **API** (`api/index.py` → `aktientool/server.py`): eine Python-Funktion für alle Anfragen an `/api/…`. Kurse, Profile,
  Nachrichten und Hebelprodukte holt sie live; zwischengespeichert wird nur kurz in `/tmp`.
- **Tägliche Daten** (`.github/workflows/daten.yml` → `scripts/daten.py`): Weltauswahl, Tiefenanalyse, Handelsliste der
  LS Exchange, Closed-End-Fonds und Tagesstände brauchen Minuten bis Stunden und laufen deshalb jede Nacht als GitHub-Workflow.
  Das Ergebnis liegt auf dem Branch `data` (ohne Verlauf, wird jedes Mal ersetzt); die API lädt es von dort
  (`aktientool/remote.py`, höchstens alle 10 Minuten eine kurze Prüfung). Die Tiefenanalyse läuft je Nacht bis zu
  4,5 Stunden und setzt in der nächsten Nacht fort; nach einigen Tagen ist die ganze Weltauswahl analysiert.

Einrichten:

1. Repo bei Vercel importieren (Framework „Other“, keine Build-Einstellungen nötig; `vercel.json` regelt alles).
2. Unter GitHub → Actions den Workflow „Daten aktualisieren“ einmal von Hand starten („Run workflow“). Nach rund
   10 Minuten steht der Zwischenstand (Weltauswahl, Handelsliste, Fonds) auf dem Branch `data`, danach läuft er jede Nacht.
3. Optional in Vercel: `AKTIENTOOL_SEC_USER_AGENT` mit eigener Kontaktadresse (verlangt die SEC) und
   `AKTIENTOOL_DATA_URL`, falls die Daten aus einem anderen Repo kommen sollen.
4. Optional in GitHub (Settings → Secrets and variables → Actions → Variables): `SEC_USER_AGENT` mit eigener
   Kontaktadresse für den täglichen Workflow, Form „Name kontakt@domain“. Die Kennung darf nicht „GitHub“ enthalten:
   Solche Kennungen lehnt die SEC mit 403 ab, und alle US-Aktien hätten dann nur 3 bis 4 Jahre Bilanzdaten von Yahoo.
   Der Workflow meldet das als Warnung („SEC EDGAR nicht erreichbar“).

Hinweise: GitHub pausiert geplante Workflows in Repos ohne Aktivität nach 60 Tagen (dann in Actions wieder aktivieren).
Alarme prüft der Browser alle 30 Minuten, solange das Tool in einem Tab offen ist (auf Wunsch mit Mitteilung des Browsers);
E-Mail und macOS-Mitteilungen gibt es nicht mehr. Yahoo kann Anfragen aus Rechenzentren zeitweise drosseln.

## Lokal starten

```bash
.venv/bin/python -m pip install -r requirements.txt   # einmalig
.venv/bin/python run.py
```

Dann im Browser öffnen: <http://127.0.0.1:5050>. Beenden mit `Strg+C`.

Bequemer: **Doppelklick auf `Aktientool.command`** im Finder. Das startet den Server in einem Terminalfenster und öffnet die
Seite im Standardbrowser (`AKTIENTOOL_BROWSER=1`). Läuft das Tool schon, öffnet sich nur die Seite. Das Fenster offen lassen,
solange das Tool laufen soll. Die Oberfläche ist für den Laptop-Browser gebaut, nicht fürs Handy.

## Was das Tool kann

**Startseite (Übersicht)**: Depotwert mit Veränderung heute und seit Kauf und den größten Bewegungen des Tages, ausgelöste
Alarme, die nächsten Zahlen- und Dividendentermine (60 Tage) von Watchlist und Depot und die Watchlist mit Kurs,
Tagesänderung, Gesamt-Score, Gewinnstabilität, Abstand zum fairen Wert, erwarteter Rendite und Dividendenrendite (sortiert
nach Abschlag zum fairen Wert). Die Startseite lädt nur zwei Sammelabfragen (Kurse samt Terminen von Yahoo und die Zeilen der
Weltauswahl), keine einzelnen Profile, und ist deshalb sofort da; Ex-Tage stehen unter „Termine“. Leere Listen zeigen
überall den nächsten Schritt (z. B. Vorlagen der Weltauswahl bei leerer Watchlist).

**Ansicht Basis / Profi** (Umschalter oben rechts): „Basis“ zeigt überall nur das Wichtigste, „Profi“ alles. In der Basis-Ansicht
bleiben im Menü Weltauswahl, Trusts & Holdings, Watchlist, Depot, Alarme, Tutorial, Call/Put-Rechner und Lexikon. Die Weltauswahl hat dann zwei Ansichten (Überblick:
Gesamt-Score, KGV, Dividendenrendite, Gewinnstabilität, Gewinnwachstum, Kurs vs. fairer Wert, erwartete Rendite; Dividende),
rund ein Dutzend Kennzahlen für Filter und Sortierung und vier Vorlagen. Das Profil zeigt „Auf einen Blick“, Zukunft, Qualität, Kurs, Scorecard
(nur die Scores), fairen Wert (längster Zeitraum, ohne Reverse-DCF), Dividende (vier Kacheln) und Notizen; Signale, Bewertung im
Detail und Jahreswerte entfallen. Watchlist und Depot zeigen weniger Spalten. Filter oder Auswahlen aus der Profi-Ansicht bleiben sichtbar, damit nichts
unbemerkt filtert. Die Wahl bleibt im Browser (localStorage); während einer Tutorial-Tour gilt immer die Profi-Ansicht.

**Tutorial** (`#/tutorial`, Menü „Mehr“ oder Startseite): führt in fünf Lektionen (etwa 30 Minuten) durch den ganzen Weg
zu einer lohnenden Aktie. Lektion 1 legt die Strategie fest (Dividendenertrag, Dividendenwachstum oder Gewinnwachstum, wie in der
Scorecard). Ab Lektion 2 läuft eine Tour über die echten Seiten: Ein Hinweisfenster markiert den erklärten Bereich, stellt kleine
Aufgaben (Vorlage anklicken, Ansicht wechseln, Zeitraum umschalten, These speichern …) und erkennt selbst, wann sie erledigt sind.
Die Texte im Profil beziehen sich auf die Übungsaktie, am besten die in Lektion 2 selbst gefundene. Dazu eine Kauf-Checkliste, die
jede Aktie nach den Regeln des Tools abhakt (`#/tutorial?pruefen=MSFT`), ein Wissenstest mit zehn Fragen und der Ablauf für später.
Der Fortschritt bleibt im Browser (localStorage), eine laufende Tour übersteht ein Neuladen der Seite. „Von vorn beginnen“
(Tutorial-Seite oder Startseite) setzt nach einer Rückfrage alles zurück (Lektionen, Strategie, Übungsaktie, Testergebnis);
Watchlist, Notizen und Alarme bleiben. Eine einzelne Lektion startet mit ↺ im Hinweisfenster oder „Lektion von vorn“ neu.

**Kurz-Touren** (Knopf „? Tour“ oben rechts, `static/js/pagetours.js`): Jede Seite hat ihre eigene kleine Führung (1–3 Minuten,
3–8 Schritte) mit derselben Technik wie die Lektionen – Übersicht, Weltauswahl, Screener, Watchlist, Trusts & Holdings, Depot,
Alarme, Termine, Vergleich, Score-Check, Call/Put-Rechner, Optionsscheine & Knock-outs, Lexikon und Aktienprofil (mit der gerade
offenen Aktie). Ein Punkt am Knopf zeigt, dass die Tour dieser Seite noch nicht gemacht ist; alle Touren stehen auch auf der
Tutorial-Seite (`#/tutorial?teil=touren`). Erledigte Touren bleiben im Browser und zählen nicht zum Fortschritt der Lektionen.

**Bedienung** (gilt überall):

| Funktion | Inhalt |
| --- | --- |
| Tastenkürzel | `/` oder ⌘ K springt in die Suche, `?` zeigt alle Kürzel (auch „Mehr“ → Tastenkürzel), `g` und ein Buchstabe wechselt die Seite (`g w` Weltauswahl, `g l` Watchlist, `g d` Depot, `g h` Übersicht …). Im Profil: ← → blättern, `b` zurück zur Liste, `m` Watchlist an/aus, `n` Notizen. In der Weltauswahl: `f` Filter ein/aus, `s` Suchfeld. Kürzel greifen nicht, solange man in ein Feld tippt (`static/js/keys.js`) |
| Zuletzt angesehen | Die Suche zeigt bei leerem Feld die zuletzt geöffneten Profile, die Startseite eine Zeile mit ihnen (localStorage, `recent.js`) |
| Blättern im Profil | Wer ein Profil aus einer Liste öffnet (Weltauswahl, Screener, Watchlist, Depot, Startseite, Vergleich), sieht über dem Profil „‹ vorige · 3 von 57 · nächste ›“ und „← Liste“. Blättern ersetzt den Verlaufseintrag, „Zurück“ führt also direkt zur Liste; dort springt das Tool an die Zeile der zuletzt angesehenen Aktie (`browse.js`) |
| Zurück an dieselbe Stelle | Zurück, Vor und Neuladen stellen die Scroll-Position jeder Seite wieder her, auch wenn ihre Daten erst nachladen; „Weitere 100 anzeigen“ der Weltauswahl steht dafür in der Adresse (`n=300`). Jeder Verlaufseintrag hat dazu eine Kennung in `history.state` (`nav.js`, sessionStorage) |
| Meldungen mit „Rückgängig“ | Watchlist (Stern, Profil, Mehrfachauswahl), gelöschte Depot-Käufe, importierte Käufe und gelöschte eigene Filter lassen sich in der Meldung unten links zurückholen (`toast.js`); Rückfragen per Dialog entfallen dort |
| Tabellen | Spaltenköpfe von Weltauswahl, Screener, Watchlist und Depot bleiben beim Scrollen stehen, solange die Tabelle in die Breite passt; „↑ nach oben“ erscheint auf langen Seiten. Häkchen links wählen mehrere Zeilen: Vergleichen (2–4), im Screener analysieren, auf die bzw. von der Watchlist. CSV-Export (Semikolon, Dezimalkomma, für Excel) in Weltauswahl (alle Treffer, alle Kennzahlen), Screener/Watchlist und Depot |
| Notizen | speichern sich nach kurzer Tipp-Pause und beim Verlassen des Feldes selbst (⌘ Enter sofort) |

**Alles in Euro:** Kurse, Börsenwerte, faire Werte, Kursziele, Dividenden, Bilanzzahlen, Depot und Alarme zeigt das Tool in
Euro, auch bei Aktien aus Dollar-, Pfund- oder Hongkong-Börsen. Umgerechnet wird so:

| Was | Wechselkurs |
| --- | --- |
| Aktueller Kurs, Börsenwert, fairer Wert, Kursziel, Schätzungen, Dividende der letzten 12 Monate | aktueller Kurs (Yahoo `EURxxx=X`, 15 Minuten im Cache); die Tagesveränderung enthält die Bewegung des Wechselkurses |
| Kursverlauf, Renditetabelle, Allzeithoch, Linie des fairen Werts im Kursdiagramm | Kurs des jeweiligen Tages (wie ein Euro-Chart beim Broker); Tageskurse gibt es ab etwa 2003, davor gilt der erste bekannte Kurs. Einzelne Ausreißer-Tage in Yahoos Wechselkursen werden herausgefiltert |
| Gewinn, Umsatz, Cashflow und Dividende je Jahr (Diagramme und Jahreswerte) | heutiger Kurs, damit die Wachstumsraten nicht von Währungsschwankungen verzerrt werden |

Intern rechnet das Tool weiter in der Börsenwährung (Bewertung, Momentum, Scores, Weltauswahl), umgerechnet wird erst für die
Anzeige (`aktientool/eur.py`). Börsenwerte meldet Yahoo in der Hauptwährung (Pfund), Kurse in der Unterwährung (Pence); beides
wird richtig umgerechnet. Im Profilkopf steht zusätzlich der Kurs an der Börse samt Wechselkurs. Ist kein Wechselkurs zu
bekommen, zeigt das Profil die Originalwährung und einen Hinweis.

**Aktien-Profil** (Suche oben nach Name oder Ticker; deutsche Aktien z. B. `ALV.DE`, Schweiz `NESN.SW`, London `ULVR.L`)

| Abschnitt | Inhalt |
| --- | --- |
| Kopf | Land, Sektor, Branche, Mitarbeiter, ISIN, Börsenwert, Kurs (in Euro, darunter an der Börse), Dividendenrendite, nächster Zahlentermin; „Was macht …?“ mit der Einleitung des deutschen Wikipedia-Artikels (über Wikidata per ISIN gefunden, ersatzweise per Firmenname, aber nur bei börsennotierten Einträgen), sonst die englische Beschreibung von Yahoo; Schaltflächen Watchlist, ＋ Depot, 🔔 Alarm, ⇄ Vergleichen, Call/Put |
| Auf einen Blick | Das Fazit direkt unter dem Kopf: Satz zur Eignung, Gewinnentwicklung, Bewertung (Kurs vs. fairer Wert, erwartete Rendite), passende Strategie mit allen drei Scorecard-Scores, Stimmung; Link zur Kauf-Checkliste |
| Scores & Nachrichten | Scores der Weltauswahl im Sektorvergleich, Anlagethemen; aktuelle Nachrichten deutsch (Google News) oder englisch (Yahoo Finance) |
| Zukunft: Chancen und Risiken | Qualitative Einordnung zu KI und Automatisierung: getrennte Chancen/Risiken, drei Beobachtungspunkte, fünf Blickwinkel, Zeithorizonte, datierte Unternehmensquellen und Prüfstand; in Basis und Profi sichtbar |
| Qualität | Gewinnstabilität (0–1), Gewinnwachstum p. a., Analystenerwartung, Chart Gewinn je Aktie inkl. Prognose; Kapitalrendite (ROIC), Piotroski F-Score mit allen 9 Prüfpunkten, Aktienrückkäufe/Verwässerung, Free-Cashflow-Rendite |
| Signale | Revisionen der Gewinnschätzungen (30/90 Tage, Anhebungen/Senkungen), Gewinnüberraschungen der letzten Quartale, Insidergeschäfte (USA), Netto-Leerverkaufspositionen (Bundesanzeiger) |
| Kursentwicklung | Kurs, Total Return, 20/50/200-Tage-Linie, Zeiträume 1J–Max, log. Skala, Renditetabelle, Momentum (200 Tage und 12-1), Allzeithoch |
| Scorecard | Scores 1–10 für Dividendenertrag, Dividendenwachstum und Gewinnwachstum, je Kriterium mit Bandbreite |
| Bewertung | Stabilität von bilanziertem/bereinigtem Gewinn, operativem Cashflow, normalisiertem Gewinn und Umsatz; Verlauf von KGV, bereinigtem KGV, KCV, normalisiertem KGV und KUV mit Durchschnitt, umschaltbar (★ = Grundlage des fairen Werts) |
| Fairer Wert | Bewertungszeitraum 3/5/10 Jahre, Fair-Value-Linie, Prognosekorridor, Analysten-Kursziel, erwartete Rendite p. a., Reverse-DCF (eingepreistes Wachstum bei 8/9/10 % geforderter Rendite) |
| Dividende | Rendite, Wachstum, Stabilität, Ausschüttungsquote, Steigerungen in Folge, Rendite vs. Durchschnitt, Rendite nach Quellen- und Abgeltungsteuer, nächster Ex-Tag und Zahltag |
| Jahreswerte, Notizen | Alle Grunddaten als Tabelle mit Quelle; eigene Notizen zur Aktie (Investment-These) |

**Zukunftseinordnung** (Abschnitt „Zukunft“ im Profil): Die erste redaktionelle Auswahl umfasst Microsoft, SAP,
Accenture, NVIDIA und Siemens, geprüft am 29.10.2026. Chancen und Risiken werden getrennt als gering, mittel, hoch
oder unklar eingeordnet. Es handelt sich um mögliche Geschäftsauswirkungen, keine Eintrittswahrscheinlichkeiten oder
Kaufempfehlungen. Scores und fairer Wert werden davon nicht verändert. Die Beobachtungspunkte zeigen, soweit vorhanden,
die operative bzw. Free-Cashflow-Marge aus dem geladenen Finanzprofil; deren Veränderung belegt keinen KI-Effekt.

Unternehmensangaben („berichtet“/„angekündigt“) stehen mit Datum und Quellenlink getrennt von eigenen Ableitungen.
Nach 90 Tagen ohne Prüfung erscheint „Prüfung überfällig“. Kursaktualisierungen und Nachrichten erneuern die Einordnung
nicht. Unbekannte Unternehmen erhalten keine automatisch aus Branche oder Themen abgeleiteten Bewertungen.
Die Zuordnung erfolgt über explizite Ticker oder ISINs; widersprüchliche Stammdaten werden angezeigt.

Die Inhalte stehen in [`aktientool/outlook.json`](aktientool/outlook.json). Für Ergänzungen müssen Chancen, Risiken,
alle fünf Blickwinkel, genau drei Beobachtungspunkte und Belege mit passenden `source_ids` vorliegen. Quellen direkt
prüfen, Veröffentlichungsdaten übernehmen, Unternehmensbehauptungen als solche kennzeichnen und erst danach
`reviewed_at` ändern. `reported` bedeutet vom Unternehmen berichtet, nicht unabhängig nachgewiesen. Das Prüfdatum darf
nicht vor einem Quelldatum liegen. Validierung: `.venv/bin/python -m pytest tests/test_outlook.py`.
Der separate Endpunkt `/api/outlook/<Ticker>?isin=<ISIN>` liest den Katalog ohne Netzwerk und ohne Cache; Änderungen
werden beim Neuladen sichtbar. Ein defekter Katalog lässt das übrige Profil weiter funktionieren.

**Weltauswahl** (`#/welt`): rund 6.000 Aktien ab 2 Mrd. € Börsenwert von den Börsen aus 47 Ländern. Die Liste ist
nicht fest hinterlegt, sondern wird live über den Yahoo-Screener geladen (ca. 20 Sekunden, danach einen Tag im Cache,
„aktualisieren“ lädt neu).

| Funktion | Inhalt |
| --- | --- |
| Filter | Kontinent, Land, Sektor, Branche, Anlagethema (Mehrfachauswahl mit Trefferzahlen), Suche nach Name/Ticker/ISIN, Mindest-Börsenwert. Aktive Filter stehen als Chips in der Kopfzeile des Filterbereichs (✕ entfernt einen); der Bereich lässt sich einklappen, dann beginnt die Tabelle fast oben (die Wahl bleibt im Browser, während einer Tutorial-Tour ist er immer offen) |
| Kennzahl-Filter | beliebig viele Bedingungen „mindestens/höchstens“ auf jede Kennzahl und jeden Score; Vorlagen u. a. Kauf-Checkliste (mindestens 9 Punkte erfüllt), Stabil & unterbewertet (ohne Value-Fallen), Hohe erwartete Rendite (vorsichtig gerechnet), Dividenden-Aristokraten, Dividendenwachstum, Bilanzstark, Rückkäufer mit Rückenwind, Attraktivste (Gesamt-Score), Magic Formula, Dividendenperlen |
| Kauf-Checkliste | Spalte, Sortierung und Filter „erfüllt x von y Punkten“: dieselben Prüfungen wie die Checkliste im Tutorial (Datenbasis, Qualität, Preis, Rückenwind, Strategie), für die neben den Vorlagen gewählte Strategie; der Tooltip nennt die nicht erfüllten Punkte. Unter der Trefferzahl steht ein Hinweis, wenn eine gefilterte Kennzahl nur für wenige Aktien vorliegt |
| Tiefenanalyse | Datenjahre und Quelle, Gewinnstabilität, Gewinnwachstum, Kurs vs. fairer Wert, erwartete Rendite (Modell und vorsichtig), Warnzeichen für eine Value-Falle, Scorecard-Scores, Dividende netto, eigene Dividendensteigerungen, ROIC, Piotroski, Aktienzahl, Revisionen, Momentum 12-1, Reverse-DCF, FCF-Rendite für jede Aktie, im Hintergrund berechnet (siehe unten) |
| Scores (0–100) | Gesamt, Qualität, Bewertung, Wachstum, Momentum, Beständigkeit, Dividende, Magic Formula (Berechnung siehe Methodik) |
| Themen | Künstliche Intelligenz, Robotik & Automatisierung, Humanoide Robotik, Cybersecurity, Rechenzentren & Stromnetze, Elektromobilität & Batterien, Erneuerbare Energien, Rüstung & Verteidigung, Quantencomputing |
| Kennzahlen | Börsenwert, Umsatz, KGV, KGV erwartet, KBV, KUV, EV/EBITDA, PEG, Dividendenrendite, Dividendensteigerungen in Folge, Ausschüttungsquote, Eigen-/Gesamtkapitalrendite, Brutto-/EBITDA-/Nettomarge, Umsatz- und Gewinnwachstum, erwartetes Gewinnwachstum, Verschuldungsgrad, Nettoschulden/EBITDA, Altman-Z-Score, Beta, Kursentwicklung 1 Jahr, Momentum, Abstand zum Hoch, Analysten-Rating |
| Ansichten | Überblick, Scores, Bewertung, Rentabilität, Wachstum, Dividende, Qualität & fairer Wert, Signale, Bilanz & Risiko, Kurs & Analysten; Sortieren per Spaltenklick oder Auswahl |
| Trade Republic | Schalter „nur bei Trade Republic handelbar“ in der Kopfzeile des Filterbereichs (voreingestellt an, die Wahl bleibt im Browser). Ist er aus, tragen nicht handelbare Aktien das Kennzeichen „nicht bei TR“ (ebenso in Suche, Screener und Watchlist auf der Startseite). Quelle und Grenzen siehe unten |
| Weiter | Name öffnet das ausführliche Profil; „im Screener analysieren“ übergibt bis zu 50 Treffer an den Screener mit Scores |
| Meine Filter | die aktuelle Suche (Filter, Ansicht, Sortierung) unter einem Namen speichern; ein Klick stellt sie wieder ein, löschen mit ✕ (mit „Rückgängig“). Die Filter stehen auch auf der Startseite und bleiben im Browser (localStorage, `savedfilters.js`) |
| Auswahl & Export | Häkchen links wählen Zeilen für Vergleich, Screener oder Watchlist; „CSV“ speichert alle Treffer mit allen Kennzahlen (Prozentwerte als Zahl, Börsenwert und Umsatz in Mrd. €) |

Filter und Sortierung stehen in der Adresse (z. B. `#/welt?land=DE|AT|CH&sort=div_yield`) und lassen sich als
Lesezeichen speichern.

**Tiefenanalyse der Weltauswahl:** Damit sich alle rund 6.000 Aktien wie beim Aktienfinder nach Gewinnstabilität und
fairem Wert filtern lassen, berechnet das Tool im Hintergrund für jede Aktie das vollständige Profil. Das sind rund
zehn Abfragen je Aktie; damit Yahoo nicht drosselt, arbeitet der Lauf eine Aktie nach der anderen ab (größte zuerst,
etwa 4–5 Sekunden je Aktie, für die ganze Auswahl einige Stunden). Er startet automatisch, sobald der Server läuft,
speichert alle 25 Aktien, setzt nach einem Neustart fort und lässt sich in der Weltauswahl pausieren. Ein Ergebnis
gilt eine Woche. Abweichung vom fairen Wert und erwartete Rendite werden mit dem aktuellen Kurs neu berechnet. Aktien,
die noch nicht analysiert sind, fallen bei Filtern auf diese Kennzahlen heraus.

Wie belastbar die Werte sind, hängt an der Länge der Bilanzreihe: Yahoo liefert 3 bis 4 Jahre, die SEC für US-Firmen
und Firmen mit US-Listing oft 15, die ESEF-Berichte für viele europäische Firmen die Jahre ab 2020. Unter 5 Jahren
erfüllt eine Aktie Filter „Gewinnstabilität/-wachstum mindestens …“ nicht, zählt im Beständigkeits-Score höchstens
neutral und bekommt keinen eingeordneten fairen Wert. Die Zeile über den Filtern nennt, wie viele Aktien mindestens
5 Jahre haben; die Spalte „Datenjahre“ zeigt Länge und Quelle je Aktie.

**Vorsichtige Rendite und Value-Fallen:** Die erwartete Rendite des Modells unterstellt, dass die Aktie wieder so
bewertet wird wie im Durchschnitt der Vergangenheit, und mittelt Analystenerwartung und Historie. Daneben steht die
vorsichtige Variante: niedrigere der beiden Wachstumsquellen, das Multiple bleibt, wo es ist (liegt es über dem
Durchschnitt, fällt es dorthin). Drei Warnzeichen prüfen, ob die Vergangenheit noch trägt: Analysten erwarten sinkende
Gewinne oder weniger als die Hälfte des bisherigen Wachstums; die Gewinnschätzung wurde in 90 Tagen um mindestens 3 %
gesenkt; Kurs unter der 200-Tage-Linie bei negativem Momentum 12-1. Liegt der Kurs mindestens 10 % unter dem fairen
Wert und treffen zwei Warnzeichen zu, gilt die Aktie als mögliche Value-Falle (`analysis/trap.py`).

**Depot** (`#/depot`): Käufe mit Stückzahl, Kaufkurs in Euro (wie in der Abrechnung der Bank) und Datum erfassen. Käufe aus
der Zeit davor (ohne Feld `currency`) stehen in der Kurswährung und werden zum heutigen Kurs umgerechnet.
Wert und Gewinn/Verlust in Euro (Live-Kurse, aktuelle Wechselkurse), Dividenden pro Jahr brutto und nach Steuern,
Dividenden nach Monaten, Aufteilung nach Land, Sektor und Währung, Abweichung vom fairen Wert und Scorecard je Position,
nach Depotwert gewichtete Scores. Unter „Alle Käufe“ lässt sich jeder Kauf bearbeiten (`PUT /api/depot/<id>`) oder löschen
(„Rückgängig“ über `POST /api/depot/restore`, mit derselben Kennung) und die Liste als CSV sichern. „Käufe aus einer Tabelle
übernehmen“ liest eingefügte Excel-Zeilen oder eine CSV-Datei (Ticker; Stück; Kaufkurs; Datum; Notiz, Kopfzeile optional,
Datum als TT.MM.JJJJ oder JJJJ-MM-TT), zeigt vorab erkannte Käufe und Fehler je Zeile und speichert alles oder nichts
und speichert alles oder nichts. Gespeichert im Browser.

**Alarme** (`#/alarme`): Kurs fällt unter / steigt über eine Schwelle (in Euro; ältere Alarme ohne Feld `currency` in der
Kurswährung), Kurs mindestens x % unter dem fairen Wert,
Dividende gekürzt, Gesamt-Score fällt unter eine Schwelle. Geprüft wird alle 30 Minuten, solange das Tool im Browser
geöffnet ist („Jetzt prüfen“ sofort; der Browser schickt die offenen Alarme an `POST /api/alerts/check`). Ausgelöste Alarme
erscheinen als Zahl in der Kopfzeile und, falls erlaubt, als Mitteilung des Browsers. Gespeichert im Browser.

**Termine** (`#/termine`): Quartalszahlen, Ex-Tage und Zahltage aller Aktien aus Watchlist und Depot, mit erwarteter
Dividende je Aktie und der Revision der Gewinnschätzung vor den Zahlen.

**Vergleich** (`#/vergleich?s=KO,PEP,NESN.SW`): bis zu vier Aktien nebeneinander mit rund 30 Kennzahlen (bester Wert
je Zeile hervorgehoben) und gemeinsamer Wertentwicklung inkl. Dividenden.

**Score-Check** (`#/score-check`): Die Weltauswahl speichert jeden Tag einen kompakten Stand (`data/snapshots/`,
rund 300 KB je Tag). Der Score-Check zeigt, wie sich die Aktien seit einem gewählten Tag entwickelt haben, aufgeteilt
in fünf Gruppen nach ihrem damaligen Score, dazu die Rangkorrelation. So lässt sich prüfen, ob ein Score tatsächlich
Rendite vorhersagt. Für Scores aus Bilanzdaten geht das rückwirkend mit kostenlosen Daten nicht, deshalb wird ab dem
ersten Start gesammelt.

Für Kennzahlen, die sich allein aus Kursen ergeben, gibt es den **Rückblick** (`#/score-check?teil=rueckblick`): Die
Tiefenanalyse legt je Aktie die Monatsschlusskurse der letzten 11 Jahre ab (`monatskurse`, serverlos als
`monatskurse.json.gz` auf dem Branch `data`). Daraus wird für jeden Monat berechnet, wie die Fünftel nach Momentum
12-1, Kursentwicklung 12 Monate, Abstand zum 10-Monats-Durchschnitt und Abstand zum 12-Monats-Hoch in den folgenden
1, 3, 6 und 12 Monaten abgeschnitten haben (`aktientool/rueckblick.py`). Grenze: Geprüft wird die heutige
Weltauswahl; inzwischen geschrumpfte oder verschwundene Firmen fehlen, die Renditen sind deshalb zu hoch.

**Call/Put-Rechner** (`#/callput?s=SAP.DE`, Menü „Mehr“ oder Knopf „Call/Put“ im Profil): rechnet Optionsscheine und
Knock-out-Produkte (Turbos, Mini-Futures) auf eine Aktie oder einen Index durch. Eingaben aus dem Produktblatt: Call oder
Put, Basispreis, Knock-out-Schwelle bzw. Fälligkeit, Bezugsverhältnis (`0,1` oder `10:1`) und optional der aktuelle Preis
des Produkts. Kurs, historische Volatilität (1 Jahr, 3 Monate), Dividendenrendite und Euro-Kurs lädt das Tool selbst
(`/api/basiswert/<Ticker>`); ohne Aktie lässt sich der Kurs auch von Hand eingeben. Ergebnis: Hebel, Gewinnschwelle,
Verdopplung, Totalverlust- bzw. Knock-out-Marke, beim Optionsschein der Zeitwertverlust pro Tag; „Was wäre, wenn“ für einen
eigenen Kurs und Tag; ein Diagramm Gewinn/Verlust je Aktienkurs (Optionsschein: sofort, am gewählten Tag, bei Fälligkeit)
und eine Tabelle von −30 % bis +30 %. Optionsscheine bewertet das Black-Scholes-Modell mit Dividendenrendite; mit dem
eingegebenen Preis rechnet es mit der impliziten Volatilität. Knock-outs zählen den inneren Wert (ohne Finanzierungskosten
und Spanne), nach Berührung der Schwelle den Restwert. Kurse, Kursmarken und Produktwerte zeigt der Rechner in Euro zum
heutigen Wechselkurs; Basispreis und Schwelle gibt man wie im Produktblatt in der Währung der Aktie ein (bei US-Aktien in
Dollar), daneben steht der Euro-Wert. Alle Angaben stehen in der Adresse, ein Produkt lässt sich also als Lesezeichen speichern.

*Konkrete Produkte* (Daten von onvista, `aktientool/sources/onvista.py`, `aktientool/derivate.py`):
- „Produkt laden“ nimmt eine ISIN oder WKN (etwa aus der Trade-Republic-App) und füllt Produktart, Richtung, Basiswert,
  Basispreis, Schwelle, Bezugsverhältnis, Fälligkeit und den Briefkurs als Preis (`#/callput?p=DE000…`,
  `/api/derivat/<ISIN oder WKN>`). Der Kopf zeigt Emittent, Geld/Brief, Spanne, Links zu onvista und Emittent und ob
  Trade Republic das Produkt handelt.
- **Ihre Erwartung** (Karte unter den Kennzahlen): Kurs der Aktie an einem Tag, voreingestellt der heutige Kurs („±0“),
  Knöpfe −20 % … +30 % und 1 Woche … 1 Jahr, dazu die Schwankung bis dahin (voreingestellt: die des letzten Jahres).
  Ergebnis für das Produkt im Rechner: „genau so“ (Aktie steht exakt dort) und „mit Schwankung“ (alle dann möglichen
  Kurse, lognormal): Ø Rendite, Gewinnchance, Risiko eines Verlusts über 50 %, Knock-out-Risiko auf dem Weg dorthin
  (Brownsche Brücke). Die Erwartung steht als `ziel` (in %), `am` und `sig` in der Adresse und bleibt beim Wechsel des
  Produkts erhalten.
- **Preis-Check** (neutral, ohne Meinung): Briefkurs gegenüber dem fairen Wert – Optionsschein: Black-Scholes mit der
  Schwankung aus „Ihre Erwartung“; Knock-out ohne Laufzeit: innerer Wert; Knock-out mit Fälligkeit: Terminwert (der Zins
  bis dahin steckt im Preis). Beim Optionsschein dazu „ähnliche Scheine“: Preis bei der mittleren impliziten Volatilität
  vergleichbarer Scheine anderer Emittenten (gleiche Richtung, Basispreis ±7 %, Laufzeit ±25 %, mindestens drei).
- Bewertet wird jedes Produkt mit dem Aktienkurs, mit dem onvista seinen Briefkurs gerechnet hat (aus dem einfachen Hebel
  abgeleitet, `derivate._enrich`); beim geladenen Produkt steht dieser Kurs auch in „Kurs jetzt“. So stammen Kurs und
  Preis vom selben Zeitpunkt. Den Hebel zeigt der Rechner mit zwei Nachkommastellen, beim geladenen Produkt den des
  Emittenten (wie die Trade-Republic-App).
- Knock-outs ohne Laufzeit verlieren mit der Zeit die Finanzierung: Basispreis und Schwelle steigen beim Call um Zins +
  Marge, beim Put ändern sie sich um Zins − Marge (Annahmen: Zins 2 %, Marge 3 % p. a.). Die Kachel „Finanzierung pro
  Monat“, Tabelle, Diagramm und Erwartung rechnen das ein.
- Darunter stehen alle Optionsscheine bzw. Knock-outs auf die gewählte Aktie oder den Index – dieselbe Tabelle wie auf der
  Seite „Optionsscheine & Knock-outs“ (siehe unten), kompakter; Art und Richtung folgen den Schaltern des Rechners,
  „Große Ansicht“ öffnet die Seite.
- Der Schalter „nur bei Trade Republic handelbar“ (dieselbe Einstellung wie in der Weltauswahl, voreingestellt an)
  zeigt nur Produkte von HSBC, Société Générale, UBS und Vontobel. Mit diesen Emittenten handelt Trade Republic
  Derivate außerbörslich; onvistas Broker-Filter „Trade Republic“ liefert genau diese Produkte.
- Mit Häkchen kommen bis zu sechs Produkte in den Vergleich (`v=ISIN,ISIN` in der Adresse): gemeinsames Diagramm
  Gewinn/Verlust je Aktienkurs am Tag der Erwartung mit der erwarteten Verteilung als Fläche, Tabelle mit Brief, Hebel,
  Spanne, Preis-Check, vs. ähnliche, Gewinnschwelle, Ø Erwartung, Gewinnchance, Verlust > 50 % und KO-Risiko.
- **Im Aktienprofil** (Abschnitt „Hebelprodukte“, lädt beim Hinscrollen, `/api/derivate/<Ticker>/ueberblick`): Anzahl
  der Call-/Put-Optionsscheine und Knock-outs Long/Short und je Gruppe die drei typischen Produkte (Laufzeit 3–12
  Monate bzw. Hebel 5–10, Optionsscheine mit Basispreis höchstens 15 % vom Kurs) mit dem günstigsten Preis-Check;
  „Alle …“ führt auf die Seite „Optionsscheine & Knock-outs“, „Rechnen“ in den Rechner.
- Basispreise rechnet das Tool in die Kurswährung bei Yahoo um, etwa Pfund in Pence oder Euro in Pence bei Shell.
  Quanto-Produkte rechnen mit 1 Einheit = 1 €.
- Die Zuordnung Ticker ↔ Basiswert läuft über die ISIN und bleibt 30 Tage im Cache. Kurse werden 3 Minuten im Speicher
  gehalten.
- Faktor-Zertifikate, Inline- und Discount-Optionsscheine zeigt der Rechner an, rechnet sie aber nicht.

**Optionsscheine & Knock-outs** (`#/hebel?s=SAP.DE&art=os&typ=call`, Menü „Mehr“, „Alle …“ im Profil, „Große Ansicht“ im
Rechner; `static/js/hebel.js`, Tabelle in `static/js/derivtable.js`, Bewertung in `static/js/derivmodel.js`): alle
Hebelprodukte auf eine Aktie in einer großen Tabelle.
- **Alle Produkte:** onvistas Finder gibt je Abfrage höchstens 1.000 Zeilen heraus (Seite 10 ergibt Fehler 400).
  `onvista.all_products` lädt deshalb in Abschnitten nach Basispreis, vom Kurs aus nach oben und unten (zehn Seiten je
  Abschnitt parallel, der nächste beginnt beim letzten Basispreis), bis 6.000 Produkte (`/api/derivate/<Ticker>/alle`,
  3 Minuten im Speicher). Bei mehr (Dax) bleiben die mit dem Basispreis am nächsten am Kurs; dann gehen die Filter, die
  onvista kennt (Laufzeit, Hebel, Abstand, Art, Basispreis, ein Emittent), beim Laden mit. Die erste Seite erscheint sofort,
  der Rest nach ein bis zehn Sekunden.
- **Filter** (im Browser, sofort): Schnellknöpfe für Laufzeit, Basispreis im/am/aus dem Geld, Hebel, Spanne, Turbo/Mini,
  Open End, Abstand zur Schwelle; „Weitere Filter“ mit eigenen Bereichen (Fälligkeit, Basispreis absolut und in % vom Kurs,
  Hebel, Abstand, Briefkurs), Emittent (Mehrfachauswahl), Spanne und Preis-Check höchstens, Ausübungsart, WKN/ISIN-Suche,
  ohne Quanto, nur neue Produkte (erster Handelstag in den letzten 7 Tagen). Aktive Filter stehen als Chips darüber.
- **Sortieren nach jeder Spalte, über alle Produkte**, auch nach Preis-Check, vs. ähnliche (jetzt für jeden Schein, nur
  gegen andere Emittenten) und Ø Erwartung/Gewinnchance. Produkte ohne Briefkurs (nicht kaufbar) kommen bei diesen Spalten
  ans Ende und tragen „kein Brief“.
- **Spalten** wählbar (im Browser gespeichert): Geld, Brief, Spanne, Spanne ÷ Hebel (die Spanne auf die Aktie umgerechnet,
  vergleichbar über alle Hebel), Omega/Hebel, Delta, Zeitwert/Tag, Vola, Aufgeld, Gewinnschwelle, Preis-Check,
  vs. ähnliche, Ø Erwartung, Gewinnchance, Verlust > 50 %, KO-Risiko, Veränderung heute, Bezugsverhältnis, erster Handelstag.
  „CSV“ speichert die gefilterte, sortierte Liste für Excel (Semikolon, Dezimalkomma).
- **Matrix:** Optionsscheine nach Fälligkeit (Monate, dann Quartale, dann Jahre) × Basispreis in % vom Kurs, Knock-outs
  nach Abstand × Art; je Feld bester Preis-Check, bester vs. ähnliche, niedrigste Vola, kleinste Spanne ÷ Hebel oder
  Anzahl. Ein Klick filtert die Liste auf das Feld.
- **Landkarte:** jedes Produkt als Punkt (x: Basispreis bzw. Schwelle in % vom Kurs, y: Vola, Preis-Check, vs. ähnliche,
  Spanne oder Hebel), nach Emittent gefärbt; ein Klick nimmt das Produkt in den Vergleich.
- **Ihre Erwartung** oben (Zeitraum, Veränderung, Schwankung) wie im Rechner; Vergleich bis sechs Produkte unter der
  Tabelle, „Rechnen“ öffnet ein Produkt im Rechner. Filter, Sortierung und Ansicht stehen in der Adresse.

**Trusts & Holdings** (`#/trusts`, Hauptmenü): Firmen, die selbst in Aktien und andere Firmen investieren, mit ihrem
Abschlag (oder Aufschlag) zum inneren Wert (NAV). Zwei Tabellen:
- **Holdings** (Investor AB, Industrivärden, Exor, GBL, Porsche SE; weitere lassen sich anlegen): Den NAV veröffentlichen
  sie nur mit den Quartalsberichten, das Tool rechnet ihn deshalb selbst: börsennotierte Beteiligungen (Stückzahl laut
  Bericht) zum aktuellen Kurs, nicht börsennotierte Beteiligungen, Kasse und Schulden mit dem Wert aus dem Bericht.
  Meldet ein Bericht nur Werte statt Stückzahlen (oder mehrere Aktiengattungen zusammen), rechnet das Tool die
  Stückzahl über den Kurs am Stichtag zurück. Die Angaben stehen in [`aktientool/holdings.json`](aktientool/holdings.json)
  mit Quelle und Stichtag. **Sie aktualisieren sich nicht von selbst** (keine kostenlose Schnittstelle): Nach einem neuen
  Bericht über „Angaben ändern“ die Stückzahlen, Schulden und übrigen Posten eintragen (landet im Browser und
  geht vor; „Eigene Änderungen verwerfen“ stellt die mitgelieferten Werte wieder her). Der Stichtag ist gelb, wenn der
  Bericht älter als drei Monate ist, rot ab einem halben Jahr.
- **Fonds & Trusts weltweit**: rund 770 Closed-End-Fonds aus London, New York, Zürich, Sydney, Toronto, Amsterdam,
  Paris u. a. (ohne britische VCTs und Sondergattungen wie ZDP), davon rund 110 bei Trade Republic handelbar. Abschlag,
  NAV, Kosten und NAV-Rendite kommen von Morningstar, für britische Trusts von der AIC zusätzlich der durchschnittliche
  Abschlag über 1, 3 und 5 Jahre, die Spanne des letzten Jahres, Fremdkapital und Sektor. „vs. üblich“ vergleicht den
  heutigen Abschlag mit dem längsten verfügbaren Durchschnitt (±2 Prozentpunkte = wie üblich, ab 5 = viel günstiger
  bzw. teurer). Aufklappen zeigt die größten Positionen: London von Morningstar (monatlich), USA aus den N-PORT-Meldungen
  an die SEC (vierteljährlich). Für die handelbaren Fonds lädt das Tool sie im Hintergrund vor, dann stehen die drei
  größten direkt in der Tabelle.

**Verlauf des Abschlags** (beim Aufklappen und in der Profilkarte): Diagramm mit Zeitraum 1, 3, 5, 10 Jahre oder gesamt,
dazu Durchschnitt, günstigster und teuerster Stand (mit Datum), letzter Wert und an wie vielen Tagen der Abschlag größer
war als heute; „Alle Zeiträume als Tabelle“ zeigt alles auf einen Blick. Fonds: Abschlag je Tag aus Schlusskurs und NAV
von Morningstar (bei vielen Fonds ab 2000; ein NAV gilt bis zur nächsten Bewertung, höchstens 100 Tage). Dieser Verlauf
liefert auch den „üblichen“ Abschlag für Fonds ohne AIC-Daten (z. B. BB Biotech, US-Fonds); für die bei Trade Republic
handelbaren lädt das Tool ihn im Hintergrund vor. Holdings: zurückgerechnet über 3 Jahre mit den Beteiligungen laut
letztem Bericht und den Tageskursen (Yahoo); vor dem Stichtag gestrichelt, weil Käufe, Verkäufe und Schulden damals
anders waren. Zusätzlich speichert das Tool jeden Börsentag den berechneten Abschlag jeder Holding
(`data/snapshots/abschlag_holdings.json`); diese Werte gehen im Verlauf vor und bleiben auch nach einer Aktualisierung
der Angaben erhalten.

Ein Kasten oben auf der Seite zeigt, wie aktuell die Daten sind (Ampelfarben). Im Aktienprofil eines Trusts oder einer
Holding steht die Karte „Innerer Wert“ vor „Auf einen Blick“, weil KGV und fairer Wert bei solchen Firmen wenig aussagen.

**Notizen**: Am Ende jedes Profils lässt sich eine Investment-These festhalten (im Browser).

**Anlagethemen** wie KI oder Robotik gibt es weder bei Yahoo noch in den Branchen-Klassifikationen. Die Zuordnung steht
in [`aktientool/themes.json`](aktientool/themes.json): eine redaktionelle Liste von Tickern je Thema, ergänzt um passende
Branchen (z. B. Solar) und Muster im Firmennamen (z. B. „Robot“). Die Datei lässt sich frei bearbeiten; Änderungen wirken
nach einem Neuladen der Seite, ohne die Börsen neu zu laden.

**Lexikon** (`#/lexikon`): Fachbegriffe sind im ganzen Tool gepunktet unterstrichen und zeigen beim Darüberfahren (oder
Antippen) eine Kurzerklärung mit Links ins Lexikon und zu Wikipedia. Im Lexikon lässt sich je Begriff die
Wikipedia-Zusammenfassung nachladen. Die Texte stehen in [`static/js/glossary.js`](static/js/glossary.js).

**Screener und Watchlist**: Kennzahlen für ganze Listen laden (DAX 40, Dow Jones 30, Qualitäts-Klassiker,
Watchlist oder eigene Tickerliste), filtern und nach Spalten bzw. Score sortieren. Die Vorlagen stehen in
[`aktientool/presets.json`](aktientool/presets.json) und lassen sich frei bearbeiten. Die Watchlist liegt im Browser.

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
| Wikidata und deutsche Wikipedia | Firmenbeschreibung im Profil (Einleitung des Artikels, Lizenz CC BY-SA) | 28 Tage im Cache, auch „kein Artikel“ |
| Yahoo Finance (`EURxxx=X`) | Wechselkurse für die Euro-Anzeige: aktuell und täglich ab etwa 2003 | aktuell 15 Minuten, Tageskurse 1 Tag im Cache |
| LS Exchange (Lang & Schwarz): Stammdaten-PDF und Kursliste | Handelbarkeit bei Trade Republic: ISIN, WKN, Name von rund 11.000 Aktien | PDF jeden Börsentag (1,7 MB), Kursliste wöchentlich (rund 40 MB, nur die ISINs werden gelesen) |
| Morningstar UK (öffentliche Fondssuche `lt.morningstar.com`) | Closed-End-Fonds weltweit: Kurs, Abschlag zum NAV, Kosten, NAV-Rendite, tägliche Kurs- und NAV-Reihen (Verlauf des Abschlags); für Londoner Fonds die größten Positionen, NAV-Datum, 12-Monats-Abschlag | Liste alle 12 Stunden (Stand Vortag), Verlauf 1 Tag, Positionen 7 Tage im Cache |
| AIC (theaic.co.uk, Daten von Morningstar) | Britische Investment Trusts: Ø-Abschlag 1/3/5 Jahre, Spanne 12 Monate, Fremdkapital, Sektor | mit der Fondsliste, rund 800 KB je Abruf |
| SEC EDGAR (Formular N-PORT) | Positionen von US-Fonds | vierteljährlich, bis zu 60 Tage Verzug, 7 Tage im Cache |
| Quartals- und Halbjahresberichte der Holdings | Beteiligungen, Schulden, Aktienzahl ([`aktientool/holdings.json`](aktientool/holdings.json)) | von Hand gepflegt, Stand siehe Stichtag |

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
- **Handelbar bei Trade Republic:** Trade Republic veröffentlicht keine Liste. Bis Ende Juni 2026 liefen alle
  Aktienorders über die LS Exchange, deshalb gilt deren Angebot als Annäherung: das tägliche Stammdaten-PDF
  (`ls-x.de/de/handelsuniversum`) plus die Kursliste (`ls-x.de/de/download`), die einige Dutzend Werte enthält, die im
  PDF fehlen. Verglichen wird über die ISIN, zuerst die der Heimatnotierung, dann die aller anderen Notierungen der
  Firma: TSMC, Samsung oder SK hynix gibt es dort nur als ADR/GDR, chinesische Firmen oft nur als H-Aktie; das Profil
  nennt dann die ISIN, unter der die App die Aktie führt. Fehlt bei Yahoo die ISIN einer Notierung (z. B. BYD in
  Hongkong) oder ist sie falsch, stimmt die Angabe nicht; im Profil lässt sie sich mit einem Klick korrigieren
  (im Browser). Von gut 5.950 Aktien der Weltauswahl sind rund 3.460 handelbar; fast nichts gibt es aus
  Korea, Taiwan, Indien, Saudi-Arabien, Malaysia und Vietnam.

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
| Rückblick | je Monat Fünftel nach Kursfaktor, Folgerendite über 1/3/6/12 Monate (mit Dividenden, Kurswährung), gemittelt über alle Monate mit mindestens 200 Aktien; Trefferquote = Anteil der Monate, in denen das stärkste Fünftel vor dem schwächsten lag |
| Beständigkeits-Score | Rang im Sektor bei Gewinnstabilität (unter 5 Jahren Daten höchstens 0,5) und Ø-Kapitalrendite (ROIC, bis 4 Jahre); fünfter Teil des Gesamt-Scores, wo die Tiefenanalyse vorliegt |
| Erwartete Rendite, vorsichtig | min(1, fairer Wert ÷ Kurs)^(1/5) × (1 + niedrigere Wachstumsquelle) − 1 + Dividendenrendite |
| Kauf-Checkliste | erfüllte von prüfbaren Punkten; Schwellen wie im Tutorial (`static/js/checklist.js`, `static/js/tutorial.js`) |

Die Werte weichen von denen des Aktienfinders ab, der kostenpflichtige Daten (FactSet, Morningstar) mit
30 Jahren Historie nutzt und seine genauen Formeln nicht veröffentlicht. Keine Anlageberatung.

## Einstellungen (Umgebungsvariablen)

| Variable | Standard | Zweck |
| --- | --- | --- |
| `AKTIENTOOL_PORT` | `5050` | Port des lokalen Servers |
| `AKTIENTOOL_SEC_USER_AGENT` | `Aktientool lokal aktientool@example.com` | Die SEC verlangt einen User-Agent mit Kontaktadresse; bitte eigene E-Mail eintragen |
| `AKTIENTOOL_TTL_YAHOO` | `21600` | Cache-Dauer der Yahoo-Daten in Sekunden |
| `AKTIENTOOL_DATA_DIR` | `./data` (serverlos `/tmp/aktientool`) | Ort für den Cache |
| `AKTIENTOOL_WELT_MIN_CAP` | `2e9` | Mindest-Börsenwert in Euro für die Weltauswahl (`2e9` ≈ 6.000 Aktien, `5e9` ≈ 3.200, `1e10` ≈ 1.900; kleinere Werte machen die Liste größer und den Aufbau langsamer) |
| `AKTIENTOOL_TTL_WELT` | `86400` | Cache-Dauer der Weltauswahl in Sekunden |
| `AKTIENTOOL_TIEFE_AUTO` | `1` | Tiefenanalyse automatisch starten (`0` = nur per Schaltfläche in der Weltauswahl) |
| `AKTIENTOOL_TIEFE_PAUSE` | `1.5` | Pause zwischen zwei Aktien der Tiefenanalyse in Sekunden (kleiner = schneller, aber eher gedrosselt) |
| `AKTIENTOOL_TTL_TIEFE` | `604800` | Gültigkeit eines Ergebnisses der Tiefenanalyse in Sekunden |
| `AKTIENTOOL_SNAPSHOT_DIR` | `./data/snapshots` | Ort der Tagesstände für den Score-Check |
| `AKTIENTOOL_SERVERLESS` | `0` (auf Vercel `1`) | Serverlos: keine Hintergrund-Läufe, Daten vom Branch `data` |
| `AKTIENTOOL_DATA_URL` | `https://raw.githubusercontent.com/<Repo>/data` | Woher die serverlose Fassung die täglichen Daten lädt |
| `AKTIENTOOL_DATA_PRUEFEN` | `600` | So oft (Sekunden) sieht die serverlose Fassung nach neuen Daten |

## Aufbau

```
run.py                     Start (lokal)
api/index.py               Einstieg für Vercel (serverlos)
vercel.json                Vercel: statische Oberfläche aus static/, /api/… an die Python-Funktion
scripts/daten.py           täglicher Daten-Workflow (Weltauswahl, Tiefenanalyse, Handelsliste, Fonds, Tagesstände)
.github/workflows/daten.yml  startet ihn jede Nacht und legt das Ergebnis auf den Branch data
aktientool/
  server.py                Flask: Oberfläche + JSON-API (Profil, Weltauswahl, Kurse, Wechselkurse, Alarmprüfung,
                           Tiefenanalyse, Tagesstände, Nachrichten, Lexikon); Kontext aus dem Browser (Korrekturen, Holdings)
  remote.py                serverlos: tägliche Daten vom Branch data laden und entpacken
  service.py               setzt alle Quellen zu einem Profil zusammen
  world.py                 Weltauswahl: Börsen laden, Notierungen zusammenführen, Land bestimmen, Aufbau im Hintergrund
  deep.py                  Tiefenanalyse der Weltauswahl im Hintergrund (fortsetzbar)
  snapshots.py             Tagesstände der Weltauswahl und Score-Check
  rueckblick.py            Monatskurse der Tiefenanalyse und Rückblick der Kursfaktoren für den Score-Check
  alerts.py                Alarme prüfen (die Alarme schickt der Browser mit)
  userdata.py              Kontext der Anfrage: Korrekturen zur Handelbarkeit und eigene Holdings (prüft sie)
  trusts.py                Trusts & Holdings: Fondsliste im Hintergrund, innerer Wert der Holdings, Positionen
  holdings.json            Holdings mit Beteiligungen laut letztem Bericht (Quelle und Stichtag je Eintrag)
  names.py                 deutsche Namen für Sektoren, Branchen, Länder und Kontinente
  themes.json              Anlagethemen der Weltauswahl (frei bearbeitbar)
  outlook.py, outlook.json Quellenbasierte Zukunftseinordnung und redaktionelle Startauswahl
  quellensteuer.json       Quellensteuersätze für Anleger in Deutschland (frei bearbeitbar)
  sources/yahoo.py         Yahoo Finance über yfinance
  sources/yahoo_screener.py  Yahoo-Screener für ganze Börsen, Sammelabfrage für Kurse
  sources/sec.py           SEC EDGAR companyfacts, Split-Bereinigung
  sources/esef.py          ESEF-Jahresberichte (filings.xbrl.org), ISIN → LEI über GLEIF
  sources/shorts.py        Netto-Leerverkaufspositionen (Bundesanzeiger)
  sources/lsx.py           Handelsliste der LS Exchange (handelbar bei Trade Republic), liest das Stammdaten-PDF ohne Bibliothek
  sources/morningstar.py   Closed-End-Fonds weltweit (Fondssuche von Morningstar UK), Positionen Londoner Fonds
  sources/aic.py           Britische Investment Trusts (AIC): Durchschnittsabschläge, Sektor, Fremdkapital
  sources/nport.py         Positionen von US-Fonds aus den N-PORT-Meldungen an die SEC
  sources/news.py          Nachrichten (Google News, Yahoo Finance)
  eur.py                   Anzeige in Euro: rechnet Profil, Kennzahlenzeilen und Kurse für die Oberfläche um
  sources/wiki.py          Wikipedia: Zusammenfassungen fürs Lexikon, deutsche Firmenbeschreibung (über Wikidata)
  sources/fx.py            Währungsumrechnung (inkl. Pence), Euro-Kurse aktuell und täglich
  analysis/                Kennzahlen, Bewertung (inkl. normalisiertem Gewinn, KUV, erwarteter Rendite), Reverse-DCF,
                           ROIC/Piotroski/Rückkäufe/Revisionen, Dividenden, Steuern, Scorecard, Fazit
static/                    Oberfläche (HTML, CSS, JavaScript-Module); static/vendor/ enthält ECharts 5.5.1, damit
                           Diagramme ohne CDN laden; static/js/store.js speichert die eigenen Daten im Browser
Aktientool.command         Start per Doppelklick (Server starten und Browser öffnen)
tests/                     pytest, ohne Netzwerk
```

Tests: `.venv/bin/python -m pytest`
