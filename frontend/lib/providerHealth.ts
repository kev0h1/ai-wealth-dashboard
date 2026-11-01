/** A183: Finexer reports each bank's health as operational, degraded or down.
 *  Only a degraded or down bank gets a notice, and it never blocks connecting. */
export function providerHealthNotice(name: string, status?: string | null): string | null {
  const s = (status ?? "").toLowerCase();
  if (s !== "degraded" && s !== "down") return null;
  return `${name || "This bank"} is having problems right now. You can still try, or come back later.`;
}
