import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, RefreshControl,
  ActivityIndicator, TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, DebtInsights } from "@/lib/api";
import { categoryColour } from "@/lib/categories";

function fmt(n: number, sym = "£") {
  return `${sym}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function fmt2(n: number, sym = "£") {
  return `${sym}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function debtFreeDate(months: number) {
  if (!isFinite(months) || months > 600) return "a very long time";
  const d = new Date();
  d.setMonth(d.getMonth() + Math.ceil(months));
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export default function DebtScreen() {
  const [insights, setInsights] = useState<DebtInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hide, setHide] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, prefs] = await Promise.all([
        api.debtInsights(),
        api.getPreferences(),
      ]);
      setInsights(data);
      setHide(prefs.hide_net_worth);
    } catch {}
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-[#f0f2f7] items-center justify-center">
        <ActivityIndicator color="#b91c1c" size="large" />
      </SafeAreaView>
    );
  }

  const hasDebt = (insights?.total_debt ?? 0) > 0;

  return (
    <SafeAreaView className="flex-1 bg-[#f0f2f7]" edges={["top"]}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-6"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#b91c1c" />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="mx-4 mt-4 rounded-3xl px-5 pt-5 pb-6" style={{ backgroundColor: "#b91c1c" }}>
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-white text-xl font-bold">Debt Tracker</Text>
              <Text className="text-white/70 text-sm mt-0.5">Credit card overview</Text>
            </View>
            <TouchableOpacity onPress={() => setHide(h => !h)} className="opacity-70">
              <Text className="text-white text-xs">{hide ? "Show" : "Hide"}</Text>
            </TouchableOpacity>
          </View>
          {insights && (
            <View className="mt-4">
              {hasDebt ? (
                <>
                  <Text className="text-white/70 text-xs mb-0.5">Total Outstanding</Text>
                  <Text className="text-white text-4xl font-bold tracking-tight">
                    {hide ? "••••" : fmt(insights.total_debt)}
                  </Text>
                  <Text className="text-white/60 text-sm mt-0.5">
                    Across {insights.accounts.length} card{insights.accounts.length !== 1 ? "s" : ""} · free by{" "}
                    <Text className="font-semibold text-white/80">{debtFreeDate(insights.months_at_current_rate)}</Text>
                  </Text>
                </>
              ) : (
                <>
                  <Text className="text-white/70 text-xs mb-0.5">Monthly Surplus</Text>
                  <Text className="text-white text-4xl font-bold tracking-tight">
                    {hide ? "••••" : fmt(Math.abs(insights.monthly_surplus))}
                  </Text>
                  <Text className="text-white/60 text-sm mt-0.5">No credit card debt ✅</Text>
                </>
              )}
            </View>
          )}
        </View>

        <View className="px-4 mt-3 gap-3">
          {!insights ? (
            <View className="bg-white rounded-2xl p-8 items-center shadow-sm">
              <Text className="text-slate-400 text-sm">Could not load debt data</Text>
            </View>
          ) : (
            <>
              {/* Income vs Spending */}
              <View className="bg-white rounded-2xl shadow-sm p-4">
                <Text className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Monthly Cash Flow</Text>
                <CashFlowRow label="Income" value={insights.monthly_income} colour="#22c55e" max={Math.max(insights.monthly_income, insights.monthly_spending)} hide={hide} />
                <View className="mt-2">
                  <CashFlowRow label="Spending" value={insights.monthly_spending} colour="#f97316" max={Math.max(insights.monthly_income, insights.monthly_spending)} hide={hide} />
                </View>
                <View className="mt-3 pt-3 border-t border-slate-50 flex-row justify-between">
                  <Text className="text-slate-500 text-sm">Monthly surplus</Text>
                  <Text className={`font-bold text-sm ${insights.monthly_surplus >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {hide ? "••••" : fmt2(insights.monthly_surplus)}
                  </Text>
                </View>
              </View>

              {/* Credit cards */}
              {hasDebt && insights.accounts.length > 0 && (
                <View className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <View className="px-4 pt-3 pb-2 flex-row justify-between items-center">
                    <Text className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Credit Cards</Text>
                    {insights.weighted_apr > 0 && (
                      <Text className="text-xs font-semibold text-amber-600">{insights.weighted_apr.toFixed(1)}% avg APR</Text>
                    )}
                  </View>
                  {insights.accounts.map((acc, i) => {
                    const owed = Math.abs(acc.balance);
                    const pct = insights.total_debt > 0 ? (owed / insights.total_debt) * 100 : 0;
                    return (
                      <View key={acc.account_id} className={`px-4 py-3 ${i > 0 ? "border-t border-slate-50" : ""}`}>
                        <View className="flex-row items-center justify-between mb-1.5">
                          <View className="flex-1 mr-3">
                            <Text className="text-slate-800 font-medium text-sm" numberOfLines={1}>{acc.name}</Text>
                            <Text className="text-slate-400 text-xs">{acc.provider}</Text>
                          </View>
                          <View className="items-end">
                            <Text className="text-rose-500 font-bold text-sm">{hide ? "••••" : fmt2(owed)}</Text>
                            {acc.apr !== null && (
                              <Text className="text-amber-500 text-xs">{acc.apr}% APR</Text>
                            )}
                          </View>
                        </View>
                        <View className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <View className="h-full bg-rose-400 rounded-full" style={{ width: `${pct}%` }} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Free Up Cash */}
              {insights.recommendations.length > 0 && insights.monthly_surplus > 0 && (() => {
                const rows = insights.recommendations
                  .map(rec => ({
                    ...rec,
                    moSaved: Math.max(0, insights.months_at_current_rate - (insights.total_debt / (insights.monthly_surplus + rec.cut_25pct_saves))),
                  }))
                  .filter(rec => rec.moSaved > 0.5)
                  .sort((a, b) => b.moSaved - a.moSaved)
                  .slice(0, 3);
                if (rows.length === 0) return null;
                return (
                  <View className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    <View className="px-4 pt-4 pb-2">
                      <Text className="text-sm font-semibold text-slate-800">Free Up Cash</Text>
                      <Text className="text-xs text-slate-400 mt-0.5">Cut these vs. your current trajectory</Text>
                    </View>
                    {rows.map(rec => {
                      const colour = categoryColour(rec.category);
                      return (
                        <View key={rec.category} className="flex-row items-center justify-between px-4 py-3.5 border-t border-slate-50">
                          <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
                            <View className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colour }} />
                            <View className="min-w-0">
                              <Text className="text-slate-800 font-medium text-sm">{rec.category}</Text>
                              <Text className="text-slate-400 text-xs">{hide ? "••••" : `${fmt(rec.monthly_spend)}/mo · cut 25% saves ${fmt(rec.cut_25pct_saves)}/mo`}</Text>
                            </View>
                          </View>
                          <Text className="text-emerald-600 font-bold text-sm flex-shrink-0 ml-3">
                            ~{Math.round(rec.moSaved)}mo sooner
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                );
              })()}

              {/* Milestone */}
              {hasDebt && (
                <View className="bg-white rounded-2xl shadow-sm p-4">
                  <Text className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Timeline</Text>
                  <View className="flex-row gap-3">
                    <Stat
                      label="Months to clear"
                      value={insights.months_at_current_rate > 600 ? "∞" : `${Math.ceil(insights.months_at_current_rate)}`}
                      sub="at current rate"
                    />
                    <Stat
                      label="Monthly interest"
                      value={fmt2(insights.accounts.reduce((s, a) => s + (a.monthly_interest ?? 0), 0))}
                      sub="total cost"
                    />
                  </View>
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function CashFlowRow({ label, value, colour, max, hide }: { label: string; value: number; colour: string; max: number; hide: boolean }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <View>
      <View className="flex-row justify-between mb-1">
        <Text className="text-slate-500 text-xs">{label}</Text>
        <Text className="text-slate-700 text-xs font-semibold">{hide ? "••••" : `£${value.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`}</Text>
      </View>
      <View className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <View className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: colour }} />
      </View>
    </View>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <View className="flex-1 bg-slate-50 rounded-xl p-3">
      <Text className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{label}</Text>
      <Text className="text-slate-800 font-bold text-xl">{value}</Text>
      <Text className="text-slate-400 text-[10px] mt-0.5">{sub}</Text>
    </View>
  );
}
