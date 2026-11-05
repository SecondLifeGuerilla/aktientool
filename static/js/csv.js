// CSV-Dateien für Excel & Co.: Semikolon als Trenner, Dezimalkomma, UTF-8 mit BOM (sonst zeigt Excel Umlaute falsch)

// Zahl ohne Tausenderpunkte, mit Komma; leer, wenn kein Wert
export function csvNum(x, digits = 4) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "";
  return String(Math.round(x * 10 ** digits) / 10 ** digits).replace(".", ",");
}

function cell(v) {
  const s = v == null ? "" : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
}

export function downloadCsv(filename, header, rows) {
  const blob = new Blob(["﻿", toCsv(header, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const today = () => new Date().toLocaleDateString("sv-SE"); // JJJJ-MM-TT

// Eingelesene CSV-Zeilen: Trenner ; , oder Tab (erkannt an der ersten Zeile), Anführungszeichen wie in Excel
export function parseCsv(text) {
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const first = lines[0];
  const sep = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  return lines.map((line) => {
    const out = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === sep) { out.push(cur.trim()); cur = ""; } else cur += c;
    }
    out.push(cur.trim());
    return out;
  });
}
