import { BRAND } from "./brand.generated";
import { regulatedFooter } from "./footer";

export type IntroMode = "light" | "dark";

// Finexer's real class names are not known to us, so the shell uses plain
// elements. Wording is copied from the production screenshot.
const PERMISSIONS = [
  ["Your Accounts", "Information such as your account name, IBAN, sort code, account number, type, and currency."],
  ["Your Transactions", "Information such as transactions' date, reference, amount, status, and transaction code."],
  ["Your Account Balance", "Information such as accrued balances on your accounts' statements, currency, and credit line."],
];

const MARK = `<svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true"><path d="M7 11 L37 7 V15 L7 19 Z" fill="var(--s-ink)" opacity=".85"/><path d="M7 21 L37 17 V25 L7 29 Z" fill="var(--s-muted)"/><rect x="7" y="31" width="30" height="7" rx="2" fill="var(--s-primary)"/></svg>`;

const SHELL_CSS = `
.fx-bar{display:flex;justify-content:flex-end;padding:16px 16px 0}
.fx-bar span{border:2px solid var(--s-ink);border-radius:4px;padding:4px 8px;font-size:15px}
.fx-logo{display:flex;justify-content:center;margin:28px 0 24px}
.fx h1{font-size:26px;text-align:center;margin:0 24px 24px;font-weight:600}
.fx dl{margin:0 16px 24px}
.fx dt{color:var(--s-ink);font-weight:500;font-size:15px;margin-top:12px}
.fx dt:before{content:"^";display:inline-block;width:32px;font-size:12px;color:var(--s-muted)}
.fx dd{margin:2px 0 0 32px;color:var(--s-muted);font-size:15px}
.fx .row{display:flex;gap:16px;justify-content:center;padding:0 16px}
.fx .row button{width:140px;height:42px;font-size:15px;letter-spacing:.02em;border:1px solid transparent;cursor:default}
.fx .row .btn-light{background:#eef1f5;color:#475569;border-color:#cbd5e1}
.fx footer{margin:32px 16px 0;border-top:1px solid var(--s-ink);padding:12px 0 24px;font-size:12px;line-height:1.6}
`;

export function buildDoc(mode: IntroMode): string {
  // The light token file carries a prefers-color-scheme block for phones with no
  // saved preference. The mock picks the mode with its chip, so drop it here.
  const tokens = BRAND.tokens[mode].replace(/@media \(prefers-color-scheme: dark\)\s*\{[\s\S]*?\}\s*\}/, "");
  const perms = PERMISSIONS.map(([h, d]) => `<dt>${h}</dt><dd>${d}</dd>`).join("");
  // Finexer substitutes the template's app_name into the headline and the footer.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${tokens}\n${BRAND.shared}\n${SHELL_CSS}</style></head><body class="fx">
<div data-fx="header">${BRAND.header}</div>
<div class="fx-bar"><span>View completion screen</span></div>
<div class="fx-logo">${MARK}</div>
<h1>${BRAND.appName} is requesting permission to read:</h1>
<dl>${perms}</dl>
<div class="row"><button class="btn-light">CANCEL</button><button>NEXT</button></div>
<footer>${regulatedFooter(BRAND.appName)}</footer>
</body></html>`;
}
