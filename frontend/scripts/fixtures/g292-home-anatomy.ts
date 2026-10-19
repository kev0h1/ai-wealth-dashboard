// Synthetic component-regression data, retained after the G292 preview retires.
import type { CompanionItem, SavingsInsight, UnfundedMoveEntry } from "@/lib/api";

const SAVER = { account_id: "g292-saver", name: "Rainy Day Saver", provider: "Nationwide", balance: 2180 };
const MONZO = { account_id: "g292-monzo", name: "Everyday Account", provider: "Monzo", balance: 430 };
const COVER_DESTINATION = { account_id: "g292-cover-destination", name: "Premier Current", provider: "Barclays", balance: 855 };

export const COVERED_ITEM: CompanionItem = {
  id: "g292-covered", type: "celebration",
  headline: "Premier Current has enough for what's due",
  body: "This account has enough for £32 across 3 payments, so they should go through before 30 Oct.",
  action: null, estimated: false,
  brief_lead: { value: "£32", companion: "across 3 payments before 30 Oct" },
};

export const LONG_COVERED_ITEM: CompanionItem = {
  ...COVERED_ITEM,
  id: "g292-covered-long",
  headline: "Premier Current household bills and everyday payments account has enough for what's due",
  body: "This account has enough for the £925 rent payment and the £146 council tax payment, so both should go through before 30 Oct.",
  brief_lead: { value: "£1,071", companion: "across 2 payments before 30 Oct" },
};

export const MASKED_COVERED_ITEM: CompanionItem = {
  ...COVERED_ITEM,
  headline: "Premier Current has enough for what's due",
  body: "This account has enough for £•••• across 3 payments, so they should go through before 30 Oct.",
  brief_lead: { value: "£••••", companion: "across 3 payments before 30 Oct" },
};

export const MISSING_BODY_COVERED_ITEM: CompanionItem = { ...COVERED_ITEM, id: "g292-covered-no-body", body: "" };

export const COVER_MOVE_ITEM: CompanionItem = {
  id: "g292-cover-plan", type: "move", headline: "Move £70 to Premier Current",
  body: "£70 across two moves keeps everything clearing at Premier Current.",
  action: { label: "See what’s due", route: "/upcoming" }, estimated: false,
  brief_lead: { value: "£70", companion: "to Premier Current" },
  plan_dest: { ...COVER_DESTINATION, needs_total: 925, needs_by: "30 Oct", bills: [{ label: "Rent", amount: 925 }] },
  moves: [
    { headline: "Move £40 from Rainy Day Saver", amount: 40, move_map: { from: { ...SAVER, safe_note: "Covers its own bills" }, to: { ...COVER_DESTINATION, incoming: "£925 due" } } },
    { headline: "Move £30 from Everyday Account", amount: 30, move_map: { from: { ...MONZO, safe_note: "Covers its own bills" }, to: { ...COVER_DESTINATION, incoming: "£925 due" } } },
  ],
  covered: true, sources_safe: true, amount: 70,
};

const UNFUNDED: UnfundedMoveEntry = {
  key: "RENT", label: "Rent", amount: 925, expected_date: "2026-10-18", days_past_due: 1,
  source_account_id: COVER_DESTINATION.account_id, source_name: COVER_DESTINATION.name, source_bank: COVER_DESTINATION.provider,
  suggested_amount: 70, suggested_from_name: SAVER.name, suggested_from_count: 1,
  suggested_covers_all: true, suggested_sources: [{ ...SAVER, amount: 70 }],
};

export const UNFUNDED_MOVE_ITEM: CompanionItem = {
  id: "g292-unfunded", type: "unfunded_move", headline: "A planned move needs £70 to cover it.",
  body: "The £925 rent payment needs £70 from Rainy Day Saver to be covered.",
  action: { label: "See it in Upcoming", route: "/upcoming" }, estimated: false,
  brief_lead: { value: "£70", companion: "suggested from Rainy Day Saver" },
  moves: [UNFUNDED] as unknown as CompanionItem["moves"],
};

export const TIP: SavingsInsight = {
  id: "g292-mobile-tip", category: "mobile", icon: "", label: "Mobile", pinned: false, is_new: false,
  title: "You pay EE £57 a month", body: "SIM-only plans are listed at £5 to £14 a month. Checked 14 Oct, source uswitch.com.",
  refreshed_at: "2026-10-14T09:00:00Z", return_reason: null, stopped_line: null, substituted: false,
  substituted_merchant: null, substituted_line: null, deadline_at: null, claim_valid_until: null,
  content_valid_until: "2026-10-21T09:00:00Z", expiry_line: "Researched 5d ago", state: "fresh",
  researched_at: "2026-10-14T09:00:00Z", triggered_by: [{ merchant_key: "ee", display_name: "EE", monthly_amount: 57, occurrences: 5, is_recurring: true }],
  user_context: null, has_workflow: true, app_route: "/transactions?category=Bills&tip=g292-mobile-tip",
};

export const MASKED_TIP: SavingsInsight = {
  ...TIP,
  title: "You pay EE £•••• a month",
  body: "SIM-only plans are listed at £•••• to £•••• a month. Checked 14 Oct, source uswitch.com.",
};
