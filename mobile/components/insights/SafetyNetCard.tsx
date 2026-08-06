import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { CheckCircle2, ChevronRight, Edit2, Plus, Trash2 } from "lucide-react-native";
import { useTheme } from "@/lib/ThemeContext";
import { tw } from "@/lib/tw";
import { fmtGBP } from "@/lib/format";
import { insightsApi } from "@/lib/api/insights";
import type { SavingsInsights } from "@/lib/api/insights";

interface Props {
  data: SavingsInsights;
  onUpdate: (updated: SavingsInsights) => void;
}

const RING_SIZE = 52;
const RING_R = 20;
const RING_STROKE = 5;
const CIRCUMFERENCE = 2 * Math.PI * RING_R;

function ProgressRing({ pct, dark }: { pct: number; dark: boolean }) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const strokeDashoffset = CIRCUMFERENCE - (CIRCUMFERENCE * clamped) / 100;
  return (
    <Svg width={RING_SIZE} height={RING_SIZE}>
      <Circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_R}
        stroke={dark ? tw.color.slate700 : tw.color.emerald100}
        strokeWidth={RING_STROKE}
        fill="none"
      />
      <Circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_R}
        stroke={tw.color.emerald500}
        strokeWidth={RING_STROKE}
        fill="none"
        strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        rotation="-90"
        origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
      />
    </Svg>
  );
}

const TARGET_OPTIONS = [
  { label: "3 months", months: 3 },
  { label: "6 months", months: 6 },
  { label: "Custom", months: 0 },
];

