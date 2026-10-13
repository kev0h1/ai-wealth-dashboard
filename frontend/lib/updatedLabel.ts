// G250: "Updated 8 min ago" from an ISO timestamp (KPIs.last_updated). Returns
// undefined when the value is missing or unparseable so nothing renders.
// British English, no em dashes.
export function formatUpdated(iso: string | null | undefined, now: number = Date.now()): string | undefined {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return undefined;
  const mins = Math.max(0, Math.floor((now - t) / 60_000));
  if (mins < 1) return "Updated just now";
  if (mins < 60) return `Updated ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Updated ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Updated yesterday" : `Updated ${days} days ago`;
}
