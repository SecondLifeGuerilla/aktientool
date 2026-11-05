// Alarme: Kurs unter/über einer Schwelle, Kurs unter fairem Wert, Dividendenkürzung, Score-Verfall
import { api } from "./api.js";
import { trackBrowse } from "./browse.js";
import * as F from "./format.js";
import { attachSearch } from "./search.js";
import { toast } from "./toast.js";

const esc = F.escapeHtml;
const UNITS = { price_below: "Kurs in €", price_above: "Kurs in €", below_fair: "% unter fairem Wert", dividend_cut: "", score_below: "Punkte (0–100)" };

export async function renderAlarms(root, params, isCurrent) {
  document.title = "Alarme – Aktientool";
  const preset = params.get("neu") || "";
  root.innerHTML = `
    <h1>Alarme</h1>
    <p class="secondary" style="max-width:860px;margin-top:6px">Ihre Alarme liegen in diesem Browser. Das Tool prüft sie alle 30 Minuten, solange es
      in einem Tab geöffnet ist, und auf Knopfdruck. Ausgelöste Alarme erscheinen hier und als Zahl in der Kopfzeile; auf Wunsch zusätzlich als
      Mitteilung des Browsers <button class="linklike" id="a-notify" type="button" hidden>Mitteilungen erlauben</button>.</p>
    <div class="card" style="margin-top:14px">
      <form class="filters" id="a-form" autocomplete="off">
        <div class="field search" style="max-width:260px"><label for="a-symbol">Aktie</label>
          <input id="a-symbol" class="wide" required value="${esc(preset)}" placeholder="z. B. MSFT">
          <ul id="a-results" class="search-results" role="listbox" hidden></ul></div>
        <div class="field"><label for="a-type">Art</label><select id="a-type"></select></div>
        <div class="field"><label for="a-value" id="a-unit">Schwelle</label><input id="a-value" inputmode="decimal" placeholder="z. B. 100"></div>
        <button class="btn primary" type="submit">Alarm anlegen</button>
        <button class="btn" type="button" id="a-check">Jetzt prüfen</button>
        <span class="muted" id="a-msg" style="font-size:13px"></span>
      </form>
      <p class="muted" id="a-status" style="font-size:13px;margin:10px 0 0"></p>
    </div>
    <div class="card table-scroll" style="margin-top:12px;padding:8px 8px 4px"><table class="data"><thead><tr>
      <th>Aktie</th><th style="text-align:left">Bedingung</th><th>Angelegt</th><th style="text-align:left">Status</th><th></th></tr></thead>
      <tbody id="a-rows"><tr><td colspan="5" class="muted">Lade …</td></tr></tbody></table></div>`;
  const $ = (s) => root.querySelector(s);
  attachSearch($("#a-symbol"), $("#a-results"), (sym) => { $("#a-symbol").value = sym; $("#a-value").focus(); });
  let types = {};
  let shownSyms = [];
  trackBrowse($("#a-rows"), "Alarme", () => shownSyms.map((s) => [s, s]));

  const paintUnit = () => {
    const t = $("#a-type").value;
    $("#a-unit").textContent = UNITS[t] ? `Schwelle (${UNITS[t]})` : "keine Schwelle nötig";
    $("#a-value").disabled = t === "dividend_cut";
  };
  $("#a-type").addEventListener("change", paintUnit);

  async function load(markSeen = true) {
    let data;
    try { data = await api.alerts(); } catch (e) { $("#a-rows").innerHTML = `<tr><td colspan="5">${esc(e.message)}</td></tr>`; return; }
    if (!isCurrent()) return;
    if (!Object.keys(types).length) {
      types = data.types;
      $("#a-type").innerHTML = Object.entries(types).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("");
      paintUnit();
    }
    const st = data.status;
    $("#a-status").textContent = `${st.open} aktiv, ${st.total - st.open} ausgelöst · zuletzt geprüft: ${st.last_check ? new Date(st.last_check * 1000).toLocaleString("de-DE") : "noch nicht"}
      · Mitteilung im Browser: ${st.notify ? "an" : "aus"}${st.error ? ` · Fehler: ${st.error}` : ""}`;
    const nb = $("#a-notify");
    nb.hidden = st.notify || typeof Notification === "undefined" || Notification.permission === "denied";
    // Kursschwellen in Euro; Alarme aus der Zeit vor der Euro-Anzeige (ohne "currency") gelten in der Kurswährung
    const describe = (a) => (a.type === "dividend_cut"
      ? `Dividende sinkt unter ${F.isNum(a.baseline_eur) ? F.money(a.baseline_eur, "€") : F.money(a.baseline, "")} (12 Monate)`
      : a.type === "below_fair" ? `Kurs mindestens ${F.num(a.value, 0)} % unter fairem Wert`
        : a.type === "score_below" ? `${types[a.type]} ${F.num(a.value, 0)}`
          : `${types[a.type]} ${F.money(a.value, a.currency === "EUR" ? "€" : "")}`);
    $("#a-rows").innerHTML = data.alerts.length ? [...data.alerts].reverse().map((a) => `<tr class="${a.triggered && !a.seen ? "alert-new" : ""}">
        <td class="name"><a href="#/aktie/${encodeURIComponent(a.symbol)}">${esc(a.symbol)}</a></td>
        <td style="text-align:left">${esc(describe(a))}</td><td>${F.date(a.created)}</td>
        <td style="text-align:left;white-space:normal">${a.triggered ? `<span class="badge serious">ausgelöst ${F.date(a.triggered)}</span> ${esc(a.message || "")}` : '<span class="badge good">aktiv</span>'}</td>
        <td>${a.triggered ? `<button class="linklike" data-reset="${a.id}" type="button">wieder scharf</button> · ` : ""}<button class="linklike" data-del="${a.id}" type="button">löschen</button></td>
      </tr>`).join("") : `<tr><td colspan="5" class="muted" style="text-align:left;white-space:normal">Noch keine Alarme. Bewährt haben sich zum Beispiel
        „Kurs mindestens x % unter fairem Wert“ mit 10 % für Kandidaten Ihrer Watchlist (meldet eine Kaufgelegenheit) und
        „Dividende gekürzt“ für Ihre Depotwerte. Am schnellsten legen Sie einen Alarm im Aktienprofil über „🔔 Alarm“ an.</td></tr>`;
    // Löschen ohne Rückfrage, dafür mit „Rückgängig“ (der Alarm kommt samt Status an seine alte Stelle zurück)
    $("#a-rows").querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      const index = data.alerts.findIndex((a) => a.id === b.dataset.del);
      const item = data.alerts[index];
      try { await api.alertRemove(b.dataset.del); } catch (err) { toast(err.message, { kind: "bad" }); return; }
      load(false);
      toast(`Alarm für ${item.symbol} gelöscht.`, { action: "Rückgängig", onAction: async () => { await api.alertRestore(item, index); if (isCurrent()) load(false); } });
    }));
    shownSyms = [...new Set([...data.alerts].reverse().map((a) => a.symbol))];
    $("#a-rows").querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", async () => { await api.alertReset(b.dataset.reset); load(false); }));
    if (markSeen && st.unseen) {
      await api.alertsSeen();
      document.dispatchEvent(new CustomEvent("alerts-changed"));
    }
  }

  $("#a-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#a-msg").textContent = "Speichere …";
    try {
      const sym = $("#a-symbol").value.trim().toUpperCase();
      await api.alertAdd({ symbol: sym, type: $("#a-type").value, value: F.parseNum($("#a-value").value) ?? $("#a-value").value });
      $("#a-msg").textContent = "";
      toast(`Alarm für ${sym} angelegt.`, { kind: "good" });
      $("#a-value").value = "";
      load(false);
    } catch (err) { $("#a-msg").textContent = err.message; }
  });
  $("#a-notify").addEventListener("click", async () => {
    try { await Notification.requestPermission(); } catch (e) { /* Browser ohne Mitteilungen */ }
    load(false);
  });
  $("#a-check").addEventListener("click", async () => {
    $("#a-msg").textContent = "Prüfe …";
    try {
      const r = await api.alertsCheck();
      $("#a-msg").textContent = r.triggered.length ? `${r.triggered.length} Alarm(e) ausgelöst.` : "Kein Alarm ausgelöst.";
      load();
    } catch (err) { $("#a-msg").textContent = err.message; }
  });
  load();
}
