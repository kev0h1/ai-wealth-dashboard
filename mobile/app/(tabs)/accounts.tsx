import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, RefreshControl,
  ActivityIndicator, TouchableOpacity, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, Account } from "@/lib/api";

function fmt2(n: number, sym = "£") {
  return `${n < 0 ? "-" : ""}${sym}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const TYPE_LABELS: Record<string, string> = {
  current: "Current",
  savings: "Savings",
  credit: "Credit Card",
  pension: "Pension",
  isa: "ISA",
  investment: "Investment",
  loan: "Loan",
  mortgage: "Mortgage",
};

const TYPE_COLOURS: Record<string, string> = {
  current: "#3b82f6",
  savings: "#22c55e",
  credit: "#ef4444",
  pension: "#8b5cf6",
  isa: "#10b981",
  investment: "#f59e0b",
  loan: "#f97316",
  mortgage: "#64748b",
};

export default function AccountsScreen() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [investments, setInvestments] = useState<{ id: string; provider: string; account_type: string; total_value: number; currency: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [hide, setHide] = useState(false);

  const load = useCallback(async () => {
    try {
      const [accs, inv, prefs] = await Promise.all([
        api.accounts(),
        api.getInvestmentAccounts(),
        api.getPreferences(),
      ]);
      setAccounts(accs);
      setInvestments(inv);
      setHide(prefs.hide_net_worth);
    } catch {}
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function sync() {
    setSyncing(true);
    try {
      await api.syncAccounts();
      await load();
    } catch {
      Alert.alert("Sync failed", "Could not sync accounts. Try again.");
    }
    setSyncing(false);
  }

  async function deleteAccount(acc: Account) {
    Alert.alert(
      "Remove account",
      `Remove "${acc.name}" from the dashboard? This won't affect your bank.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteAccount(acc.id);
              setAccounts(prev => prev.filter(a => a.id !== acc.id));
            } catch {
              Alert.alert("Error", "Could not remove account.");
            }
          },
        },
      ]
    );
  }

  // Group accounts by type
  const grouped = accounts.reduce<Record<string, Account[]>>((g, a) => {
    const key = a.type || "other";
    return { ...g, [key]: [...(g[key] ?? []), a] };
  }, {});

  const totalBankBalance = accounts
    .filter(a => !["credit", "pension", "investment"].includes(a.type))
    .reduce((s, a) => s + a.balance, 0);

  const totalDebt = accounts
    .filter(a => a.type === "credit" && a.balance < 0)
    .reduce((s, a) => s + Math.abs(a.balance), 0);

  const totalInvestments = investments.reduce((s, i) => s + i.total_value, 0);

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
        <View className="mx-4 mt-4 mb-3 flex-row items-center justify-between">
          <View>
            <Text className="text-2xl font-bold text-slate-800">Accounts</Text>
            <Text className="text-slate-400 text-sm mt-0.5">{accounts.length} connected</Text>
          </View>
          <TouchableOpacity onPress={() => setHide(h => !h)} className="bg-white rounded-xl px-3 py-2 shadow-sm">
            <Text className="text-slate-500 text-xs font-medium">{hide ? "Show values" : "Hide values"}</Text>
          </TouchableOpacity>
        </View>

        {/* Summary chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-4 mb-3">
          <View className="flex-row gap-2 pr-4">
            <SummaryChip label="Cash" value={hide ? "••••" : fmt2(totalBankBalance)} colour="#3b82f6" />
            {totalDebt > 0 && (
              <SummaryChip label="Debt" value={hide ? "••••" : fmt2(totalDebt)} colour="#ef4444" />
            )}
            {totalInvestments > 0 && (
              <SummaryChip label="Invested" value={hide ? "••••" : fmt2(totalInvestments)} colour="#f59e0b" />
            )}
          </View>
        </ScrollView>

        {/* Sync button */}
        <View className="mx-4 mb-3">
          <TouchableOpacity
            onPress={sync}
            disabled={syncing}
            className="bg-white rounded-2xl px-4 py-3 flex-row items-center justify-center shadow-sm active:opacity-70 disabled:opacity-50"
          >
            {syncing ? (
              <ActivityIndicator color="#b91c1c" size="small" />
            ) : (
              <Text className="text-[#b91c1c] font-semibold text-sm">↻  Sync all accounts</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Accounts by type */}
        {Object.entries(grouped).map(([type, accs]) => (
          <View key={type} className="mx-4 mb-3">
            <Text className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-2 px-1">
              {TYPE_LABELS[type] ?? type}s
            </Text>
            <View className="bg-white rounded-2xl overflow-hidden shadow-sm">
              {accs.map((acc, i) => {
                const colour = TYPE_COLOURS[acc.type] ?? "#94a3b8";
                const sym = acc.currency === "GBP" ? "£" : acc.currency === "KES" ? "KES " : acc.currency + " ";
                return (
                  <TouchableOpacity
                    key={acc.id}
                    onLongPress={() => deleteAccount(acc)}
                    className={`px-4 py-3.5 flex-row items-center gap-3 ${i > 0 ? "border-t border-slate-50" : ""}`}
                  >
                    <View
                      className="w-9 h-9 rounded-xl items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: colour + "22" }}
                    >
                      <Text className="text-xs font-bold" style={{ color: colour }}>
                        {acc.name.slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                    <View className="flex-1 min-w-0">
                      <Text className="text-slate-800 font-medium text-sm" numberOfLines={1}>{acc.name}</Text>
                      <Text className="text-slate-400 text-xs mt-0.5">{acc.provider}</Text>
                    </View>
                    <Text className={`font-bold text-sm flex-shrink-0 ${acc.balance < 0 ? "text-rose-500" : "text-slate-800"}`}>
                      {hide ? "••••" : fmt2(acc.balance, sym)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        {/* Investment accounts */}
        {investments.length > 0 && (
          <View className="mx-4 mb-3">
            <Text className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-2 px-1">
              Investment Accounts
            </Text>
            <View className="bg-white rounded-2xl overflow-hidden shadow-sm">
              {investments.map((inv, i) => (
                <View key={inv.id} className={`px-4 py-3.5 flex-row items-center gap-3 ${i > 0 ? "border-t border-slate-50" : ""}`}>
                  <View className="w-9 h-9 rounded-xl items-center justify-center flex-shrink-0 bg-amber-50">
                    <Text className="text-xs font-bold text-amber-600">
                      {inv.provider.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View className="flex-1 min-w-0">
                    <Text className="text-slate-800 font-medium text-sm" numberOfLines={1}>{inv.provider}</Text>
                    <Text className="text-slate-400 text-xs mt-0.5">{inv.account_type}</Text>
                  </View>
                  <Text className="text-slate-800 font-bold text-sm flex-shrink-0">
                    {hide ? "••••" : fmt2(inv.total_value, inv.currency === "GBP" ? "£" : inv.currency + " ")}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <Text className="text-slate-400 text-xs text-center mt-2 px-4">
          Long-press an account to remove it from the dashboard
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryChip({ label, value, colour }: { label: string; value: string; colour: string }) {
  return (
    <View className="bg-white rounded-xl px-4 py-2.5 shadow-sm items-center min-w-[90px]">
      <Text className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: colour }}>{label}</Text>
      <Text className="text-slate-800 font-bold text-sm">{value}</Text>
    </View>
  );
}
