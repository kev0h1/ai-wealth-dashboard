import { View, Text, Pressable, StyleSheet } from "react-native";
import { useState } from "react";
import { tw } from "@/lib/tw";
import { api, type MirrorTrait } from "@/lib/api";

// Kind → accent colour map (Category Voice Rule: ~15% tint bg + full-strength dot)
type KindAccent = {
  lightBg: string;
  darkBg: string;
  dot: string;
};

const KIND_ACCENT: Record<MirrorTrait["kind"], KindAccent> = {
  structure: {
    lightBg: tw.color.indigo50,
    darkBg: "#312e8133", // indigo-900/20
    dot:    tw.color.indigo500,
  },
  habit: {
    lightBg: tw.color.emerald50,
    darkBg: "#06532133", // emerald-900/20
    dot:    tw.color.emerald500,
  },
  pleasure: {
    lightBg: tw.color.violet50,
    darkBg: "#4c1d9533", // violet-900/20
    dot:    tw.color.violet500,
  },
  hygiene: {
    lightBg: tw.color.slate100,
    darkBg: "#33415566", // slate-700/40
    dot:    tw.color.slate400,
  },
};

interface Props {
  trait: MirrorTrait;
  dark: boolean;
  onChoice: (id: string, choice: "keep" | "change") => void;
}

export function TraitCard({ trait, dark, onChoice }: Props) {
  const accent = KIND_ACCENT[trait.kind] ?? KIND_ACCENT.structure;
  const [saving, setSaving] = useState(false);

  async function handleChoice(choice: "keep" | "change") {
    if (saving || trait.choice === choice) return;
    setSaving(true);
    // Optimistic update first so UI responds immediately
    onChoice(trait.id, choice);
    try {
      await api.setMirrorChoice(trait.id, choice);
    } catch {
      // Silent — optimistic state stays; parent can re-fetch on next load
    } finally {
      setSaving(false);
    }
  }

  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const cardBorder = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;

  // Keep button selected state: indigo tint
  const keepSelected = trait.choice === "keep";
  const keepBg = keepSelected
    ? (dark ? "#312e8150" : tw.color.indigo50) // indigo-900/30 dark
    : "transparent";
  const keepBorder = keepSelected
    ? (dark ? tw.color.indigo800 : tw.color.indigo200)
    : (dark ? tw.color.slate700 : tw.color.slate200);
  const keepText = keepSelected
    ? (dark ? tw.color.indigo300 : tw.color.indigo700)
    : (dark ? tw.color.slate300 : tw.color.slate600);

  // Change button selected state: amber tint
  const changeSelected = trait.choice === "change";
  const changeBg = changeSelected
    ? (dark ? "#78350f50" : tw.color.amber50) // amber-900/30 dark
    : "transparent";
  const changeBorder = changeSelected
    ? (dark ? tw.color.amber800 : tw.color.amber200)
    : (dark ? tw.color.slate700 : tw.color.slate200);
  const changeText = changeSelected
    ? (dark ? tw.color.amber300 : tw.color.amber700)
    : (dark ? tw.color.slate300 : tw.color.slate600);

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      {/* Kind dot accent strip */}
      <View style={[styles.kindDot, { backgroundColor: accent.dot }]} />

      {/* Header band: title + narrative */}
      <View style={styles.headerBand}>
        <Text style={[styles.title, { color: dark ? tw.color.slate100 : tw.color.slate900 }]}>
          {trait.title}
        </Text>
        <Text style={[styles.narrative, { color: dark ? tw.color.slate300 : tw.color.slate600 }]}>
          {trait.narrative}
        </Text>
      </View>

      {/* Evidence lines — plain text matching web (no bullet markers) */}
      {trait.evidence.length > 0 && (
        <View style={styles.evidenceBlock}>
          {trait.evidence.map((e, i) => (
            <Text key={i} style={[styles.evidenceText, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
              {e}
            </Text>
          ))}
        </View>
      )}

      {/* Choice buttons */}
      <View style={styles.choiceRow}>
        {/* Keep */}
        <Pressable
          onPress={() => handleChoice("keep")}
          disabled={saving}
          style={({ pressed }) => [
            styles.choiceBtn,
            {
              flex: 1,
              backgroundColor: keepBg,
              borderColor: keepBorder,
              transform: [{ scale: pressed ? 0.98 : 1 }],
              opacity: saving ? 0.6 : pressed ? 0.8 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="This is me — keep it"
          accessibilityState={{ selected: keepSelected }}
        >
          <Text style={[styles.choiceBtnText, { color: keepText }]}>
            This is me — keep it
          </Text>
        </Pressable>

        {/* Change */}
        <Pressable
          onPress={() => handleChoice("change")}
          disabled={saving}
          style={({ pressed }) => [
            styles.choiceBtn,
            {
              flex: 1,
              backgroundColor: changeBg,
              borderColor: changeBorder,
              transform: [{ scale: pressed ? 0.98 : 1 }],
              opacity: saving ? 0.6 : pressed ? 0.8 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="I'd like to change this"
          accessibilityState={{ selected: changeSelected }}
        >
          <Text style={[styles.choiceBtnText, { color: changeText }]}>
            {"I’d like to change this"}
          </Text>
        </Pressable>
      </View>

      {/* Confirmation line */}
      {trait.choice != null && (
        <View style={styles.confirmLine}>
          <Text style={[styles.confirmText, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
            {trait.choice === "keep"
              ? "Noted — we’ll never nag you about this."
              : "Noted — Penny will start working on this with you."}
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
    overflow: "hidden",
    // One soft shadow (light mode only — dark mode uses border)
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  // 3px left accent strip mirroring kind tint
  kindDot: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: tw.radius["2xl"],
    borderBottomLeftRadius: tw.radius["2xl"],
  },
  headerBand: {
    paddingTop: tw.space[4],
    paddingBottom: tw.space[3],
    paddingLeft: tw.space[4] + 3, // account for kind strip
    paddingRight: tw.space[4],
  },
  title: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
    lineHeight: 22,
  },
  narrative: {
    ...tw.text.sm,
    marginTop: tw.space[1],
    lineHeight: 21,
  },
  evidenceBlock: {
    paddingBottom: tw.space[3],
    paddingLeft: tw.space[4] + 3, // account for kind strip
    paddingRight: tw.space[4],
    gap: tw.space[1],
  },
  evidenceText: {
    fontSize: 13,
    lineHeight: 18,
  },
  choiceRow: {
    flexDirection: "row",
    gap: tw.space[2],
    paddingBottom: tw.space[4],
    paddingLeft: tw.space[4] + 3,
    paddingRight: tw.space[4],
  },
  choiceBtn: {
    paddingVertical: tw.space[2],
    paddingHorizontal: tw.space[3],
    borderRadius: tw.radius.xl,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 36, // ~h-9
  },
  choiceBtnText: {
    ...tw.text.xs,
    fontWeight: tw.weight.semibold,
    textAlign: "center",
  },
  confirmLine: {
    paddingBottom: tw.space[4],
    paddingLeft: tw.space[4] + 3,
    paddingRight: tw.space[4],
    marginTop: -tw.space[2],
  },
  confirmText: {
    fontSize: 13,
    lineHeight: 18,
  },
});
