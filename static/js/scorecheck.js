// Score-Check: Haben Aktien mit hohem Score besser abgeschnitten? Zwei Blickwinkel:
// „Seit einem Tagesstand“ (alle Scores, so weit die gespeicherten Tagesstände reichen) und
// „Rückblick“ (Kursfaktoren wie Momentum 12-1 über die letzten Jahre, aus den Monatskursen der Tiefenanalyse).
import { api } from "./api.js";
import * as C from "./charts.js";
import * as F from "./format.js";
import { term } from "./glossary.js";

const esc = F.escapeHtml;
const KEYS = [
  ["score_total", "Gesamt-Score"], ["score_quality", "Qualitäts-Score"], ["score_value", "Bewertungs-Score"],
  ["score_growth", "Wachstums-Score"], ["score_momentum", "Momentum-Score"], ["score_stability", "Beständigkeits-Score"],
  ["score_dividend", "Dividenden-Score"],
  ["magic_formula", "Magic Formula"], ["d_sc_eg", "Scorecard Gewinnwachstum"], ["d_sc_dg", "Scorecard Dividendenwachstum"],
  ["d_sc_inc", "Scorecard Dividendenertrag"], ["d_stab", "Gewinnstabilität"], ["d_exp", "Erwartete Rendite"],
  ["d_exp_lo", "Erwartete Rendite, vorsichtig"], ["d_warn", "Warnzeichen (weniger besser)", "asc"],
  ["d_dev", "Kurs vs. fairer Wert (niedriger besser)", "asc"], ["d_pio", "Piotroski F-Score"], ["d_roic", "Kapitalrendite (ROIC)"],
  ["d_rev90", "Revisionen 90 Tage"], ["d_mom121", "Momentum 12-1"], ["pe", "KGV (niedriger besser)", "asc"],
];
const HORIZON_LABEL = { 1: "1 Monat", 3: "3 Monate", 6: "6 Monate", 12: "12 Monate" };
const HORIZON_IN = { 1: "in 1 Monat", 3: "in 3 Monaten", 6: "in 6 Monaten", 12: "in 12 Monaten" };

