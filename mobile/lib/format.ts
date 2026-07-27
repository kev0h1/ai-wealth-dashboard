export function fmtGBP(n: number, sym = "£"): string {
  return `${sym}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
export function fmtBalance(n: number, sym = "£"): string {
  return `${n < 0 ? "-" : ""}${fmtGBP(n, sym)}`;
}
