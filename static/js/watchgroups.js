// Gruppen und Untergruppen der Watchlist: frei benannt, aus Vorlagen oder automatisch (Sektor, Land, Bewertung …).
// Eine Aktie kann in mehreren Gruppen stehen; was in einer Untergruppe steht, zählt auch zur übergeordneten Gruppe.
// Gespeichert wird immer der ganze Baum (PUT /api/watchgruppen); Änderungen lassen sich per „Rückgängig“ zurückdrehen.
import { api } from "./api.js";
import * as F from "./format.js";
import { toast } from "./toast.js";

const esc = F.escapeHtml;
export const MAX_DEPTH = 3;

// ---------------------------------------------------------------- Speicher

let cache = null;
export async function getGroups() {
  if (!cache) cache = await api.watchGroups();
  return cache;
}
export async function saveGroups(groups) {
  cache = await api.saveWatchGroups(groups);
  document.dispatchEvent(new CustomEvent("watchgroups-changed"));
  return cache;
}
// speichern und „Rückgängig“ anbieten; onChange(groups) zeichnet die Seite neu (auch nach dem Zurückdrehen)
export async function saveWithUndo(prev, next, message, onChange) {
  const saved = await saveGroups(next);
  onChange?.(saved);
  toast(message, {
    kind: "good", action: "Rückgängig",
    onAction: async () => onChange?.(await saveGroups(prev)),
  });
  return saved;
}

export const clone = (groups) => groups.map((g) => ({ ...g, symbols: [...(g.symbols || [])] }));
const newId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ---------------------------------------------------------------- Baum

export const childrenOf = (groups, id) => groups.filter((g) => (g.parent || null) === (id || null));

// in Anzeigereihenfolge: [{g, depth}] mit depth 0 für die oberste Ebene
export function flatten(groups, rootId = null) {
  const out = [];
  const walk = (pid, depth) => { for (const g of childrenOf(groups, pid)) { out.push({ g, depth }); walk(g.id, depth + 1); } };
  walk(rootId, 0);
  return out;
}
export function descendantIds(groups, id) {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) ids.push(...childrenOf(groups, ids[i]).map((g) => g.id));
  return ids;
}
export function pathOf(groups, id) {
  const names = [];
  for (let g = groups.find((x) => x.id === id); g; g = groups.find((x) => x.id === g.parent)) names.unshift(g.name);
  return names;
}
export const pathLabel = (groups, id) => pathOf(groups, id).join(" › ");
export const depthOf = (groups, id) => pathOf(groups, id).length; // 1 = oberste Ebene
// Ebenen einschließlich der Gruppe selbst (für „Verschieben“: passt der Teilbaum noch unter das Ziel?)
function heightOf(groups, id) {
  const kids = childrenOf(groups, id);
  return 1 + (kids.length ? Math.max(...kids.map((k) => heightOf(groups, k.id))) : 0);
}
export function topAncestor(groups, id) {
  let g = groups.find((x) => x.id === id);
  while (g?.parent) g = groups.find((x) => x.id === g.parent);
  return g || null;
}
// Aktien der Gruppe samt Untergruppen; watch (Set) blendet Aktien aus, die nicht mehr auf der Watchlist stehen
export function symbolsIn(groups, id, watch = null) {
  const set = new Set();
  for (const gid of descendantIds(groups, id)) for (const s of groups.find((g) => g.id === gid)?.symbols || []) if (!watch || watch.has(s)) set.add(s);
  return set;
}
export const groupsOf = (groups, sym) => groups.filter((g) => g.symbols.includes(sym));
export function ungrouped(groups, watch) {
  const inAny = new Set(groups.flatMap((g) => g.symbols));
  return [...watch].filter((s) => !inAny.has(s));
}

function findOrCreate(groups, parent, name) {
  let g = groups.find((x) => (x.parent || null) === (parent || null) && x.name.toLowerCase() === name.toLowerCase());
  if (!g) { g = { id: newId(), name, parent: parent || null, symbols: [] }; groups.push(g); }
  return g;
}
// neue Gruppe im Entwurf anlegen; wirft bei leerem Namen, doppeltem Namen oder zu tiefer Verschachtelung
export function addGroup(groups, name, parent = null) {
  name = String(name || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name) throw new Error("Bitte einen Namen eingeben.");
  if (parent && depthOf(groups, parent) >= MAX_DEPTH) throw new Error(`Höchstens ${MAX_DEPTH} Ebenen.`);
  if (groups.some((x) => (x.parent || null) === (parent || null) && x.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`„${name}“ gibt es an dieser Stelle schon.`);
  }
  const g = { id: newId(), name, parent: parent || null, symbols: [] };
  groups.push(g);
  return g;
}

