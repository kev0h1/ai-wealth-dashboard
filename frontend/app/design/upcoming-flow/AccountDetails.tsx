"use client";

import UpcomingFlowSheet from "@/components/UpcomingFlowSheet";
import UpcomingAccountDetails from "@/components/upcoming/UpcomingAccountDetails";
import { BankIcon } from "@/components/AccountMiniCard";
import type { PlanCaseId } from "./PlanPreview.types";
import { accountDetailFixtures } from "./account-fixtures";
import { focusClass } from "./ui";

export default function AccountDetails({ accountId, state, status, onClose }: {
  accountId: string;
  state: PlanCaseId;
  status: "loading" | "error" | "ready";
  onClose: () => void;
}) {
  const fixture = accountDetailFixtures[state];
  const account = fixture.accounts.find(item => item.id === accountId)!;
  return <UpcomingFlowSheet initialView={{ kind: "account", id: accountId }} onClose={onClose} renderView={(_view, navigation) => ({
    title: account.bank,
    subtitle: `${account.name} · ${fixture.periodLabel}`,
    leading: <BankIcon identity={{ provider: account.bank }} size={36} altText="" />,
    body: <UpcomingAccountDetails account={account} plans={fixture.plans} plansStatus={status} periodLabel={fixture.periodLabel} />,
    footer: <button type="button" onClick={navigation.close} className={`min-h-12 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 ${focusClass}`}>Done</button>,
  })} />;
}
