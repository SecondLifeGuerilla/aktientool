// Suche mit Vorschlägen (Kopfzeile, Startseite und Eingabefelder für Ticker)
import { api } from "./api.js";
import { NOT_TR_TAG } from "./broker.js";
import { escapeHtml } from "./format.js";
import { recent } from "./recent.js";

// onPick: statt das Profil zu öffnen, wird der gewählte Ticker übergeben (z. B. im Depot-Formular)
export function attachSearch(input, list, onPick = null) {
  let items = [];
  let heading = ""; // „Zuletzt angesehen“, solange das Feld leer ist
  let active = -1;
  let timer = null;
  let seq = 0;

  const close = () => { list.hidden = true; active = -1; };
  const go = (sym) => {
    close();
    if (onPick) { onPick(sym); return; }
    input.value = ""; input.blur(); location.hash = `#/aktie/${encodeURIComponent(sym)}`;
  };
  const paint = () => {
    list.innerHTML = (heading && items.length ? `<li class="sr-head" role="presentation">${escapeHtml(heading)}</li>` : "") + items.map((it, i) => `
      <li role="option" data-i="${i}" aria-selected="${i === active}">
        <span class="sym">${escapeHtml(it.symbol)}</span>
        <span>${escapeHtml(it.name)}${it.tr === false ? NOT_TR_TAG : ""}</span>
        <span class="ex">${escapeHtml(it.exchange || "")}</span>
      </li>`).join("");
    list.hidden = items.length === 0;
  };

  // leeres Feld: die zuletzt angesehenen Aktien zum schnellen Wiederfinden
  const showRecent = () => {
    if (input.value.trim()) return;
    items = recent().map((r) => ({ symbol: r.symbol, name: r.name, exchange: "" }));
    heading = "Zuletzt angesehen";
    active = -1;
    paint();
  };
  input.addEventListener("focus", showRecent);
  input.addEventListener("click", () => { if (list.hidden) showRecent(); });

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { seq++; showRecent(); return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const res = await api.search(q);
        if (my !== seq) return;
        items = res;
        heading = "";
        active = items.length ? 0 : -1;
        paint();
      } catch (e) { /* Vorschläge sind optional; Enter mit Ticker funktioniert trotzdem */ }
    }, 250);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && list.hidden && !input.value.trim()) { showRecent(); e.preventDefault(); return; }
    if (e.key === "ArrowDown" && items.length) { active = (active + 1) % items.length; paint(); e.preventDefault(); }
    else if (e.key === "ArrowUp" && items.length) { active = (active - 1 + items.length) % items.length; paint(); e.preventDefault(); }
    else if (e.key === "Enter") {
      const q = input.value.trim();
      const open = !list.hidden && active >= 0 && items[active];
      if (onPick && !open) return; // Formular normal absenden
      if (open) go(items[active].symbol);
      else if (q) go(q.toUpperCase()); // direkte Tickereingabe, z. B. ALV.DE
      e.preventDefault();
    } else if (e.key === "Escape") {
      if (list.hidden) input.blur();
      close();
    }
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) { e.preventDefault(); go(items[Number(li.dataset.i)].symbol); }
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
}
