import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { AlertTriangle } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, Account, DebtPlanView } from "@/lib/api";
import { planningApi, PlanningCashflow, PlanningUpcomingItem } from "@/lib/api/planning";
import { useTheme } from "@/lib/ThemeContext";
import { usePreferences, PayPeriodConfig } from "@/lib/PreferencesContext";
import { tw } from "@/lib/tw";
import { Skeleton } from "@/components/ui";
import { SwipeDismissRow } from "@/components/planning/SwipeDismissRow";
import { BillRow, BillRowItem } from "@/components/planning/BillRow";
import { UpcomingEditSheet } from "@/components/planning/UpcomingEditSheet";
import { PlanOneOffSheet } from "@/components/planning/PlanOneOffSheet";
import { PlannedEditSheet } from "@/components/planning/PlannedEditSheet";
import { PayPeriodSettingsSheet } from "@/components/planning/PayPeriodSettingsSheet";
import { DebtEntryCard } from "@/components/planning/DebtEntryCard";
import { UndoSnackbar } from "@/components/planning/UndoSnackbar";

// ── Pay period helpers ────────────────────────────────────────────────────────

function getPayPeriodEnd(config: PayPeriodConfig): Date {
  const now = new Date();
  const type = config.type;
  if (!type || type === "weekly") {
    return new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }
  if (type === "day_of_month" && config.day) {
    const d = config.day;
    let payday = new Date(now.getFullYear(), now.getMonth(), d);
    if (payday <= now) payday = new Date(now.getFullYear(), now.getMonth() + 1, d);
    const end = new Date(payday);
    end.setDate(end.getDate() - 1);
    return end;
  }
  if (type === "last_weekday" && config.weekday !== undefined) {
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    let d = new Date(lastDay);
    while (d.getDay() !== config.weekday) d.setDate(d.getDate() - 1);
    if (d <= now) {
      const nextLastDay = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      let d2 = new Date(nextLastDay);
      while (d2.getDay() !== config.weekday) d2.setDate(d2.getDate() - 1);
      return d2;
    }
    return d;
  }
  return new Date(now.getFullYear(), now.getMonth() + 1, 0);
}

