// Finexer's regulated footer, as Finexer renders it: the template's app_name is
// substituted into the first sentence (A151: AURIQ LTD, the registered agent).
// The rest is verbatim from Kevin's production Android screenshot (2026-10-07).
// Never reworded, restyled or hidden by our CSS.
export function regulatedFooter(appName: string): string {
  return `${appName} acts as Finexer Ltd's registered agent. Finexer Ltd is authorised by the Financial Conduct Authority under the Payment Services Regulations 2017 firm reference number 925695 as an Authorised Payment Institution to provide account information services and payment initiation services.`;
}
