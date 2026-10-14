// G272: one source for how an investment account stays current, shared by the
// account card's "How this stays current" explainer and the Upload Investment
// Statement sheet, so the two can never disagree.

export const STAY_CURRENT_COPY =
  "A statement sets the account's value. Contract notes add each buy or sell on top until the next statement arrives, then the statement takes over and earlier notes fold into it. Add every contract note when it lands. Notes dated before your latest statement won't add: that value is already counted, and duplicates are rejected.";

export const STATEMENT_FLOW_STEPS = [
  { key: "statement", label: "Statement", line: "Sets your holdings and units." },
  { key: "notes", label: "Contract notes", line: "Add trades between statements." },
  { key: "prices", label: "Daily prices", line: "Refresh your value each day." },
] as const;

// Evidence: backend/app/routers/investments.py investment_upload saves only
// provider, account type, reference, holdings, units and values; the PDF is
// written to a temp file for text extraction and deleted in a finally block
// (backend/app/services/pdf.py extract_pdf_text); its text is read by an AI
// model (llm_parse_investment_statement).
export const STATEMENT_PRIVACY_LINE =
  "An AI model reads your PDF once to pick out your account details, holdings, units and values. Only those are saved, and the file itself is not kept.";
