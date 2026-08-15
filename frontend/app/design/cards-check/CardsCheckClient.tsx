"use client";

import AccountMiniCard from "@/components/AccountMiniCard";
import InvestmentMiniCard from "@/components/InvestmentMiniCard";
import { Account, InvestmentAccount } from "@/lib/api";

// Temp visual-check route for Fix 1 (spine removal, investment unification,
// equal heights). Not linked from app nav — deep-link only. Safe to delete
// once the account-card work is confirmed and no longer needed.

const CURRENT_PLAIN: Account = {
  id: "mock-1",
  name: "Monzo Current",
  type: "transaction",
  subtype: "current",
  balance: 1245.32,
  currency: "GBP",
  provider: "Monzo",
  status: "active",
};

const CURRENT_LONG_NAME: Account = {
  id: "mock-2",
  name: "Barclays Everyday Current Account — Joint with Sarah Maingi-Wilson",
  type: "transaction",
  subtype: "current",
  balance: 312.5,
  currency: "GBP",
  provider: "Barclays",
  status: "active",
};

const CREDIT_WITH_TERMS: Account = {
  id: "mock-3",
  name: "Amex Platinum",
  type: "credit",
  subtype: "credit_card",
  balance: -820.14,
  currency: "GBP",
  provider: "Amex",
  status: "active",
  apr: 21.9,
};

const SAVINGS_ZERO: Account = {
  id: "mock-4",
  name: "Chase Saver",
  type: "savings",
  subtype: "savings",
  balance: 0,
  currency: "GBP",
  provider: "Chase",
  status: "active",
};

const ISA_INVESTMENT: InvestmentAccount = {
  id: "mock-5",
  provider: "Vanguard",
  account_type: "Stocks & Shares ISA",
  account_reference: "mock-ref",
  currency: "GBP",
  total_value: 18240.77,
  statement_date: "2026-08-01",
  last_refreshed: "2026-08-10T00:00:00Z",
  updated_at: "2026-08-10T00:00:00Z",
  added_since: 0,
  notes_since: 0,
  display_value: 18240.77,
};

export default function CardsCheckClient() {
  return (
    <div className="dark min-h-screen bg-slate-900">
      {/* 430px-wide column with px-4 padding — mirrors the real Home/Accounts
          grid wrapper exactly, so this is an honest check of the on-device
          layout rather than a wider desktop approximation. */}
      <div className="mx-auto" style={{ width: 430 }}>
        <p className="text-slate-400 text-[11px] px-4 pt-4 pb-2 font-mono">
          /design/cards-check — uniform-height + stagger verification (Fix A/B)
        </p>
        <div className="grid grid-cols-2 gap-3 px-4 pb-6">
          <AccountMiniCard account={CURRENT_PLAIN} grid calm glass index={0} />
          <AccountMiniCard account={CURRENT_LONG_NAME} grid calm glass index={1} />
          <AccountMiniCard
            account={CREDIT_WITH_TERMS}
            grid
            calm
            glass
            index={2}
            termsPill={{ label: "0% until Mar 2027", amber: false }}
            onTermsClick={() => {}}
          />
          <AccountMiniCard account={SAVINGS_ZERO} grid calm glass index={3} />
          <InvestmentMiniCard account={ISA_INVESTMENT} grid calm glass index={4} />
        </div>
      </div>
    </div>
  );
}