const tiles = (list) => list.map(([l, v, s]) => `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join("");
const icText = (ic) => (F.isNum(ic) ? (Math.abs(ic) < 0.03 ? "kein Zusammenhang" : ic > 0 ? "höherer Wert, höhere Rendite" : "höherer Wert, niedrigere Rendite") : "");

// Balken je Fünftel (Durchschnitt und Median); r.groups wie von /api/snapshots/eval und /api/rueckblick
function quintileChart(r) {
  return (t) => ({
    ...C.base(t),
    tooltip: { ...C.base(t).tooltip, axisPointer: { type: "shadow" }, valueFormatter: (v) => F.signedPct(v, 1) },
    legend: { ...C.base(t).legend, data: ["Durchschnitt", "Median"] },
    xAxis: C.categoryAxis(t, r.groups.map((g) => `${g.group}${g.group === 1 ? " (schwach)" : g.group === r.groups.length ? " (stark)" : ""}`)),
    yAxis: C.valueAxis(t, { scale: false, axisLabel: { color: t.muted, formatter: (v) => `${F.num(v * 100, 0)} %` } }),
    series: [
      { name: "Durchschnitt", type: "bar", barMaxWidth: 28, data: r.groups.map((g) => g.mean), itemStyle: { color: t.series[0], borderRadius: [4, 4, 0, 0] } },
      { name: "Median", type: "bar", barMaxWidth: 28, data: r.groups.map((g) => g.median), itemStyle: { color: t.series[1], borderRadius: [4, 4, 0, 0] } },
    ],
  });
}

// ---------------------------------------------------------------- Seit einem Tagesstand
async function renderSnapshots(body, params, isCurrent) {
  let days;
  try { days = await api.snapshots(); } catch (e) { body.innerHTML = `<div class="error-block">${esc(e.message)}</div>`; return; }
  if (!isCurrent()) return;
  if (days.length < 2) {
    body.innerHTML = `<div class="card"><p>${days.length ? `Bisher gibt es einen Tagesstand (${F.date(days[0])}).` : "Noch kein Tagesstand gespeichert."}
      Die Weltauswahl speichert jeden Tag einen weiteren. Eine erste Auswertung ist ab dem zweiten Tag möglich,
      aussagekräftig wird sie nach einigen Wochen bis Monaten (kurzfristig dominiert der Zufall).</p></div>`;
    return;
  }
  const opts = (sel) => days.map((d) => `<option value="${d}" ${d === sel ? "selected" : ""}>${F.date(d)}</option>`).join("");
  const span = Math.round((Date.parse(days[days.length - 1]) - Date.parse(days[0])) / 864e5);
  body.innerHTML = `
    <p class="secondary" style="max-width:860px">Das Tool speichert jeden Tag einen Stand der Weltauswahl. Hier sehen Sie, wie sich die Aktien seit
      einem gewählten Tag entwickelt haben, aufgeteilt in fünf gleich große Gruppen nach ihrem damaligen Score (1 = schwächstes Fünftel,
      5 = stärkstes). Steigen die Balken von links nach rechts, hatte der Score Vorhersagekraft.</p>
    ${span < 90 ? `<div class="notice" style="max-width:860px"><ul><li class="warn">Die Tagesstände reichen erst ${F.int(span)} Tage zurück. Über so kurze Zeit
      entscheiden Zufall und Sektortrends, nicht der Score. Belastbar wird diese Auswertung nach vielen Monaten; bis dahin zeigt der
      <button class="linklike" type="button" data-mode-go="rueck">Rückblick</button>, was sich für Kursfaktoren über mehrere Jahre sagen lässt.</li></ul></div>` : ""}
    <div class="card" style="margin-top:12px"><div class="filters">
      <div class="field"><label for="s-from">Stand vom</label><select id="s-from">${opts(params.get("von") || days[0])}</select></div>
      <div class="field"><label for="s-to">bis</label><select id="s-to">${opts(params.get("bis") || days[days.length - 1])}</select></div>
      <div class="field"><label for="s-key">Score</label><select id="s-key">${KEYS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></div>
    </div></div>
    <div class="grid tiles" id="s-tiles" style="margin-top:12px"></div>
    <div class="card" style="margin-top:12px"><div class="chart-title"><h3>Kursrendite je Fünftel</h3><span class="muted">ohne Dividenden, in Kurswährung</span></div>
      <div class="chart small" id="ch-quint"></div></div>
    <p class="muted" style="font-size:13px;margin-top:8px">Hinweise: Kurzfristige Ergebnisse sind stark vom Zufall und von Sektortrends geprägt. Unterschiedliche
      Währungen und Dividenden sind nicht berücksichtigt. Erst über viele Monate und mehrere Zeiträume zeigt sich, ob ein Score
      verlässlich ist.</p>`;
  const $ = (s) => body.querySelector(s);
  let chart;
  async function run() {
    const [key, , dir] = KEYS.find(([k]) => k === $("#s-key").value);
    let r;
    try { r = await api.snapshotEval($("#s-from").value, $("#s-to").value, key, dir); } catch (e) { $("#s-tiles").innerHTML = `<p class="bad">${esc(e.message)}</p>`; return; }
    if (!isCurrent()) return;
    const ic = r.rank_correlation;
    if (!r.count) { // z. B. ein neuer Score, den es am gewählten Tag noch nicht gab
      $("#s-tiles").innerHTML = `<p class="muted">Für diesen Score gibt es am ${F.date($("#s-from").value)} noch keine Werte. Wählen Sie einen späteren Tag;
        neue Kennzahlen sammeln sich ab dem Tag, an dem das Tool sie zum ersten Mal berechnet hat.</p>`;
      chart?.update(quintileChart({ groups: [] }));
      return;
    }
    $("#s-tiles").innerHTML = tiles([
      ["Zeitraum", `${r.days} Tage`, `${F.int(r.count)} Aktien mit Score`],
      ["Alle Aktien", F.signedPct(r.all.mean, 1), `Median ${F.signedPct(r.all.median, 1)}`],
      ["Stärkstes minus schwächstes Fünftel", `<span class="${(r.spread ?? 0) >= 0 ? "good" : "bad"}">${F.signedPct(r.spread, 1)}</span>`, "Ø Rendite"],
      [term("rangkorrelation", "Rangkorrelation"), F.num(ic, 3), icText(ic).replace("Wert", "Score")],
    ]);
    if (chart) chart.update(quintileChart(r)); else chart = C.mount($("#ch-quint"), quintileChart(r));
  }
  body.querySelectorAll("select").forEach((s) => s.addEventListener("change", run));
  run();
}

// ---------------------------------------------------------------- Rückblick: Kursfaktoren über die letzten Jahre
async function renderRueckblick(body, isCurrent) {
  let data;
  try { data = await api.rueckblick(); } catch (e) { body.innerHTML = `<div class="error-block">${esc(e.message)}</div>`; return; }
  if (!isCurrent()) return;
  const ready = Object.values(data.results || {}).some((r) => r.available);
  if (!ready) {
    body.innerHTML = `<div class="card"><p>Der Rückblick ist noch nicht berechnet. Er entsteht aus den Monatskursen, die die
      ${term("tiefenanalyse", "Tiefenanalyse")} für jede Aktie ablegt${data.stocks ? ` (bisher ${F.int(data.stocks)} Aktien)` : ""};
      sobald genug Aktien erfasst sind, erscheint er hier von selbst.</p></div>`;
    return;
  }
  const month = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  const factors = Array.isArray(data.factors) ? data.factors : Object.entries(data.factors || {});
  body.innerHTML = `
    <p class="secondary" style="max-width:860px">Für Kennzahlen, die sich allein aus Kursen ergeben, reicht der Blick weiter zurück: Für jeden
      Monat der letzten Jahre wurden die Aktien nach dem damaligen Wert in fünf Gruppen geteilt und ihre Rendite in den Monaten danach
      gemessen. Die Balken zeigen den Durchschnitt über alle diese Monate.</p>
    <div class="card" style="margin-top:12px"><div class="filters">
      <div class="field"><label for="r-factor">Kennzahl</label><select id="r-factor">${factors.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></div>
      <div class="field"><label for="r-horizon">Haltedauer danach</label><select id="r-horizon">${data.horizons.map((h) => `<option value="${h}" ${h === 6 ? "selected" : ""}>${HORIZON_LABEL[h] || `${h} Monate`}</option>`).join("")}</select></div>
    </div></div>
    <div class="grid tiles" id="r-tiles" style="margin-top:12px"></div>
    <div class="card" style="margin-top:12px"><div class="chart-title"><h3>Rendite je Fünftel</h3><span class="muted" id="r-sub"></span></div>
      <div class="chart small" id="ch-rueck"></div></div>
    <div class="notice" style="margin-top:12px;max-width:900px"><b>So ist das zu lesen</b><ul>
      <li class="warn">Geprüft werden die Aktien der <b>heutigen</b> Weltauswahl. Firmen, die seither geschrumpft, übernommen oder insolvent sind, fehlen
        (Survivorship Bias). Alle Renditen fallen dadurch zu hoch aus, und auch der Abstand zwischen den Gruppen kann verzerrt sein.
        Lesen Sie das Ergebnis als Hinweis auf die Richtung, nicht als erreichbare Rendite.</li>
      <li>Bei Haltedauern über einen Monat überlappen sich die Zeiträume; die Monate sind nicht unabhängig voneinander.</li>
      <li>Renditen in Kurswährung, mit Dividenden, ohne Kosten und Steuern.</li>
      <li>Scores aus Bilanzdaten (Qualität, Bewertung, Scorecard) lassen sich so nicht prüfen: Dafür müsste bekannt sein, welche Zahlen damals vorlagen.
        Sie sammeln sich unter „Seit einem Tagesstand“.</li></ul></div>`;
  const $ = (s) => body.querySelector(s);
  let chart;
  function run() {
    const r = data.results[`${$("#r-factor").value}:${$("#r-horizon").value}`];
    if (!r?.available) {
      $("#r-tiles").innerHTML = '<p class="muted">Für diese Auswahl gibt es noch zu wenige Monate mit genügend Aktien.</p>';
      return;
    }
    const ic = r.rank_correlation;
    $("#r-tiles").innerHTML = tiles([
      ["Zeitraum", `${F.int(r.months)} Monate`, `${esc(month(r.from))} bis ${esc(month(r.to))} · Ø ${F.int(r.count)} Aktien`],
      ["Alle Aktien", F.signedPct(r.all.mean, 1), `${HORIZON_IN[r.horizon]} · Median ${F.signedPct(r.all.median, 1)}`],
      ["Stärkstes minus schwächstes Fünftel", `<span class="${r.spread >= 0 ? "good" : "bad"}">${F.signedPct(r.spread, 1)}</span>`,
        `Ø Rendite · in ${F.pct(r.hit_rate, 0)} der Monate vorn`],
      [term("rangkorrelation", "Rangkorrelation"), F.num(ic, 3), icText(ic)],
    ]);
    $("#r-sub").textContent = `Ø über ${F.int(r.months)} Monate, Haltedauer ${HORIZON_LABEL[r.horizon]}, mit Dividenden`;
    if (chart) chart.update(quintileChart(r)); else chart = C.mount($("#ch-rueck"), quintileChart(r));
  }
  body.querySelectorAll("select").forEach((s) => s.addEventListener("change", run));
  run();
}

export async function renderScoreCheck(root, params, isCurrent) {
  document.title = "Score-Check – Aktientool";
  let mode = params.get("teil") === "rueckblick" ? "rueck" : "stand";
  root.innerHTML = `
    <h1>Score-Check</h1>
    <p class="secondary" style="max-width:860px;margin-top:6px">Taugen die Scores etwas? Geprüft wird, ob Aktien mit hohem Wert danach besser gelaufen sind als Aktien mit niedrigem.</p>
    <div class="segmented" id="s-mode" role="group" aria-label="Art der Auswertung" style="margin-top:10px">
      <button type="button" data-mode="stand">Seit einem Tagesstand</button>
      <button type="button" data-mode="rueck">Rückblick über Jahre (Kursfaktoren)</button>
    </div>
    <div id="s-body" style="margin-top:12px"></div>`;
  const body = root.querySelector("#s-body");
  let run = 0;
  const show = () => {
    const my = ++run;
    root.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    body.innerHTML = '<div class="loading-block"><div class="spinner"></div>Lade …</div>';
    const current = () => isCurrent() && my === run;
    history.replaceState(history.state, "", mode === "rueck" ? "#/score-check?teil=rueckblick" : "#/score-check");
    return mode === "rueck" ? renderRueckblick(body, current) : renderSnapshots(body, params, current);
  };
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode], [data-mode-go]");
    if (!b) return;
    mode = b.dataset.mode || b.dataset.modeGo;
    show();
  });
  show();
}
