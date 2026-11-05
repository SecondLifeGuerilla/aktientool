// Kurze Rückmeldungen unten links („Zur Watchlist hinzugefügt“), auf Wunsch mit einer Aktion wie „Rückgängig“.
// Sie verschwinden nach einigen Sekunden von selbst; solange die Maus darauf steht, bleiben sie stehen.
import { escapeHtml as esc } from "./format.js";

let box = null;

function container() {
  if (!box) {
    box = document.createElement("div");
    box.className = "toasts";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    document.body.append(box);
  }
  return box;
}

// kind: "" | "good" | "bad"; action/onAction: Knopf in der Meldung (z. B. „Rückgängig“)
export function toast(text, { action = "", onAction = null, kind = "", ms = 4500 } = {}) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button" class="linklike">${esc(action)}</button>` : ""}
    <button type="button" class="toast-x" aria-label="Meldung schließen">✕</button>`;
  const close = () => {
    clearTimeout(timer);
    el.classList.add("out");
    setTimeout(() => el.remove(), 180);
  };
  let timer = setTimeout(close, action ? Math.max(ms, 7000) : ms);
  el.addEventListener("mouseenter", () => clearTimeout(timer));
  el.addEventListener("mouseleave", () => { timer = setTimeout(close, 2500); });
  el.querySelector(".toast-x").addEventListener("click", close);
  if (action) {
    el.querySelector(".linklike").addEventListener("click", async () => {
      close();
      try { await onAction?.(); } catch (e) { toast(e.message, { kind: "bad" }); }
    });
  }
  const c = container();
  c.append(el);
  while (c.children.length > 4) c.firstElementChild.remove();
  return close;
}
