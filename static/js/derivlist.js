// Hebelprodukte auf eine Aktie: die große Tabelle (derivtable.js) samt Vergleich ausgewählter Produkte – im
// Call/Put-Rechner und auf der Seite „Optionsscheine & Knock-outs“ (hebel.js) – und ein kurzer Überblick fürs Aktienprofil.
// Die Bewertung (fairer Wert, Preis-Check, Erwartung, ähnliche Scheine) steht in derivmodel.js; zwei Arten von Zahlen:
// - neutral, ohne Meinung: Preis-Check (Briefkurs gegenüber dem fairen Wert: Optionsschein bei der bisherigen
//   Schwankung der Aktie, Knock-out = innerer Wert) und beim Optionsschein der Vergleich mit ähnlichen Scheinen
//   anderer Emittenten (gleiche Richtung, Basispreis und Laufzeit ähnlich);
// - zur eigenen Erwartung (Kurs an einem Tag, Schwankung bis dahin): Ø Rendite, Gewinnchance, Risiko eines Verlusts
//   über 50 %, Knock-out-Risiko.
import { api } from "./api.js";
import { NOT_TR_TAG, trOnly } from "./broker.js";
import * as C from "./charts.js";
import {
  axisRange, densitySeries, describe, expect, figures, isMini, lev, level, marketOf, model, money, peerCheck, productPrice, valueAt,
} from "./derivmodel.js";
import { productTable } from "./derivtable.js";
import * as F from "./format.js";
import { term } from "./glossary.js";
import * as M from "./optionmath.js";

// Der Call/Put-Rechner holt alles Weitere von hier
export {
  axisRange, DEFAULT_MARGIN, DEFAULT_RATE, densitySeries, describe, isMini, kindLabel, lev, model, productPrice, stamp, unitScale,
} from "./derivmodel.js";

const esc = F.escapeHtml;
const MAX_COMPARE = 6;
const signed = (x) => (F.isNum(x) ? F.signedPct(x, Math.abs(x) >= 0.995 ? 0 : 1) : "–");
const retCell = (x, title = "") => `<td${title}>${F.isNum(x) ? `<b class="${x >= 0 ? "good" : "bad"}">${signed(x)}</b>` : "–"}</td>`;
const checkCell = (x, title = "") => `<td${title}>${F.isNum(x) ? `<span class="${x < 0 ? "good" : ""}">${signed(x)}</span>` : "–"}</td>`;
const CHECK_TITLE = (mk) => `Briefkurs gegenüber dem fairen Wert. Optionsschein: Black-Scholes mit ${F.pct(mk?.sigma, 0)} Schwankung p. a. (wie bisher bei der Aktie); Knock-out: innerer Wert, mit Fälligkeit der Terminwert (Zins bis dahin). +10 % = 10 % teurer als fair, negativ = günstiger. Unabhängig von Ihrer Erwartung.`;

// ---------------------------------------------------------------- Vergleich
/**
 * Bis zu sechs Produkte nebeneinander: Diagramm (Gewinn/Verlust je Aktienkurs am Tag Ihrer Erwartung) und Tabelle.
 * ctx: market(), scenario(), pool() (bewertete Produkte für „vs. ähnliche“), open(isin), changed(), anchor (Element,
 * das beim Erscheinen des Vergleichs nicht wegrutschen soll), rechnerLink(isins) (optional: Link in den Rechner).
 */
