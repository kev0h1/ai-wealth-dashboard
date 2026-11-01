// Payload shared by the transfer review API and its production sheet.
export type MiscategorisedMember = {
  id: string;
  date: string;
  amount: number;
  account_id: string;
  description: string | null;
  merchant_name: string | null;
};

export type MiscategorisedItem = {
  id: string;
  ids: string[];
  count: number;
  series_key: string;
  merchant_name: string | null;
  description: string | null;
  amount: number;
  amount_min: number | null;
  amount_max: number | null;
  date: string;
  first_date: string | null;
  currency: string;
  category: string | null;
  transaction_type: string;
  // account_id/members — optional/additive, absent on a payload cached
  // before the backend started sending them.
  account_id?: string;
  members?: MiscategorisedMember[];
  // Real per-row evidence for why this was flagged as an own-transfer —
  // optional/additive, absent on a payload cached before this field existed.
  reason?: { kind: "name" } | { kind: "account"; account_id: string };
};

