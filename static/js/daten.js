// Meine Daten: Die eigenen Eingaben liegen nur in diesem Browser. Hier lassen sie sich sichern (Export als JSON),
// auf ein anderes Gerät oder in einen anderen Browser übertragen (Import) und löschen.
import { api } from "./api.js";
import * as F from "./format.js";
import * as store from "./store.js";
import { toast } from "./toast.js";

const esc = F.escapeHtml;

export async function renderData(root, params, isCurrent) {
  document.title = "Meine Daten – Aktientool";
  root.innerHTML = `
    <h1>Meine Daten</h1>
    <p class="secondary" style="max-width:860px;margin-top:6px">Watchlist, Depot, Notizen, Alarme und Ihre Korrekturen liegen
      <strong>nur in diesem Browser</strong> auf diesem Gerät – ohne Konto, der Server speichert nichts davon. Ein anderer Browser, ein
      anderes Gerät oder ein privates Fenster hat einen eigenen, leeren Stand. Löscht der Browser die Websitedaten, sind auch Ihre
      Eingaben weg: Sichern Sie sie deshalb ab und zu mit „Exportieren“.</p>
    <div id="d-warn"></div>
    <div class="card" style="margin-top:14px">
      <h2 style="margin-top:0">Gespeichert in diesem Browser</h2>
      <table class="data" style="max-width:520px"><tbody id="d-counts"></tbody></table>
    </div>
    <div class="card" style="margin-top:12px">
      <h2 style="margin-top:0">Sichern und übertragen</h2>
      <div class="filters" style="align-items:center">
        <button class="btn primary" id="d-export" type="button">Exportieren (JSON-Datei)</button>
        <label class="btn" for="d-file" style="cursor:pointer">Importieren …</label>
        <input id="d-file" type="file" accept=".json,application/json" multiple hidden>
      </div>
      <p class="muted" style="font-size:13px;margin:10px 0 0;max-width:820px">Importieren nimmt eine Sicherung aus „Exportieren“ – oder die Dateien
        aus dem Ordner <code>data</code> der früheren lokalen Fassung (watchlist.json, depot.json, notizen.json, alarme.json, handelbar.json,
        holdings.json, watchgruppen.json; mehrere auf einmal auswählen).</p>
      <div id="d-preview"></div>
    </div>
    <div class="card" style="margin-top:12px">
      <h2 style="margin-top:0">Alles löschen</h2>
      <p class="muted" style="font-size:13px;margin:0 0 10px">Entfernt alle eigenen Eingaben aus diesem Browser. Darstellung, Ansicht und Tutorial-Fortschritt bleiben.</p>
      <button class="btn" id="d-clear" type="button">Alle eigenen Daten löschen …</button>
      <span id="d-clear-confirm"></span>
    </div>
    <p class="muted" id="d-info" style="font-size:13px;margin-top:14px"></p>`;
  const $ = (s) => root.querySelector(s);

  if (!store.isPersistent()) {
    $("#d-warn").innerHTML = `<div class="error-block" style="margin-top:12px">Dieser Browser erlaubt gerade keinen dauerhaften Speicher
      (z. B. privates Fenster oder gesperrte Websitedaten). Eingaben gelten nur, bis der Tab geschlossen wird.</div>`;
  }

  function paintCounts() {
    const c = store.counts();
    $("#d-counts").innerHTML = Object.entries(store.SECTIONS).map(([k, s]) =>
      `<tr><td class="name" style="text-align:left">${esc(s.label)}</td><td class="num">${F.int(c[k])}</td></tr>`).join("");
  }
  paintCounts();
  const onChange = () => { if (isCurrent()) paintCounts(); else document.removeEventListener("store-changed", onChange); };
  document.addEventListener("store-changed", onChange);

  $("#d-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(store.exportAll(), null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `aktientool-daten-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("Sicherung heruntergeladen.", { kind: "good" });
  });

  $("#d-file").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    let found;
    try {
      const contents = await Promise.all(files.map(async (f) => ({ name: f.name, content: await f.text() })));
      found = store.parseImport(contents);
    } catch (err) {
      $("#d-preview").innerHTML = `<div class="error-block" style="margin-top:12px">${esc(err.message)}</div>`;
      return;
    }
    const keys = Object.keys(found);
    if (!keys.length) {
      $("#d-preview").innerHTML = '<p class="muted" style="margin-top:12px">Die Datei enthält keine Daten.</p>';
      return;
    }
    const size = (v) => (Array.isArray(v) ? v.length : Object.keys(v).length);
    $("#d-preview").innerHTML = `<div style="margin-top:14px">
      <p style="margin:0 0 8px">Gefunden: ${keys.map((k) => `${esc(store.SECTIONS[k].label)} (${F.int(size(found[k]))})`).join(", ")}.</p>
      <div class="filters">
        <button class="btn primary" type="button" data-mode="replace">Übernehmen und Vorhandenes ersetzen</button>
        <button class="btn" type="button" data-mode="merge">Zum Vorhandenen hinzufügen</button>
        <button class="linklike" type="button" data-mode="cancel">abbrechen</button>
      </div></div>`;
    $("#d-preview").querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.mode !== "cancel") {
        try {
          store.applyImport(found, b.dataset.mode);
          toast("Daten übernommen.", { kind: "good" });
          document.dispatchEvent(new CustomEvent("alerts-changed"));
        } catch (err) {
          toast(err.message, { kind: "bad" });
          return;
        }
      }
      $("#d-preview").innerHTML = "";
    }));
  });

  $("#d-clear").addEventListener("click", () => {
    $("#d-clear-confirm").innerHTML = ` <span style="margin-left:8px">Wirklich alles löschen?</span>
      <button class="btn small" type="button" id="d-clear-yes">Ja, löschen</button>
      <button class="linklike" type="button" id="d-clear-no">nein</button>`;
    $("#d-clear-yes").addEventListener("click", () => {
      const backup = store.exportAll();
      store.clearAll();
      $("#d-clear-confirm").innerHTML = "";
      document.dispatchEvent(new CustomEvent("alerts-changed"));
      toast("Alle eigenen Daten gelöscht.", {
        action: "Rückgängig",
        onAction: () => {
          store.applyImport(store.parseImport([{ name: "sicherung.json", content: JSON.stringify(backup) }]), "replace");
          document.dispatchEvent(new CustomEvent("alerts-changed"));
        },
      });
    });
    $("#d-clear-no").addEventListener("click", () => { $("#d-clear-confirm").innerHTML = ""; });
  });

  try {
    const info = await api.info();
    if (!isCurrent()) return;
    if (info.serverless) {
      $("#d-info").textContent = `Kurse und Kennzahlen kommen live vom Server; Weltauswahl, Tiefenanalyse und Fonds werden jede Nacht vorberechnet${
        info.built ? ` (zuletzt ${new Date(info.built).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })} Uhr)` : ""}.`;
    }
  } catch (e) { /* nur Zusatzinfo */ }
}
