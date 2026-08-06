import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { X, CircleDashed } from "lucide-react-native";
import { BottomSheet } from "@/components/ui";
import { tw } from "@/lib/tw";
import { useTheme } from "@/lib/ThemeContext";
import { api, Account } from "@/lib/api";

interface PlanOneOffSheetProps {
  visible: boolean;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}

interface PlannedImpact {
  safe_to_spend_before: number | null;
  safe_to_spend_after: number | null;
  state_after: "comfortable" | "tight" | "short" | null;
}

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <View
      style={[
        radioDotStyles.outer,
        {
          borderColor: selected ? tw.color.indigo600 : tw.color.slate300,
        },
      ]}
    >
      {selected && <View style={radioDotStyles.inner} />}
    </View>
  );
}

const radioDotStyles = StyleSheet.create({
  outer: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  inner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: tw.color.indigo600,
  },
});

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PlanOneOffSheet({
  visible,
  accounts,
  onClose,
  onSaved,
}: PlanOneOffSheetProps) {
  const { dark } = useTheme();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<PlannedImpact | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (visible) {
      setName("");
      setAmount("");
      setDate(todayISO());
      setSelectedAccountId(null);
      setSaving(false);
      setError(null);
      setImpact(null);
      setSaved(false);
    }
  }, [visible]);

  const spendableAccounts = accounts.filter(
    (a) =>
      !a.manual &&
      a.type !== "savings" &&
      a.subtype !== "savings" &&
      a.type !== "credit" &&
      a.subtype !== "credit_card" &&
      a.balance >= 0
  );

  async function handleSave() {
    if (!name.trim()) {
      setError("Please enter a name.");
      return;
    }
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) {
      setError("Please enter a valid amount.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const params: { name: string; amount: number; date: string; account_id?: string } = {
        name: name.trim(),
        amount: amt,
        date: date || todayISO(),
      };
      if (selectedAccountId) params.account_id = selectedAccountId;
      const res = await api.addPlanned(params);
      setImpact(res.impact);
      setSaved(true);
      onSaved();
    } catch {
      setError("Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function confirmMessage(): string {
    if (!impact) return "Planned. It's now in your upcoming bills.";
    const sts = impact.safe_to_spend_after;
    if (sts !== null && sts > 0) {
      return `Planned. You're still okay — £${sts.toLocaleString("en-GB", { maximumFractionDigits: 0 })} in hand after this.`;
    }
    if (sts !== null && sts <= 0) {
      return `Planned. This tips your window £${Math.abs(sts).toLocaleString("en-GB", { maximumFractionDigits: 0 })} short — a cover plan will appear on Home.`;
    }
    return "Planned. It's now in your upcoming bills.";
  }

  const inputBg = dark ? tw.color.slate700 : tw.color.slate100;
  const inputColor = dark ? tw.color.slate100 : tw.color.slate800;
  const labelColor = dark ? tw.color.slate300 : tw.color.slate600;
  const sym = "£";

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text
              style={[
                styles.title,
                { color: dark ? tw.color.slate100 : tw.color.slate900 },
              ]}
            >
              Plan a one-off
            </Text>
            <Text
              style={[
                styles.subtitle,
                { color: dark ? tw.color.slate400 : tw.color.slate500 },
              ]}
            >
              A payment you know is coming.
            </Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <X
              size={20}
              color={dark ? tw.color.slate400 : tw.color.slate500}
            />
          </Pressable>
        </View>

        {saved ? (
          /* Confirmation card */
          <View
            style={[
              styles.confirmCard,
              { backgroundColor: dark ? "#312e81" : tw.color.indigo50 },
            ]}
          >
            <Text
              style={[
                styles.confirmMsg,
                { color: dark ? "#c7d2fe" : "#4338ca" },
              ]}
            >
              {confirmMessage()}
            </Text>
            <Pressable onPress={onClose} style={styles.doneBtn}>
              <Text style={styles.doneBtnText}>Done</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Name */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: labelColor }]}>
                What is it?
              </Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: inputBg, color: inputColor },
                ]}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Car service"
                placeholderTextColor={tw.color.slate400}
              />
            </View>

            {/* Amount */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: labelColor }]}>
                How much?
              </Text>
              <View style={styles.prefixRow}>
                <Text
                  style={[
                    styles.prefix,
                    { color: dark ? tw.color.slate400 : tw.color.slate500 },
                  ]}
                >
                  {sym}
                </Text>
                <TextInput
                  style={[
                    styles.inputFlex,
                    { backgroundColor: inputBg, color: inputColor },
                  ]}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={tw.color.slate400}
                />
              </View>
            </View>

            {/* Date */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: labelColor }]}>
                When?
              </Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: inputBg, color: inputColor },
                ]}
                value={date}
                onChangeText={setDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={tw.color.slate400}
              />
            </View>

            {/* Account */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: labelColor }]}>
                Which account?
              </Text>

              {/* Not sure yet */}
              <Pressable
                onPress={() => setSelectedAccountId(null)}
                style={[
                  styles.accountRow,
                  {
                    backgroundColor:
                      selectedAccountId === null
                        ? dark
                          ? "#312e81"
                          : tw.color.indigo50
                        : inputBg,
                  },
                ]}
              >
                <CircleDashed
                  size={18}
                  color={dark ? tw.color.slate400 : tw.color.slate500}
                />
                <Text
                  style={[
                    styles.accountName,
                    { color: dark ? tw.color.slate200 : tw.color.slate700 },
                  ]}
                >
                  Not sure yet
                </Text>
                <RadioDot selected={selectedAccountId === null} />
              </Pressable>

              {spendableAccounts.map((acc) => (
                <Pressable
                  key={acc.id}
                  onPress={() => setSelectedAccountId(acc.id)}
                  style={[
                    styles.accountRow,
                    {
                      backgroundColor:
                        selectedAccountId === acc.id
                          ? dark
                            ? "#312e81"
                            : tw.color.indigo50
                          : inputBg,
                    },
                  ]}
                >
                  <View style={styles.accountInitial}>
                    <Text style={styles.accountInitialText}>
                      {acc.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.accountTextGroup}>
                    <Text
                      style={[
                        styles.accountName,
                        { color: dark ? tw.color.slate200 : tw.color.slate700 },
                      ]}
                      numberOfLines={1}
                    >
                      {acc.name}
                    </Text>
                    <Text
                      style={[
                        styles.accountProvider,
                        { color: dark ? tw.color.slate400 : tw.color.slate500 },
                      ]}
                    >
                      {acc.provider}
                    </Text>
                  </View>
                  <RadioDot selected={selectedAccountId === acc.id} />
                </Pressable>
              ))}
            </View>

            {error && <Text style={styles.errorText}>{error}</Text>}

            <Pressable
              onPress={handleSave}
              style={styles.saveBtn}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={tw.color.white} />
              ) : (
                <Text style={styles.saveBtnText}>Plan it</Text>
              )}
            </Pressable>
          </>
        )}

        <View style={{ height: tw.space[4] }} />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: tw.space[5],
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: tw.text.lg.fontSize,
    lineHeight: tw.text.lg.lineHeight,
    fontWeight: tw.weight.semibold,
  },
  subtitle: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    marginTop: 2,
  },
  closeBtn: {
    padding: tw.space[2],
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  fieldGroup: {
    marginBottom: tw.space[4],
    gap: tw.space[2],
  },
  fieldLabel: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
  },
  input: {
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    minHeight: 44,
  },
  prefixRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
  },
  prefix: {
    fontSize: tw.text.base.fontSize,
    lineHeight: tw.text.base.lineHeight,
    fontWeight: tw.weight.medium,
  },
  inputFlex: {
    flex: 1,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    minHeight: 44,
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[3],
    minHeight: 52,
    marginBottom: tw.space[1],
  },
  accountInitial: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: tw.color.slate200,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  accountInitialText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.semibold,
    color: tw.color.slate700,
  },
  accountTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  accountName: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
  },
  accountProvider: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
  },
  errorText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    color: tw.color.rose500,
    marginBottom: tw.space[3],
  },
  saveBtn: {
    backgroundColor: tw.color.indigo600,
    borderRadius: tw.radius.xl,
    paddingVertical: tw.space[3],
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    marginBottom: tw.space[2],
  },
  saveBtnText: {
    fontSize: tw.text.base.fontSize,
    lineHeight: tw.text.base.lineHeight,
    fontWeight: tw.weight.semibold,
    color: tw.color.white,
  },
  confirmCard: {
    borderRadius: tw.radius["2xl"],
    padding: tw.space[4],
    gap: tw.space[4],
    alignItems: "center",
  },
  confirmMsg: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    textAlign: "center",
  },
  doneBtn: {
    backgroundColor: tw.color.indigo600,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[8],
    paddingVertical: tw.space[3],
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  doneBtnText: {
    fontSize: tw.text.base.fontSize,
    lineHeight: tw.text.base.lineHeight,
    fontWeight: tw.weight.semibold,
    color: tw.color.white,
  },
});
