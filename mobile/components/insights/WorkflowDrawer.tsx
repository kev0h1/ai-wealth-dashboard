import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { CheckCircle2 } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useTheme } from "@/lib/ThemeContext";
import { tw } from "@/lib/tw";
import { insightsApi } from "@/lib/api/insights";
import type { WorkflowDef } from "@/lib/api/insights";

interface Props {
  visible: boolean;
  onClose: () => void;
  insightId: string;
  workflowKey: string;
  workflows: Record<string, WorkflowDef>;
}

export function WorkflowDrawer({
  visible,
  onClose,
  insightId,
  workflowKey,
  workflows,
}: Props) {
  const { dark } = useTheme();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workflow = workflows[workflowKey];
  const fields = workflow?.fields ?? [];
  const totalSteps = fields.length;
  const currentField = fields[step];

  const handleClose = useCallback(() => {
    setStep(0);
    setValues({});
    setSaving(false);
    setDone(false);
    setError(null);
    onClose();
  }, [onClose]);

  // Auto-close 1.5 s after reaching done state (spec: "1.5s → auto-close")
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(handleClose, 1500);
    return () => clearTimeout(t);
  }, [done, handleClose]);

  const handleNext = useCallback(async () => {
    if (step < totalSteps - 1) {
      setStep((s) => s + 1);
    } else {
      setSaving(true);
      setError(null);
      try {
        await insightsApi.saveInsightContext(insightId, values);
        setDone(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setSaving(false);
      }
    }
  }, [step, totalSteps, insightId, values]);

  const handleBack = useCallback(() => {
    if (step > 0) setStep((s) => s - 1);
  }, [step]);

  const setValue = useCallback((key: string, val: string) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  }, []);

  if (!workflow) return null;

  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const textPrimary = dark ? tw.color.slate100 : tw.color.slate800;
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate500;
  const inputBg = dark ? tw.color.slate700 : tw.color.slate50;
  const inputBorder = dark ? tw.color.slate600 : tw.color.slate200;

  return (
    <BottomSheet visible={visible} onClose={handleClose}>
      {done ? (
        <View style={styles.doneContainer}>
          <CheckCircle2 size={48} color={tw.color.emerald600} />
          <Text style={[styles.doneTitle, { color: textPrimary }]}>
            Saved — Penny is crunching your numbers.
          </Text>
        </View>
      ) : (
        <View style={[styles.container, { backgroundColor: cardBg }]}>
          <Text style={[styles.workflowTitle, { color: textPrimary }]}>
            {workflow.label}
          </Text>

          {currentField && (
            <View style={styles.fieldContainer}>
              <Text style={[styles.fieldLabel, { color: textSecondary }]}>
                {currentField.label}
              </Text>

              {currentField.type === "select" && currentField.options ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.pillScroll}
                  contentContainerStyle={styles.pillContent}
                >
                  {currentField.options.map((opt) => {
                    const selected = values[currentField.key] === opt;
                    return (
                      <Pressable
                        key={opt}
                        onPress={() => setValue(currentField.key, opt)}
                        style={[
                          styles.pill,
                          {
                            backgroundColor: selected
                              ? tw.color.indigo600
                              : dark
                              ? tw.color.slate700
                              : tw.color.slate100,
                            borderColor: selected
                              ? tw.color.indigo600
                              : inputBorder,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.pillText,
                            {
                              color: selected
                                ? tw.color.white
                                : dark
                                ? tw.color.slate300
                                : tw.color.slate700,
                            },
                          ]}
                        >
                          {opt}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : currentField.type === "currency" ? (
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
                    value={values[currentField.key] ?? ""}
                    onChangeText={(v) => setValue(currentField.key, v)}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={textSecondary}
                    style={[styles.currencyInput, { color: textPrimary }]}
                  />
                </View>
              ) : (
                <TextInput
                  value={values[currentField.key] ?? ""}
                  onChangeText={(v) => setValue(currentField.key, v)}
                  placeholder=""
                  placeholderTextColor={textSecondary}
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: inputBg,
                      borderColor: inputBorder,
                      color: textPrimary,
                    },
                  ]}
                />
              )}
            </View>
          )}

          {error && (
            <Text style={styles.errorText}>{error}</Text>
          )}

          {/* Progress dots */}
          {totalSteps > 1 && (
            <View style={styles.dotsRow}>
              {fields.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        i === step ? tw.color.indigo600 : tw.color.slate300,
                      width: i === step ? 16 : 8,
                    },
                  ]}
                />
              ))}
            </View>
          )}

          {/* Navigation buttons */}
          <View style={styles.btnRow}>
            {step > 0 && (
              <Pressable
                onPress={handleBack}
                style={[styles.btn, styles.btnSecondary, { borderColor: inputBorder }]}
              >
                <Text style={[styles.btnLabel, { color: textSecondary }]}>
                  Back
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={handleNext}
              disabled={saving}
              style={[styles.btn, styles.btnPrimary, { flex: step > 0 ? 1 : undefined }]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={tw.color.white} />
              ) : (
                <Text style={[styles.btnLabel, { color: tw.color.white }]}>
                  {step < totalSteps - 1 ? "Next" : "Save"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: tw.space[4],
  },
  workflowTitle: {
    ...tw.text.lg,
    fontWeight: tw.weight.bold,
    marginBottom: tw.space[2],
  },
  fieldContainer: {
    gap: tw.space[2],
  },
  fieldLabel: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    ...tw.text.base,
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
    ...tw.text.base,
    marginRight: tw.space[1],
    fontWeight: tw.weight.medium,
  },
  currencyInput: {
    flex: 1,
    ...tw.text.base,
    padding: 0,
  },
  pillScroll: {
    flexGrow: 0,
  },
  pillContent: {
    gap: tw.space[2],
    paddingRight: tw.space[4],
  },
  pill: {
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[2],
    borderRadius: tw.radius.full,
    borderWidth: 1,
  },
  pillText: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tw.space[1],
    marginTop: tw.space[2],
  },
  dot: {
    height: 8,
    borderRadius: tw.radius.full,
  },
  btnRow: {
    flexDirection: "row",
    gap: tw.space[3],
    marginTop: tw.space[2],
  },
  btn: {
    borderRadius: tw.radius.xl,
    paddingVertical: tw.space[3],
    paddingHorizontal: tw.space[6],
    alignItems: "center",
    justifyContent: "center",
    minWidth: 80,
  },
  btnPrimary: {
    backgroundColor: tw.color.indigo600,
    flex: 1,
  },
  btnSecondary: {
    borderWidth: 1,
  },
  btnLabel: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  doneContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: tw.space[8],
    gap: tw.space[4],
  },
  doneTitle: {
    ...tw.text.base,
    fontWeight: tw.weight.medium,
    textAlign: "center",
  },
  errorText: {
    ...tw.text.sm,
    color: tw.color.rose500,
  },
});
