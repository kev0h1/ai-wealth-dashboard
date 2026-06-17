import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, RefreshControl,
  TouchableOpacity, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, KPIs, Account } from "@/lib/api";

function fmt(n: number, sym = "£") {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${sym}${(n / 1_000).toFixed(1)}k`;
  return `${sym}${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtFull(n: number, sym = "£") {
  return `${n < 0 ? "-" : ""}${sym}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function HomeScreen() {
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hide, setHide] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [k, a, prefs] = await Promise.all([
        api.kpis(),
        api.accounts(),
        api.getPreferences(),
      ]);
      setKpis(k);
      setAccounts(a.filter(a => a.status === "active").slice(0, 5));
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
    try { await api.syncAccounts(); await load(); } catch {}
    setSyncing(false);
  }

  const totalCash = accounts
    .filter(a => !["credit", "savings", "pension"].includes(a.type))
    .reduce((s, a) => s + a.balance, 0);

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
        {/* Hero card */}
        <View className="mx-4 mt-4 rounded-3xl px-5 pt-5 pb-6" style={{ backgroundColor: "#b91c1c" }}>
          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-white/70 text-xs font-semibold uppercase tracking-widest">Net Worth</Text>
            <TouchableOpacity onPress={() => setHide(h => !h)} className="opacity-70">
              <Text className="text-white text-xs">{hide ? "Show" : "Hide"}</Text>
            </TouchableOpacity>
          </View>
          <Text className="text-white text-4xl font-bold tracking-tight mb-1">
            {hide ? "••••••" : kpis ? fmtFull(kpis.net_worth) : "—"}
          </Text>
          {kpis && (
            <Text className="text-white/60 text-xs">
              Last updated {new Date(kpis.last_updated).toLocaleDateString("en-GB")}
            </Text>
          )}

          {/* KPI chips */}
          <View className="flex-row gap-2 mt-4">
            <KpiChip label="Cash" value={hide ? "••••" : kpis ? fmt(kpis.cash) : "—"} />
            <KpiChip label="Invested" value={hide ? "••••" : kpis ? fmt(kpis.investments) : "—"} />
            <KpiChip label="Runway" value={hide ? "••••" : kpis ? `${Math.round(kpis.runway)}mo` : "—"} />
          </View>
        </View>

        {/* Sync button */}
        <View className="mx-4 mt-3">
          <TouchableOpacity
            onPress={sync}
            disabled={syncing}
            className="bg-white rounded-2xl px-4 py-3 flex-row items-center justify-center shadow-sm active:opacity-70 disabled:opacity-50"
          >
            {syncing ? (
              <ActivityIndicator color="#b91c1c" size="small" />
            ) : (
              <Text className="text-[#b91c1c] font-semibold text-sm">↻  Sync accounts</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Accounts */}
        {accounts.length > 0 && (
          <View className="mx-4 mt-4">
            <Text className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-2 px-1">
              Accounts
            </Text>
            <View className="bg-white rounded-2xl overflow-hidden shadow-sm">
              {accounts.map((acc, i) => (
                <View
                  key={acc.id}
                  className={`px-4 py-3.5 flex-row items-center justify-between ${i > 0 ? "border-t border-slate-50" : ""}`}
                >
                  <View className="flex-1 mr-3">
                    <Text className="text-slate-800 font-medium text-sm" numberOfLines={1}>{acc.name}</Text>
                    <Text className="text-slate-400 text-xs mt-0.5">{acc.provider} · {acc.type}</Text>
                  </View>
                  <Text
                    className={`font-bold text-sm ${acc.balance < 0 ? "text-rose-500" : "text-slate-800"}`}
                  >
                    {hide ? "••••" : fmtFull(acc.balance, acc.currency === "GBP" ? "£" : acc.currency + " ")}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function KpiChip({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 bg-white/15 rounded-xl px-3 py-2">
      <Text className="text-white/60 text-[10px] mb-0.5">{label}</Text>
      <Text className="text-white font-bold text-sm">{value}</Text>
    </View>
  );
}