export function compareView(cmpEl, ctx) {
  const cmp = new Map(); // ISIN -> Produkt, in der Reihenfolge der Auswahl
  let chart = null;
  cmpEl.hidden = true;

  function paint(keepAnchor = false) {
    const before = keepAnchor && ctx.anchor ? ctx.anchor.getBoundingClientRect().top : null;
    cmpEl.hidden = cmp.size === 0;
    if (cmp.size) render();
    // die Liste soll beim Anklicken nicht wegrutschen, wenn darüber der Vergleich erscheint oder wächst
    if (before != null && before < window.innerHeight) window.scrollBy(0, ctx.anchor.getBoundingClientRect().top - before);
  }

  function render() {
    if (!cmp.size) return;
    const mk = ctx.market();
    const sc = ctx.scenario();
    const pool = ctx.pool();
    const items = [...cmp.values()].map((d) => { const m = model(d, mk); return { d, m, o: expect(m, sc), f: figures(d, m) }; });
    if (!cmpEl.querySelector(".dc-chart")) {
      cmpEl.innerHTML = `<div class="card" style="margin-top:12px">
        <div class="chart-title"><h3>Vergleich</h3><span class="muted dc-note"></span></div>
        <div class="chart dc-chart"></div>
        <div class="table-scroll" style="margin-top:8px"><table class="data dl-cmp"></table></div>
        <p class="muted dl-note dc-foot"></p>
        <div class="preset-row small" style="margin-top:6px"><button class="linklike" type="button" data-clear>Vergleich leeren</button>
          <a class="dc-rechner" hidden></a></div>
      </div>`;
      chart = null;
    }
    const link = cmpEl.querySelector(".dc-rechner");
    const href = ctx.rechnerLink?.([...cmp.keys()]);
    link.hidden = !href;
    if (href) { link.href = href; link.textContent = "Im Call/Put-Rechner vergleichen →"; }
    cmpEl.querySelector(".dc-note").textContent = sc
      ? `Gewinn oder Verlust je nach Aktienkurs am ${F.date(sc.day)}, bezogen auf den Briefkurs heute; die Fläche zeigt, wo die Aktie nach Ihrer Erwartung liegen dürfte`
      : "Ohne Kurs der Aktie lässt sich nichts rechnen";
    cmpEl.querySelector(".dc-foot").innerHTML = sc
      ? `${esc(sc.label)} · Gewinnschwelle und Preis-Check sind neutral; „vs. ähnliche“ vergleicht einen Optionsschein mit
        Scheinen anderer Emittenten aus der Liste (gleiche Richtung, Basispreis ±7 %, Laufzeit ±25 %).`
      : "";
    const rows = items.map(({ d, m, o, f }, i) => {
      const unit = d.under_ccy && d.under_ccy !== "EUR" ? d.under_ccy : "";
      const color = C.theme().series[i % 8];
      const peer = peerCheck({ d, m }, pool);
      const leverage = m ? Math.abs(M.leverage(m.p, m.S0, m.T, m.price)) : d.leverage;
      const sub = [describe(d, unit), F.isNum(f.theta) ? `Zeitwert ${F.signedPct(f.theta, 2)}/Tag` : null,
        F.isNum(f.delta) ? `Delta ${F.num(f.delta, 2)}` : null,
        d.kind === "ko" && m ? `KO ${F.signedPct(m.p.B / m.S0 - 1, 1)} entfernt` : null].filter(Boolean).join(" · ");
      return `<tr><td class="txt"><span class="dl-dot" style="background:${color}"></span><b>${esc(d.issuer || "")}</b> ${esc(d.wkn || "")}${d.tr ? "" : NOT_TR_TAG}
          <div class="sub">${esc(sub)}</div></td>
        <td>${productPrice(d) != null ? money(productPrice(d)) : "–"}</td>
        <td>${lev(Math.abs(leverage))}</td>
        <td>${F.pct(d.spread, 1)}</td>
        <td>${F.pct(f.spreadU, 2)}</td>
        ${checkCell(m?.check, m ? ` title="fairer Wert ${money(m.fair)}"` : "")}
        ${checkCell(peer?.check, peer ? ` title="Vergleich mit ${peer.n} ähnlichen Scheinen anderer Emittenten, deren mittlere Volatilität ${F.pct(peer.iv, 1)}; dieser Schein ${F.pct(m.p.vol, 1)}"` : d.kind === "os" ? ' title="zu wenige ähnliche Scheine anderer Emittenten in der Liste"' : "")}
        <td title="${f.be != null ? `Aktie ${d.kind === "os" ? "bei Fälligkeit " : ""}auf ${esc(F.money((1 + f.be) * mk.spot * mk.fx, mk.dccy))}` : ""}">${f.be != null ? F.signedPct(f.be, 1) : "–"}</td>
        ${retCell(o?.mean)}
        <td>${o ? F.pct(o.chance, 0) : "–"}</td>
        <td>${o ? F.pct(o.loss50, 0) : "–"}</td>
        <td>${o?.ko != null ? F.pct(o.ko, 0) : "–"}</td>
        <td class="dl-act"><button class="btn small" type="button" data-open="${esc(d.isin)}">Rechnen</button>
          <button class="linklike" type="button" data-drop="${esc(d.isin)}" title="aus dem Vergleich nehmen" aria-label="${esc(d.wkn || d.isin)} aus dem Vergleich nehmen">✕</button></td></tr>`;
    }).join("");
    const st = sc ? ` title="${esc(sc.label)}"` : "";
    cmpEl.querySelector(".dl-cmp").innerHTML = `<thead><tr><th scope="col" class="txt">Produkt</th><th>Brief</th><th>${term("omega", "Hebel")}</th>
        <th>${term("spanne", "Spanne")}</th><th>${term("spanne_aktie", "Spanne ÷ Hebel")}</th><th title="${esc(CHECK_TITLE(mk))}">${term("preischeck", "Preis-Check")}</th>
        <th title="Preis gegenüber vergleichbaren Optionsscheinen anderer Emittenten (mittlere implizite Volatilität)">${term("aehnliche", "vs. ähnliche")}</th>
        <th title="Kursänderung der Aktie, ab der das Produkt im Plus ist (Optionsschein: bei Fälligkeit)">${term("gewinnschwelle", "Gewinnschwelle")}</th>
        <th${st}>${term("erwartung", "Ø Erwartung")}</th><th${st}>Gewinnchance</th><th${st}>Verlust &gt; 50 %</th><th${st}>KO-Risiko</th>
        <th><span class="visually-hidden">Aktionen</span></th></tr></thead><tbody>${rows}</tbody>`;
    if (!(mk?.spot > 0) || !items.some((x) => x.m)) { cmpEl.querySelector(".dc-chart").hidden = true; return; }
    cmpEl.querySelector(".dc-chart").hidden = false;
    if (chart) chart.update();
    else chart = C.mount(cmpEl.querySelector(".dc-chart"), (t) => compareChart(t));
  }

  function compareChart(t) {
    const mk = ctx.market();
    const sc = ctx.scenario();
    const items = [...cmp.values()].map((d) => ({ d, m: model(d, mk) })).filter((x) => x.m);
    if (!items.length || !(mk?.spot > 0)) return {};
    const day = sc?.day || M.today();
    const X = sc ? mk.spot * sc.g : mk.spot;
    let lo = mk.spot * 0.7;
    let hi = mk.spot * 1.3;
    for (const { m } of items) {
      const mark = (m.p.kind === "ko" ? m.p.B : m.p.K) / m.S0 * mk.spot;
      lo = Math.min(lo, mark * 0.95);
      hi = Math.max(hi, mark * 1.05);
    }
    if (sc) {
      const [a, b] = M.likelyRange(X, sc.sigma, sc.t);
      lo = Math.min(lo, a * 0.9, X * 0.95);
      hi = Math.max(hi, b * 1.1, X * 1.05);
    }
    const ax = axisRange(Math.max(lo, mk.spot * 0.3) * mk.fx, Math.min(hi, mk.spot * 2.5) * mk.fx);
    const xs = Array.from({ length: 241 }, (_, i) => ax.lo + ((ax.hi - ax.lo) * i) / 240);
    const series = items.map(({ d, m }, i) => C.line(`${d.issuer || ""} ${d.wkn || ""}`.trim(),
      xs.map((x) => { const v = valueAt(m, mk, x / mk.fx, day); return [x, v / m.price - 1, v]; }), t.series[i % 8]));
    series[0].markLine = {
      symbol: "none", silent: true,
      data: [
        { xAxis: mk.spot * mk.fx, label: { formatter: "Kurs jetzt", color: t.secondary, position: "end", fontSize: 11 }, lineStyle: { color: t.secondary, type: "dashed", width: 1 } },
        ...(sc && Math.abs(sc.g - 1) > 0.01 ? [{ xAxis: X * mk.fx, label: { formatter: "Ihre Erwartung", color: t.good, position: "end", fontSize: 11, distance: 18 }, lineStyle: { color: t.good, type: "dashed", width: 1 } }] : []),
        { yAxis: 0, label: { show: false }, lineStyle: { color: t.baseline, type: "solid", width: 1 } },
      ],
    };
    const dens = sc ? densitySeries(t, xs, X, sc, mk.fx) : null;
    return {
      ...C.base(t),
      grid: { ...C.base(t).grid, top: 58 },
      tooltip: {
        ...C.base(t).tooltip,
        formatter: (params) => {
          const list = (Array.isArray(params) ? params : [params]).filter((q) => q.seriesId !== "dichte");
          if (!list.length) return "";
          const x = list[0].value[0];
          const rows = list.map((q) => `<div style="display:flex;gap:12px;justify-content:space-between"><span>${q.marker}${esc(q.seriesName)}</span>
            <b>${F.signedPct(q.value[1], 0)} <span style="font-weight:400;opacity:.7">${money(q.value[2])}</span></b></div>`);
          return `<div style="min-width:240px"><div style="margin-bottom:4px;opacity:.7">Aktie ${F.money(x, mk.dccy)} (${F.signedPct(x / (mk.spot * mk.fx) - 1, 1)})</div>${rows.join("")}</div>`;
        },
      },
      xAxis: C.valueAxis(t, { min: ax.lo, max: ax.hi, interval: ax.step, splitLine: { show: false }, axisLine: { show: true, lineStyle: { color: t.baseline } } }),
      yAxis: [C.valueAxis(t, { axisLabel: { color: t.muted, formatter: (v) => `${F.num(v * 100, 0)} %` } }), ...(dens ? [dens.axis] : [])],
      series: dens ? [...series, dens.series] : series,
    };
  }

  cmpEl.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]");
    if (open) { ctx.open(open.dataset.open); return; }
    const drop = e.target.closest("[data-drop]");
    if (drop) cmp.delete(drop.dataset.drop);
    else if (e.target.closest("[data-clear]")) cmp.clear();
    else return;
    paint();
    ctx.changed();
  });

  return {
    max: MAX_COMPARE,
    has: (isin) => cmp.has(isin),
    size: () => cmp.size,
    keys: () => [...cmp.keys()],
    add(d) { if (!cmp.has(d.isin) && cmp.size < MAX_COMPARE) cmp.set(d.isin, d); },
    toggle(d) {
      if (cmp.has(d.isin)) cmp.delete(d.isin);
      else if (cmp.size < MAX_COMPARE) cmp.set(d.isin, d);
    },
    paint,
    render,
  };
}

