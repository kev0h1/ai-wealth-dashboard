// Provider ids come through as slugs ("ob-barclays"); show them as a name.
export function bankLabel(raw?: string | null): string {
  const cleaned = (raw ?? "").replace(/^ob-/i, "").replace(/[-_]+/g, " ").trim();
  if (!cleaned) return "Your bank";
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}
