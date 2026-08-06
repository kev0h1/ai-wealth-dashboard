/**
 * NetWorthHeader — glass-card header for the Accounts screen.
 * Shows net worth figure, eye toggle, summary line, and context action buttons.
 */

import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Eye, EyeOff, TrendingUp, TrendingDown } from "lucide-react-native";
import { tw, HAIRLINE } from "@/lib/tw";
import type { KPIs } from "@/lib/shared";

interface NetWorthHeaderProps {
  kpis: KPIs | null;
  kpisLoading: boolean;
  hidden: boolean;
  onToggleHide: () => void;
  dark: boolean;
  bankCount: number;
  investmentCount: number;
  offlineCount: number;
  creditTotal: number;
  /** Current main tab: 0 = Banks, 1 = Investments */
  tab: number;
  onTabChange: (t: number) => void;
  /** Banks tab action buttons */
  onAddBank: () => void;
  onStatementUpload: () => void;
  onAddOffline: () => void;
  onFinexer: () => void;
  /** Investments tab action buttons */
  onInvestmentUpload: () => void;
  onAddContractNote: () => void;
}

export function NetWorthHeader({
  kpis,
  kpisLoading,
  hidden,
  onToggleHide,
  dark,
  bankCount,
  investmentCount,
  offlineCount,
  creditTotal,
  tab,
  onTabChange,
  onAddBank,
  onStatementUpload,
  onAddOffline,
  onFinexer,
  onInvestmentUpload,
  onAddContractNote,
}: NetWorthHeaderProps) {
  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const ink = dark ? tw.color.slate100 : tw.color.slate900;
  const muted = tw.color.slate400;

  const netWorth = kpis?.net_worth ?? 0;
  const netWorthStr = `£${Math.abs(netWorth).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const summaryParts: string[] = [];
  if (bankCount > 0) summaryParts.push(`${bankCount} bank`);
  if (investmentCount > 0) summaryParts.push(`${investmentCount} investment`);
  if (offlineCount > 0) summaryParts.push(`${offlineCount} offline`);

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
      {/* Title row */}
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: ink }]}>Accounts</Text>
      </View>

      {/* KPI section */}
      {kpisLoading ? (
        <View style={styles.kpiLoading}>
          <ActivityIndicator size="small" color={tw.color.indigo500} />
        </View>
      ) : kpis ? (
        <View style={styles.kpiSection}>
          <View style={styles.kpiLabelRow}>
            <Text style={[styles.kpiLabel, { color: muted }]}>Net worth</Text>
            <Pressable
              onPress={onToggleHide}
              style={({ pressed }) => [styles.eyeBtn, { opacity: pressed ? 0.6 : 1 }]}
              accessibilityLabel={hidden ? "Show balances" : "Hide balances"}
            >
              {hidden
                ? <EyeOff size={16} color={muted} />
                : <Eye size={16} color={muted} />}
            </Pressable>
          </View>
          <View style={styles.kpiValueRow}>
            <Text style={[styles.kpiValue, { color: ink }]}>
              {hidden ? "••••••" : netWorthStr}
            </Text>
            {netWorth >= 0
              ? <TrendingUp size={16} color={muted} style={styles.trendIcon} />
              : <TrendingDown size={16} color={muted} style={styles.trendIcon} />}
          </View>
          {creditTotal > 0 && !hidden && (
            <Text style={[styles.creditLine, { color: muted }]}>
              {`−£${creditTotal.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} across cards`}
            </Text>
          )}
        </View>
      ) : null}

      {/* Summary */}
      {summaryParts.length > 0 && (
        <Text style={[styles.summary, { color: muted }]}>
          {summaryParts.join(" · ")}
        </Text>
      )}

      {/* Context action buttons */}
      <View style={styles.actionRow}>
        {tab === 0 ? (
          <>
            <ActionBtn label="Add Bank" onPress={onAddBank} dark={dark} />
            <ActionBtn label="Statement" onPress={onStatementUpload} dark={dark} />
            <ActionBtn label="Offline" onPress={onAddOffline} dark={dark} />
          </>
        ) : (
          <>
            <ActionBtn label="Upload Statement" onPress={onInvestmentUpload} dark={dark} primary />
            <ActionBtn label="Add contract note" onPress={onAddContractNote} dark={dark} />
          </>
        )}
      </View>

      {/* Finexer (beta) — full width, Banks tab only */}
      {tab === 0 && (
        <Pressable
          onPress={onFinexer}
          style={({ pressed }) => [
            styles.finexerBtn,
            { opacity: pressed ? 0.7 : 1 },
            dark && styles.finexerBtnDark,
          ]}
        >
          <Text style={styles.finexerBtnText}>Finexer (beta)</Text>
        </Pressable>
      )}

      {/* Tab bar */}
      <View style={[styles.tabBar, { borderTopColor: borderColor }]}>
        {["Banks", "Investments"].map((label, i) => {
          const active = tab === i;
          return (
            <Pressable
              key={label}
              onPress={() => onTabChange(i)}
              style={[styles.tabSegment, active && styles.tabSegmentActive]}
            >
              <Text style={[
                styles.tabLabel,
                { color: active ? tw.color.indigo600 : muted },
              ]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ActionBtn({ label, onPress, dark, primary }: { label: string; onPress: () => void; dark: boolean; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionBtn,
        primary ? styles.actionBtnPrimary : [
          styles.actionBtnSecondary,
          { backgroundColor: dark ? tw.color.slate800 : tw.color.indigo50 },
        ],
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[
        styles.actionBtnText,
        { color: primary ? tw.color.white : tw.color.indigo600 },
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: tw.space[4],
    marginTop: tw.space[4],
    borderRadius: tw.radius["3xl"],
    paddingHorizontal: tw.space[4],
    paddingTop: tw.space[5],
    paddingBottom: 0,
    borderWidth: HAIRLINE,
    // shadow-sm light mode
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  titleRow: {
    marginBottom: tw.space[3],
  },
  title: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: tw.weight.bold,
  },
  kpiLoading: {
    height: 56,
    justifyContent: "center",
    alignItems: "flex-start",
    marginBottom: tw.space[2],
  },
  kpiSection: {
    marginBottom: tw.space[2],
  },
  kpiLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    marginBottom: tw.space[1],
  },
  kpiLabel: {
    ...tw.text["10"],
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.wide, 10),
  },
  eyeBtn: {
    padding: tw.space[1],
  },
  kpiValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
  },
  kpiValue: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: tw.weight.bold,
    letterSpacing: tw.tracking(tw.trackingEm.tight, 30),
  },
  trendIcon: {
    marginTop: 2,
  },
  creditLine: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
    marginTop: tw.space[1],
  },
  summary: {
    ...tw.text.sm,
    marginBottom: tw.space[3],
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tw.space[2],
    marginBottom: tw.space[2],
  },
  actionBtn: {
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[1.5],
    borderRadius: tw.radius.xl,
  },
  actionBtnPrimary: {
    backgroundColor: tw.color.indigo600,
  },
  actionBtnSecondary: {},
  actionBtnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  finexerBtn: {
    backgroundColor: tw.color.indigo50,
    borderRadius: tw.radius.xl,
    paddingVertical: tw.space[2],
    alignItems: "center",
    marginBottom: tw.space[3],
  },
  finexerBtnDark: {
    backgroundColor: tw.color.slate800,
  },
  finexerBtnText: {
    color: tw.color.indigo600,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: HAIRLINE,
    marginTop: tw.space[1],
  },
  tabSegment: {
    flex: 1,
    paddingVertical: tw.space[3],
    alignItems: "center",
  },
  tabSegmentActive: {
    borderBottomWidth: 2,
    borderBottomColor: tw.color.indigo600,
  },
  tabLabel: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
});