// ---------------------------------------------------------------- Tabelle mit Vergleich
/**
 * Tabelle und Vergleich. ctx: symbol, name, mode ("page" | "embedded"), kind(), call(), market(), scenario(), current()
 * (ISIN des Produkts im Rechner), open(isin), compare (ISINs aus der Adresse), changed() (Auswahl oder Filter geändert),
 * loaded() (Liste geladen, optional), bigLink() (eingebettet: große Ansicht), rechnerLink(isins) (Seite), initial.
 */
export function productList(listEl, cmpEl, ctx) {
  let table = null;
  let loaded; // erste Liste geladen: dann ist der Basiswert bei onvista bekannt
  const firstLoad = new Promise((resolve) => { loaded = resolve; });
  const cmp = compareView(cmpEl, {
    market: ctx.market, scenario: ctx.scenario, open: ctx.open, anchor: listEl, rechnerLink: ctx.rechnerLink,
    pool: () => table?.items() || [],
    changed: () => { table?.repaint(); ctx.changed(); },
  });
  table = productTable(listEl, {
    ...ctx, selection: cmp,
    onSelect: () => { cmp.paint(true); ctx.changed(); },
    onState: () => ctx.changed(),
    onLoaded: () => { cmp.render(); ctx.loaded?.(); loaded(); },
  });

  // Auswahl aus der Adresse: Produkte einzeln nachladen; nur die auf denselben Basiswert (ein Produkt auf eine andere
  // Aktie ließe sich mit diesem Kurs nicht rechnen). Bis dahin bleibt die Auswahl so in der Adresse, wie sie war.
  let pending = (ctx.compare || []).slice(0, MAX_COMPARE);
  (async () => {
    if (!pending.length) { pending = null; return; }
    const [found] = await Promise.all([Promise.all(pending.map((isin) => api.derivative(isin).catch(() => null))), firstLoad]);
    const under = table.under();
    for (const d of found) if (d && (!under?.isin || d.under?.isin === under.isin)) cmp.add(d);
    pending = null;
    if (cmp.size()) { cmp.paint(); table.repaint(); }
    ctx.changed();
  })();

  return {
    setKind: (kind, call) => table.setKind(kind, call),
    load: () => table.load(),
    // Kurs, Erwartung oder Annahmen geändert: nur neu rechnen
    repaint() { table.repaint(); cmp.render(); },
    selected: () => pending || cmp.keys(),
    has: (isin) => cmp.has(isin),
    toggle(d) { cmp.toggle(d); cmp.paint(); table.repaint(); ctx.changed(); },
    // ähnliche Scheine aus der geladenen Liste (für das Produkt im Rechner)
    peers: (d) => peerCheck({ d, m: model(d, ctx.market()) }, table.items()),
    state: () => table.state(),
  };
}

