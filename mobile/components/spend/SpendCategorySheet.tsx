/**
 * SpendCategorySheet — bottom sheet (~80dvh) for category drill-down.
 *
 * Structure:
 *   - Handle bar
 *   - Header: tinted icon chip + name + count + total + close button
 *   - DoorBlock: checkpoint status / intent ask / aim setting
 *   - Tool launchers (collapsible):
 *       - Transport only: "Cheaper fuel nearby"
 *       - Groceries only (Pro): "Scan & compare receipts"
 *       - NO Debt quick-link, NO swipe-to-delete
 *   - Transaction list (ScrollView, tap → closes sheet + opens TransactionSheet)
 *
 * Animation: slide up 280ms, cubic-bezier(0.32, 0.72, 0, 1) via Animated API.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Animated,
  Easing,
  TextInput,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  X,
  ChevronDown,
  ChevronRight,
  Fuel,
  ReceiptText,
} from "lucide-react-native";
import { tw } from "@/lib/tw";
import { CATEGORY_COLOURS, CATEGORY_ICONS } from "@/lib/shared";
import { spendApi } from "@/lib/api/spend";
import type { CategorySignal, Transaction, Checkpoint } from "@/lib/api/spend";
import { formatDate, formatCurrency } from "./periodUtils";
import { TransactionRow } from "./TransactionsList";
import type { CategoryData } from "./CategoryGrid";

function catColour(name: string): string {
  return CATEGORY_COLOURS[name] ?? "#94a3b8";
}

function catIcon(name: string): string {
  return CATEGORY_ICONS[name] ?? "📦";
}

function fmtWhole(n: number, sym = "£"): string {
  return `${sym}${Math.round(Math.abs(n)).toLocaleString("en-GB")}`;
}

function daysLabel(days: number): string {
  if (days <= 0) return "last day";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

// ── DoorBlock ─────────────────────────────────────────────────────────────────

interface DoorProps {
  category: string;
  signal: CategorySignal;
  isCurrentPeriod: boolean;
  dark: boolean;
  onChanged: () => void;
}

function DoorBlock({ category, signal, isCurrentPeriod, dark, onChanged }: DoorProps) {
  const { multiple, suggested_aim, door_engaged } = signal;

  const [localCheckpoint, setLocalCheckpoint] = useState<Checkpoint | null>(
    signal.checkpoint
  );
  const [localIntent, setLocalIntent] = useState<"one_off" | "new_normal" | null>(
    signal.intent
  );
  const [localDoorEngaged, setLocalDoorEngaged] = useState(door_engaged);
  const [doorOpen, setDoorOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Keep local state in sync if parent pushes new signal after refetch
  useEffect(() => {
    setLocalCheckpoint(signal.checkpoint);
    setLocalIntent(signal.intent);
    setLocalDoorEngaged(signal.door_engaged);
  }, [signal.checkpoint, signal.intent, signal.door_engaged]);

  const divColor = dark ? tw.color.slate700 : tw.color.slate100;
  const bodyText = dark ? tw.color.slate400 : tw.color.slate500;
  const headText = dark ? tw.color.slate100 : tw.color.slate900;
  const chipBorder = dark ? tw.color.slate600 : tw.color.slate200;
  const chipText = dark ? tw.color.slate300 : tw.color.slate600;
  const inputBg = dark ? tw.color.slate700 : tw.color.slate50;

  // State A — live checkpoint
  if (localCheckpoint) {
    const { id, aim_amount, spent_so_far, days_left } = localCheckpoint;
    return (
      <View style={[styles.doorBlock, { borderBottomColor: divColor }]}>
        <Text style={[styles.doorBody, { color: bodyText }]}>
          {fmtWhole(spent_so_far)} of your {fmtWhole(aim_amount)} aim ·{" "}
          {daysLabel(days_left)}
        </Text>
        <Pressable
          onPress={async () => {
            try {
              await spendApi.cancelCheckpoint(id);
              setLocalCheckpoint(null);
              onChanged();
            } catch {
              // silent — user can try again
            }
          }}
          hitSlop={8}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, marginTop: 6 }]}
        >
          <Text style={[styles.doorLink, { color: bodyText }]}>Cancel this aim</Text>
        </Pressable>
      </View>
    );
  }

  // State C — intent ask
  const showAsk =
    !localDoorEngaged &&
    localIntent == null &&
    multiple != null &&
    multiple >= 1.5 &&
    suggested_aim != null &&
    !doorOpen;

  if (showAsk) {
    return (
      <View style={[styles.doorBlock, { borderBottomColor: divColor }]}>
        <Text style={[styles.doorHead, { color: headText }]}>
          {category} ran {multiple.toFixed(1)}× your usual.
        </Text>
        <View style={styles.pillRow}>
          <Pressable
            onPress={async () => {
              try {
                await spendApi.recordTrendIntent(category, "one_off");
                setLocalIntent("one_off");
                setLocalDoorEngaged(true);
                onChanged();
              } catch {
                // silent
              }
            }}
            style={[styles.pill, { borderColor: chipBorder }]}
          >
            <Text style={[styles.pillText, { color: chipText }]}>
              That was a one-off
            </Text>
          </Pressable>
          <Pressable
            onPress={async () => {
              try {
                await spendApi.recordTrendIntent(category, "new_normal");
                setLocalIntent("new_normal");
                setLocalDoorEngaged(true);
                onChanged();
              } catch {
                // silent
              }
            }}
            style={[styles.pill, { borderColor: chipBorder }]}
          >
            <Text style={[styles.pillText, { color: chipText }]}>
              That&apos;s my new normal
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setDoorOpen(true)}
            style={[styles.pill, { borderColor: chipBorder }]}
          >
            <Text style={[styles.pillText, { color: chipText }]}>
              I&apos;d like to change this
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // State B — aim setting (Door open)
  if (doorOpen && suggested_aim != null) {
    const parsedCustom = parseFloat(customValue.replace(/[^0-9.]/g, ""));
    const customValid = !isNaN(parsedCustom) && parsedCustom > 0;

    async function handleSetAim(amount?: number) {
      setSaving(true);
      setSaveError(false);
      try {
        const cp = await spendApi.createCheckpoint(category, amount);
        setLocalCheckpoint(cp);
        setLocalDoorEngaged(true);
        setDoorOpen(false);
        setCustomMode(false);
        setCustomValue("");
        onChanged();
      } catch {
        setSaveError(true);
      } finally {
        setSaving(false);
      }
    }

    return (
      <View style={[styles.doorBlock, { borderBottomColor: divColor }]}>
        <Text style={[styles.doorHead, { color: headText }]}>
          Your usual {category} is about {fmtWhole(suggested_aim)} a period.
        </Text>
        <Text style={[styles.doorBody, { color: bodyText, marginTop: 2, marginBottom: 12 }]}>
          {isCurrentPeriod
            ? "Aim for that this period?"
            : "Aim for that in the current period?"}
        </Text>
        {!customMode ? (
          <View style={styles.pillRow}>
            <Pressable
              disabled={saving}
              onPress={() => handleSetAim(undefined)}
              style={[
                styles.pill,
                styles.pillPrimary,
                saving && { opacity: 0.6 },
              ]}
            >
              <Text style={styles.pillPrimaryText}>Set this aim</Text>
            </Pressable>
            <Pressable
              disabled={saving}
              onPress={() => setCustomMode(true)}
              style={[styles.pill, { borderColor: chipBorder }, saving && { opacity: 0.6 }]}
            >
              <Text style={[styles.pillText, { color: chipText }]}>
                Choose a different amount
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.pillRow}>
            <View
              style={[
                styles.inputWrap,
                { backgroundColor: inputBg, borderColor: chipBorder },
              ]}
            >
              <Text style={[styles.inputSym, { color: bodyText }]}>£</Text>
              <TextInput
                autoFocus
                keyboardType="decimal-pad"
                placeholder={String(Math.round(suggested_aim))}
                placeholderTextColor={bodyText}
                value={customValue}
                onChangeText={(v) => {
                  setCustomValue(v);
                  setSaveError(false);
                }}
                style={[styles.input, { color: headText }]}
              />
            </View>
            <Pressable
              disabled={saving || !customValid}
              onPress={() => handleSetAim(parsedCustom)}
              style={[
                styles.pill,
                styles.pillPrimary,
                (saving || !customValid) && { opacity: 0.6 },
              ]}
            >
              <Text style={styles.pillPrimaryText}>Set this aim</Text>
            </Pressable>
          </View>
        )}
        {saveError && (
          <Text style={[styles.doorBody, { color: bodyText, marginTop: 8 }]}>
            That didn&apos;t save. Try again.
          </Text>
        )}
      </View>
    );
  }

  // State D — nothing
  return null;
}

// ── SpendCategorySheet ────────────────────────────────────────────────────────

interface SpendCategorySheetProps {
  category: CategoryData | null;
  signal: CategorySignal | undefined;
  isCurrentPeriod: boolean;
  isPro: boolean;
  dark: boolean;
  onClose: () => void;
  onTransactionPress: (tx: Transaction) => void;
  onSignalChanged: () => void;
}

export function SpendCategorySheet({
  category,
  signal,
  isCurrentPeriod,
  isPro,
  dark,
  onClose,
  onTransactionPress,
  onSignalChanged,
}: SpendCategorySheetProps) {
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(winH)).current;
  const [toolOpen, setToolOpen] = useState(false);

  // Reset tool-open state when category changes
  useEffect(() => {
    setToolOpen(false);
  }, [category?.name]);

  useEffect(() => {
    if (category) {
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
  }, [category, slideY, winH]);

  const sheetBg = dark ? tw.color.slate900 : tw.color.white;
  const borderColor = dark ? tw.color.slate700 : tw.color.slate100;
  const divColor = dark ? tw.color.slate700 : tw.color.slate100;
  const handleColor = dark ? tw.color.slate600 : tw.color.slate200;
  const nameTone = dark ? tw.color.slate100 : tw.color.slate900;
  const subTone = dark ? tw.color.slate400 : tw.color.slate500;
  const closeBg = dark ? tw.color.slate700 : tw.color.slate100;
  const toolBadgeBg = dark ? "rgba(51,65,85,0.6)" : tw.color.slate100;
  const toolBadgeText = dark ? tw.color.slate300 : tw.color.slate500;
  const toolBadgeChevron = dark ? tw.color.slate500 : tw.color.slate400;
  const toolChevronDown = dark ? tw.color.slate400 : tw.color.slate500;

  const maxSheetH = winH * 0.8;

  if (!category) return null;

  const colour = catColour(category.name);
  const icon = catIcon(category.name);
  const chipBg = colour + "26";
  const lowerName = category.name.toLowerCase();
  const showFuelTool = lowerName === "transport";
  const showGroceryTool = lowerName === "groceries" && isPro;

  return (
    <Modal
      visible={!!category}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Backdrop */}
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
          {/* Prevent backdrop press from propagating through sheet */}
          <Pressable onPress={() => {}} style={{ flex: 1 }}>
            {/* Handle */}
            <View style={styles.handleRow}>
              <View style={[styles.handle, { backgroundColor: handleColor }]} />
            </View>

            {/* Header */}
            <View style={styles.sheetHeader}>
              <View style={[styles.headerChip, { backgroundColor: chipBg, borderRadius: tw.radius.xl }]}>
                <Text style={styles.headerChipIcon}>{icon}</Text>
              </View>
              <View style={styles.headerInfo}>
                <Text style={[styles.headerName, { color: nameTone }]}>
                  {category.name}
                </Text>
                <Text style={[styles.headerCount, { color: subTone }]}>
                  {category.count} transaction{category.count !== 1 ? "s" : ""}
                </Text>
              </View>
              <Text style={[styles.headerTotal, { color: nameTone }]}>
                £{Math.abs(category.total).toLocaleString("en-GB", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </Text>
              <Pressable
                onPress={onClose}
                style={[styles.closeBtn, { backgroundColor: closeBg }]}
                hitSlop={8}
              >
                <X size={15} color={tw.color.slate500} />
              </Pressable>
            </View>

            {/* Scrollable body */}
            <ScrollView
              style={[styles.body, { borderTopColor: divColor }]}
              showsVerticalScrollIndicator={false}
            >
              {/* Door block */}
              {signal && (
                <DoorBlock
                  category={category.name}
                  signal={signal}
                  isCurrentPeriod={isCurrentPeriod}
                  dark={dark}
                  onChanged={onSignalChanged}
                />
              )}

              {/* Transport fuel tool launcher */}
              {showFuelTool && (
                <View style={[styles.toolSection, { borderBottomColor: divColor }]}>
                  <Pressable
                    onPress={() => setToolOpen((o) => !o)}
                    style={styles.toolHeader}
                  >
                    <View
                      style={[
                        styles.toolBadge,
                        { backgroundColor: toolBadgeBg },
                      ]}
                    >
                      <Fuel size={10} color={colour} />
                      <Text style={[styles.toolBadgeText, { color: toolBadgeText }]}>
                        Cheaper fuel nearby
                      </Text>
                      <ChevronRight size={10} color={toolBadgeChevron} />
                    </View>
                    <View
                      style={[
                        styles.toolChevron,
                        { transform: [{ rotate: toolOpen ? "180deg" : "0deg" }] },
                      ]}
                    >
                      <ChevronDown size={14} color={toolChevronDown} />
                    </View>
                  </Pressable>
                  {toolOpen && (
                    <View style={styles.toolContent}>
                      <Text style={[styles.toolPlaceholder, { color: subTone }]}>
                        Fuel savings finder coming soon
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Groceries scanner tool launcher */}
              {showGroceryTool && (
                <View style={[styles.toolSection, { borderBottomColor: divColor }]}>
                  <Pressable
                    onPress={() => setToolOpen((o) => !o)}
                    style={styles.toolHeader}
                  >
                    <View
                      style={[
                        styles.toolBadge,
                        { backgroundColor: toolBadgeBg },
                      ]}
                    >
                      <ReceiptText size={10} color={colour} />
                      <Text style={[styles.toolBadgeText, { color: toolBadgeText }]}>
                        Scan &amp; compare receipts
                      </Text>
                      <ChevronRight size={10} color={toolBadgeChevron} />
                    </View>
                    <View
                      style={[
                        styles.toolChevron,
                        { transform: [{ rotate: toolOpen ? "180deg" : "0deg" }] },
                      ]}
                    >
                      <ChevronDown size={14} color={toolChevronDown} />
                    </View>
                  </Pressable>
                  {toolOpen && (
                    <View style={styles.toolContent}>
                      <Text style={[styles.toolPlaceholder, { color: subTone }]}>
                        Grocery basket scanner coming soon
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Transaction list */}
              {category.transactions.map((tx, index) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  dark={dark}
                  onPress={() => {
                    onClose();
                    // Small delay so close animation starts before sheet opens
                    setTimeout(() => onTransactionPress(tx), 50);
                  }}
                  showDivider={index < category.transactions.length - 1}
                />
              ))}
              {category.transactions.length === 0 && (
                <View style={styles.emptyBody}>
                  <Text style={[styles.toolPlaceholder, { color: subTone }]}>
                    No transactions in this category
                  </Text>
                </View>
              )}
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
    gap: tw.space[3],
    paddingHorizontal: tw.space[5],
    paddingTop: tw.space[2],
    paddingBottom: tw.space[4],
  },
  headerChip: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  headerChipIcon: {
    fontSize: 16,
  },
  headerInfo: {
    flex: 1,
    minWidth: 0,
  },
  headerName: {
    fontSize: tw.text.base.fontSize,
    lineHeight: tw.text.base.lineHeight,
    fontWeight: tw.weight.bold,
  },
  headerCount: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
  },
  headerTotal: {
    fontSize: tw.text.xl.fontSize,
    lineHeight: tw.text.xl.lineHeight,
    fontWeight: tw.weight.bold,
    flexShrink: 0,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: tw.radius.full,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginLeft: tw.space[1],
  },
  body: {
    borderTopWidth: 1,
    flex: 1,
  },
  // DoorBlock styles
  doorBlock: {
    borderBottomWidth: 1,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
  },
  doorHead: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.semibold,
    marginBottom: tw.space[2],
  },
  doorBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  doorLink: {
    fontSize: 12,
    lineHeight: 16,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tw.space[2],
  },
  pill: {
    paddingHorizontal: tw.space[3],
    paddingVertical: 6,
    borderRadius: tw.radius.full,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 13,
    lineHeight: 18,
  },
  pillPrimary: {
    backgroundColor: tw.color.indigo600,
    borderColor: tw.color.indigo600,
  },
  pillPrimaryText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: tw.weight.semibold,
    color: "#ffffff",
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[2],
  },
  inputSym: {
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    fontSize: 13,
    lineHeight: 18,
    width: 80,
  },
  // Tool launcher styles
  toolSection: {
    borderBottomWidth: 1,
  },
  toolHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: tw.space[4],
    paddingVertical: 10,
  },
  toolBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: tw.radius.full,
    flex: 1,
  },
  toolBadgeText: {
    fontSize: 11,
    lineHeight: 16,
    flex: 1,
  },
  toolChevron: {
    flexShrink: 0,
  },
  toolContent: {
    paddingHorizontal: tw.space[4],
    paddingBottom: tw.space[3],
  },
  toolPlaceholder: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    textAlign: "center",
    paddingVertical: tw.space[3],
  },
  emptyBody: {
    paddingVertical: tw.space[6],
    alignItems: "center",
  },
});