export function SafetyNetCard({ data, onUpdate }: Props) {
  const { dark } = useTheme();

  const [editing, setEditing] = useState(!data.configured);
  const [selectedMonths, setSelectedMonths] = useState<number>(
    data.target_months ?? 3
  );
  const [customMonths, setCustomMonths] = useState<string>("");
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(
    new Set(data.accounts.filter((a) => a.selected).map((a) => a.account_id))
  );
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualBalance, setManualBalance] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingManual, setAddingManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cardBg = dark ? tw.color.cardDark : tw.color.white;
  const cardBorder = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const textPrimary = dark ? tw.color.slate100 : tw.color.slate800;
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate600;
  const inputBg = dark ? tw.color.slate700 : tw.color.slate50;
  const inputBorder = dark ? tw.color.slate600 : tw.color.slate200;

  const toggleAccount = useCallback((id: string) => {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const effectiveMonths =
    selectedMonths === 0 ? parseInt(customMonths, 10) || 0 : selectedMonths;

  const handleSetup = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await insightsApi.saveSavingsGoal({
        target_type: "months",
        target_months: effectiveMonths,
        account_ids: Array.from(selectedAccountIds),
      });
      onUpdate(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [effectiveMonths, selectedAccountIds, onUpdate]);

  const handleAddManual = useCallback(async () => {
    const bal = parseFloat(manualBalance);
    if (!manualName.trim() || isNaN(bal)) return;
    setAddingManual(true);
    setError(null);
    try {
      const updated = await insightsApi.addSavingsManualAccount({
        name: manualName.trim(),
        balance: bal,
      });
      onUpdate(updated);
      setManualName("");
      setManualBalance("");
      setShowManualForm(false);
      // Auto-select the new account
      const newAcc = updated.accounts.find((a) => a.manual && a.name === manualName.trim());
      if (newAcc) {
        setSelectedAccountIds((prev) => new Set([...prev, newAcc.account_id]));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add account");
    } finally {
      setAddingManual(false);
    }
  }, [manualName, manualBalance, onUpdate]);

  const handleDeleteManual = useCallback(
    async (id: string) => {
      try {
        const updated = await insightsApi.deleteSavingsManualAccount(id);
        onUpdate(updated);
        setSelectedAccountIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } catch {}
    },
    [onUpdate]
  );

  if (editing) {
    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: dark ? tw.color.cardDark : tw.color.emerald50,
            borderColor: dark ? tw.color.cardBorderDark : tw.color.emerald200,
          },
        ]}
      >
        <Text style={[styles.setupTitle, { color: textPrimary }]}>
          Build your safety net
        </Text>
        <Text style={[styles.setupBody, { color: textSecondary }]}>
          An emergency fund of 3–6 months' spending protects you from surprises.
        </Text>

        {/* Target buttons */}
        <Text style={[styles.sectionLabel, { color: textSecondary }]}>
          Target
        </Text>
        <View style={styles.targetRow}>
          {TARGET_OPTIONS.map((opt) => {
            const active = selectedMonths === opt.months;
            return (
              <Pressable
                key={opt.label}
                onPress={() => setSelectedMonths(opt.months)}
                style={[
                  styles.targetBtn,
                  {
                    backgroundColor: active ? tw.color.emerald600 : inputBg,
                    borderColor: active ? tw.color.emerald600 : inputBorder,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.targetBtnText,
                    { color: active ? tw.color.white : textSecondary },
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {selectedMonths === 0 && (
          <View
            style={[
              styles.currencyRow,
              { backgroundColor: inputBg, borderColor: inputBorder },
            ]}
          >
            <TextInput
              value={customMonths}
              onChangeText={setCustomMonths}
              placeholder="e.g. 4"
              keyboardType="number-pad"
              placeholderTextColor={textSecondary}
              style={[styles.currencyInput, { color: textPrimary }]}
            />
            <Text style={[styles.currencyPrefix, { color: textSecondary }]}>
              months
            </Text>
          </View>
        )}

        {/* Accounts */}
        <Text style={[styles.sectionLabel, { color: textSecondary }]}>
          Savings accounts
        </Text>
        {data.accounts.map((acc) => {
          const checked = selectedAccountIds.has(acc.account_id);
          return (
            <View key={acc.account_id} style={styles.accountRow}>
              <Pressable
                onPress={() => toggleAccount(acc.account_id)}
                style={styles.accountCheckRow}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      backgroundColor: checked ? tw.color.emerald500 : "transparent",
                      borderColor: checked ? tw.color.emerald500 : inputBorder,
                    },
                  ]}
                >
                  {checked && (
                    <CheckCircle2 size={14} color={tw.color.white} />
                  )}
                </View>
                <View style={styles.accountInfo}>
                  <Text style={[styles.accountName, { color: textPrimary }]}>
                    {acc.name}
                  </Text>
                  <Text style={[styles.accountBalance, { color: textSecondary }]}>
                    {fmtGBP(acc.balance)}
                  </Text>
                </View>
              </Pressable>
              {acc.manual && (
                <Pressable
                  onPress={() => handleDeleteManual(acc.account_id)}
                  hitSlop={8}
                >
                  <Trash2 size={14} color={tw.color.rose500} />
                </Pressable>
              )}
            </View>
          );
        })}

        {/* Add manual */}
        {showManualForm ? (
          <View style={styles.manualForm}>
            <TextInput
              value={manualName}
              onChangeText={setManualName}
              placeholder="Account name"
              placeholderTextColor={textSecondary}
              style={[
                styles.textInput,
                { backgroundColor: inputBg, borderColor: inputBorder, color: textPrimary },
              ]}
            />
            <View
              style={[
                styles.currencyRow,
                { backgroundColor: inputBg, borderColor: inputBorder },
              ]}
            >
              <Text style={[styles.currencyPrefix, { color: textSecondary }]}>
                £
              </Text>
              <TextInput
                value={manualBalance}
                onChangeText={setManualBalance}
                placeholder="0"
                keyboardType="numeric"
                placeholderTextColor={textSecondary}
                style={[styles.currencyInput, { color: textPrimary }]}
              />
            </View>
            <View style={styles.manualBtnRow}>
              <Pressable
                onPress={() => {
                  setShowManualForm(false);
                  setManualName("");
                  setManualBalance("");
                }}
                style={[styles.smallBtn, { borderColor: inputBorder, borderWidth: 1 }]}
              >
                <Text style={[styles.smallBtnText, { color: textSecondary }]}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={handleAddManual}
                disabled={addingManual}
                style={[styles.smallBtn, { backgroundColor: tw.color.emerald500 }]}
              >
                {addingManual ? (
                  <ActivityIndicator size="small" color={tw.color.white} />
                ) : (
                  <Text style={[styles.smallBtnText, { color: tw.color.white }]}>
                    Add
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setShowManualForm(true)}
            style={styles.addManualBtn}
          >
            <Plus size={14} color={tw.color.emerald600} />
            <Text style={styles.addManualText}>Add manual account</Text>
          </Pressable>
        )}

        {error && (
          <Text style={styles.errorText}>{error}</Text>
        )}

        <Pressable
          onPress={handleSetup}
          disabled={saving}
          style={[styles.setupBtn, { opacity: saving ? 0.6 : 1 }]}
        >
          {saving ? (
            <ActivityIndicator size="small" color={tw.color.white} />
          ) : (
            <Text style={styles.setupBtnText}>Start tracking</Text>
          )}
        </Pressable>
      </View>
    );
  }

  // Tracking mode
  const pct = Math.round(data.pct_funded);
  const surplus = data.monthly_surplus;
  const monthsLeft = data.months_to_target;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: cardBg, borderColor: cardBorder },
      ]}
    >
      <View style={styles.trackingHeader}>
        <View style={styles.ringWrapper}>
          <ProgressRing pct={pct} dark={dark} />
          <View style={styles.ringLabel}>
            <Text style={[styles.ringPct, { color: textPrimary }]}>
              {pct}%
            </Text>
          </View>
        </View>
        <View style={styles.trackingInfo}>
          <Text style={[styles.trackingTitle, { color: textPrimary }]}>
            Safety net
          </Text>
          <Text style={[styles.trackingAmount, { color: textSecondary }]}>
            {fmtGBP(data.current_savings)} saved of {fmtGBP(data.target_amount)}
          </Text>
          <Text style={[styles.trackingTimeline, { color: textSecondary }]}>
            {surplus > 0 ? `${fmtGBP(surplus)}/month surplus · ` : ""}
            {monthsLeft > 0 ? `${monthsLeft} months to go` : "Goal reached"}
          </Text>
        </View>
        <Pressable onPress={() => setEditing(true)} hitSlop={8}>
          <Edit2 size={16} color={tw.color.slate400} />
        </Pressable>
      </View>

      {data.funded_date && (
        <View style={styles.fundedRow}>
          <ChevronRight size={14} color={tw.color.emerald500} />
          <Text style={[styles.fundedText, { color: tw.color.emerald600 }]}>
            Fully funded by{" "}
            {new Date(data.funded_date).toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            })}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
    marginHorizontal: tw.space[4],
    marginBottom: tw.space[3],
    padding: tw.space[4],
    gap: tw.space[3],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  setupTitle: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
  },
  setupBody: {
    ...tw.text.sm,
    lineHeight: 20,
  },
  sectionLabel: {
    ...tw.text.xs,
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.widest, 12),
    marginBottom: -tw.space[1],
  },
  targetRow: {
    flexDirection: "row",
    gap: tw.space[2],
  },
  targetBtn: {
    flex: 1,
    paddingVertical: tw.space[2],
    borderRadius: tw.radius.xl,
    borderWidth: 1,
    alignItems: "center",
  },
  targetBtnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  accountCheckRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    flex: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: tw.radius.full,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
  accountBalance: {
    ...tw.text.xs,
  },
  addManualBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1],
    paddingVertical: tw.space[2],
  },
  addManualText: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
    color: tw.color.emerald600,
  },
  manualForm: {
    gap: tw.space[2],
  },
  manualBtnRow: {
    flexDirection: "row",
    gap: tw.space[2],
  },
  smallBtn: {
    flex: 1,
    paddingVertical: tw.space[2],
    borderRadius: tw.radius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    ...tw.text.sm,
  },
  currencyRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
  },
  currencyPrefix: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
    marginRight: 4,
  },
  currencyInput: {
    flex: 1,
    ...tw.text.sm,
    padding: 0,
  },
  errorText: {
    ...tw.text.sm,
    color: tw.color.rose500,
  },
  setupBtn: {
    backgroundColor: tw.color.emerald600,
    borderRadius: tw.radius.xl,
    paddingVertical: tw.space[3],
    alignItems: "center",
    marginTop: tw.space[1],
  },
  setupBtnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.bold,
    color: tw.color.white,
  },
  // Tracking mode
  trackingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
  },
  ringWrapper: {
    width: RING_SIZE,
    height: RING_SIZE,
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  ringLabel: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  ringPct: {
    fontSize: 12,
    fontWeight: tw.weight.bold,
    lineHeight: 14,
  },
  trackingInfo: {
    flex: 1,
    gap: 2,
  },
  trackingTitle: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
  },
  trackingAmount: {
    ...tw.text.sm,
  },
  trackingTimeline: {
    ...tw.text.xs,
  },
  fundedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1],
  },
  fundedText: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
});
