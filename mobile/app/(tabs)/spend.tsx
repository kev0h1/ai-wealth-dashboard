import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, RefreshControl,
  TouchableOpacity, ActivityIndicator, TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, Transaction } from "@/lib/api";
import { categoryColour, CATEGORY_ICONS } from "@/lib/categories";

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function fmt(n: number, sym = "£") {
  return `${sym}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface CategoryTotal {
  category: string;
  amount: number;
  count: number;
}

export default function SpendScreen() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categoryTotals, setCategoryTotals] = useState<CategoryTotal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [view, setView] = useState<"transactions" | "categories">("transactions");

  const load = useCallback(async () => {
    try {
      const txns = await api.allTransactions();
      const debits = txns.filter(t => t.transaction_type === "debit");
      setTransactions(debits);

      // Compute category totals
      const map = new Map<string, { amount: number; count: number }>();
      for (const t of debits) {
        const cat = t.category ?? "Other";
        const cur = map.get(cat) ?? { amount: 0, count: 0 };
        map.set(cat, { amount: cur.amount + t.amount, count: cur.count + 1 });
      }
      const totals = Array.from(map.entries())
        .map(([category, v]) => ({ category, ...v }))
        .sort((a, b) => b.amount - a.amount);
      setCategoryTotals(totals);
    } catch {}
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const maxAmount = categoryTotals[0]?.amount ?? 1;

  const filtered = transactions.filter(t => {
    const matchesSearch = !search ||
      (t.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (t.merchant_name ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesCat = !selectedCategory || t.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-[#f0f2f7] items-center justify-center">
        <ActivityIndicator color="#b91c1c" size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-[#f0f2f7]" edges={["top"]}>
      {/* Header */}
      <View className="mx-4 mt-4 mb-3">
        <Text className="text-2xl font-bold text-slate-800">Spending</Text>
        <Text className="text-slate-400 text-sm mt-0.5">Last 3 months</Text>
      </View>

      {/* View toggle */}
      <View className="mx-4 mb-3 flex-row bg-white rounded-xl p-1 shadow-sm">
        {(["transactions", "categories"] as const).map(v => (
          <TouchableOpacity
            key={v}
            onPress={() => setView(v)}
            className={`flex-1 py-2 rounded-lg items-center ${view === v ? "bg-[#b91c1c]" : ""}`}
          >
            <Text className={`text-xs font-semibold capitalize ${view === v ? "text-white" : "text-slate-500"}`}>
              {v}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-6"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#b91c1c" />}
        showsVerticalScrollIndicator={false}
      >
        {view === "categories" ? (
          <View className="mx-4 bg-white rounded-2xl overflow-hidden shadow-sm">
            <View className="px-4 pt-3 pb-1 flex-row justify-between">
              <Text className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Category</Text>
              <Text className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Total</Text>
            </View>
            {categoryTotals.map((cat, i) => {
              const colour = categoryColour(cat.category);
              const barPct = (cat.amount / maxAmount) * 100;
              return (
                <TouchableOpacity
                  key={cat.category}
                  onPress={() => {
                    setSelectedCategory(cat.category === selectedCategory ? null : cat.category);
                    setView("transactions");
                  }}
                  className={`px-4 py-3 ${i > 0 ? "border-t border-slate-50" : ""}`}
                >
                  <View className="flex-row items-center justify-between mb-1.5">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-base">{CATEGORY_ICONS[cat.category] ?? "📦"}</Text>
                      <Text className="text-slate-800 font-medium text-sm">{cat.category}</Text>
                      <Text className="text-slate-400 text-xs">{cat.count}</Text>
                    </View>
                    <Text className="text-slate-800 font-bold text-sm">{fmt(cat.amount)}</Text>
                  </View>
                  <View className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <View
                      className="h-full rounded-full"
                      style={{ width: `${barPct}%`, backgroundColor: colour }}
                    />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View className="mx-4">
            {/* Search + filter */}
            <View className="mb-3 flex-row gap-2">
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search transactions…"
                placeholderTextColor="#94a3b8"
                className="flex-1 bg-white rounded-xl px-4 py-3 text-sm text-slate-800 shadow-sm"
              />
              {selectedCategory && (
                <TouchableOpacity
                  onPress={() => setSelectedCategory(null)}
                  className="bg-[#b91c1c] rounded-xl px-3 items-center justify-center"
                >
                  <Text className="text-white text-xs font-semibold">✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {selectedCategory && (
              <View className="mb-2 flex-row items-center gap-1.5 bg-white rounded-xl px-3 py-2 shadow-sm">
                <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: categoryColour(selectedCategory) }} />
                <Text className="text-slate-600 text-xs font-medium">Filtered: {selectedCategory}</Text>
              </View>
            )}

            <View className="bg-white rounded-2xl overflow-hidden shadow-sm">
              {filtered.length === 0 ? (
                <View className="px-4 py-8 items-center">
                  <Text className="text-slate-400 text-sm">No transactions found</Text>
                </View>
              ) : (
                filtered.slice(0, 100).map((t, i) => {
                  const colour = categoryColour(t.category);
                  const name = t.merchant_name || t.description;
                  return (
                    <View
                      key={t.id}
                      className={`px-4 py-3.5 flex-row items-center gap-3 ${i > 0 ? "border-t border-slate-50" : ""}`}
                    >
                      <View
                        className="w-8 h-8 rounded-full items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: colour + "22" }}
                      >
                        <Text className="text-sm">{CATEGORY_ICONS[t.category ?? "Other"] ?? "📦"}</Text>
                      </View>
                      <View className="flex-1 min-w-0">
                        <Text className="text-slate-800 font-medium text-sm" numberOfLines={1}>{name}</Text>
                        <Text className="text-slate-400 text-xs mt-0.5">
                          {fmtDate(t.date)} · {t.category ?? "Other"}
                        </Text>
                      </View>
                      <Text className="text-slate-800 font-bold text-sm flex-shrink-0">
                        -{fmt(t.amount)}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>
            {filtered.length > 100 && (
              <Text className="text-slate-400 text-xs text-center mt-2">
                Showing 100 of {filtered.length} transactions
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
