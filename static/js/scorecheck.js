// Score-Check: Haben Aktien mit hohem Score seit einem Tagesstand besser abgeschnitten?
import { api } from "./api.js";
import * as C from "./charts.js";
import * as F from "./format.js";
import { term } from "./glossary.js";

const esc = F.escapeHtml;
const KEYS = [
  ["score_total", "Gesamt-Score"], ["score_quality", "Qualitäts-Score"], ["score_value", "Bewertungs-Score"],
  ["score_growth", "Wachstums-Score"], ["score_momentum", "Momentum-Score"], ["score_dividend", "Dividenden-Score"],
  ["magic_formula", "Magic Formula"], ["d_sc_eg", "Scorecard Gewinnwachstum"], ["d_sc_dg", "Scorecard Dividendenwachstum"],
  ["d_sc_inc", "Scorecard Dividendenertrag"], ["d_stab", "Gewinnstabilität"], ["d_exp", "Erwartete Rendite"],
  ["d_dev", "Kurs vs. fairer Wert (niedriger besser)", "asc"], ["d_pio", "Piotroski F-Score"], ["d_roic", "Kapitalrendite (ROIC)"],
  ["d_rev90", "Revisionen 90 Tage"], ["d_mom121", "Momentum 12-1"], ["pe", "KGV (niedriger besser)", "asc"],
];

export async function renderScoreCheck(root, params, isCurrent) {
  document.title = "Score-Check – Aktientool";
  root.innerHTML = `
    <h1>Score-Check</h1>
    <p class="secondary" style="max-width:860px;margin-top:6px">Taugen die Scores etwas? Das Tool speichert jeden Tag einen Stand der Weltauswahl.
      Hier sehen Sie, wie sich die Aktien seit einem gewählten Tag entwickelt haben, aufgeteilt in fünf gleich große Gruppen nach ihrem
      damaligen Score (1 = schwächstes Fünftel, 5 = stärkstes). Steigen die Balken von links nach rechts, hatte der Score Vorhersagekraft.</p>
    <div id="s-body" style="margin-top:12px"><div class="loading-block"><div class="spinner"></div>Lade …</div></div>`;
  let days;
  try { days = await api.snapshots(); } catch (e) { root.querySelector("#s-body").innerHTML = `<div class="error-block">${esc(e.message)}</div>`; return; }
  if (!isCurrent()) return;
  const body = root.querySelector("#s-body");
  if (days.length < 2) {
    body.innerHTML = `<div class="card"><p>${days.length ? `Bisher gibt es einen Tagesstand (${F.date(days[0])}).` : "Noch kein Tagesstand gespeichert."}
      Die Weltauswahl speichert jeden Tag, an dem das Tool läuft, einen weiteren. Eine erste Auswertung ist ab dem zweiten Tag möglich,
      aussagekräftig wird sie nach einigen Wochen bis Monaten (kurzfristig dominiert der Zufall).</p></div>`;
    return;
  }
  const opts = (sel) => days.map((d) => `<option value="${d}" ${d === sel ? "selected" : ""}>${F.date(d)}</option>`).join("");
  body.innerHTML = `
    <div class="card"><div class="filters">
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
    $("#s-tiles").innerHTML = [
      ["Zeitraum", `${r.days} Tage`, `${F.int(r.count)} Aktien mit Score`],
      ["Alle Aktien", F.signedPct(r.all.mean, 1), `Median ${F.signedPct(r.all.median, 1)}`],
      ["Stärkstes minus schwächstes Fünftel", `<span class="${(r.spread ?? 0) >= 0 ? "good" : "bad"}">${F.signedPct(r.spread, 1)}</span>`, "Ø Rendite"],
      [term("rangkorrelation", "Rangkorrelation"), F.num(ic, 3), F.isNum(ic) ? (Math.abs(ic) < 0.03 ? "kein Zusammenhang" : ic > 0 ? "höherer Score, höhere Rendite" : "höherer Score, niedrigere Rendite") : ""],
    ].map(([l, v, s]) => `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join("");
    const build = (t) => ({
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
    if (chart) chart.update(build); else chart = C.mount($("#ch-quint"), build);
  }
  body.querySelectorAll("select").forEach((s) => s.addEventListener("change", run));
  run();
}
