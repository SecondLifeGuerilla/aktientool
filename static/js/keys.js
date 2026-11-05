// Tastenkürzel: „/“ sucht, „g“ und ein Buchstabe wechselt die Seite, „?“ zeigt die Übersicht. Seiten können eigene Kürzel
// anmelden (z. B. das Profil ← → zum Blättern); app.js meldet sie bei jedem Seitenwechsel wieder ab.
// Kürzel greifen nicht, solange man in ein Eingabefeld tippt.
import { escapeHtml as esc } from "./format.js";
import { tourRunning } from "./mode.js";

export const GO_KEYS = [
  ["h", "#/", "Übersicht"], ["w", "#/welt", "Weltauswahl"], ["l", "#/watchlist", "Watchlist"], ["d", "#/depot", "Depot"],
  ["a", "#/alarme", "Alarme"], ["t", "#/trusts", "Trusts & Holdings"], ["s", "#/screener", "Screener"], ["v", "#/vergleich", "Vergleich"],
  ["o", "#/hebel", "Optionsscheine & Knock-outs"], ["r", "#/callput", "Call/Put-Rechner"], ["x", "#/lexikon", "Lexikon"],
];
// Kürzel einzelner Seiten für die Übersicht (die Funktionen melden die Seiten selbst an)
const PAGE_HELP = [
  ["Aktienprofil", [["←  →", "vorige / nächste Aktie der Liste, aus der Sie das Profil geöffnet haben"], ["b", "zurück zu dieser Liste"],
    ["m", "auf die Watchlist setzen oder entfernen"], ["n", "zu den Notizen"]]],
  ["Weltauswahl", [["f", "Filter ein- oder ausklappen"], ["s", "Suchfeld der Weltauswahl"]]],
];

let pageKeys = null;
let gPending = 0;

export function setPageKeys(map) { pageKeys = map; }

const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

function focusSearch() {
  const input = document.getElementById("search-input");
  input.focus();
  input.select();
}

let dialog = null;
export function showShortcuts() {
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "keys-dialog";
    const row = ([k, text]) => `<tr><td>${k.split(" ").filter(Boolean).map((x) => `<kbd>${esc(x)}</kbd>`).join(" ")}</td><td>${esc(text)}</td></tr>`;
    dialog.innerHTML = `
      <div class="chart-title"><h2>Tastenkürzel</h2><button type="button" class="icon-btn" data-close aria-label="Schließen">✕</button></div>
      <p class="muted" style="font-size:13px">Gelten überall, solange Sie nicht gerade in ein Eingabefeld tippen.</p>
      <div class="keys-cols">
        <div><h3>Überall</h3><table class="keys"><tbody>
          ${[["/", "Aktie suchen (auch ⌘ K)"], ["?", "diese Übersicht"], ["Esc", "Suche, Menü oder Fenster schließen"]].map(row).join("")}
        </tbody></table>
        <h3 style="margin-top:14px">Seite wechseln: erst <kbd>g</kbd>, dann …</h3><table class="keys"><tbody>
          ${GO_KEYS.map(([k, , label]) => row([k, label])).join("")}
        </tbody></table></div>
        <div>${PAGE_HELP.map(([title, rows]) => `<h3>${esc(title)}</h3><table class="keys"><tbody>${rows.map(row).join("")}</tbody></table>`).join('<div style="height:14px"></div>')}
          <h3 style="margin-top:14px">In der Suche</h3><table class="keys"><tbody>
          ${[["↓ ↑", "Vorschlag wählen (leeres Feld: zuletzt angesehene Aktien)"], ["Enter", "Profil öffnen, auch direkt per Ticker wie ALV.DE"]].map(row).join("")}
          </tbody></table></div>
      </div>`;
    dialog.addEventListener("click", (e) => { if (e.target === dialog || e.target.closest("[data-close]")) dialog.close(); });
    document.body.append(dialog);
  }
  if (!dialog.open) dialog.showModal();
}

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); focusSearch(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || typing(e.target) || dialog?.open) return;
  if (tourRunning()) return; // während einer Tour keine Seitenwechsel per Taste
  if (gPending && Date.now() - gPending < 1500) {
    gPending = 0;
    const go = GO_KEYS.find(([k]) => k === e.key.toLowerCase());
    if (go) { e.preventDefault(); location.hash = go[1]; }
    return;
  }
  if (e.key === "/") { e.preventDefault(); focusSearch(); return; }
  if (e.key === "?") { e.preventDefault(); showShortcuts(); return; }
  if (e.key === "g") { gPending = Date.now(); return; }
  const fn = pageKeys?.[e.key];
  if (fn) { e.preventDefault(); fn(e); }
});