// ---------------------------------------------------------------- Vorlagen und automatische Einteilung

export const TEMPLATES = [
  ["Status", ["Kaufkandidaten", "Beobachten", "Zu teuer – auf Preis warten", "Später genauer prüfen", "Verkauft – weiter beobachten"]],
  ["Strategie", ["Dividende", "Dividendenwachstum", "Wachstum", "Qualität zum fairen Preis", "Value / Turnaround", "Spekulativ"]],
  ["Horizont", ["Langfristig halten", "Mittelfristig", "Trading-Idee"]],
];

const bucketDev = (r) => (!F.isNum(r.deviation) ? "Ohne Bewertung" : r.deviation < -0.1 ? "Unterbewertet (mehr als 10 % unter fair)"
  : r.deviation <= 0.1 ? "Etwa fair bewertet (± 10 %)" : "Überbewertet (mehr als 10 % über fair)");
const bucketYield = (r) => (!(r.div_yield > 0) ? "Keine Dividende" : r.div_yield < 0.02 ? "unter 2 %" : r.div_yield < 0.04 ? "2 bis 4 %" : "4 % und mehr");
// Börsenwert kommt in Euro (eur.summary)
const bucketCap = (r) => (!F.isNum(r.market_cap) ? "Unbekannt" : r.market_cap >= 100e9 ? "Groß (ab 100 Mrd. €)"
  : r.market_cap >= 10e9 ? "Mittel (10 bis 100 Mrd. €)" : "Klein (unter 10 Mrd. €)");

// levels: je Ebene eine Funktion Zeile → Name der Untergruppe
export const AUTO = [
  { key: "sector", label: "Sektor › Branche", root: "Nach Sektor", levels: [(r) => r.sector || "Ohne Sektor", (r) => r.industry || "Sonstige"] },
  { key: "country", label: "Land", root: "Nach Land", levels: [(r) => r.country || "Unbekannt"] },
  { key: "valuation", label: "Bewertung (Kurs vs. fairer Wert)", root: "Nach Bewertung", levels: [bucketDev] },
  { key: "yield", label: "Dividendenrendite", root: "Nach Dividende", levels: [bucketYield] },
  { key: "size", label: "Börsenwert", root: "Nach Größe", levels: [bucketCap] },
];

// Teilt die geladenen Aktien unter einer Obergruppe (z. B. „Nach Sektor“) ein. Erneut ausgeführt, wird die Einteilung
// auf den aktuellen Stand gebracht: Aktien wandern um, leere automatische Untergruppen verschwinden. Eigene Gruppen bleiben.
export function applyAuto(groups, auto, rows) {
  const root = findOrCreate(groups, null, auto.root);
  const inside = new Set(descendantIds(groups, root.id));
  const syms = new Set(rows.map((r) => r.symbol));
  for (const g of groups) if (inside.has(g.id)) g.symbols = g.symbols.filter((s) => !syms.has(s));
  for (const r of rows) {
    let g = root;
    for (const level of auto.levels) g = findOrCreate(groups, g.id, String(level(r)).slice(0, 60));
    g.symbols.push(r.symbol);
  }
  // leere Untergruppen der Obergruppe entfernen (von unten nach oben)
  for (const { g } of flatten(groups, root.id).reverse()) {
    if (!g.symbols.length && !childrenOf(groups, g.id).length) groups.splice(groups.indexOf(g), 1);
  }
  return root;
}

// ---------------------------------------------------------------- Dialoge

function dialogShell(cls, title) {
  const dlg = document.createElement("dialog");
  dlg.className = `keys-dialog grp-dialog ${cls}`;
  dlg.innerHTML = `<div class="chart-title"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Schließen">✕</button></div><div class="grp-body"></div>`;
  document.body.append(dlg);
  return dlg;
}

function parentOptions(groups, selected = "", exclude = null) {
  const blocked = exclude ? new Set(descendantIds(groups, exclude)) : new Set();
  const need = exclude ? heightOf(groups, exclude) : 1;
  return `<option value="">Oberste Ebene</option>${flatten(groups)
    .filter(({ g, depth }) => !blocked.has(g.id) && depth + 1 + need <= MAX_DEPTH)
    .map(({ g, depth }) => `<option value="${esc(g.id)}" ${g.id === selected ? "selected" : ""}>${" ".repeat(depth)}unter ${esc(g.name)}</option>`).join("")}`;
}

