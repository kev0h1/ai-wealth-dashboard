/** Identity stays opaque for edit/dismiss APIs; only presentation uses this. */
export function upcomingDisplayName(item: { name: string; display_name?: string | null }): string {
  const label = item.display_name?.trim();
  if (label && !label.includes("::")) return label;
  // During an old-cache rollout there may be no original bank description.
  // Do not invent a merchant name by splitting a normalised payer token.
  return item.name.includes("::") ? "Expected income" : item.name;
}