// ---------------------------------------------------------------- Überblick im Aktienprofil

const GROUP_NAMES = { "os-call": "Call-Optionsscheine", "os-put": "Put-Optionsscheine", "ko-call": "Knock-outs Long (Call)", "ko-put": "Knock-outs Short (Put)" };
const OVERVIEW_TOP = 3;
const OVERVIEW_NEAR = 0.15; // Optionsscheine im Überblick: Basispreis höchstens 15 % vom Kurs (weit aus dem Geld täuscht das Vola-Lächeln „billig“ vor)

/**
 * Was gibt es gerade an Hebelprodukten auf die Aktie? Je Gruppe die Anzahl und die drei typischen Produkte
 * (Laufzeit 3–12 Monate bzw. Hebel 5–10, Basispreis nahe am Kurs) mit dem günstigsten Preis-Check, dazu Links auf die
 * Seite mit allen Produkten und in den Rechner.
 */
export async function derivOverview(el, symbol, isCurrent) {
  el.innerHTML = '<p class="muted"><span class="spinner inline"></span>Lade Optionsscheine und Knock-outs von onvista …</p>';
  let u;
  let ov;
  try {
    [u, ov] = await Promise.all([api.underlying(symbol), api.derivativesOverview(symbol, trOnly())]);
  } catch (e) {
    if (isCurrent()) el.innerHTML = `<p class="muted">Hebelprodukte nicht verfügbar: ${esc(e.message)}</p>`;
    return;
  }
  if (!isCurrent()) return;
  if (!ov.under) {
    el.innerHTML = '<p class="muted">Zu dieser Aktie findet onvista keine Hebelprodukte (die Aktie ließ sich über ihre ISIN nicht zuordnen).</p>';
    return;
  }
  const mk = marketOf(u);
  const link = (g) => `#/hebel?${new URLSearchParams({ s: u.symbol || symbol, art: g.art, typ: g.typ })}`;
  const cards = ov.groups.map((g) => {
    const best = g.rows.map((d) => ({ d, m: model(d, mk) }))
      .filter((x) => x.m && x.m.check != null && (x.d.kind !== "os" || Math.abs(x.m.p.K / x.m.S0 - 1) <= OVERVIEW_NEAR))
      .sort((a, b) => a.m.check - b.m.check).slice(0, OVERVIEW_TOP);
    const rows = best.map(({ d, m }) => `<tr>
        <td class="txt">${esc(d.issuer || "")}<div class="sub">WKN ${esc(d.wkn || "–")}${isMini(d) ? '<span class="tag">Mini-Future</span>' : ""}${d.tr ? "" : NOT_TR_TAG}</div></td>
        <td>${level(d.kind === "ko" ? d.barrier : d.strike)}<span class="muted cp-v">${F.signedPct((d.kind === "ko" ? m.p.B : m.p.K) / m.S0 - 1, 0)}</span></td>
        <td>${d.open_end || !d.expiry ? "Open End" : F.date(d.expiry)}</td>
        <td title="Spanne ${F.pct(d.spread, 1)}">${money(m.price)}</td><td>${lev(d.leverage)}</td>
        ${checkCell(m.check, ` title="fairer Wert ${money(m.fair)} · Spanne ${F.pct(d.spread, 1)}"`)}
        <td><a href="#/callput?${new URLSearchParams({ p: d.isin })}" title="Im Call/Put-Rechner öffnen">Rechnen →</a></td></tr>`).join("");
    const name = GROUP_NAMES[`${g.art}-${g.typ}`];
    return `<div class="card dl-ov">
      <div class="chart-title"><h3>${name}</h3><span class="muted">${F.int(g.total)}${trOnly() ? " bei Trade Republic" : ""}</span></div>
      ${rows ? `<div class="table-scroll"><table class="data dl-table dl-mini"><thead><tr><th class="txt">Emittent</th>
          <th>${g.art === "ko" ? "Knock-out" : "Basispreis"}</th><th>Fälligkeit</th><th>Brief</th><th>${g.art === "ko" ? "Hebel" : "Omega"}</th>
          <th title="${esc(CHECK_TITLE(mk))}">Preis-Check</th><th><span class="visually-hidden">Rechnen</span></th></tr></thead>
          <tbody>${rows}</tbody></table></div>` : '<p class="muted">Keine typischen Produkte (Laufzeit 3–12 Monate, Hebel 5–10).</p>'}
      <p style="margin:8px 0 0"><a href="${link(g)}">Alle ${F.int(g.total)} in der großen Tabelle filtern, sortieren und vergleichen →</a></p>
    </div>`;
  }).join("");
  el.innerHTML = `<div class="grid two">${cards}</div>
    <p class="muted dl-note">Je Gruppe drei typische Produkte (Optionsscheine: Laufzeit 3–12 Monate, Omega 5–10, Basispreis höchstens 15 % vom Kurs;
      Knock-outs: Hebel 5–10) mit dem günstigsten ${term("preischeck", "Preis-Check")}: Briefkurs gegenüber dem fairen Wert bei ${F.pct(mk.sigma, 0)}
      Schwankung p. a. (wie im letzten Jahr) bzw. dem inneren Wert (Knock-outs mit Fälligkeit: Terminwert). Alle Produkte mit Filtern, Matrix und
      Landkarte zeigt die große Tabelle; ob ein Produkt zu Ihrer Erwartung passt, zeigt der Call/Put-Rechner.
      ${trOnly() ? "Nur Produkte, die Trade Republic handelt (Einstellung wie in der Weltauswahl)." : ""}</p>`;
}
