/** G204: provider and account names often arrive as raw upper-case strings
 *  ("PENTESTCANARYBANK"). Rows that show them sentence-case a name only when it
 *  has no lower-case letters at all, so a name the user typed or a bank's own
 *  mixed-case name is never altered. Known acronyms ("HSBC UK") and tokens with
 *  an ampersand or digits ("NS&I", "M&S", "365") keep their capitals. */
const ACRONYMS = new Set(["HSBC", "TSB", "RBS", "UK", "ISA", "BOS", "AIB", "JLP", "PCA", "GBP"]);

function keepsCapitals(token: string): boolean {
  return token.includes("&") || /\d/.test(token) || ACRONYMS.has(token.replace(/[^A-Z]/g, ""));
}

export function tidyAccountText(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text || /[a-z]/.test(text) || !/[A-Z]/.test(text)) return text;
  let capitalised = false;
  return text.split(/\s+/).map((token) => {
    if (keepsCapitals(token)) return token;
    const lower = token.toLowerCase();
    if (capitalised) return lower;
    capitalised = true;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(" ");
}
