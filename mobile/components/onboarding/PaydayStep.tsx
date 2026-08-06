import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Check } from "lucide-react-native";
import { onboardingApi } from "@/lib/api/onboarding";
import { useTheme } from "@/lib/ThemeContext";
import { tw } from "@/lib/tw";

interface PaydayStepProps {
  onNext: () => void;
}

const PAY_OPTIONS = [
  {
    label: "Last Friday of month",
    sub: "Typical UK monthly salary",
    value: { type: "last_friday" },
  },
  {
    label: "1st of the month",
    sub: "e.g. civil service, some pensions",
    value: { type: "monthly_pay_date", day: 1 },
  },
  {
    label: "15th of the month",
    sub: "",
    value: { type: "monthly_pay_date", day: 15 },
  },
  {
    label: "25th of the month",
    sub: "Common for many employers",
    value: { type: "monthly_pay_date", day: 25 },
  },
  {
    label: "28th of the month",
    sub: "",
    value: { type: "monthly_pay_date", day: 28 },
  },
  {
    label: "End of the month",
    sub: "Calendar month view",
    value: { type: "calendar_month" },
  },
  { label: "I'll set this later", sub: "", value: null },
];

export function PaydayStep({ onNext }: PaydayStepProps) {
  const { dark } = useTheme();
  const [payIdx, setPayIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [ctaPressed, setCtaPressed] = useState(false);

  async function savePayday() {
    setSaving(true);
    const chosen = PAY_OPTIONS[payIdx].value;
    if (chosen) {
      try {
        await onboardingApi.updatePayPeriod(chosen);
      } catch {
        // silent
      }
    }
    setSaving(false);
    onNext();
  }

  const cardBg = dark ? tw.color.slate800 : tw.color.white;
  const borderColor = dark ? tw.color.slate700 : "#f8fafc";

  return (
    <View style={styles.container}>
      <Text
        style={[
          styles.heading,
          { color: dark ? tw.color.slate100 : tw.color.slate900 },
        ]}
      >
        When do you get paid?
      </Text>
      <Text
        style={[
          styles.subheading,
          { color: dark ? tw.color.slate400 : tw.color.slate500 },
        ]}
      >
        This powers your spending runway and budget periods.
      </Text>

      <View
        style={[
          styles.card,
          {
            backgroundColor: cardBg,
            shadowColor: "#000",
            shadowOpacity: 0.05,
            shadowOffset: { width: 0, height: 1 },
            shadowRadius: 2,
            elevation: 1,
          },
        ]}
      >
        {PAY_OPTIONS.map((opt, i) => {
          const selected = payIdx === i;
          const isLast = i === PAY_OPTIONS.length - 1;
          return (
            <Pressable
              key={opt.label}
              onPress={() => setPayIdx(i)}
              style={[
                styles.row,
                {
                  backgroundColor: selected
                    ? dark
                      ? "rgba(79,70,229,0.15)"
                      : tw.color.indigo50
                    : "transparent",
                  borderBottomWidth: isLast ? 0 : 1,
                  borderBottomColor: borderColor,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.rowLabel,
                    {
                      color: selected
                        ? dark
                          ? tw.color.indigo300
                          : tw.color.indigo700
                        : dark
                        ? tw.color.slate100
                        : tw.color.slate800,
                    },
                  ]}
                >
                  {opt.label}
                </Text>
                {opt.sub ? (
                  <Text
                    style={[
                      styles.rowSub,
                      { color: tw.color.slate400 },
                    ]}
                  >
                    {opt.sub}
                  </Text>
                ) : null}
              </View>
              {selected && (
                <View style={styles.checkBadge}>
                  <Check size={11} color="white" strokeWidth={3} />
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={savePayday}
        onPressIn={() => setCtaPressed(true)}
        onPressOut={() => setCtaPressed(false)}
        disabled={saving}
        style={[
          styles.cta,
          {
            opacity: saving ? 0.5 : 1,
            transform: [{ scale: ctaPressed ? 0.97 : 1 }],
          },
        ]}
      >
        <Text style={styles.ctaText}>Continue</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  heading: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  subheading: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
  },
  card: {
    borderRadius: 24,
    overflow: "hidden",
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  rowSub: {
    fontSize: 12,
    marginTop: 2,
  },
  checkBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: tw.color.indigo500,
    alignItems: "center",
    justifyContent: "center",
  },
  cta: {
    borderRadius: 16,
    paddingVertical: 14,
    backgroundColor: tw.color.indigo600,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    fontSize: 14,
    fontWeight: "600",
    color: "white",
  },
});
