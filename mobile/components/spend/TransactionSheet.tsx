/**
 * TransactionSheet — bottom sheet (88dvh) for single transaction edit.
 *
 * Structure:
 *   - Handle bar
 *   - Header: transaction name + close button
 *   - Amount block (tinted) + date + transaction type
 *   - Category selector (current category pill + ScrollView of options)
 *   - Scope selector: "All from merchant" | "Future from merchant"
 *     (scope values: "all" | "future" ONLY — no "single" per spec)
 *     When only one option available (no matchKey), defaults to "all" with no selector shown.
 *   - Similar transactions checklist (FlatList, appears when scope is set)
 *   - Save button (indigo→violet gradient → green on success)
 *
 * Animation: slide up 280ms, same easing as SpendCategorySheet.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  FlatList,
  StyleSheet,
  Animated,
  Easing,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  X,
  Tag,
  Check,
  Users,
  CalendarArrowUp,
  CheckSquare,
  Square,
} from "lucide-react-native";
import { tw } from "@/lib/tw";
import { CATEGORY_COLOURS, CATEGORY_ICONS } from "@/lib/shared";
import { spendApi } from "@/lib/api/spend";
import type { Transaction } from "@/lib/api/spend";
import { formatDate, formatCurrency } from "./periodUtils";

type Scope = "all" | "future";

function catColour(name: string): string {
  return CATEGORY_COLOURS[name] ?? "#94a3b8";
}

function catIcon(name: string): string {
  return CATEGORY_ICONS[name] ?? "📦";
}

function txDisplayName(tx: Transaction): string {
  return tx.merchant_name || tx.description || "Unknown";
}

function matchLabel(tx: Transaction): string {
  if (tx.merchant_name) return `"${tx.merchant_name}"`;
  const desc = (tx.description ?? "").slice(0, 28);
  return `"${desc}${(tx.description ?? "").length > 28 ? "…" : ""}"`;
}

interface TransactionSheetProps {
  transaction: Transaction | null;
  allCategories: string[];
  dark: boolean;
  account?: { name: string; provider: string };
  onClose: () => void;
  onUpdated: (tx: Transaction, additionalIds?: string[]) => void;
}

export function TransactionSheet({
  transaction,
  allCategories,
  dark,
  account,
  onClose,
  onUpdated,
}: TransactionSheetProps) {
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(winH)).current;

  const [category, setCategory] = useState(transaction?.category ?? "Other");
  const [scope, setScope] = useState<Scope>("all");
  const [similar, setSimilar] = useState<Transaction[] | null>(null);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  // Reset state when transaction changes
  useEffect(() => {
    setCategory(transaction?.category ?? "Other");
    setScope("all");
    setSimilar(null);
    setSelected(new Set());
    setSaving(false);
    setSavedCount(null);
  }, [transaction?.id]);

  // Slide animation
  useEffect(() => {
    if (transaction) {
      Animated.timing(slideY, {
        toValue: 0,
        duration: 280,
        easing: Easing.bezier(0.32, 0.72, 0, 1),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideY, {
        toValue: winH,
        duration: 200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }
  }, [transaction, slideY, winH]);

  // Fetch similar transactions when scope changes
  useEffect(() => {
    if (!transaction) return;
    const hasMatchKey = Boolean(
      (transaction.merchant_name ?? "").trim() ||
        (transaction.description ?? "").trim().length >= 3
    );
    if (!hasMatchKey) return;

    setLoadingSimilar(true);
    setSimilar(null);
    spendApi
      .similarTransactions(transaction.id, scope)
      .then((txns) => {
        setSimilar(txns);
        setSelected(new Set(txns.map((t) => t.id)));
      })
      .catch(() => {
        setSimilar([]);
        setSelected(new Set());
      })
      .finally(() => setLoadingSimilar(false));
  }, [scope, transaction?.id]);

  const toggleAll = () => {
    if (!similar) return;
    if (selected.size === similar.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(similar.map((t) => t.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (!transaction || saving || savedCount !== null) return;
    setSaving(true);
    try {
      const additionalIds = similar ? Array.from(selected) : [];
      const res = await spendApi.patchTransaction(transaction.id, {
        category,
        additional_ids: additionalIds,
      });
      setSavedCount(res.bulk_count ?? 0);
      onUpdated(
        { ...transaction, category },
        additionalIds.length > 0 ? additionalIds : undefined
      );
      setTimeout(onClose, 900);
    } catch {
      setSavedCount(0);
      onUpdated({ ...transaction, category });
      setTimeout(onClose, 900);
    } finally {
      setSaving(false);
    }
  };

  // ── Design tokens ────────────────────────────────────────────────────────────
  const sheetBg = dark ? tw.color.slate900 : tw.color.white;
  const borderColor = dark ? tw.color.slate700 : tw.color.slate100;
  const handleColor = dark ? tw.color.slate600 : tw.color.slate200;
  const headText = dark ? tw.color.slate100 : tw.color.slate900;
  const bodyText = dark ? tw.color.slate400 : tw.color.slate500;
  const closeBg = dark ? tw.color.slate700 : tw.color.slate100;
  const divColor = dark ? tw.color.slate700 : tw.color.slate100;
  const sectionLabel = dark ? tw.color.slate400 : tw.color.slate500;
  const catOptBorder = dark ? tw.color.slate700 : tw.color.slate100;
  const catOptBg = dark ? "rgba(51,65,85,0.4)" : tw.color.slate50;
  const scopeActiveBorder = tw.color.indigo500;
  const scopeActiveBg = dark ? "rgba(79,70,229,0.2)" : tw.color.indigo50;
  const scopeActiveText = dark ? tw.color.indigo300 : "#4338ca";
  const scopeInactiveBorder = dark ? tw.color.slate700 : tw.color.slate100;
  const scopeInactiveBg = dark ? "rgba(51,65,85,0.4)" : tw.color.slate50;
  const scopeInactiveText = dark ? tw.color.slate300 : tw.color.slate600;
  const similarCheckOn = tw.color.indigo500;
  const similarCheckOff = dark ? tw.color.slate600 : tw.color.slate300;
  const similarRowOnBg = dark ? "rgba(79,70,229,0.2)" : tw.color.indigo50;
  const similarRowOffBg = dark ? tw.color.slate800 : tw.color.white;
  const similarItemText = dark ? tw.color.slate200 : tw.color.slate700;
  const similarSubText = dark ? tw.color.slate500 : tw.color.slate400;
  const similarAmtCredit = tw.color.emerald500;
  const similarAmtDebit = dark ? tw.color.slate200 : "#ef4444";

  const maxSheetH = winH * 0.88;
  const saved = savedCount !== null;

  if (!transaction) return null;

  const isCredit = transaction.transaction_type === "credit";
  const hasMatchKey = Boolean(
    (transaction.merchant_name ?? "").trim() ||
      (transaction.description ?? "").trim().length >= 3
  );
  const label = matchLabel(transaction);
  const colour = catColour(category);
  const icon = catIcon(category);
  const allChecked =
    similar !== null && similar.length > 0 && selected.size === similar.length;

  const SCOPES: { value: Scope; label: string; Icon: typeof Users }[] = [
    { value: "all", label: `All from ${label}`, Icon: Users },
    { value: "future", label: `Future from ${label}`, Icon: CalendarArrowUp },
  ];

  const saveLabel = () => {
    if (saved) return savedCount && savedCount > 0 ? `Saved · ${savedCount + 1} updated` : "Saved";
    if (saving) return "Saving…";
    if (selected.size === 0) return "Save (this transaction only)";
    return `Save for ${selected.size + 1} transaction${selected.size > 0 ? "s" : ""}`;
  };

  return (
    <Modal
      visible={!!transaction}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: sheetBg,
              borderTopColor: borderColor,
              maxHeight: maxSheetH,
              paddingBottom: insets.bottom + tw.space[4],
              transform: [{ translateY: slideY }],
            },
          ]}
        >
          <Pressable onPress={() => {}} style={{ flex: 1 }}>
            {/* Handle */}
            <View style={styles.handleRow}>
              <View style={[styles.handle, { backgroundColor: handleColor }]} />
            </View>

            {/* Header */}
            <View style={[styles.sheetHeader, { paddingBottom: tw.space[4] }]}>
              <Text style={[styles.headerName, { color: headText }]} numberOfLines={1}>
                {txDisplayName(transaction)}
              </Text>
              <Pressable
                onPress={onClose}
                style={[styles.closeBtn, { backgroundColor: closeBg }]}
                hitSlop={8}
              >
                <X size={16} color={tw.color.slate500} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
              {/* Amount + date block */}
              <View
                style={[
                  styles.amountRow,
                  { borderBottomColor: divColor },
                ]}
              >
                <View
                  style={[
                    styles.amountBlock,
                    {
                      backgroundColor: isCredit
                        ? "rgba(16,185,129,0.10)"
                        : "rgba(239,68,68,0.08)",
                    },
                  ]}
                >
                  <Text style={[styles.amountLabel, { color: bodyText }]}>Amount</Text>
                  <Text
                    style={[
                      styles.amountValue,
                      { color: isCredit ? tw.color.emerald500 : "#ef4444" },
                    ]}
                  >
                    {isCredit ? "+" : "-"}
                    {formatCurrency(transaction.amount, transaction.currency)}
                  </Text>
                </View>
                <View style={styles.dateBlock}>
                  <Text style={[styles.dateLabel, { color: bodyText }]}>Date</Text>
                  <Text style={[styles.dateValue, { color: dark ? tw.color.slate200 : tw.color.slate700 }]}>
                    {formatDate(transaction.date)}
                  </Text>
                  <Text style={[styles.txType, { color: bodyText }]}>
                    {transaction.transaction_type}
                  </Text>
                </View>
                {account && (
                  <View style={styles.accountBlock}>
                    <View style={[styles.accountBadge, { backgroundColor: dark ? tw.color.slate700 : tw.color.slate100 }]}>
                      <Text style={[styles.accountInitials, { color: dark ? tw.color.slate200 : tw.color.slate700 }]}>
                        {(account.provider ?? "?").slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                    <Text style={[styles.accountName, { color: bodyText }]} numberOfLines={1}>
                      {account.name}
                    </Text>
                  </View>
                )}
              </View>

              {/* Category picker */}
              <View style={styles.section}>
                <View style={styles.sectionLabelRow}>
                  <Tag size={14} color={tw.color.slate500} />
                  <Text
                    style={[
                      styles.sectionLabel,
                      {
                        color: sectionLabel,
                        textTransform: "uppercase",
                        letterSpacing: tw.tracking(tw.trackingEm.wide, 11),
                      },
                    ]}
                  >
                    Category
                  </Text>
                </View>

                {/* Current category pill */}
                <View style={styles.currentCatRow}>
                  <View
                    style={[
                      styles.currentCatPill,
                      { backgroundColor: colour },
                    ]}
                  >
                    <Text style={styles.currentCatIcon}>{icon}</Text>
                    <Text style={styles.currentCatLabel}>{category}</Text>
                  </View>
                </View>

                {/* Category options — horizontal scroll */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.catScroll}
                >
                  {allCategories.map((cat) => {
                    const active = cat === category;
                    const c = catColour(cat);
                    const ic = catIcon(cat);
                    return (
                      <Pressable
                        key={cat}
                        onPress={() => setCategory(cat)}
                        style={[
                          styles.catOption,
                          {
                            backgroundColor: active ? c + "20" : catOptBg,
                            borderColor: active ? c : catOptBorder,
                          },
                        ]}
                      >
                        <Text style={styles.catOptionIcon}>{ic}</Text>
                        <Text
                          style={[
                            styles.catOptionLabel,
                            { color: active ? c : (dark ? tw.color.slate300 : tw.color.slate600) },
                          ]}
                        >
                          {cat}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Scope selector — only shown when there's a match key */}
              {hasMatchKey && (
                <View style={[styles.section, { paddingBottom: tw.space[4] }]}>
                  <Text
                    style={[
                      styles.sectionLabel,
                      {
                        color: sectionLabel,
                        textTransform: "uppercase",
                        letterSpacing: tw.tracking(tw.trackingEm.wide, 11),
                        marginBottom: tw.space[2],
                      },
                    ]}
                  >
                    Apply to
                  </Text>
                  <View style={styles.scopeList}>
                    {SCOPES.map(({ value, label: scopeLabel, Icon }) => {
                      const active = scope === value;
                      return (
                        <Pressable
                          key={value}
                          onPress={() => setScope(value)}
                          style={[
                            styles.scopeOption,
                            {
                              borderColor: active ? scopeActiveBorder : scopeInactiveBorder,
                              backgroundColor: active ? scopeActiveBg : scopeInactiveBg,
                            },
                          ]}
                        >
                          <Icon
                            size={16}
                            color={active ? tw.color.indigo500 : tw.color.slate400}
                          />
                          <Text
                            style={[
                              styles.scopeLabel,
                              { color: active ? scopeActiveText : scopeInactiveText },
                            ]}
                            numberOfLines={1}
                          >
                            {scopeLabel}
                          </Text>
                          {active && (
                            <View style={styles.scopeCheck}>
                              <Check size={10} color="#fff" strokeWidth={3} />
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Similar transactions checklist */}
              <View style={[styles.section, { paddingBottom: tw.space[4] }]}>
                {loadingSimilar ? (
                  <View style={styles.similarLoading}>
                    <ActivityIndicator size="small" color={tw.color.indigo500} />
                  </View>
                ) : similar !== null && similar.length > 0 ? (
                  <>
                    <View style={styles.similarHeader}>
                      <Text style={[styles.sectionLabel, { color: sectionLabel, textTransform: "uppercase", letterSpacing: tw.tracking(tw.trackingEm.wide, 11) }]}>
                        {similar.length} similar transaction{similar.length !== 1 ? "s" : ""}
                      </Text>
                      <Pressable onPress={toggleAll} hitSlop={8} style={styles.selectAllBtn}>
                        {allChecked ? (
                          <CheckSquare size={14} color={tw.color.indigo600} />
                        ) : (
                          <Square size={14} color={tw.color.indigo600} />
                        )}
                        <Text style={[styles.selectAllText, { color: tw.color.indigo600 }]}>
                          {allChecked ? "Deselect all" : "Select all"}
                        </Text>
                      </Pressable>
                    </View>
                    <View
                      style={[
                        styles.similarList,
                        { borderColor: dark ? tw.color.slate700 : tw.color.slate100 },
                      ]}
                    >
                      {similar.map((tx) => {
                        const checked = selected.has(tx.id);
                        const txCredit = tx.transaction_type === "credit";
                        return (
                          <Pressable
                            key={tx.id}
                            onPress={() => toggleOne(tx.id)}
                            style={[
                              styles.similarRow,
                              { backgroundColor: checked ? similarRowOnBg : similarRowOffBg },
                            ]}
                          >
                            <View
                              style={[
                                styles.checkbox,
                                {
                                  backgroundColor: checked ? similarCheckOn : (dark ? tw.color.slate700 : "#fff"),
                                  borderColor: checked ? similarCheckOn : similarCheckOff,
                                },
                              ]}
                            >
                              {checked && <Check size={9} color="#fff" strokeWidth={3} />}
                            </View>
                            <View style={styles.similarInfo}>
                              <Text
                                style={[styles.similarName, { color: similarItemText }]}
                                numberOfLines={1}
                              >
                                {tx.merchant_name || tx.description}
                              </Text>
                              <Text style={[styles.similarDate, { color: similarSubText }]}>
                                {formatDate(tx.date)}
                              </Text>
                            </View>
                            <Text
                              style={[
                                styles.similarAmt,
                                { color: txCredit ? similarAmtCredit : similarAmtDebit },
                              ]}
                            >
                              {txCredit ? "+" : "-"}
                              {formatCurrency(tx.amount, tx.currency)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                ) : similar !== null && similar.length === 0 ? (
                  <Text style={[styles.noSimilar, { color: bodyText }]}>
                    No similar transactions found
                  </Text>
                ) : null}
              </View>

              {/* Save button */}
              <View style={[styles.section, { paddingBottom: tw.space[4] }]}>
                <Pressable
                  onPress={handleSave}
                  disabled={saving || saved}
                  style={({ pressed }) => [
                    styles.saveBtn,
                    {
                      opacity: (saving || saved) ? 1 : pressed ? 0.92 : 1,
                      transform: [{ scale: pressed && !saving && !saved ? 0.97 : 1 }],
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.saveBtnInner,
                      {
                        backgroundColor: saved ? tw.color.emerald500 : tw.color.indigo600,
                      },
                    ]}
                  >
                    {saved && <Check size={18} color="#fff" />}
                    <Text style={styles.saveBtnText}>{saveLabel()}</Text>
                  </View>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.40)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: tw.radius["3xl"],
    borderTopRightRadius: tw.radius["3xl"],
    borderTopWidth: 1,
    overflow: "hidden",
  },
  handleRow: {
    alignItems: "center",
    paddingTop: tw.space[3],
    paddingBottom: tw.space[1],
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tw.space[5],
    paddingTop: tw.space[2],
    gap: tw.space[4],
  },
  headerName: {
    fontSize: tw.text.lg.fontSize,
    lineHeight: tw.text.lg.lineHeight,
    fontWeight: tw.weight.bold,
    flex: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: tw.radius.full,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[4],
    paddingHorizontal: tw.space[5],
    paddingBottom: tw.space[5],
    borderBottomWidth: 1,
  },
  amountBlock: {
    borderRadius: tw.radius["2xl"],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    alignItems: "center",
  },
  amountLabel: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    marginBottom: 2,
  },
  amountValue: {
    fontSize: tw.text.xl.fontSize,
    lineHeight: tw.text.xl.lineHeight,
    fontWeight: tw.weight.bold,
  },
  dateBlock: {
    flex: 1,
  },
  dateLabel: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    marginBottom: 4,
  },
  dateValue: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
  },
  txType: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    marginTop: 4,
    textTransform: "capitalize",
  },
  accountBlock: {
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  accountBadge: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  accountInitials: {
    fontSize: 12,
    fontWeight: tw.weight.bold,
  },
  accountName: {
    fontSize: 10,
    lineHeight: 14,
    maxWidth: 64,
    textAlign: "center",
  },
  section: {
    paddingHorizontal: tw.space[5],
    paddingTop: tw.space[5],
  },
  sectionLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    marginBottom: tw.space[3],
  },
  sectionLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: tw.weight.semibold,
  },
  currentCatRow: {
    marginBottom: tw.space[3],
  },
  currentCatPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingLeft: 10,
    paddingRight: tw.space[3],
    paddingVertical: 4,
    borderRadius: tw.radius.full,
  },
  currentCatIcon: {
    fontSize: 14,
  },
  currentCatLabel: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.semibold,
    color: "#ffffff",
  },
  catScroll: {
    gap: tw.space[2],
    paddingRight: tw.space[4],
  },
  catOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: tw.space[3],
    paddingVertical: 6,
    borderRadius: tw.radius.xl,
    borderWidth: 1,
  },
  catOptionIcon: {
    fontSize: 14,
  },
  catOptionLabel: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
  },
  scopeList: {
    gap: tw.space[2],
  },
  scopeOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    borderRadius: tw.radius.xl,
    borderWidth: 2,
  },
  scopeLabel: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
    flex: 1,
  },
  scopeCheck: {
    width: 16,
    height: 16,
    borderRadius: tw.radius.full,
    backgroundColor: tw.color.indigo500,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },
  similarLoading: {
    paddingVertical: tw.space[4],
    alignItems: "center",
  },
  similarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: tw.space[2],
  },
  selectAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  selectAllText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.medium,
  },
  similarList: {
    borderRadius: tw.radius.xl,
    borderWidth: 1,
    overflow: "hidden",
    maxHeight: 208, // ~4 rows visible, matches web max-h-52
  },
  similarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    paddingHorizontal: tw.space[3],
    paddingVertical: 10,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  similarInfo: {
    flex: 1,
    minWidth: 0,
  },
  similarName: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.medium,
  },
  similarDate: {
    fontSize: 10,
    lineHeight: 14,
  },
  similarAmt: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
    flexShrink: 0,
  },
  noSimilar: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    textAlign: "center",
    paddingVertical: tw.space[3],
  },
  saveBtn: {
    borderRadius: tw.radius["2xl"],
    overflow: "hidden",
  },
  saveBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tw.space[2],
    paddingVertical: tw.space[4],
  },
  saveBtnText: {
    fontSize: tw.text.base.fontSize,
    lineHeight: tw.text.base.lineHeight,
    fontWeight: tw.weight.semibold,
    color: "#ffffff",
  },
});
