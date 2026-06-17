import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, RefreshControl,
  ActivityIndicator, TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, Transaction, BudgetItem } from "@/lib/api";
import { categoryColour, CATEGORY_ICONS } from "@/lib/categories";

function fmt(n: number) {
  return `£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

interface BudgetRow {
  category: string;
  limit: number;
  spent: number;
  remaining: number;
  pct: number;
}

export default function BudgetScreen() {
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [unbudgeted, setUnbudgeted] = useState<{ category: string; spent: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [totalSpent, setTotalSpent] = useState(0);
  const [totalBudget, setTotalBudget] = useState(0);

  const load = useCallback(async () => {
    try {
      const [budgetData, txns] = await Promise.all([
        api.getBudgets(),
        api.allTransactions(),
      ]);

      // Current month transactions (debits only)
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthDebits = txns.filter(t =>
        t.transaction_type === "debit" && new Date(t.date) >= monthStart
      );

      // Spending per category this month
      const spendMap = new Map<string, number>();
      for (const t of monthDebits) {
        const cat = t.category ?? "Other";
        spendMap.set(cat, (spendMap.get(cat) ?? 0) + t.amount);
      }

      const budgets = budgetData.budgets;
      const budgetedCats = new Set(budgets.map(b => b.category));

      // Build rows for budgeted categories
      const builtRows: BudgetRow[] = budgets
        .map(b => {
          const spent = spendMap.get(b.category) ?? 0;
          return {
            category: b.category,
            limit: b.monthly_limit,
            spent,
            remaining: b.monthly_limit - spent,
            pct: b.monthly_limit > 0 ? Math.min((spent / b.monthly_limit) * 100, 100) : 0,
          };
        })
        .sort((a, b) => b.pct - a.pct);

      // Unbudgeted categories with spend
      const unb = Array.from(spendMap.entries())
        .filter(([cat]) => !budgetedCats.has(cat) && cat !== "Income" && cat !== "Transfers")
        .map(([category, spent]) => ({ category, spent }))
        .sort((a, b) => b.spent - a.spent);

      setRows(builtRows);
      setUnbudgeted(unb);
      setTotalSpent(builtRows.reduce((s, r) => s + r.spent, 0));
      setTotalBudget(builtRows.reduce((s, r) => s + r.limit, 0));
    } catch {}
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const overallPct = totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 100) : 0;
  const overBudget = rows.filter(r => r.spent > r.limit);
  const daysLeft = (() => {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return end.getDate() - now.getDate();
  })();

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-[#f0f2f7] items-center justify-center">
        <ActivityIndicator color="#b91c1c" size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-[#f0f2f7]" edges={["top"]}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-6"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#b91c1c" />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="mx-4 mt-4 mb-3">
          <Text className="text-2xl font-bold text-slate-800">Budget</Text>
          <Text className="text-slate-400 text-sm mt-0.5">
            {new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })} · {daysLeft} days left
          </Text>
        </View>

        {rows.length === 0 ? (
          <View className="mx-4 bg-white rounded-2xl p-8 items-center shadow-sm">
            <Text className="text-slate-400 text-sm text-center">
              No budgets set yet.{"\n"}Set budgets in the web app to track them here.
            </Text>
          </View>
        ) : (
          <>
            {/* Overall summary */}
            <View className="mx-4 mb-3 bg-white rounded-2xl shadow-sm p-4">
              <View className="flex-row justify-between items-center mb-2">
                <Text className="text-slate-600 text-sm font-medium">Total this month</Text>
                <Text className="text-slate-500 text-xs">{daysLeft}d left</Text>
              </View>
              <View className="flex-row items-baseline gap-1.5 mb-2">
                <Text className="text-slate-800 text-2xl font-bold">{fmt(totalSpent)}</Text>
                <Text className="text-slate-400 text-sm">of {fmt(totalBudget)}</Text>
              </View>
              <View className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <View
                  className="h-full rounded-full"
                  style={{
                    width: `${overallPct}%`,
                    backgroundColor: overallPct >= 90 ? "#ef4444" : overallPct >= 70 ? "#f59e0b" : "#22c55e",
                  }}
                />
              </View>
              <View className="flex-row justify-between mt-1.5">
                <Text className="text-slate-400 text-xs">{Math.round(overallPct)}% used</Text>
                <Text className={`text-xs font-semibold ${totalBudget - totalSpent >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {totalBudget - totalSpent >= 0 ? fmt(totalBudget - totalSpent) + " left" : fmt(Math.abs(totalBudget - totalSpent)) + " over"}
                </Text>
              </View>
            </View>

            {/* Over budget alert */}
            {overBudget.length > 0 && (
              <View className="mx-4 mb-3 bg-red-50 border border-red-100 rounded-2xl p-3 flex-row items-start gap-2">
                <Text className="text-lg">⚠️</Text>
                <View className="flex-1">
                  <Text className="text-red-700 font-semibold text-sm mb-0.5">Over budget</Text>
                  <Text className="text-red-600 text-xs">
                    {overBudget.map(r => r.category).join(", ")}
                  </Text>
                </View>
              </View>
            )}

            {/* Budget rows */}
            <View className="mx-4 bg-white rounded-2xl shadow-sm overflow-hidden">
              {rows.map((row, i) => {
                const colour = categoryColour(row.category);
                const isOver = row.spent > row.limit;
                return (
                  <View key={row.category} className={`px-4 py-3.5 ${i > 0 ? "border-t border-slate-50" : ""}`}>
                    <View className="flex-row items-center justify-between mb-2">
                      <View className="flex-row items-center gap-2 flex-1 min-w-0">
                        <Text className="text-base">{CATEGORY_ICONS[row.category] ?? "📦"}</Text>
                        <Text className="text-slate-800 font-medium text-sm" numberOfLines={1}>{row.category}</Text>
                      </View>
                      <View className="items-end ml-2">
                        <Text className={`font-bold text-sm ${isOver ? "text-red-500" : "text-slate-800"}`}>
                          {fmt(row.spent)}
                          <Text className="text-slate-400 font-normal"> / {fmt(row.limit)}</Text>
                        </Text>
                        <Text className={`text-[10px] ${isOver ? "text-red-500" : "text-slate-400"}`}>
                          {isOver ? `${fmt(Math.abs(row.remaining))} over` : `${fmt(row.remaining)} left`}
                        </Text>
                      </View>
                    </View>
                    <View className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <View
                        className="h-full rounded-full"
                        style={{ width: `${row.pct}%`, backgroundColor: isOver ? "#ef4444" : colour }}
                      />
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Unbudgeted spending */}
            {unbudgeted.length > 0 && (
              <View className="mx-4 mt-3">
                <Text className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-2 px-1">
                  Unbudgeted this month
                </Text>
                <View className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  {unbudgeted.map((u, i) => (
                    <View key={u.category} className={`flex-row items-center justify-between px-4 py-3 ${i > 0 ? "border-t border-slate-50" : ""}`}>
                      <View className="flex-row items-center gap-2">
                        <Text className="text-base">{CATEGORY_ICONS[u.category] ?? "📦"}</Text>
                        <Text className="text-slate-700 text-sm">{u.category}</Text>
                      </View>
                      <Text className="text-slate-600 font-medium text-sm">{fmt(u.spent)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
