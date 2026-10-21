// Alarme: Kurs unter/über einer Schwelle, Kurs unter fairem Wert, Dividendenkürzung, Score-Verfall
import { api } from "./api.js";
import * as F from "./format.js";
import { attachSearch } from "./search.js";

const esc = F.escapeHtml;
const UNITS = { price_below: "Kurs", price_above: "Kurs", below_fair: "% unter fairem Wert", dividend_cut: "", score_below: "Punkte (0–100)" };

export async function renderAlarms(root, params, isCurrent) {
  document.title = "Alarme – Aktientool";
  const preset = params.get("neu") || "";
  root.innerHTML = `
    <h1>Alarme</h1>
    <p class="secondary" style="max-width:860px;margin-top:6px">Das Tool prüft Ihre Alarme alle 30 Minuten, solange es läuft, und meldet sich mit
      einer macOS-Mitteilung (auf Wunsch auch per E-Mail, siehe README). Ausgelöste Alarme erscheinen hier und als Zahl in der Kopfzeile.</p>
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
      · Mitteilung: ${st.notify ? "macOS" : "aus"}${st.email ? " + E-Mail" : ""}${st.error ? ` · Fehler: ${st.error}` : ""}`;
    const describe = (a) => (a.type === "dividend_cut" ? `Dividende sinkt unter ${F.money(a.baseline, "")} (12 Monate)`
      : a.type === "below_fair" ? `Kurs mindestens ${F.num(a.value, 0)} % unter fairem Wert`
        : `${types[a.type]} ${F.num(a.value, a.type === "score_below" ? 0 : 2)}`);
    $("#a-rows").innerHTML = data.alerts.length ? [...data.alerts].reverse().map((a) => `<tr class="${a.triggered && !a.seen ? "alert-new" : ""}">
        <td class="name"><a href="#/aktie/${encodeURIComponent(a.symbol)}">${esc(a.symbol)}</a></td>
        <td style="text-align:left">${esc(describe(a))}</td><td>${F.date(a.created)}</td>
        <td style="text-align:left;white-space:normal">${a.triggered ? `<span class="badge serious">ausgelöst ${F.date(a.triggered)}</span> ${esc(a.message || "")}` : '<span class="badge good">aktiv</span>'}</td>
        <td>${a.triggered ? `<button class="linklike" data-reset="${a.id}" type="button">wieder scharf</button> · ` : ""}<button class="linklike" data-del="${a.id}" type="button">löschen</button></td>
      </tr>`).join("") : '<tr><td colspan="5" class="muted" style="text-align:left">Noch keine Alarme.</td></tr>';
    $("#a-rows").querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => { await api.alertRemove(b.dataset.del); load(false); }));
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
      await api.alertAdd({ symbol: $("#a-symbol").value.trim().toUpperCase(), type: $("#a-type").value, value: $("#a-value").value });
      $("#a-msg").textContent = "Alarm angelegt.";
      $("#a-value").value = "";
      load(false);
    } catch (err) { $("#a-msg").textContent = err.message; }
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
