// Watchlist umschalten (Stern, „Zur Watchlist“, Tastenkürzel W) mit Rückmeldung und „Rückgängig“
import { toggleWatch } from "./api.js";
import { toast } from "./toast.js";

// onChange(on): die aufrufende Seite zeichnet Stern bzw. Knopf neu, auch nach „Rückgängig“
export async function flipWatch(sym, name, onChange = null) {
  const on = await toggleWatch(sym);
  onChange?.(on);
  const who = name || sym;
  toast(on ? `${who} steht jetzt auf der Watchlist.` : `${who} ist nicht mehr auf der Watchlist.`, {
    kind: on ? "good" : "",
    action: "Rückgängig",
    onAction: async () => onChange?.(await toggleWatch(sym)),
  });
  return on;
}