function isCalendarMonth(config: PayPeriodConfig): boolean {
  return !config.type || config.type === "weekly";
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function PlanningTab() {
  const { dark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { payPeriodConfig, setPayPeriodConfig } = usePreferences();

  const [cashflow, setCashflow] = useState<PlanningCashflow | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [debtView, setDebtView] = useState<DebtPlanView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [planSheetOpen, setPlanSheetOpen] = useState(false);
  const [editItem, setEditItem] = useState<{
    name: string;
    amount: number;
    expected_date: string;
    original_date?: string | null;
    type: "bill" | "income";
    category?: string | null;
    edited?: boolean;
    rule_label?: string | null;
  } | null>(null);
  const [editPlanned, setEditPlanned] = useState<{
    id: string;
    name: string;
    amount: number;
    date: string;
    account_id: string | null;
  } | null>(null);

  const [undoBar, setUndoBar] = useState<
    | { kind: "recurring"; name: string }
    | { kind: "planned"; id: string }
    | null
  >(null);
  const [undoNonce, setUndoNonce] = useState(0);
  const [highlightBill, setHighlightBill] = useState<string | null>(null);

  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDismissRef = useRef<{
    name: string;
    bills: PlanningUpcomingItem[];
    income: PlanningUpcomingItem[];
    request: Promise<unknown>;
  } | null>(null);
  const lastPlannedDeleteRef = useRef<{
    id: string;
    bills: PlanningUpcomingItem[];
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const lastSkipRef = useRef<{
    name: string;
    date: string;
    item: PlanningUpcomingItem;
  } | null>(null);

  // Derived period end
  const periodEnd = getPayPeriodEnd(payPeriodConfig);
  const calMonth = isCalendarMonth(payPeriodConfig);

  async function load(isRefresh = false) {
    if (!isRefresh) setLoading(true);
    try {
      const [cf, accs, debt] = await Promise.all([
        planningApi.planningCashflow(),
        api.accounts().catch(() => [] as Account[]),
        api.getDebtPlanView().catch(() => null),
      ]);
      setCashflow(cf);
      setAccounts(accs);
      setDebtView(debt);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    return () => {
      flushPlannedDelete();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!highlightBill) return;
    const t = setTimeout(() => setHighlightBill(null), 2800);
    return () => clearTimeout(t);
  }, [highlightBill]);

  // ── At-risk calculation ───────────────────────────────────────────────────
  const atRiskBills = (() => {
    if (!cashflow) return [];
    const nextPaydayMs = periodEnd.getTime() + 86400000;
    const scopedBills = cashflow.upcoming_bills.filter(
      (b) =>
        new Date(b.expected_date).getTime() < nextPaydayMs &&
        b.account_balance != null &&
        b.account_balance >= 0
    );
    if (scopedBills.length === 0) return [];
    const running: Record<string, number> = {};
    for (const b of scopedBills) {
      const key = b.account_id ?? "__null__";
      if (!(key in running)) running[key] = b.account_balance!;
    }
    type Ev =
      | { kind: "income"; days_away: number; amount: number; account_id: string | null | undefined }
      | { kind: "bill"; days_away: number; amount: number; account_id: string | null | undefined; bill: PlanningUpcomingItem };
    const events: Ev[] = [
      ...scopedBills.map((b) => ({
        kind: "bill" as const,
        days_away: b.days_away,
        amount: b.amount,
        account_id: b.account_id,
        bill: b,
      })),
      ...cashflow.upcoming_income
        .filter((inc) => new Date(inc.expected_date).getTime() < nextPaydayMs)
        .map((inc) => ({
          kind: "income" as const,
          days_away: inc.days_away,
          amount: inc.amount,
          account_id: inc.account_id as string | null | undefined,
        })),
    ];
    events.sort((a, b) => {
      if (a.days_away !== b.days_away) return a.days_away - b.days_away;
      return a.kind === "income" ? -1 : 1;
    });
    const atRisk: PlanningUpcomingItem[] = [];
    for (const ev of events) {
      if (ev.kind === "income") {
        if (ev.account_id) {
          const key = ev.account_id;
          if (key in running) running[key] += ev.amount;
        } else {
          for (const key of Object.keys(running)) running[key] += ev.amount;
        }
      } else {
        const key = ev.account_id ?? "__null__";
        if (!(key in running)) continue;
        if (running[key] >= ev.amount) {
          running[key] -= ev.amount;
        } else {
          atRisk.push(ev.bill);
        }
      }
    }
    return atRisk;
  })();

  const accountShortfalls = (() => {
    if (!cashflow || atRiskBills.length === 0) return [];
    const accountIds = [
      ...new Set(atRiskBills.map((b) => b.account_id ?? "__null__")),
    ];
    return accountIds
      .map((accountId) => {
        const firstBill = atRiskBills.find(
          (b) => (b.account_id ?? "__null__") === accountId
        );
        if (!firstBill) return null;
        const balance = firstBill.account_balance ?? 0;
        const bank =
          firstBill.account_bank || firstBill.account_name || "Account";
        const nextPaydayMs = periodEnd.getTime() + 86400000;
        const scopedBills = cashflow!.upcoming_bills.filter(
          (b) =>
            (b.account_id ?? "__null__") === accountId &&
            new Date(b.expected_date).getTime() < nextPaydayMs &&
            b.account_balance != null &&
            b.account_balance >= 0
        );
        const billsSum = scopedBills.reduce((s, b) => s + b.amount, 0);
        const shortfall = billsSum - balance;
        if (shortfall <= 0) return null;
        return { accountId, bank, balance, shortfall };
      })
      .filter(
        (
          x
        ): x is { accountId: string; bank: string; balance: number; shortfall: number } =>
          x !== null
      )
      .sort((a, b) => b.shortfall - a.shortfall);
  })();

  // ── Undo actions ──────────────────────────────────────────────────────────

  function flushPlannedDelete() {
    const p = lastPlannedDeleteRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    lastPlannedDeleteRef.current = null;
    api.deletePlanned(p.id).catch(() => {});
  }

  function deletePlannedWithUndo(id: string) {
    flushPlannedDelete();
    if (undoTimer.current) clearTimeout(undoTimer.current);
    let stashedBills: PlanningUpcomingItem[] = [];
    setCashflow((prev) => {
      if (!prev) return prev;
      stashedBills = prev.upcoming_bills.filter((b) => b.planned_id === id);
      return {
        ...prev,
        upcoming_bills: prev.upcoming_bills.filter((b) => b.planned_id !== id),
      };
    });
    const timer = setTimeout(() => {
      api.deletePlanned(id).catch(() => {});
      lastPlannedDeleteRef.current = null;
      setUndoBar(null);
      planningApi.planningCashflow().then(setCashflow).catch(() => {});
    }, 6000);
    lastPlannedDeleteRef.current = { id, bills: stashedBills, timer };
    setUndoBar({ kind: "planned", id });
    setUndoNonce((n) => n + 1);
  }

  function undoPlannedDelete() {
    const p = lastPlannedDeleteRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    lastPlannedDeleteRef.current = null;
    setUndoBar(null);
    setCashflow((prev) =>
      prev
        ? {
            ...prev,
            upcoming_bills: [...prev.upcoming_bills, ...p.bills].sort(
              (a, b) => a.days_away - b.days_away
            ),
          }
        : prev
    );
  }

  function dismissUpcoming(name: string) {
    flushPlannedDelete();
    setCashflow((prev) => {
      if (!prev) return prev;
      lastDismissRef.current = {
        name,
        bills: prev.upcoming_bills.filter((b) => b.name === name),
        income: prev.upcoming_income.filter((b) => b.name === name),
        request: api.dismissRecurring(name).catch(() => {}),
      };
      return {
        ...prev,
        upcoming_bills: prev.upcoming_bills.filter((b) => b.name !== name),
        upcoming_income: prev.upcoming_income.filter((b) => b.name !== name),
      };
    });
    setUndoBar({ kind: "recurring", name });
    setUndoNonce((n) => n + 1);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoBar(null), 6000);
  }

  async function undoLastDismiss() {
    const last = lastDismissRef.current;
    if (!last) return;
    setUndoBar(null);
    lastDismissRef.current = null;
    setCashflow((prev) =>
      prev
        ? {
            ...prev,
            upcoming_bills: [...prev.upcoming_bills, ...last.bills].sort(
              (a, b) => a.days_away - b.days_away
            ),
            upcoming_income: [...prev.upcoming_income, ...last.income].sort(
              (a, b) => a.days_away - b.days_away
            ),
          }
        : prev
    );
    try {
      await last.request;
      await planningApi.restoreRecurring(last.name);
      const fresh = await planningApi.planningCashflow();
      setCashflow(fresh);
    } catch {}
  }

  function skipOccurrence(item: PlanningUpcomingItem) {
    const dateKey = item.original_date ?? item.expected_date;
    lastSkipRef.current = { name: item.name, date: dateKey, item };
    setCashflow((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        upcoming_bills: prev.upcoming_bills.filter(
          (b) =>
            !(b.name === item.name && b.expected_date === item.expected_date)
        ),
      };
    });
    planningApi
      .skipUpcomingOccurrence(item.name, dateKey)
      .then(() => planningApi.planningCashflow().then(setCashflow))
      .catch(() => {
        const saved = lastSkipRef.current;
        if (!saved) return;
        setCashflow((prev) =>
          prev
            ? {
                ...prev,
                upcoming_bills: [...prev.upcoming_bills, saved.item].sort(
                  (a, b) => a.days_away - b.days_away
                ),
              }
            : prev
        );
        lastSkipRef.current = null;
      });
  }

  // ── Render items ──────────────────────────────────────────────────────────

  function buildItems() {
    if (!cashflow) return [];
    const nextPaydayMs = periodEnd.getTime() + 86400000;
    const nextPaydayMidnight = new Date(
      Date.UTC(
        new Date(nextPaydayMs).getUTCFullYear(),
        new Date(nextPaydayMs).getUTCMonth(),
        new Date(nextPaydayMs).getUTCDate()
      )
    );

    const raw = [
      ...cashflow.upcoming_income.map((b) => ({ ...b, type: "income" as const })),
      ...cashflow.upcoming_bills.map((b) => ({ ...b, type: "bill" as const })),
    ]
      .filter(
        (b) =>
          new Date(b.expected_date).getTime() <= nextPaydayMidnight.getTime()
      )
      .sort((a, b) => {
        if (a.days_away !== b.days_away) return a.days_away - b.days_away;
        if (a.type !== b.type) return a.type === "income" ? -1 : 1;
        return b.amount - a.amount;
      });

    let running = cashflow.available_balance ?? 0;
    return raw.map((item) => {
      if (item.type === "income") {
        running += item.amount;
        const r: BillRowItem = {
          ...item,
          balance_after: running,
          at_risk: false,
          account_short: false,
          is_credit_card: false,
          flagged: false,
        };
        return r;
      } else {
        running -= item.amount;
        const acctBalance = item.account_balance ?? null;
        const is_credit_card = acctBalance !== null && acctBalance < 0;
        const account_short =
          !is_credit_card && acctBalance !== null && item.amount > acctBalance;
        const flagged = atRiskBills.some(
          (r) =>
            r.name === item.name && r.expected_date === item.expected_date
        );
        const r: BillRowItem = {
          ...item,
          balance_after: running,
          at_risk: running < 0,
          account_short,
          is_credit_card,
          flagged,
        };
        return r;
      }
    });
  }

  function groupByDay(list: BillRowItem[]) {
    const groups: { label: string; items: BillRowItem[] }[] = [];
    for (const item of list) {
      const label =
        item.days_away === 0
          ? "Today"
          : item.days_away === 1
          ? "Tomorrow"
          : `${item.days_away} days`;
      const g = groups.find((g) => g.label === label);
      if (g) g.items.push(item);
      else groups.push({ label, items: [item] });
    }
    return groups;
  }

  // ── Runway calc ───────────────────────────────────────────────────────────

  function getRunway() {
    if (!cashflow || cashflow.available_balance == null) return null;
    const nextPaydayMs = periodEnd.getTime() + 86400000;
    const nextPaydayMidnight = new Date(
      Date.UTC(
        new Date(nextPaydayMs).getUTCFullYear(),
        new Date(nextPaydayMs).getUTCMonth(),
        new Date(nextPaydayMs).getUTCDate()
      )
    );
    const billsBeforePayday = cashflow.upcoming_bills.filter((b) => {
      return new Date(b.expected_date).getTime() < nextPaydayMidnight.getTime();
    });
    const billsTotal = billsBeforePayday.reduce((s, b) => s + b.amount, 0);
    const runway = (cashflow.available_balance ?? 0) - billsTotal;
    const today = new Date();
    const todayMidnight = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    );
    const daysToPayday = Math.round(
      (nextPaydayMidnight.getTime() - todayMidnight.getTime()) / 86400000
    );
    const paydayLabel = new Date(nextPaydayMs).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    return { runway, billsTotal, daysToPayday, paydayLabel };
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const canvasBg = dark ? tw.color.canvasDark : tw.color.canvasLight;
  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const cardBorder = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const sym = "£";

  const items = buildItems();
  const groups = groupByDay(items);
  const runwayData = getRunway();

  return (
    <View style={[styles.root, { backgroundColor: canvasBg }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 16, paddingBottom: 120 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load(true);
            }}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text
            style={[
              styles.whisper,
              { color: dark ? tw.color.slate500 : tw.color.slate400 },
            ]}
          >
            PLANNING
          </Text>
          <Text
            style={[
              styles.headline,
              { color: dark ? tw.color.slate100 : tw.color.slate900 },
            ]}
          >
            What's coming
          </Text>
        </View>

        {/* At-risk callout */}
        {!loading && accountShortfalls.length > 0 && (
          <>
            <View
              style={[
                styles.callout,
                {
                  backgroundColor: dark
                    ? "rgba(76,5,25,0.4)"
                    : "#fff1f2",
                  borderColor: dark ? "rgba(136,19,55,0.6)" : "#fecdd3",
                },
              ]}
            >
              <AlertTriangle
                size={16}
                color={dark ? "#fb7185" : "#e11d48"}
                style={{ flexShrink: 0, marginTop: 2 } as any}
              />
              <View style={styles.calloutText}>
                {accountShortfalls.length === 1 ? (
                  <>
                    <Text
                      style={[
                        styles.calloutTitle,
                        { color: dark ? "#fee2e2" : "#431407" },
                      ]}
                    >
                      Your {accountShortfalls[0].bank} account is short before
                      payday
                    </Text>
                    <Text
                      style={[
                        styles.calloutBody,
                        { color: dark ? "#fca5a5" : "#b91c1c" },
                      ]}
                    >
                      {sym}
                      {accountShortfalls[0].shortfall.toLocaleString("en-GB", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      short for bills due before payday — move money in, or
                      change a payment date.
                    </Text>
                  </>
                ) : (
                  <>
                    <Text
                      style={[
                        styles.calloutTitle,
                        { color: dark ? "#fee2e2" : "#431407" },
                      ]}
                    >
                      {accountShortfalls.length} accounts are short before
                      payday
                    </Text>
                    <Text
                      style={[
                        styles.calloutBody,
                        { color: dark ? "#fca5a5" : "#b91c1c" },
                      ]}
                    >
                      {accountShortfalls
                        .slice(0, 3)
                        .map(
                          (a) =>
                            `${a.bank} · ${sym}${a.shortfall.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} short`
                        )
                        .join(" · ")}
                      {accountShortfalls.length > 3
                        ? ` · +${accountShortfalls.length - 3} more`
                        : ""}
                    </Text>
                  </>
                )}
              </View>
              <Pressable
                onPress={() => {
                  const top = [...atRiskBills].sort((a, b) =>
                    a.days_away !== b.days_away
                      ? a.days_away - b.days_away
                      : b.amount - a.amount
                  )[0];
                  if (top)
                    setHighlightBill(
                      `bill-${top.name}-${top.expected_date}`
                    );
                }}
                style={styles.reviewBtn}
              >
                <Text style={styles.reviewBtnText}>Review</Text>
              </Pressable>
            </View>
            <Text
              style={[
                styles.calloutNote,
                { color: dark ? tw.color.slate400 : tw.color.slate500 },
              ]}
            >
              Payments can take a day or two to appear, so a very recent one may
              not be counted yet.
            </Text>
          </>
        )}

        {/* Main content */}
        {loading ? (
          <View style={styles.skeletonBlock}>
            <Skeleton height={80} borderRadius={tw.radius["2xl"]} />
            <Skeleton height={60} borderRadius={tw.radius["2xl"]} />
            <Skeleton height={60} borderRadius={tw.radius["2xl"]} />
          </View>
        ) : error ? (
          <View
            style={[
              styles.errorCard,
              { backgroundColor: cardBg, borderColor: cardBorder },
            ]}
          >
            <Text
              style={[
                styles.errorText,
                { color: dark ? tw.color.slate400 : tw.color.slate500 },
              ]}
            >
              Couldn't load your planning data. Pull down to retry.
            </Text>
          </View>
        ) : (
          <>
            {/* Runway card */}
            {runwayData && (
              <View
                style={[
                  styles.runwayCard,
                  {
                    backgroundColor:
                      runwayData.runway < 0
                        ? dark
                          ? "rgba(136,19,55,0.2)"
                          : "#fff1f2"
                        : cardBg,
                    borderColor:
                      runwayData.runway < 0
                        ? dark
                          ? tw.color.rose800
                          : "#fecdd3"
                        : cardBorder,
                  },
                ]}
              >
                <View style={styles.runwayInner}>
                  <View style={styles.runwayLeft}>
                    <Text
                      style={[
                        styles.runwayLabel,
                        { color: dark ? tw.color.slate400 : tw.color.slate500 },
                      ]}
                    >
                      {calMonth ? "Before month end" : "To last until payday"}
                    </Text>
                    <Text
                      style={[
                        styles.runwayAmount,
                        {
                          color:
                            runwayData.runway < 0
                              ? dark
                                ? "#fb7185"
                                : "#e11d48"
                              : dark
                              ? tw.color.slate100
                              : tw.color.slate900,
                        },
                      ]}
                    >
                      {runwayData.runway < 0 ? "−" : ""}
                      {sym}
                      {Math.abs(runwayData.runway).toLocaleString("en-GB", {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}
                    </Text>
                    <Text
                      style={[
                        styles.runwaySub,
                        { color: dark ? tw.color.slate400 : tw.color.slate500 },
                      ]}
                    >
                      {sym}
                      {(cashflow?.available_balance ?? 0).toLocaleString(
                        "en-GB",
                        { minimumFractionDigits: 0, maximumFractionDigits: 0 }
                      )}{" "}
                      now −{sym}
                      {runwayData.billsTotal.toLocaleString("en-GB", {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}{" "}
                      bills
                      {calMonth
                        ? ` · ${runwayData.daysToPayday} ${runwayData.daysToPayday === 1 ? "day" : "days"} remaining`
                        : ` · ${runwayData.paydayLabel} (${runwayData.daysToPayday} ${runwayData.daysToPayday === 1 ? "day" : "days"})`}
                    </Text>
                  </View>
                  {accountShortfalls.length > 0 && (
                    <View
                      style={[
                        styles.shortBadge,
                        {
                          backgroundColor: dark
                            ? "rgba(159,18,57,0.4)"
                            : "#fecdd3",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.shortBadgeText,
                          { color: dark ? "#fca5a5" : "#e11d48" },
                        ]}
                      >
                        ⚠{" "}
                        {accountShortfalls.length}{" "}
                        {accountShortfalls.length === 1
                          ? "account"
                          : "accounts"}{" "}
                        short
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Whisper */}
            <Text
              style={[
                styles.basisNote,
                { color: dark ? tw.color.slate500 : tw.color.slate400 },
              ]}
            >
              Based on your typical spending — last 90 days
            </Text>

            {/* Plan a one-off */}
            <Pressable
              onPress={() => setPlanSheetOpen(true)}
              style={styles.planOneOff}
            >
              <Text
                style={[
                  styles.planOneOffText,
                  { color: dark ? tw.color.indigo400 : tw.color.indigo600 },
                ]}
              >
                + Plan a one-off
              </Text>
            </Pressable>

            {/* Debt card */}
            <DebtEntryCard
              view={debtView}
              onTap={() => router.push("/debt-plan")}
            />

            {/* Groups */}
            {groups.length === 0 ? (
              <View
                style={[
                  styles.emptyCard,
                  { backgroundColor: cardBg, borderColor: cardBorder },
                ]}
              >
                <Text
                  style={[
                    styles.emptyText,
                    { color: dark ? tw.color.slate400 : tw.color.slate500 },
                  ]}
                >
                  Nothing more expected this pay period
                </Text>
              </View>
            ) : (
              <View style={styles.groupsBlock}>
                {groups.map(({ label, items: groupItems }) => (
                  <View key={label} style={styles.group}>
                    <Text
                      style={[
                        styles.groupLabel,
                        {
                          color:
                            label === "Today" || label === "Tomorrow"
                              ? dark
                                ? tw.color.amber400
                                : "#b45309"
                              : dark
                              ? tw.color.slate400
                              : tw.color.slate500,
                        },
                      ]}
                    >
                      {label.toUpperCase()}
                    </Text>
                    <View style={styles.groupRows}>
                      {groupItems.map((item) => {
                        const isPlanned =
                          item.type === "bill" && item.planned;
                        const rowKey = `${item.type}-${item.name}-${item.expected_date}`;
                        const highlighted = highlightBill === rowKey;
                        return (
                          <SwipeDismissRow
                            key={rowKey}
                            onDismiss={() =>
                              isPlanned
                                ? deletePlannedWithUndo(item.planned_id!)
                                : dismissUpcoming(item.name)
                            }
                            label={isPlanned ? "Delete" : "Not recurring"}
                          >
                            <BillRow
                              item={item}
                              dark={dark}
                              highlighted={highlighted}
                              onPress={() => {
                                if (isPlanned) {
                                  setEditPlanned({
                                    id: item.planned_id!,
                                    name: item.name,
                                    amount: item.amount,
                                    date: item.expected_date,
                                    account_id: item.account_id ?? null,
                                  });
                                } else {
                                  setEditItem({
                                    name: item.name,
                                    amount: item.amount,
                                    expected_date: item.expected_date,
                                    original_date: item.original_date,
                                    type: item.type,
                                    category: item.category,
                                    edited: item.edited,
                                    rule_label: item.rule_label,
                                  });
                                }
                              }}
                              onSkip={() => skipOccurrence(item)}
                            />
                          </SwipeDismissRow>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Undo snackbar */}
      {undoBar && (
        <UndoSnackbar
          key={undoNonce}
          visible={!!undoBar}
          kind={undoBar.kind}
          onUndo={
            undoBar.kind === "planned" ? undoPlannedDelete : undoLastDismiss
          }
        />
      )}

      {/* Sheets */}
      <UpcomingEditSheet
        visible={!!editItem}
        item={editItem}
        onClose={() => setEditItem(null)}
        onDismiss={() => editItem && dismissUpcoming(editItem.name)}
        onSaved={async () => {
          try {
            const fresh = await planningApi.planningCashflow();
            setCashflow(fresh);
          } catch {}
        }}
      />

      <PlannedEditSheet
        visible={!!editPlanned}
        item={editPlanned}
        accounts={accounts}
        onClose={() => setEditPlanned(null)}
        onDelete={() => editPlanned && deletePlannedWithUndo(editPlanned.id)}
        onSaved={() =>
          planningApi.planningCashflow().then(setCashflow).catch(() => {})
        }
      />

      <PlanOneOffSheet
        visible={planSheetOpen}
        accounts={accounts}
        onClose={() => setPlanSheetOpen(false)}
        onSaved={() =>
          planningApi.planningCashflow().then(setCashflow).catch(() => {})
        }
      />

      <PayPeriodSettingsSheet
        visible={settingsOpen}
        current={payPeriodConfig}
        onClose={() => setSettingsOpen(false)}
        onSave={(c) => setPayPeriodConfig(c)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: tw.space[4],
  },
  header: {
    marginBottom: tw.space[4],
  },
  whisper: {
    fontSize: tw.text["11"].fontSize,
    lineHeight: tw.text["11"].lineHeight,
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: tw.space[1],
  },
  headline: {
    fontSize: tw.text.xl.fontSize,
    lineHeight: tw.text.xl.lineHeight,
    fontWeight: tw.weight.bold,
  },
  callout: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tw.space[2.5],
    borderRadius: tw.radius["2xl"],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    borderWidth: 1,
    marginBottom: tw.space[2],
  },
  calloutText: {
    flex: 1,
    minWidth: 0,
  },
  calloutTitle: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.semibold,
  },
  calloutBody: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    marginTop: 2,
  },
  reviewBtn: {
    backgroundColor: "#e11d48",
    borderRadius: tw.radius.lg,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[1],
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  reviewBtnText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
    color: tw.color.white,
  },
  calloutNote: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    paddingHorizontal: tw.space[1],
    marginBottom: tw.space[3],
  },
  skeletonBlock: {
    gap: tw.space[3],
    marginTop: tw.space[4],
  },
  errorCard: {
    borderRadius: tw.radius["2xl"],
    padding: tw.space[6],
    alignItems: "center",
    borderWidth: 1,
    marginTop: tw.space[4],
  },
  errorText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    textAlign: "center",
  },
  runwayCard: {
    borderRadius: tw.radius["2xl"],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[4],
    borderWidth: 1,
    marginBottom: tw.space[2],
  },
  runwayInner: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: tw.space[2],
  },
  runwayLeft: {
    flex: 1,
    minWidth: 0,
  },
  runwayLabel: {
    fontSize: tw.text["11"].fontSize,
    lineHeight: tw.text["11"].lineHeight,
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  runwayAmount: {
    fontSize: tw.text["2xl"].fontSize,
    lineHeight: tw.text["2xl"].lineHeight,
    fontWeight: tw.weight.bold,
    letterSpacing: -0.5,
  },
  runwaySub: {
    fontSize: tw.text["11"].fontSize,
    lineHeight: tw.text["11"].lineHeight,
    marginTop: 2,
  },
  shortBadge: {
    borderRadius: tw.radius.lg,
    paddingHorizontal: tw.space[2],
    paddingVertical: tw.space[1],
    flexShrink: 0,
  },
  shortBadgeText: {
    fontSize: tw.text["11"].fontSize,
    lineHeight: tw.text["11"].lineHeight,
    fontWeight: tw.weight.semibold,
  },
  basisNote: {
    fontSize: tw.text["10"].fontSize,
    lineHeight: tw.text["10"].lineHeight,
    paddingHorizontal: tw.space[1],
    marginBottom: tw.space[3],
  },
  planOneOff: {
    minHeight: 44,
    borderRadius: tw.radius.xl,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: tw.space[3],
  },
  planOneOffText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.semibold,
  },
  emptyCard: {
    borderRadius: tw.radius["2xl"],
    padding: tw.space[8],
    alignItems: "center",
    borderWidth: 1,
    marginTop: tw.space[3],
  },
  emptyText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    textAlign: "center",
  },
  groupsBlock: {
    gap: tw.space[3],
    marginTop: tw.space[3],
  },
  group: {
    gap: tw.space[2],
  },
  groupLabel: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.wide, tw.text.xs.fontSize),
  },
  groupRows: {
    gap: tw.space[2],
  },
});
