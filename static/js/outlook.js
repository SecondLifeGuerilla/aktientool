// Redaktionelle Einordnung: unabhängig von Kennzahlen und Scores nachladen.
import { api } from "./api.js";
import * as F from "./format.js";

const esc = F.escapeHtml;
const LEVELS = { low: ["gering", 1], medium: ["mittel", 2], high: ["hoch", 3], unknown: ["unklar", 0] };
const DIMENSIONS = { cost: "Kosten", revenue: "Neue Einnahmen", business: "Geschäftsmodell", moat: "Wettbewerbsvorteile", execution: "Umsetzung" };

export function outlookSection() {
  return `<section class="section outlook" id="sec-outlook" aria-labelledby="outlook-heading">
    <h2 id="outlook-heading">Zukunft: Chancen und Risiken</h2>
    <p class="lead">Wie KI und Automatisierung das Geschäft verändern könnten.</p>
    <div class="card" data-outlook-body aria-busy="true"><p role="status">Lade Einordnung …</p></div>
  </section>`;
}

function safeUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function refs(ids, sources) {
  return `<span class="outlook-refs">${ids.map((id) => {
    const i = sources.findIndex((s) => s.id === id);
    const s = sources[i];
    const url = s && safeUrl(s.url);
    return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Quelle ${i + 1}: ${esc(s.title)}">[${i + 1}]</a>` : "";
  }).join(" ")}</span>`;
}

function axis(label, value, cls, sources) {
  const [level, n] = LEVELS[value.level] || LEVELS.unknown;
  return `<div class="outlook-axis ${cls}">
    <div class="outlook-axis-head"><h3>${label}</h3><strong>${level}</strong></div>
    <div class="outlook-scale" aria-hidden="true">${[1, 2, 3].map((i) => `<span class="${i <= n ? "on" : ""}"></span>`).join("")}</div>
    <p>${esc(value.text)} ${refs(value.source_ids, sources)}</p>
  </div>`;
}

function coverageLinks(coverage) {
  return `<div class="outlook-coverage">${coverage.map((p) => `<a class="tag" href="#/aktie/${encodeURIComponent(p.symbol)}">${esc(p.name)}</a>`).join(" ")}</div>`;
}

function metric(w, p) {
  const value = p.business?.ttm?.[w.metric];
  if (!F.isNum(value)) return "";
  const label = w.metric === "operating_margin" ? "Operative Marge" : "Free-Cashflow-Marge";
  return `<span class="outlook-metric">${label}, letzte 12 Monate: <b>${F.pct(value, 1)}</b></span>`;
}

export function outlookContent(data, p) {
  if (data.status === "unavailable") {
    return `<p>Die Zukunftseinordnung ist gerade nicht verfügbar.</p><button class="btn" type="button" data-outlook-retry>Erneut versuchen</button>`;
  }
  if (data.status !== "available") {
    return `<p><b>${data.status === "identity_conflict" ? "Unternehmenszuordnung unklar." : `Für ${esc(p.name)} liegt noch keine geprüfte Einordnung vor.`}</b></p>
      <p class="secondary">${data.status === "identity_conflict" ? "Ticker und ISIN passen nicht zusammen. Deshalb wird keine Einordnung zugeordnet." : "Die Startauswahl umfasst die folgenden Unternehmen. Eine fehlende Einordnung bedeutet kein geringes Risiko."}</p>
      ${coverageLinks(data.coverage || [])}`;
  }
  const o = data.profile;
  const hasMetrics = o.watch.some((w) => F.isNum(p.business?.ttm?.[w.metric]));
  return `<div class="outlook-meta"><span class="tag">${esc(o.theme)}</span>
      <span>Geprüft am ${F.date(o.reviewed_at)}</span>
      ${data.stale ? '<span class="badge warning">Prüfung überfällig</span>' : ""}</div>
    ${data.stale ? `<p class="outlook-stale" role="note">Diese Einordnung wurde seit ${data.age_days} Tagen nicht geprüft. Entwicklungen seitdem können fehlen; erneute Prüfung fällig seit ${F.date(data.next_review)}.</p>` : ""}
    <p class="outlook-summary">${esc(o.summary)}</p>
    <p class="outlook-caption">Qualitative Einschätzung möglicher Entwicklungen · Chancen und Risiken getrennt betrachtet</p>
    <div class="outlook-axes">
      ${axis("Chancen", o.opportunity, "outlook-opportunity", o.sources)}
      ${axis("Risiken", o.risk, "outlook-risk", o.sources)}
    </div>
    <p class="outlook-uncertainty"><b>Was offen bleibt:</b> ${esc(o.uncertainty)}</p>
    <div class="outlook-watch"><h3>Darauf achten</h3><ul>${o.watch.map((w) => `<li><b>${esc(w.label)}:</b> ${esc(w.text)}${metric(w, p)}</li>`).join("")}</ul>
      ${hasMetrics ? '<p class="outlook-caption">Kennzahlen aus dem geladenen Finanzprofil. Eine Veränderung allein belegt keinen KI-Effekt.</p>' : ""}
    </div>
    <details class="outlook-details"><summary>Geschäft und Zeithorizont genauer ansehen</summary>
      <p class="outlook-caption">Eigene Ableitungen aus den Quellen; keine Prognosen des Unternehmens.</p>
      <dl class="outlook-dimensions">${o.dimensions.map((d) => `<div><dt>${esc(DIMENSIONS[d.key] || d.key)}</dt><dd>${esc(d.text)} ${refs(d.source_ids, o.sources)}</dd></div>`).join("")}</dl>
      <div class="outlook-horizons"><p><b>Kurzfristig</b><br>${esc(o.short_term)}</p><p><b>Längerfristig</b><br>${esc(o.long_term)}</p></div>
    </details>
    <details class="outlook-details"><summary>Belege und Quellen (${o.sources.length})</summary>
      <p class="outlook-caption">Die folgenden Angaben stammen vom Unternehmen. „Berichtet“ ist kein unabhängiger Nachweis; Ankündigungen sind noch keine Ergebnisse.</p>
      <ul class="outlook-evidence">${o.evidence.map((e) => `<li><span class="badge neutral">${e.kind === "reported" ? "Berichtet" : "Angekündigt"} · Unternehmensangabe</span><p>${esc(e.text)} ${refs(e.source_ids, o.sources)}</p></li>`).join("")}</ul>
      <ol class="outlook-sources">${o.sources.map((s) => {
        const url = safeUrl(s.url);
        return `<li>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a>` : esc(s.title)}<br><span>${esc(s.publisher)} · veröffentlicht am ${F.date(s.published)}</span></li>`;
      }).join("")}</ol>
    </details>
    <details class="outlook-details"><summary>Wie diese Einordnung entsteht</summary>
      <p>Die Texte sind eine redaktionelle Einschätzung anhand der datierten Quellen. „Hoch“ bedeutet: könnte wesentliche Teile des Geschäfts betreffen. „Mittel“: könnte einzelne wichtige Bereiche betreffen. „Gering“: voraussichtlich begrenzter Einfluss. „Unklar“: für eine Einordnung fehlen Belege. Die Stufen sind keine Wahrscheinlichkeiten und werden nicht zu einem Gesamtscore verrechnet.</p>
      <p>Nach ${data.review_days} Tagen ohne Prüfung wird die Einordnung als überfällig markiert. Kursabrufe und neue Nachrichten aktualisieren diese Texte nicht. Nächste Prüfung: ${F.date(data.next_review)}.</p>
      <p>Finanzscores und fairer Wert werden separat berechnet. Ob Chancen bereits im Kurs stecken, muss zusätzlich anhand der Bewertung geprüft werden.</p>
      <p>Aktuell erfasste Unternehmen:</p>${coverageLinks(data.coverage)}
    </details>`;
}

export async function loadOutlook(root, p, isCurrent) {
  const body = root.querySelector("[data-outlook-body]");
  if (!body) return;
  // Auch bei einem erneuten Laden desselben Profils darf eine alte Antwort nichts überschreiben.
  const alive = () => isCurrent() && root.querySelector("[data-outlook-body]") === body;
  body.setAttribute("aria-busy", "true");
  try {
    const data = await api.outlook(p.symbol, p.facts?.isin || "");
    if (!alive()) return;
    body.innerHTML = outlookContent(data, p);
  } catch {
    if (!alive()) return;
    body.innerHTML = '<p>Die Zukunftseinordnung konnte nicht geladen werden.</p><button class="btn" type="button" data-outlook-retry>Erneut versuchen</button>';
  } finally {
    if (alive()) {
      body.setAttribute("aria-busy", "false");
      body.querySelector("[data-outlook-retry]")?.addEventListener("click", (e) => {
        e.currentTarget.disabled = true;
        loadOutlook(root, p, isCurrent);
      });
    }
  }
}
