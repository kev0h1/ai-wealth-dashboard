import React, { useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, Alert } from "react-native";
import {
  Star,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Info,
  Move,
  Zap,
  Target,
  X,
  ChevronRight,
  Check,
} from "lucide-react-native";
import { useRouter } from "expo-router";
import { Linking } from "react-native";
import { tw } from "@/lib/tw";
import { api } from "@/lib/api";
import type { CompanionItem } from "@/lib/api";

interface Props {
  greeting?: string;          // optional override from API; if absent, compute locally
  firstName?: string;         // user's first name for time-based greeting
  companionItems: CompanionItem[];
  dark: boolean;
  onRefresh?: () => void;
}

function timeGreeting(firstName?: string): string {
  const h = new Date().getHours();
  const salutation =
    h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return firstName ? `${salutation}, ${firstName}` : salutation;
}

// Sort order: celebration first, then urgency-descending
const SORT_ORDER: Record<CompanionItem["type"], number> = {
  celebration: 0,
  cliff: 1,
  trajectory: 2,
  rhythm: 3,
  ask: 4,
  needle: 5,
  info: 6,
  move: 7,
};

function fmtGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(Math.abs(n));
}

function ItemIcon({
  type,
  dark,
}: {
  type: CompanionItem["type"];
  dark: boolean;
}) {
  const size = 18;
  switch (type) {
    case "celebration":
      return <Star size={size} color={tw.color.amber500} />;
    case "cliff":
      return <AlertTriangle size={size} color={tw.color.rose500} />;
    case "trajectory":
      return <TrendingUp size={size} color={tw.color.emerald500} />;
    case "rhythm":
      return <TrendingDown size={size} color={tw.color.amber500} />;
    case "ask":
      return <Zap size={size} color={tw.color.violet500} />;
    case "needle":
      return <Target size={size} color={tw.color.indigo600} />;
    case "move":
      return <Move size={size} color={tw.color.slate400} />;
    case "info":
    default:
      return <Info size={size} color={dark ? tw.color.slate400 : tw.color.slate500} />;
  }
}

function itemAccentColor(type: CompanionItem["type"]): string {
  switch (type) {
    case "celebration":
      return tw.color.amber500;
    case "cliff":
      return tw.color.rose500;
    case "trajectory":
      return tw.color.emerald500;
    case "rhythm":
      return tw.color.amber500;
    case "ask":
      return tw.color.violet500;
    case "needle":
      return tw.color.indigo600;
    default:
      return tw.color.slate400;
  }
}

function itemBgColor(type: CompanionItem["type"], dark: boolean): string {
  if (dark) return tw.color.cardDark;
  switch (type) {
    case "celebration":
      return tw.color.amber50;
    case "cliff":
      return "#fff5f5";
    case "trajectory":
      return tw.color.emerald50;
    case "rhythm":
      return tw.color.amber50;
    case "ask":
      return tw.color.violet50;
    case "needle":
      return tw.color.indigo50;
    default:
      return tw.color.cardLight;
  }
}

