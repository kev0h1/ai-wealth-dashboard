// Single source of truth for the Finexer agency disclosure shown at sign-in,
// bank connect and on the public legal pages (A153, Finexer Client Terms Part C
// clause A4.1). The sentence is FIXED TEXT required verbatim by Finexer: do not
// reword, shorten or "improve" it. scripts/check-agency-disclosure.mjs pins it.
export const AGENT_DISCLOSURE =
  "AURIQ LTD is acting as an agent of Finexer LTD, which is authorised by the Financial Conduct Authority under the Payment Services Regulations 2017, firm reference number 925695, as an Authorised Payment Institution to provide account information services and payment initiation services.";

// Finexer asked (A163, on approving the consent journey) for the regulatory
// disclosure to make the trading name clear. Rendered immediately BEFORE
// AGENT_DISCLOSURE, in the same paragraph, wherever that sentence is shown.
// It is a separate constant so the fixed A4.1 text above is never altered.
export const TRADING_NAME_DISCLOSURE = "Sorted is a trading name of AURIQ LTD.";
