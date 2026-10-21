// Lexikon: alle Fachbegriffe mit Erklärung, Wikipedia-Link und nachladbarer Wikipedia-Zusammenfassung
import { api } from "./api.js";
import { escapeHtml as esc } from "./format.js";
import { GROUPS, TERMS, wikiUrl } from "./glossary.js";

export function renderLexicon(root, params, isCurrent) {
  document.title = "Lexikon – Aktientool";
  const focus = params.get("begriff");
  const entries = Object.entries(TERMS);
  root.innerHTML = `
    <h1>Lexikon</h1>
    <p class="secondary" style="max-width:860px;margin-top:6px">Die Fachbegriffe des Tools kurz erklärt. Im ganzen Tool erscheinen sie
      gepunktet unterstrichen; beim Darüberfahren oder Antippen zeigt sich die Kurzfassung. Zu vielen Begriffen lässt sich hier
      zusätzlich die Zusammenfassung aus Wikipedia laden.</p>
    <div class="field" style="margin:14px 0 4px"><label for="lex-q">Begriff suchen</label>
      <input id="lex-q" class="wide" type="search" placeholder="z. B. KGV, Dividende, Score" autocomplete="off"></div>
    <nav class="preset-row" aria-label="Kategorien">${GROUPS.map((g) => `<a class="btn small" href="#lex-${encodeURIComponent(g)}" data-jump="${esc(g)}">${esc(g)}</a>`).join("")}</nav>
    ${GROUPS.map((g) => `
      <section class="section lex-group" id="lex-${esc(g)}">
        <h2>${esc(g)}</h2>
        <div class="grid two" style="margin-top:10px">
          ${entries.filter(([, t]) => t.group === g).map(([key, t]) => `
            <article class="card lex-entry" id="begriff-${key}" data-search="${esc(`${t.term} ${t.short} ${t.long || ""}`.toLowerCase())}">
              <h3>${esc(t.term)}</h3>
              <p style="margin-top:6px">${esc(t.short)}</p>
              ${t.long ? `<p class="secondary">${esc(t.long)}</p>` : ""}
              ${t.wiki ? `<div class="lex-actions">
                <button type="button" class="btn small" data-wiki="${esc(t.wiki)}">Zusammenfassung aus Wikipedia laden</button>
                <a href="${wikiUrl(t.wiki)}" target="_blank" rel="noopener">Wikipedia-Artikel öffnen ↗</a>
              </div>
              <div class="lex-wiki" hidden></div>` : ""}
            </article>`).join("")}
        </div>
      </section>`).join("")}`;

  root.querySelector("#lex-q").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    root.querySelectorAll(".lex-entry").forEach((el) => { el.hidden = Boolean(q) && !el.dataset.search.includes(q); });
    root.querySelectorAll(".lex-group").forEach((sec) => { sec.hidden = ![...sec.querySelectorAll(".lex-entry")].some((el) => !el.hidden); });
  });
  // Sprungmarken ohne Hash-Navigation (der Hash steuert die Seite)
  root.querySelector("nav").addEventListener("click", (e) => {
    const a = e.target.closest("[data-jump]");
    if (!a) return;
    e.preventDefault();
    document.getElementById(`lex-${a.dataset.jump}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-wiki]");
    if (!b) return;
    const box = b.closest(".lex-entry").querySelector(".lex-wiki");
    const [lang, title] = b.dataset.wiki.startsWith("en:") ? ["en", b.dataset.wiki.slice(3)] : ["de", b.dataset.wiki];
    b.disabled = true;
    b.textContent = "Wird geladen …";
    try {
      const w = await api.wiki(title, lang);
      if (!isCurrent()) return;
      box.innerHTML = `<p>${esc(w.extract)}</p><p class="muted" style="font-size:12px;margin:0">Quelle: Wikipedia${lang === "en" ? " (englisch)" : ""},
        Artikel „${esc(w.title)}“, Lizenz CC BY-SA 4.0${w.url ? ` · <a href="${esc(w.url)}" target="_blank" rel="noopener">weiterlesen ↗</a>` : ""}</p>`;
      box.hidden = false;
      b.remove();
    } catch (err) {
      b.disabled = false;
      b.textContent = "Zusammenfassung aus Wikipedia laden";
      box.innerHTML = `<p class="bad">${esc(err.message)}</p>`;
      box.hidden = false;
    }
  });

  if (focus && TERMS[focus]) {
    const el = root.querySelector(`#begriff-${focus}`);
    el.classList.add("highlight");
    requestAnimationFrame(() => el.scrollIntoView({ block: "center" }));
  }
}
