import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
} from "react-native";
import { X } from "lucide-react-native";
import { BottomSheet } from "@/components/ui";
import { tw } from "@/lib/tw";
import { useTheme } from "@/lib/ThemeContext";
import { PayPeriodConfig } from "@/lib/PreferencesContext";

interface PayPeriodSettingsSheetProps {
  visible: boolean;
  current: PayPeriodConfig;
  onClose: () => void;
  onSave: (c: PayPeriodConfig) => void;
}

type ModeType = null | "day_of_month" | "biweekly" | "last_weekday";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MODES: { type: ModeType; label: string; description: string }[] = [
  {
    type: null,
    label: "Calendar month",
    description: "1st to last day of each month",
  },
  {
    type: "day_of_month",
    label: "Monthly pay date",
    description: "Period starts on a fixed day each month",
  },
  {
    type: "biweekly",
    label: "Every two weeks",
    description: "14-day periods from a reference payday",
  },
  {
    type: "last_weekday",
    label: "Last weekday of month",
    description: "Payday = last chosen weekday each month",
  },
];

export function PayPeriodSettingsSheet({
  visible,
  current,
  onClose,
  onSave,
}: PayPeriodSettingsSheetProps) {
  const { dark } = useTheme();
  const [selectedType, setSelectedType] = useState<ModeType>(
    (current.type as ModeType) ?? null
  );
  const [day, setDay] = useState<number>(current.day ?? 1);
  const [weekday, setWeekday] = useState<number>(current.weekday ?? 5);
  const [anchor, setAnchor] = useState<string>(current.anchor ?? "");

  useEffect(() => {
    if (visible) {
      setSelectedType((current.type as ModeType) ?? null);
      setDay(current.day ?? 1);
      setWeekday(current.weekday ?? 5);
      setAnchor(current.anchor ?? "");
    }
  }, [visible, current]);

  function handleSave() {
    const config: PayPeriodConfig = { type: selectedType };
    if (selectedType === "day_of_month") config.day = day;
    if (selectedType === "last_weekday") config.weekday = weekday;
    if (selectedType === "biweekly") {
      config.weekday = weekday;
      config.anchor = anchor;
    }
    onSave(config);
    onClose();
  }

  const cardBg = dark ? tw.color.slate700 : tw.color.slate100;
  const labelColor = dark ? tw.color.slate300 : tw.color.slate600;
  const inputBg = dark ? tw.color.slate800 : tw.color.white;
  const inputColor = dark ? tw.color.slate100 : tw.color.slate800;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text
            style={[
              styles.title,
              { color: dark ? tw.color.slate100 : tw.color.slate900 },
            ]}
          >
            Pay period
          </Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <X
              size={20}
              color={dark ? tw.color.slate400 : tw.color.slate500}
            />
          </Pressable>
        </View>

        {/* Mode cards */}
        <View style={styles.modeList}>
          {MODES.map((mode) => {
            const selected = selectedType === mode.type;
            return (
              <Pressable
                key={String(mode.type)}
                onPress={() => setSelectedType(mode.type)}
                style={[
                  styles.modeCard,
                  {
                    backgroundColor: selected
                      ? dark
                        ? "#312e81"
                        : tw.color.indigo50
                      : cardBg,
                    borderColor: selected
                      ? tw.color.indigo600
                      : dark
                      ? tw.color.cardBorderDark
                      : tw.color.cardBorderLight,
                  },
                ]}
              >
                <View style={styles.modeRadio}>
                  <View
                    style={[
                      styles.radioOuter,
                      {
                        borderColor: selected
                          ? tw.color.indigo600
                          : tw.color.slate300,
                      },
                    ]}
                  >
                    {selected && <View style={styles.radioInner} />}
                  </View>
                </View>
                <View style={styles.modeText}>
                  <Text
                    style={[
                      styles.modeLabel,
                      {
                        color: selected
                          ? dark
                            ? "#a5b4fc"
                            : "#4338ca"
                          : dark
                          ? tw.color.slate100
                          : tw.color.slate800,
                      },
                    ]}
                  >
                    {mode.label}
                  </Text>
                  <Text
                    style={[
                      styles.modeDesc,
                      { color: dark ? tw.color.slate400 : tw.color.slate500 },
                    ]}
                  >
                    {mode.description}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Sub-options */}
        {selectedType === "day_of_month" && (
          <View style={styles.subSection}>
            <Text style={[styles.subLabel, { color: labelColor }]}>
              Pay day of month
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <Pressable
                  key={d}
                  onPress={() => setDay(d)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor:
                        day === d
                          ? tw.color.indigo600
                          : dark
                          ? tw.color.slate700
                          : tw.color.slate100,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: day === d ? tw.color.white : dark ? tw.color.slate300 : tw.color.slate700 },
                    ]}
                  >
                    {d}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {selectedType === "last_weekday" && (
          <View style={styles.subSection}>
            <Text style={[styles.subLabel, { color: labelColor }]}>
              Which weekday?
            </Text>
            <View style={styles.weekdayRow}>
              {WEEKDAY_NAMES.map((name, idx) => (
                <Pressable
                  key={name}
                  onPress={() => setWeekday(idx)}
                  style={[
                    styles.weekdayChip,
                    {
                      backgroundColor:
                        weekday === idx
                          ? tw.color.indigo600
                          : dark
                          ? tw.color.slate700
                          : tw.color.slate100,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      {
                        color:
                          weekday === idx
                            ? tw.color.white
                            : dark
                            ? tw.color.slate300
                            : tw.color.slate700,
                      },
                    ]}
                  >
                    {name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {selectedType === "biweekly" && (
          <View style={styles.subSection}>
            <Text style={[styles.subLabel, { color: labelColor }]}>
              Which weekday?
            </Text>
            <View style={styles.weekdayRow}>
              {WEEKDAY_NAMES.map((name, idx) => (
                <Pressable
                  key={name}
                  onPress={() => setWeekday(idx)}
                  style={[
                    styles.weekdayChip,
                    {
                      backgroundColor:
                        weekday === idx
                          ? tw.color.indigo600
                          : dark
                          ? tw.color.slate700
                          : tw.color.slate100,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      {
                        color:
                          weekday === idx
                            ? tw.color.white
                            : dark
                            ? tw.color.slate300
                            : tw.color.slate700,
                      },
                    ]}
                  >
                    {name}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.subLabel, { color: labelColor, marginTop: tw.space[3] }]}>
              Reference payday (YYYY-MM-DD)
            </Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: inputBg, color: inputColor },
              ]}
              value={anchor}
              onChangeText={setAnchor}
              placeholder="e.g. 2026-01-10"
              placeholderTextColor={tw.color.slate400}
            />
          </View>
        )}

        {/* Save */}
        <Pressable onPress={handleSave} style={styles.saveBtn}>
          <Text style={styles.saveBtnText}>Save</Text>
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
  title: {
    fontSize: tw.text.base.fontSize,
    lineHeight: tw.text.base.lineHeight,
    fontWeight: tw.weight.bold,
  },
  closeBtn: {
    padding: tw.space[2],
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  modeList: {
    gap: tw.space[2],
    marginBottom: tw.space[4],
  },
  modeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    borderRadius: tw.radius["2xl"],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    minHeight: 56,
    borderWidth: 2,
  },
  modeRadio: {
    flexShrink: 0,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: tw.color.indigo600,
  },
  modeText: {
    flex: 1,
    minWidth: 0,
  },
  modeLabel: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.semibold,
  },
  modeDesc: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    marginTop: 2,
  },
  subSection: {
    marginBottom: tw.space[4],
  },
  subLabel: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
    marginBottom: tw.space[2],
  },
  chipRow: {
    flexDirection: "row",
    gap: tw.space[1],
    paddingBottom: tw.space[1],
  },
  chip: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.medium,
  },
  weekdayRow: {
    flexDirection: "row",
    gap: tw.space[1],
    flexWrap: "wrap",
  },
  weekdayChip: {
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[2],
    borderRadius: tw.radius.lg,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    minHeight: 44,
  },
  saveBtn: {
    backgroundColor: tw.color.indigo600,
    borderRadius: tw.radius["2xl"],
    paddingVertical: tw.space[4],
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
});
