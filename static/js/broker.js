// Nur Aktien, die bei Trade Republic handelbar sind (laut Handelsliste der LS Exchange, siehe aktientool/sources/lsx.py).
// Die Wahl gilt für die Weltauswahl und bleibt im Browser gespeichert; voreingestellt ist „nur Trade Republic“.
import { escapeHtml as esc } from "./format.js";
import { term } from "./glossary.js";

const KEY = "nurTradeRepublic";

function read() {
  try { return localStorage.getItem(KEY) !== "0"; } catch (e) { return true; }
}

let only = read();

export const trOnly = () => only;

export function setTrOnly(on) {
  only = on;
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) { /* ohne Speicher gilt die Wahl nur bis zum Neuladen */ }
}

// Kennzeichen hinter dem Namen, wenn die Aktie laut Handelsliste nicht bei Trade Republic handelbar ist
export const NOT_TR_TAG = '<span class="tag off" title="Laut Handelsliste der LS Exchange nicht bei Trade Republic handelbar">nicht bei TR</span>';

// Zeile im Profil: handelbar ja/nein, unter welcher ISIN die App die Aktie führt, und die eigene Korrektur
export function trLine(t, dateFmt) {
  if (!t || t.tradable == null) return "";
  const src = `laut ${term("trade_republic", "Handelsliste der LS Exchange")}${t.list_date ? ` vom ${dateFmt(t.list_date)}` : ""}`;
  const ids = t.tradable && t.isin ? `in der App: ISIN <b class="num">${esc(t.isin)}</b>${t.wkn ? ` (WKN ${esc(t.wkn)})` : ""}` : "";
  const badge = t.tradable
    ? '<span class="badge good">bei Trade Republic handelbar</span>'
    : '<span class="badge serious">nicht bei Trade Republic handelbar</span>';
  let parts;
  if (t.override) {
    parts = ["eigene Angabe", ids, '<button class="linklike" type="button" data-tr="reset">zurück zur Handelsliste</button>'];
  } else if (t.tradable) {
    const other = t.other_listing ? `als ADR o. Ä.${t.ls_name ? ` (${esc(t.ls_name)})` : ""}` : "";
    parts = [other, ids, src, '<button class="linklike" type="button" data-tr="no">in der App nicht zu finden?</button>'];
  } else {
    parts = [src, '<button class="linklike" type="button" data-tr="yes">in der App doch zu finden?</button>'];
  }
  return `${badge} <span class="muted">${parts.filter(Boolean).join(" · ")}</span>`;
}
