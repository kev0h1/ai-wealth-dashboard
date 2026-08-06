import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Modal,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Trash2,
  Camera,
  Receipt,
} from "lucide-react-native";
import { router } from "expo-router";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTheme } from "@/lib/ThemeContext";
import { tw } from "@/lib/tw";
import { fmtGBP } from "@/lib/format";
import { insightsApi } from "@/lib/api/insights";
import type { Basket } from "@/lib/api/insights";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

interface BasketRowProps {
  basket: Basket;
  dark: boolean;
  onDelete: (id: string) => void;
}

function BasketRow({ basket, dark, onDelete }: BasketRowProps) {
  const [expanded, setExpanded] = useState(false);

  const cardBg = dark ? tw.color.cardDark : tw.color.white;
  const cardBorder = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const textPrimary = dark ? tw.color.slate100 : tw.color.slate800;
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate500;
  const divider = dark ? tw.color.slate700 : tw.color.slate100;

  return (
    <View
      style={[
        rowStyles.card,
        { backgroundColor: cardBg, borderColor: cardBorder },
      ]}
    >
      {/* Summary row */}
      <View style={rowStyles.summaryRow}>
        <Pressable
          onPress={() => setExpanded((e) => !e)}
          style={rowStyles.summaryLeft}
        >
          <View style={rowStyles.shopBlock}>
            <Text style={[rowStyles.shopName, { color: textPrimary }]}>
              {basket.shop ?? "Unknown shop"}
            </Text>
            <Text style={[rowStyles.itemCount, { color: textSecondary }]}>
              {basket.item_count} item{basket.item_count !== 1 ? "s" : ""}
            </Text>
          </View>
          <View style={rowStyles.rightBlock}>
            {basket.purchased_at && (
              <Text style={[rowStyles.date, { color: textSecondary }]}>
                {formatDate(basket.purchased_at)}
                {basket.date_estimated ? " (est.)" : ""}
              </Text>
            )}
            {basket.total != null && (
              <Text style={[rowStyles.total, { color: textPrimary }]}>
                {fmtGBP(basket.total)}
              </Text>
            )}
          </View>
        </Pressable>
        <Pressable
          onPress={() => onDelete(basket.id)}
          hitSlop={8}
          style={rowStyles.deleteBtn}
          accessibilityLabel="Delete receipt"
        >
          <Trash2 size={16} color={tw.color.rose500} />
        </Pressable>
        <Pressable
          onPress={() => setExpanded((e) => !e)}
          hitSlop={8}
          accessibilityLabel={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? (
            <ChevronUp size={16} color={textSecondary} />
          ) : (
            <ChevronDown size={16} color={textSecondary} />
          )}
        </Pressable>
      </View>

      {/* Expanded items */}
      {expanded && basket.items.length > 0 && (
        <>
          <View
            style={[rowStyles.divider, { backgroundColor: divider }]}
          />
          {basket.items.map((item, idx) => (
            <View key={idx} style={rowStyles.itemRow}>
              <View style={rowStyles.itemLeft}>
                <Text style={[rowStyles.itemName, { color: textPrimary }]}>
                  {item.qty > 1 ? `${item.qty}× ` : ""}
                  {item.name}
                </Text>
                <Text style={[rowStyles.itemCategory, { color: textSecondary }]}>
                  {item.category}
                </Text>
              </View>
              {item.line_price != null && (
                <Text style={[rowStyles.itemPrice, { color: textSecondary }]}>
                  {fmtGBP(item.line_price)}
                </Text>
              )}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const rowStyles = StyleSheet.create({
  card: {
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
    marginBottom: tw.space[2],
    padding: tw.space[4],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
    gap: tw.space[2],
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
  },
  summaryLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  shopBlock: {
    flex: 1,
  },
  shopName: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  itemCount: {
    ...tw.text.xs,
  },
  rightBlock: {
    alignItems: "flex-end",
  },
  date: {
    ...tw.text.xs,
  },
  total: {
    ...tw.text.sm,
    fontWeight: tw.weight.bold,
  },
  deleteBtn: {
    padding: tw.space[1],
  },
  divider: {
    height: 1,
    marginVertical: tw.space[1],
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: tw.space[2],
    paddingVertical: 2,
  },
  itemLeft: {
    flex: 1,
  },
  itemName: {
    ...tw.text.xs,
    fontWeight: tw.weight.medium,
  },
  itemCategory: {
    fontSize: 10,
    lineHeight: 14,
  },
  itemPrice: {
    ...tw.text.xs,
    fontWeight: tw.weight.medium,
  },
});

export function ReceiptsPage() {
  const { dark } = useTheme();
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);

  const canvasBg = dark ? tw.color.canvasDark : tw.color.canvasLight;
  const cardBg = dark ? tw.color.cardDark : tw.color.white;
  const cardBorder = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const textPrimary = dark ? tw.color.slate100 : tw.color.slate800;
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate500;

  useEffect(() => {
    insightsApi
      .listBaskets()
      .then(setBaskets)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleDeletePress = useCallback((id: string) => {
    setDeleteTarget(id);
    setConfirmVisible(true);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    const id = deleteTarget;
    setConfirmVisible(false);
    setDeleteTarget(null);
    // Optimistic remove
    setBaskets((prev) => prev.filter((b) => b.id !== id));
    try {
      await insightsApi.deleteBasket(id);
    } catch {
      // On failure, refetch
      insightsApi.listBaskets().then(setBaskets).catch(() => {});
    }
  }, [deleteTarget]);

  const handleScan = useCallback(async () => {
    setScanError(null);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      setScanError("Photo library permission required to scan receipts.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    setScanning(true);
    try {
      const basket = await insightsApi.scanReceipt(result.assets[0].base64);
      setBaskets((prev) => [basket, ...prev]);
    } catch (e) {
      setScanError(
        e instanceof Error ? e.message : "Receipt scan failed. Please try again."
      );
    } finally {
      setScanning(false);
    }
  }, []);

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.safeArea, { backgroundColor: canvasBg }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={[
            styles.backBtn,
            { backgroundColor: cardBg, borderColor: cardBorder },
          ]}
          hitSlop={8}
          accessibilityLabel="Go back"
        >
          <ChevronLeft size={20} color={textPrimary} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: textPrimary }]}>
            Receipts
          </Text>
          {!loading && baskets.length > 0 && (
            <View style={styles.countBadge}>
              <Text style={[styles.countText, { color: textSecondary }]}>
                {baskets.length} total
              </Text>
            </View>
          )}
        </View>
        <Pressable
          onPress={handleScan}
          disabled={scanning}
          style={[
            styles.scanBtn,
            { backgroundColor: tw.color.indigo600, opacity: scanning ? 0.6 : 1 },
          ]}
          accessibilityLabel="Add receipt"
        >
          {scanning ? (
            <ActivityIndicator size="small" color={tw.color.white} />
          ) : (
            <Camera size={18} color={tw.color.white} />
          )}
        </Pressable>
      </View>

      {scanError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{scanError}</Text>
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton
                key={i}
                height={64}
                borderRadius={tw.radius["2xl"]}
                style={styles.skeletonItem}
              />
            ))}
          </>
        ) : baskets.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View
              style={[
                styles.emptyIconWrap,
                { backgroundColor: tw.color.emerald50 },
              ]}
            >
              <Receipt size={56} color={tw.color.emerald400} />
            </View>
            <Text style={[styles.emptyTitle, { color: textPrimary }]}>
              No receipts yet
            </Text>
            <Text style={[styles.emptyBody, { color: textSecondary }]}>
              Scan a receipt using the camera button above to track your spending in detail.
            </Text>
            <Pressable
              onPress={() => router.back()}
              style={styles.goBackBtn}
            >
              <Text style={styles.goBackText}>Go back</Text>
            </Pressable>
          </View>
        ) : (
          baskets.map((basket) => (
            <BasketRow
              key={basket.id}
              basket={basket}
              dark={dark}
              onDelete={handleDeletePress}
            />
          ))
        )}
      </ScrollView>

      {/* Delete confirmation modal */}
      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmVisible(false)}
        statusBarTranslucent
      >
        <View style={modalStyles.backdrop}>
          <View
            style={[
              modalStyles.card,
              { backgroundColor: cardBg, borderColor: cardBorder },
            ]}
          >
            <Text style={[modalStyles.title, { color: textPrimary }]}>
              Delete receipt?
            </Text>
            <Text style={[modalStyles.body, { color: textSecondary }]}>
              This action cannot be undone.
            </Text>
            <View style={modalStyles.btnRow}>
              <Pressable
                onPress={() => {
                  setConfirmVisible(false);
                  setDeleteTarget(null);
                }}
                style={[
                  modalStyles.btn,
                  {
                    borderWidth: 1,
                    borderColor: dark ? tw.color.slate700 : tw.color.slate200,
                  },
                ]}
              >
                <Text style={[modalStyles.btnLabel, { color: textSecondary }]}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={handleDeleteConfirm}
                style={[
                  modalStyles.btn,
                  { backgroundColor: tw.color.rose500 },
                ]}
              >
                <Text
                  style={[modalStyles.btnLabel, { color: tw.color.white }]}
                >
                  Delete
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    gap: tw.space[3],
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: tw.radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
  },
  headerTitle: {
    ...tw.text.xl,
    fontWeight: tw.weight.bold,
  },
  countBadge: {
    backgroundColor: tw.color.slate100,
    borderRadius: tw.radius.full,
    paddingHorizontal: tw.space[2],
    paddingVertical: 2,
  },
  countText: {
    ...tw.text.xs,
    fontWeight: tw.weight.medium,
  },
  scanBtn: {
    width: 40,
    height: 40,
    borderRadius: tw.radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  errorBanner: {
    backgroundColor: tw.color.rose500 + "18",
    marginHorizontal: tw.space[4],
    marginBottom: tw.space[2],
    borderRadius: tw.radius.xl,
    padding: tw.space[3],
    borderWidth: 1,
    borderColor: tw.color.rose500 + "40",
  },
  errorText: {
    ...tw.text.sm,
    color: tw.color.rose500,
    fontWeight: tw.weight.medium,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: tw.space[4],
    paddingTop: tw.space[1],
    paddingBottom: 80,
  },
  skeletonItem: {
    marginBottom: tw.space[2],
  },
  emptyContainer: {
    alignItems: "center",
    paddingTop: tw.space[12],
    gap: tw.space[3],
  },
  emptyIconWrap: {
    width: 96,
    height: 96,
    borderRadius: tw.radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    ...tw.text.lg,
    fontWeight: tw.weight.bold,
  },
  emptyBody: {
    ...tw.text.sm,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: tw.space[6],
  },
  goBackBtn: {
    marginTop: tw.space[2],
  },
  goBackText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
    color: tw.color.emerald600,
  },
});

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tw.space[6],
  },
  card: {
    width: "100%",
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
    padding: tw.space[6],
    gap: tw.space[3],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  title: {
    ...tw.text.lg,
    fontWeight: tw.weight.bold,
  },
  body: {
    ...tw.text.sm,
  },
  btnRow: {
    flexDirection: "row",
    gap: tw.space[3],
    marginTop: tw.space[2],
  },
  btn: {
    flex: 1,
    paddingVertical: tw.space[3],
    borderRadius: tw.radius.xl,
    alignItems: "center",
  },
  btnLabel: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
});
