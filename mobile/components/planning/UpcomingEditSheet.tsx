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
import { X, Repeat } from "lucide-react-native";
import { BottomSheet, SegmentedControl } from "@/components/ui";
import { tw } from "@/lib/tw";
import { useTheme } from "@/lib/ThemeContext";
import { api } from "@/lib/api";
import { planningApi } from "@/lib/api/planning";
import { CATEGORY_ICONS, CATEGORY_COLOURS } from "@/lib/categories";

interface UpcomingEditSheetProps {
  visible: boolean;
  item: {
    name: string;
    amount: number;
    expected_date: string;
    original_date?: string | null;
    type: "bill" | "income";
    category?: string | null;
    edited?: boolean;
    rule_label?: string | null;
  } | null;
  onClose: () => void;
  onDismiss: () => void;
  onSaved: () => void;
}

export function UpcomingEditSheet({
  visible,
  item,
  onClose,
  onDismiss,
  onSaved,
}: UpcomingEditSheetProps) {
  const { dark } = useTheme();
  const [dateVal, setDateVal] = useState("");
  const [amountVal, setAmountVal] = useState("");
  const [scope, setScope] = useState<0 | 1>(0); // 0 = "Just this one", 1 = "This & future"
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ruleExpanded, setRuleExpanded] = useState(false);
  const [ruleText, setRuleText] = useState("");
  const [rulePreview, setRulePreview] = useState<{
    ok: boolean;
    label?: string;
    schedule?: Record<string, unknown>;
    next_dates?: string[];
    error?: string;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [dismissConfirm, setDismissConfirm] = useState(false);

  useEffect(() => {
    if (item && visible) {
      setDateVal(item.expected_date);
      setAmountVal(item.amount.toFixed(2));
      setScope(0);
      setError(null);
      setRuleExpanded(false);
      setRuleText("");
      setRulePreview(null);
      setDismissConfirm(false);
    }
  }, [item, visible]);

  if (!item) return null;

  const catName =
    item.type === "income"
      ? item.category || "Income"
      : item.category || "Other";
  const colour = CATEGORY_COLOURS[catName] ?? "#795548";
  const emoji = CATEGORY_ICONS[catName] ?? "📦";
  const sym = "£";

  async function handleSave() {
    if (!item) return;
    setSaving(true);
    setError(null);
    try {
      const newDate = dateVal.trim() || undefined;
      const newAmount = amountVal ? parseFloat(amountVal) : undefined;
      const dateKey = item.original_date ?? item.expected_date;
      await api.editUpcoming({
        key: item.name,
        date: dateKey,
        new_date: newDate ?? null,
        new_amount: newAmount ?? null,
        scope: scope === 0 ? "one" : "future",
      });
      onSaved();
      onClose();
    } catch {
      setError("Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!item) return;
    setSaving(true);
    setError(null);
    try {
      await planningApi.clearUpcomingOverride({
        key: item.name,
        date: item.original_date ?? item.expected_date,
      });
      onSaved();
      onClose();
    } catch {
      setError("Couldn't reset. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSkip() {
    if (!item) return;
    setSaving(true);
    try {
      await planningApi.skipUpcomingOccurrence(
        item.name,
        item.original_date ?? item.expected_date
      );
      onSaved();
      onClose();
    } catch {
      setError("Couldn't skip. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePreviewRule() {
    if (!item || !ruleText.trim()) return;
    setPreviewLoading(true);
    try {
      const res = await planningApi.previewUpcomingRule({
        key: item.name,
        text: ruleText.trim(),
        anchor_date: item.original_date ?? item.expected_date,
      });
      setRulePreview(res);
    } catch {
      setRulePreview({ ok: false, error: "Preview failed." });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleApplyRule() {
    if (!item || !rulePreview?.schedule) return;
    setSaving(true);
    try {
      await planningApi.applyUpcomingRule({
        key: item.name,
        schedule: rulePreview.schedule,
      });
      onSaved();
      onClose();
    } catch {
      setError("Couldn't apply schedule. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleClearRule() {
    if (!item) return;
    setSaving(true);
    try {
      await planningApi.clearUpcomingRule({ key: item.name });
      onSaved();
      onClose();
    } catch {
      setError("Couldn't remove schedule. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const inputBg = dark ? tw.color.slate700 : tw.color.slate100;
  const inputColor = dark ? tw.color.slate100 : tw.color.slate800;
  const labelColor = dark ? tw.color.slate300 : tw.color.slate600;

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
              style={[styles.headerIcon, { backgroundColor: colour + "26" }]}
            >
              <Text style={styles.headerEmoji}>{emoji}</Text>
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
                Predicted {item.expected_date} ·{" "}
                {item.type === "income" ? "+" : "−"}
                {sym}
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

        {/* Date field */}
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
            keyboardType="default"
          />
        </View>

        {/* Amount field */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: labelColor }]}>Amount</Text>
          <View style={styles.prefixRow}>
            <Text
              style={[styles.prefix, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}
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

        {/* Repeat / rule section */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: labelColor }]}>
            Repeats
          </Text>
          {item.rule_label ? (
            <View style={styles.ruleRow}>
              <Repeat
                size={14}
                color={dark ? "#a5b4fc" : tw.color.indigo600}
              />
              <Text
                style={[
                  styles.ruleLabel,
                  { color: dark ? "#a5b4fc" : tw.color.indigo600 },
                ]}
              >
                {item.rule_label}
              </Text>
              <Pressable onPress={handleClearRule} style={styles.removeBtn}>
                <Text style={styles.removeBtnText}>Remove</Text>
              </Pressable>
            </View>
          ) : !ruleExpanded ? (
            <Pressable
              onPress={() => setRuleExpanded(true)}
              style={styles.setScheduleBtn}
            >
              <Repeat
                size={14}
                color={dark ? tw.color.slate400 : tw.color.slate500}
              />
              <Text
                style={[
                  styles.setScheduleText,
                  { color: dark ? tw.color.slate400 : tw.color.slate500 },
                ]}
              >
                Set a schedule
              </Text>
            </Pressable>
          ) : (
            <View>
              <View style={styles.prefixRow}>
                <TextInput
                  style={[
                    styles.inputFlex,
                    { backgroundColor: inputBg, color: inputColor },
                  ]}
                  value={ruleText}
                  onChangeText={setRuleText}
                  placeholder='e.g. "every 4th of the month"'
                  placeholderTextColor={tw.color.slate400}
                />
                <Pressable
                  onPress={handlePreviewRule}
                  style={styles.previewBtn}
                  disabled={previewLoading}
                >
                  {previewLoading ? (
                    <ActivityIndicator size="small" color={tw.color.white} />
                  ) : (
                    <Text style={styles.previewBtnText}>Preview</Text>
                  )}
                </Pressable>
              </View>
              {rulePreview && (
                <View
                  style={[
                    styles.previewCard,
                    {
                      backgroundColor: rulePreview.ok
                        ? dark
                          ? tw.color.slate700
                          : tw.color.slate100
                        : dark
                        ? "rgba(159,18,57,0.2)"
                        : "#fff1f2",
                    },
                  ]}
                >
                  {rulePreview.ok ? (
                    <>
                      <Text
                        style={[
                          styles.previewLabel,
                          { color: dark ? tw.color.slate200 : tw.color.slate700 },
                        ]}
                      >
                        {rulePreview.label}
                      </Text>
                      {rulePreview.next_dates && (
                        <Text
                          style={[
                            styles.previewDates,
                            { color: dark ? tw.color.slate400 : tw.color.slate500 },
                          ]}
                        >
                          Next: {rulePreview.next_dates.slice(0, 3).join(", ")}
                        </Text>
                      )}
                      <View style={styles.previewActions}>
                        <Pressable
                          onPress={handleApplyRule}
                          style={styles.applyBtn}
                        >
                          <Text style={styles.applyBtnText}>Apply</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setRulePreview(null)}
                          style={styles.editRuleBtn}
                        >
                          <Text
                            style={[
                              styles.editRuleBtnText,
                              { color: dark ? tw.color.slate400 : tw.color.slate500 },
                            ]}
                          >
                            Edit
                          </Text>
                        </Pressable>
                      </View>
                    </>
                  ) : (
                    <Text style={styles.previewError}>
                      {rulePreview.error ?? "Couldn't parse that schedule."}
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}
        </View>

        {/* Scope */}
        <View style={styles.fieldGroup}>
          <SegmentedControl
            options={["Just this one", "This & future"]}
            selected={scope}
            onChange={(i) => setScope(i as 0 | 1)}
          />
          <Text
            style={[
              styles.hintText,
              { color: dark ? tw.color.slate500 : tw.color.slate400 },
            ]}
          >
            {scope === 0
              ? "Only this occurrence will change."
              : "This and all future predicted occurrences will change."}
          </Text>
        </View>

        {error && (
          <Text style={styles.errorText}>{error}</Text>
        )}

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

        {/* Reset to prediction */}
        {item.edited && (
          <Pressable onPress={handleReset} style={styles.secondaryBtn}>
            <Text
              style={[
                styles.secondaryBtnText,
                { color: dark ? tw.color.slate400 : tw.color.slate500 },
              ]}
            >
              Reset to prediction
            </Text>
          </Pressable>
        )}

        {/* Skip this month */}
        {item.type === "bill" && (
          <Pressable onPress={handleSkip} style={styles.secondaryBtn}>
            <Text
              style={[
                styles.secondaryBtnText,
                { color: dark ? tw.color.slate400 : tw.color.slate500 },
              ]}
            >
              Skip this month
            </Text>
          </Pressable>
        )}

        {/* Not a bill / Not income (destructive) */}
        {!dismissConfirm ? (
          <Pressable
            onPress={() => setDismissConfirm(true)}
            style={styles.secondaryBtn}
          >
            <Text style={styles.destructiveText}>
              {item.type === "bill" ? "Not a bill" : "Not income"}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.confirmRow}>
            <Text
              style={[
                styles.confirmText,
                { color: dark ? tw.color.slate300 : tw.color.slate600 },
              ]}
            >
              Remove this prediction?
            </Text>
            <Pressable
              onPress={() => {
                onDismiss();
                onClose();
              }}
              style={styles.confirmYesBtn}
            >
              <Text style={styles.confirmYesText}>Yes, remove</Text>
            </Pressable>
            <Pressable
              onPress={() => setDismissConfirm(false)}
              style={styles.confirmNoBtn}
            >
              <Text
                style={[
                  styles.confirmNoText,
                  { color: dark ? tw.color.slate400 : tw.color.slate500 },
                ]}
              >
                Cancel
              </Text>
            </Pressable>
          </View>
        )}

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
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
  },
  ruleLabel: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    flex: 1,
  },
  removeBtn: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tw.space[2],
  },
  removeBtnText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    color: tw.color.rose500,
    fontWeight: tw.weight.medium,
  },
  setScheduleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    minHeight: 44,
  },
  setScheduleText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
  },
  previewBtn: {
    backgroundColor: tw.color.indigo600,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[4],
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  previewBtnText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.semibold,
    color: tw.color.white,
  },
  previewCard: {
    borderRadius: tw.radius.xl,
    padding: tw.space[3],
    marginTop: tw.space[2],
    gap: tw.space[1],
  },
  previewLabel: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
  },
  previewDates: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
  },
  previewActions: {
    flexDirection: "row",
    gap: tw.space[2],
    marginTop: tw.space[2],
  },
  applyBtn: {
    backgroundColor: tw.color.indigo600,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[2],
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  applyBtnText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
    color: tw.color.white,
  },
  editRuleBtn: {
    paddingHorizontal: tw.space[3],
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  editRuleBtnText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
  },
  previewError: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    color: tw.color.rose500,
  },
  hintText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    marginTop: tw.space[1],
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
  secondaryBtn: {
    paddingVertical: tw.space[3],
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  secondaryBtnText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
  },
  destructiveText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
    color: tw.color.rose500,
  },
  confirmRow: {
    alignItems: "center",
    gap: tw.space[2],
    paddingVertical: tw.space[2],
  },
  confirmText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
  },
  confirmYesBtn: {
    backgroundColor: tw.color.rose500,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[5],
    paddingVertical: tw.space[2],
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmYesText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.semibold,
    color: tw.color.white,
  },
  confirmNoBtn: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tw.space[4],
  },
  confirmNoText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
  },
});
