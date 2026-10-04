/** G204: provider and account names often arrive as raw upper-case strings
 *  ("PENTESTCANARYBANK"). Rows that show them sentence-case a name only when it
 *  has no lower-case letters at all, so a name the user typed or a bank's own
 *  mixed-case name is never altered. */
export function tidyAccountText(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text || /[a-z]/.test(text) || !/[A-Z]/.test(text)) return text;
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
