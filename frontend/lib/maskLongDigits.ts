/** G413 privacy: a run of 12 or more digits (a card number, hyphens and spaces
 * allowed) keeps only its last five, as "…20001". Twin of the server's
 * `mask_long_digits`. Applied wherever a match rule's text or label is shown. */
const LONG_DIGITS = /(?<!\d)\d(?:[- ]?\d){11,}(?!\d)/g;

export function maskLongDigits(text: string | null | undefined): string {
  return String(text ?? "").replace(LONG_DIGITS, run => `…${run.replace(/\D/g, "").slice(-5)}`);
}
