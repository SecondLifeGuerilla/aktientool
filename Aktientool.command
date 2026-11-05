#!/bin/bash
# Doppelklick im Finder: startet das Aktientool und öffnet es im Browser.
# Läuft es schon, öffnet sich nur die Seite. Das Terminalfenster offen lassen, solange das Tool laufen soll;
# beenden mit Strg+C oder durch Schließen des Fensters.
cd "$(dirname "$0")" || exit 1
if [ ! -x .venv/bin/python ]; then
  echo "Keine Python-Umgebung gefunden (.venv). Einmalig einrichten, siehe README."
  read -r -p "Enter zum Schließen …"
  exit 1
fi
AKTIENTOOL_BROWSER=1 .venv/bin/python run.py
status=$?
# Bei einem Fehler das Fenster offen lassen, damit die Meldung lesbar bleibt (130 = mit Strg+C beendet)
if [ $status -ne 0 ] && [ $status -ne 130 ]; then
  read -r -p "Enter zum Schließen …"
fi
exit $status