function templateChips(groups, parent) {
  const taken = new Set(childrenOf(groups, parent).map((g) => g.name.toLowerCase()));
  return TEMPLATES.map(([title, names]) => {
    const free = names.filter((n) => !taken.has(n.toLowerCase()));
    return free.length ? `<div class="grp-tpl"><span class="field-label">${esc(title)}</span>${free.map((n) =>
      `<button type="button" class="btn small" data-tpl="${esc(n)}">+ ${esc(n)}</button>`).join("")}</div>` : "";
  }).join("");
}

// Aktien in Gruppen einteilen. symbols: Ticker; title: Überschrift. Ergebnis: gespeicherte Gruppen oder null (abgebrochen).
export function openAssign(symbols, title) {
  return new Promise((resolve) => {
    getGroups().then((saved) => {
      const draft = clone(saved);
      const prev = clone(saved);
      const dlg = dialogShell("grp-assign", title);
      const body = dlg.querySelector(".grp-body");
      // Zustand je Gruppe: true (alle drin), false (keine), "some" (teilweise, bleibt so, solange nicht angeklickt)
      const state = new Map(draft.map((g) => {
        const n = symbols.filter((s) => g.symbols.includes(s)).length;
        return [g.id, n === 0 ? false : n === symbols.length ? true : "some"];
      }));
      let parentSel = "";
      let done = false;
      const finish = (val) => { if (done) return; done = true; dlg.close(); dlg.remove(); resolve(val); };

      function paint() {
        const rows = flatten(draft);
        body.innerHTML = `
          <p class="muted" style="font-size:13px;margin:4px 0 10px">Häkchen setzen oder entfernen. Eine Aktie kann in mehreren Gruppen stehen;
            was in einer Untergruppe steht, sehen Sie auch in der Gruppe darüber.</p>
          ${rows.length ? `<ul class="grp-tree">${rows.map(({ g, depth }) => `<li style="--d:${depth}"><label>
              <input type="checkbox" data-g="${esc(g.id)}" ${state.get(g.id) === true ? "checked" : ""}> ${esc(g.name)}</label></li>`).join("")}</ul>`
            : '<p class="muted">Noch keine Gruppen. Legen Sie unten eine an oder nehmen Sie eine Vorlage.</p>'}
          <div class="grp-new">
            <div class="field"><label for="ga-name">Neue Gruppe</label><input id="ga-name" class="wide" maxlength="60" placeholder="z. B. Halbleiter"></div>
            <div class="field"><label for="ga-parent">Ebene</label><select id="ga-parent">${parentOptions(draft, parentSel)}</select></div>
            <button type="button" class="btn" data-act="new">Anlegen</button>
          </div>
          <details class="grp-tpls"><summary>Vorlagen</summary>${templateChips(draft, parentSel || null) || '<p class="muted">Alle Vorlagen dieser Ebene sind schon angelegt.</p>'}</details>
          <div class="grp-actions"><button type="button" class="btn" data-close>Abbrechen</button><button type="button" class="btn primary" data-act="apply">Übernehmen</button></div>`;
        body.querySelectorAll("input[data-g]").forEach((cb) => { if (state.get(cb.dataset.g) === "some") cb.indeterminate = true; });
      }
      function create(name) {
        try {
          const g = addGroup(draft, name, parentSel || null);
          state.set(g.id, true);
          paint();
        } catch (e) { toast(e.message, { kind: "bad" }); }
      }

      dlg.addEventListener("click", async (e) => {
        if (e.target === dlg || e.target.closest("[data-close]")) { finish(null); return; }
        const tpl = e.target.closest("[data-tpl]");
        if (tpl) { create(tpl.dataset.tpl); return; }
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "new") create(body.querySelector("#ga-name").value);
        if (act === "apply") {
          for (const g of draft) {
            const st = state.get(g.id);
            if (st === true) g.symbols = [...new Set([...g.symbols, ...symbols])];
            if (st === false) g.symbols = g.symbols.filter((s) => !symbols.includes(s));
          }
          try {
            const n = symbols.length;
            finish(await saveWithUndo(prev, draft, `${n === 1 ? "Gruppen der Aktie" : `Gruppen von ${F.int(n)} Aktien`} gespeichert.`, null));
          } catch (err) { toast(err.message, { kind: "bad" }); }
        }
      });
      dlg.addEventListener("change", (e) => {
        if (e.target.matches("input[data-g]")) state.set(e.target.dataset.g, e.target.checked);
        if (e.target.id === "ga-parent") { parentSel = e.target.value; const v = body.querySelector("#ga-name").value; paint(); body.querySelector("#ga-name").value = v; }
      });
      dlg.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "ga-name") { e.preventDefault(); create(e.target.value); } });
      dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(null); });
      paint();
      dlg.showModal();
      body.querySelector("#ga-name")?.focus();
    }).catch((e) => { toast(e.message, { kind: "bad" }); resolve(null); });
  });
}