// RhythmCard: category spend spike — offer one_off or new_normal
function RhythmCard({
  item,
  dark,
  onDismiss,
}: {
  item: CompanionItem;
  dark: boolean;
  onDismiss: () => void;
}) {
  const [answered, setAnswered] = useState(false);
  const [busy, setBusy] = useState(false);
  const category = item.payload?.category ?? item.id;
  const accent = itemAccentColor(item.type);
  const inkColor = dark ? tw.color.slate100 : tw.color.slate900;
  const subColor = dark ? tw.color.slate400 : tw.color.slate500;

  const respond = useCallback(
    async (answer: "one_off" | "new_normal") => {
      if (busy) return;
      setBusy(true);
      try {
        await api.recordTrendIntent(category, answer);
        setAnswered(true);
        onDismiss();
      } catch {
        // non-fatal — still dismiss
        setAnswered(true);
        onDismiss();
      } finally {
        setBusy(false);
      }
    },
    [category, busy, onDismiss],
  );

  if (answered) return null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: itemBgColor(item.type, dark),
          borderColor: dark ? tw.color.cardBorderDark : "rgba(0,0,0,0.06)",
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <View
          style={[styles.iconChip, { backgroundColor: `${accent}18` }]}
        >
          <ItemIcon type={item.type} dark={dark} />
        </View>
        <View style={styles.cardTitles}>
          <Text
            style={[styles.cardHeadline, { color: inkColor }]}
            numberOfLines={2}
          >
            {item.headline}
          </Text>
          <Text
            style={[styles.cardBody, { color: subColor }]}
            numberOfLines={3}
          >
            {item.body}
          </Text>
        </View>
      </View>

      {item.amount != null && (
        <View style={styles.amountRow}>
          <Text style={[styles.amountValue, { color: accent }]}>
            {fmtGBP(item.amount)}
          </Text>
          {item.payload?.multiple != null && (
            <Text style={[styles.amountSub, { color: subColor }]}>
              {item.payload.multiple.toFixed(1)}× usual
            </Text>
          )}
        </View>
      )}

      <View style={styles.rhythmBtns}>
        <Pressable
          onPress={() => respond("one_off")}
          disabled={busy}
          style={({ pressed }) => [
            styles.rhythmBtn,
            styles.rhythmBtnOutline,
            {
              borderColor: accent,
              opacity: pressed || busy ? 0.6 : 1,
            },
          ]}
        >
          <Text style={[styles.rhythmBtnText, { color: accent }]}>
            One-off
          </Text>
        </Pressable>
        <Pressable
          onPress={() => respond("new_normal")}
          disabled={busy}
          style={({ pressed }) => [
            styles.rhythmBtn,
            { backgroundColor: accent, opacity: pressed || busy ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.rhythmBtnText, { color: tw.color.white }]}>
            New normal
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// AskPaydayCard: confirm upcoming payday
function AskPaydayCard({
  item,
  dark,
  onDismiss,
  onRefresh,
}: {
  item: CompanionItem;
  dark: boolean;
  onDismiss: () => void;
  onRefresh?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const inkColor = dark ? tw.color.slate100 : tw.color.slate900;
  const subColor = dark ? tw.color.slate400 : tw.color.slate500;

  const confirm = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.confirmPayday();
      onRefresh?.();
      onDismiss();
    } catch {
      onDismiss();
    } finally {
      setBusy(false);
    }
  }, [busy, onDismiss, onRefresh]);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: itemBgColor(item.type, dark),
          borderColor: dark ? tw.color.cardBorderDark : "rgba(0,0,0,0.06)",
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.iconChip,
            { backgroundColor: `${tw.color.violet500}18` },
          ]}
        >
          <ItemIcon type={item.type} dark={dark} />
        </View>
        <View style={styles.cardTitles}>
          <Text style={[styles.cardHeadline, { color: inkColor }]} numberOfLines={2}>
            {item.headline}
          </Text>
          <Text style={[styles.cardBody, { color: subColor }]} numberOfLines={3}>
            {item.body}
          </Text>
        </View>
      </View>

      <View style={styles.rhythmBtns}>
        <Pressable
          onPress={onDismiss}
          style={({ pressed }) => [
            styles.rhythmBtn,
            styles.rhythmBtnOutline,
            {
              borderColor: tw.color.slate300,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
        >
          <Text style={[styles.rhythmBtnText, { color: subColor }]}>
            Not yet
          </Text>
        </Pressable>
        <Pressable
          onPress={confirm}
          disabled={busy}
          style={({ pressed }) => [
            styles.rhythmBtn,
            {
              backgroundColor: tw.color.violet500,
              opacity: pressed || busy ? 0.6 : 1,
            },
          ]}
        >
          <Check size={14} color={tw.color.white} />
          <Text style={[styles.rhythmBtnText, { color: tw.color.white }]}>
            Confirm
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// GenericItemCard: covers celebration, cliff, trajectory, needle, info, move
function GenericItemCard({
  item,
  dark,
  onDismiss,
}: {
  item: CompanionItem;
  dark: boolean;
  onDismiss: () => void;
}) {
  const router = useRouter();
  const accent = itemAccentColor(item.type);
  const inkColor = dark ? tw.color.slate100 : tw.color.slate900;
  const subColor = dark ? tw.color.slate400 : tw.color.slate500;

  const handleAction = useCallback(
    async (action: NonNullable<CompanionItem["action"]>) => {
      const { route } = action;
      if (route.startsWith("http")) {
        await Linking.openURL(route);
      } else {
        router.push(route as any);
      }
    },
    [router],
  );

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: itemBgColor(item.type, dark),
          borderColor: dark ? tw.color.cardBorderDark : "rgba(0,0,0,0.06)",
        },
      ]}
    >
      {/* Dismiss */}
      <Pressable
        onPress={onDismiss}
        style={styles.dismissBtn}
        hitSlop={8}
        accessibilityLabel="Dismiss"
      >
        <X size={14} color={tw.color.slate400} />
      </Pressable>

      <View style={styles.cardHeader}>
        <View style={[styles.iconChip, { backgroundColor: `${accent}18` }]}>
          <ItemIcon type={item.type} dark={dark} />
        </View>
        <View style={styles.cardTitles}>
          <Text
            style={[styles.cardHeadline, { color: inkColor }]}
            numberOfLines={2}
          >
            {item.headline}
          </Text>
          <Text
            style={[styles.cardBody, { color: subColor }]}
            numberOfLines={4}
          >
            {item.body}
          </Text>
        </View>
      </View>

      {item.amount != null && (
        <View style={styles.amountRow}>
          <Text style={[styles.amountValue, { color: accent }]}>
            {fmtGBP(item.amount)}
          </Text>
        </View>
      )}

      {/* Actions row */}
      {(item.action || item.secondary_action) && (
        <View style={styles.actionsRow}>
          {item.secondary_action && (
            <Pressable
              onPress={() => handleAction(item.secondary_action!)}
              style={({ pressed }) => [
                styles.actionBtnSecondary,
                {
                  borderColor: accent,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Text style={[styles.actionBtnSecondaryText, { color: accent }]}>
                {item.secondary_action.label}
              </Text>
            </Pressable>
          )}
          {item.action && (
            <Pressable
              onPress={() => handleAction(item.action!)}
              style={({ pressed }) => [
                styles.actionBtnPrimary,
                {
                  backgroundColor: accent,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Text style={styles.actionBtnPrimaryText}>
                {item.action.label}
              </Text>
              <ChevronRight size={14} color={tw.color.white} />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function sortItems(items: CompanionItem[]): CompanionItem[] {
  return [...items].sort(
    (a, b) => (SORT_ORDER[a.type] ?? 99) - (SORT_ORDER[b.type] ?? 99),
  );
}

function isPaydayAsk(item: CompanionItem): boolean {
  return (
    item.type === "ask" &&
    (item.action?.kind === "confirm_payday" ||
      item.headline.toLowerCase().includes("payday") ||
      item.body.toLowerCase().includes("payday"))
  );
}

export function HomeBrief({ greeting, firstName, companionItems, dark, onRefresh }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const greetingText = greeting ?? timeGreeting(firstName);

  const dismiss = useCallback(async (item: CompanionItem) => {
    setDismissed((prev) => new Set([...prev, item.id]));
    try {
      await api.dismissTodayItem(item.id);
    } catch {
      // non-fatal
    }
  }, []);

  const visible = sortItems(companionItems).filter(
    (item) => !dismissed.has(item.id),
  );

  const inkColor = dark ? tw.color.slate100 : tw.color.slate900;

  return (
    <View style={styles.container}>
      {/* Greeting line — always render even with no companion items */}
      <Text style={[styles.greeting, { color: inkColor }]}>{greetingText}</Text>

      {visible.map((item) => {
        const onDismiss = () => dismiss(item);

        if (item.type === "rhythm") {
          return (
            <RhythmCard
              key={item.id}
              item={item}
              dark={dark}
              onDismiss={onDismiss}
            />
          );
        }

        if (isPaydayAsk(item)) {
          return (
            <AskPaydayCard
              key={item.id}
              item={item}
              dark={dark}
              onDismiss={onDismiss}
              onRefresh={onRefresh}
            />
          );
        }

        return (
          <GenericItemCard
            key={item.id}
            item={item}
            dark={dark}
            onDismiss={onDismiss}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: tw.space[3],
  },
  greeting: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: tw.weight.bold,
    letterSpacing: -0.3,
  },
  card: {
    borderRadius: tw.radius["2xl"],
    padding: tw.space[4],
    borderWidth: 1,
    gap: tw.space[3],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    shadowOpacity: 0.05,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tw.space[3],
    paddingRight: tw.space[6],
  },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardTitles: {
    flex: 1,
    gap: tw.space[1],
  },
  cardHeadline: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
  },
  cardBody: {
    ...tw.text.sm,
    lineHeight: 20,
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: tw.space[2],
  },
  amountValue: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: tw.weight.bold,
  },
  amountSub: {
    ...tw.text.sm,
  },
  rhythmBtns: {
    flexDirection: "row",
    gap: tw.space[2],
    marginTop: tw.space[1],
  },
  rhythmBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tw.space[1],
    paddingVertical: tw.space[2],
    paddingHorizontal: tw.space[3],
    borderRadius: tw.radius.xl,
  },
  rhythmBtnOutline: {
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  rhythmBtnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  dismissBtn: {
    position: "absolute",
    top: tw.space[3],
    right: tw.space[3],
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  actionsRow: {
    flexDirection: "row",
    gap: tw.space[2],
    marginTop: tw.space[1],
  },
  actionBtnPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1],
    paddingVertical: tw.space[2],
    paddingHorizontal: tw.space[3],
    borderRadius: tw.radius.xl,
  },
  actionBtnPrimaryText: {
    color: tw.color.white,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  actionBtnSecondary: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: tw.space[2],
    paddingHorizontal: tw.space[3],
    borderRadius: tw.radius.xl,
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  actionBtnSecondaryText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
});
