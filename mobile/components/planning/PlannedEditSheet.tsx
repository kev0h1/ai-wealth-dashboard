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
import { X } from "lucide-react-native";
import { BottomSheet } from "@/components/ui";
import { tw } from "@/lib/tw";
import { useTheme } from "@/lib/ThemeContext";
import { Account } from "@/lib/api";
import { planningApi } from "@/lib/api/planning";
import { CATEGORY_COLOURS } from "@/lib/categories";

interface PlannedEditSheetProps {
  visible: boolean;
  item: {
    id: string;
    name: string;
    amount: number;
    date: string;
    account_id: string | null;
  } | null;
  accounts: Account[];
  onClose: () => void;
  onDelete: () => void;
  onSaved: () => void;
}

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <View
      style={[
        radioDotStyles.outer,
        { borderColor: selected ? tw.color.indigo600 : tw.color.slate300 },
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

const OTHER_COLOUR = "#795548";

export function PlannedEditSheet({
  visible,
  item,
  accounts,
  onClose,
  onDelete,
  onSaved,
}: PlannedEditSheetProps) {
  const { dark } = useTheme();
  const [nameVal, setNameVal] = useState("");
  const [amountVal, setAmountVal] = useState("");
  const [dateVal, setDateVal] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item && visible) {
      setNameVal(item.name);
      setAmountVal(item.amount.toFixed(2));
      setDateVal(item.date);
      setSelectedAccountId(item.account_id);
      setSaving(false);
      setError(null);
    }
  }, [item, visible]);

  if (!item) return null;

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
    if (!item) return;
    setSaving(true);
    setError(null);
    try {
      await planningApi.updatePlanned(item.id, {
        name: nameVal.trim() || item.name,
        amount: parseFloat(amountVal) || item.amount,
        date: dateVal || item.date,
        account_id: selectedAccountId,
      });
      onSaved();
      onClose();
    } catch {
      setError("Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
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
          <View style={styles.headerLeft}>
            <View
              style={[styles.headerIcon, { backgroundColor: OTHER_COLOUR + "26" }]}
            >
              <Text style={styles.headerEmoji}>📦</Text>
            </View>
            <View style={styles.headerText}>
              <Text
                style={[
                  styles.headerName,
                  { color: dark ? tw.color.slate100 : tw.color.slate900 },
                ]}
              >
                {item.name}
              </Text>
              <Text
                style={[
                  styles.headerSub,
                  { color: dark ? tw.color.slate400 : tw.color.slate500 },
                ]}
              >
                Planned {item.date} · −{sym}
                {item.amount.toFixed(2)}
              </Text>
            </View>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <X
              size={20}
              color={dark ? tw.color.slate400 : tw.color.slate500}
            />
          </Pressable>
        </View>

        {/* Name */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: labelColor }]}>Name</Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: inputBg, color: inputColor },
            ]}
            value={nameVal}
            onChangeText={setNameVal}
            placeholder="Name"
            placeholderTextColor={tw.color.slate400}
          />
        </View>

        {/* Amount */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: labelColor }]}>Amount</Text>
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
              value={amountVal}
              onChangeText={setAmountVal}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={tw.color.slate400}
            />
          </View>
        </View>

        {/* Date */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: labelColor }]}>Date</Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: inputBg, color: inputColor },
            ]}
            value={dateVal}
            onChangeText={setDateVal}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={tw.color.slate400}
          />
        </View>

        {/* Account */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: labelColor }]}>
            Account
          </Text>

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

        {/* Save */}
        <Pressable
          onPress={handleSave}
          style={styles.saveBtn}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={tw.color.white} />
          ) : (
            <Text style={styles.saveBtnText}>Save</Text>
          )}
        </Pressable>

        {/* Delete */}
        <Pressable
          onPress={() => {
            onDelete();
            onClose();
          }}
          style={styles.deleteBtn}
        >
          <Text style={styles.deleteBtnText}>Delete</Text>
        </Pressable>

        <View style={{ height: tw.space[4] }} />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: tw.space[5],
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    flex: 1,
    minWidth: 0,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: tw.radius.xl,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  headerEmoji: {
    fontSize: 18,
    lineHeight: 24,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerName: {
    fontSize: tw.text.base.fontSize,
    lineHeight: tw.text.base.lineHeight,
    fontWeight: tw.weight.semibold,
  },
  headerSub: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
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
  deleteBtn: {
    paddingVertical: tw.space[3],
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  deleteBtnText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
    color: tw.color.rose500,
  },
});