// Gruppen verwalten: anlegen, umbenennen, verschieben, sortieren, löschen, Vorlagen, automatisch einteilen.
// rows: geladene Kennzahlen der Watchlist (für die automatische Einteilung); watch: Set der gemerkten Ticker.
export function openManage(rows, watch) {
  return new Promise((resolve) => {
    getGroups().then((saved) => {
      let draft = clone(saved);
      const prev = clone(saved);
      const dlg = dialogShell("grp-manage", "Gruppen verwalten");
      const body = dlg.querySelector(".grp-body");
      let parentSel = "";
      let done = false;
      const finish = (val) => { if (done) return; done = true; dlg.close(); dlg.remove(); resolve(val); };
      const count = (id) => symbolsIn(draft, id, watch).size;

      function paint() {
        const rowsFlat = flatten(draft);
        const autoCount = rows.length;
        body.innerHTML = `
          <div class="grp-cols">
            <div>
              <h3>Ihre Gruppen</h3>
              ${rowsFlat.length ? `<ul class="grp-tree edit">${rowsFlat.map(({ g, depth }) => {
                const sibs = childrenOf(draft, g.parent);
                const i = sibs.indexOf(g);
                return `<li style="--d:${depth}" data-id="${esc(g.id)}">
                  <input class="grp-name" value="${esc(g.name)}" maxlength="60" aria-label="Name der Gruppe">
                  <span class="muted grp-count">${F.int(count(g.id))}</span>
                  <span class="grp-tools">
                    <button type="button" class="icon-btn" data-act="up" ${i === 0 ? "disabled" : ""} title="Nach oben" aria-label="Nach oben">↑</button>
                    <button type="button" class="icon-btn" data-act="down" ${i === sibs.length - 1 ? "disabled" : ""} title="Nach unten" aria-label="Nach unten">↓</button>
                    ${depth + 1 < MAX_DEPTH ? '<button type="button" class="btn small" data-act="sub" title="Untergruppe anlegen">+ Untergruppe</button>' : ""}
                    <select data-act="move" aria-label="Verschieben" title="Verschieben">${parentOptions(draft, g.parent || "", g.id)}</select>
                    <button type="button" class="icon-btn danger" data-act="del" title="Gruppe löschen (Aktien bleiben auf der Watchlist)" aria-label="Löschen">✕</button>
                  </span></li>`;
              }).join("")}</ul>` : '<p class="muted">Noch keine Gruppen.</p>'}
              <div class="grp-new">
                <div class="field"><label for="gm-name">Neue Gruppe</label><input id="gm-name" class="wide" maxlength="60" placeholder="z. B. Halbleiter"></div>
                <div class="field"><label for="gm-parent">Ebene</label><select id="gm-parent">${parentOptions(draft, parentSel)}</select></div>
                <button type="button" class="btn" data-act="new">Anlegen</button>
              </div>
            </div>
            <div>
              <h3>Vorlagen</h3>
              <p class="muted" style="font-size:13px">Fertige Namen mit einem Klick anlegen (auf der gewählten Ebene).</p>
              ${templateChips(draft, parentSel || null) || '<p class="muted">Alle Vorlagen dieser Ebene sind schon angelegt.</p>'}
              <h3 style="margin-top:16px">Automatisch einteilen</h3>
              <p class="muted" style="font-size:13px">Legt eine Obergruppe mit passenden Untergruppen an und sortiert die
                ${F.int(autoCount)} geladenen Aktien ein. Nochmals klicken bringt die Einteilung auf den aktuellen Stand.</p>
              <div class="grp-tpl">${AUTO.map((a) => `<button type="button" class="btn small" data-auto="${a.key}" ${autoCount ? "" : "disabled"}>${esc(a.label)}</button>`).join("")}</div>
              ${autoCount ? "" : '<p class="muted" style="font-size:13px">Warten Sie, bis die Kennzahlen der Watchlist geladen sind.</p>'}
            </div>
          </div>
          <div class="grp-actions"><button type="button" class="btn" data-close>Abbrechen</button><button type="button" class="btn primary" data-act="save">Speichern</button></div>`;
      }
      const keepInput = (fn) => { const v = body.querySelector("#gm-name")?.value || ""; fn(); paint(); const el = body.querySelector("#gm-name"); if (el) el.value = v; };
      function create(name, parent = parentSel || null) {
        try { addGroup(draft, name, parent); paint(); } catch (e) { toast(e.message, { kind: "bad" }); }
      }
      // Reihenfolge unter Geschwistern tauschen: in der Gesamtliste die Plätze der beiden tauschen
      function swap(g, dir) {
        const sibs = childrenOf(draft, g.parent);
        const other = sibs[sibs.indexOf(g) + dir];
        if (!other) return;
        const a = draft.indexOf(g), b = draft.indexOf(other);
        [draft[a], draft[b]] = [draft[b], draft[a]];
      }

      dlg.addEventListener("click", async (e) => {
        if (e.target === dlg || e.target.closest("[data-close]")) { finish(null); return; }
        const tpl = e.target.closest("[data-tpl]");
        if (tpl) { create(tpl.dataset.tpl); return; }
        const auto = e.target.closest("[data-auto]");
        if (auto) {
          const a = AUTO.find((x) => x.key === auto.dataset.auto);
          try {
            const test = clone(draft);
            applyAuto(test, a, rows);
            if (flatten(test).length > 300) throw new Error("Das wären zu viele Gruppen.");
            draft = test;
            paint();
            toast(`„${a.root}“ eingeteilt. Mit „Speichern“ übernehmen.`);
          } catch (err) { toast(err.message, { kind: "bad" }); }
          return;
        }
        const btn = e.target.closest("button[data-act]");
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === "new") { create(body.querySelector("#gm-name").value); return; }
        if (act === "save") {
          try { finish(await saveWithUndo(prev, draft, "Gruppen gespeichert.", null)); } catch (err) { toast(err.message, { kind: "bad" }); }
          return;
        }
        const g = draft.find((x) => x.id === btn.closest("li[data-id]")?.dataset.id);
        if (!g) return;
        if (act === "up" || act === "down") keepInput(() => swap(g, act === "up" ? -1 : 1));
        if (act === "sub") {
          let n = 1;
          while (childrenOf(draft, g.id).some((x) => x.name === `Neue Untergruppe${n > 1 ? ` ${n}` : ""}`)) n++;
          let sub;
          keepInput(() => { sub = addGroup(draft, `Neue Untergruppe${n > 1 ? ` ${n}` : ""}`, g.id); });
          const input = body.querySelector(`li[data-id="${CSS.escape(sub.id)}"] .grp-name`);
          input?.focus(); input?.select();
        }
        if (act === "del") {
          const ids = new Set(descendantIds(draft, g.id));
          keepInput(() => { draft = draft.filter((x) => !ids.has(x.id)); });
        }
      });
      dlg.addEventListener("change", (e) => {
        if (e.target.id === "gm-parent") { keepInput(() => { parentSel = e.target.value; }); return; }
        const li = e.target.closest("li[data-id]");
        const g = li && draft.find((x) => x.id === li.dataset.id);
        if (!g) return;
        if (e.target.matches(".grp-name")) {
          const name = e.target.value.replace(/\s+/g, " ").trim().slice(0, 60);
          if (!name) { e.target.value = g.name; return; }
          if (childrenOf(draft, g.parent).some((x) => x !== g && x.name.toLowerCase() === name.toLowerCase())) {
            toast(`„${name}“ gibt es an dieser Stelle schon.`, { kind: "bad" }); e.target.value = g.name; return;
          }
          g.name = name;
        }
        if (e.target.matches("select[data-act=move]")) {
          const target = e.target.value || null;
          if (childrenOf(draft, target).some((x) => x !== g && x.name.toLowerCase() === g.name.toLowerCase())) {
            toast(`Dort gibt es schon eine Gruppe „${g.name}“.`, { kind: "bad" }); e.target.value = g.parent || ""; return;
          }
          // ans Ende der neuen Geschwister
          keepInput(() => { g.parent = target; draft.splice(draft.indexOf(g), 1); draft.push(g); });
        }
      });
      dlg.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        if (e.target.id === "gm-name") { e.preventDefault(); create(e.target.value); }
        else if (e.target.matches(".grp-name")) { e.preventDefault(); e.target.blur(); }
      });
      dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(null); });
      paint();
      dlg.showModal();
      body.querySelector("#gm-name")?.focus();
    }).catch((e) => { toast(e.message, { kind: "bad" }); resolve(null); });
  });
}
