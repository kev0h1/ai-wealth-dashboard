import { View, Text, Pressable, Image, StyleSheet, useWindowDimensions } from "react-native";
import { TrendingUp, ChevronRight } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { WhisperLabel } from "@/components/ui/WhisperLabel";
import type { Account, InvestmentAccount } from "@/lib/shared";
import { fmtBalance } from "@/lib/format";
import { tw, HAIRLINE } from "@/lib/tw";

interface Props {
  accounts: Account[];
  investmentAccounts: InvestmentAccount[];
  loading: boolean;
  dark: boolean;
  hidden: boolean;
  pinnedIds: string[];
  onManage: () => void;
  onAccountPress: (id: string) => void;
  onInvestmentsPress: () => void;
}

// BANK_META: gradient colors for each bank [from, to]
const BANK_META: Record<string, [string, string]> = {
  BARCLAYS:     ["#00aeef", "#002d72"],
  NATWEST:      ["#5a0069", "#d9006c"],
  HSBC:         ["#db0011", "#6b0008"],
  MONZO:        ["#ff3464", "#ff6b35"],
  STARLING:     ["#6935d8", "#00d4aa"],
  LLOYDS:       ["#024731", "#006a4d"],
  AMEX:         ["#007bc1", "#003f6b"],
  REVOLUT:      ["#191c1f", "#3d4451"],
  SANTANDER:    ["#ec0000", "#8b0000"],
  HALIFAX:      ["#1c5aa0", "#003580"],
  NATIONWIDE:   ["#1a2e6b", "#3c5fa0"],
  CHASE:        ["#117aca", "#003087"],
  FIRST_DIRECT: ["#111111", "#444444"],
  TSB:          ["#006ab0", "#003f6b"],
  DEFAULT:      ["#2563eb", "#1d4ed8"],
};

// Logo domains for google favicon
const LOGO_DOMAINS: Record<string, string> = {
  MONZO:        "monzo.com",
  REVOLUT:      "revolut.com",
  SANTANDER:    "santander.co.uk",
  HALIFAX:      "halifax.co.uk",
  NATIONWIDE:   "nationwide.co.uk",
  CHASE:        "chase.co.uk",
  FIRST_DIRECT: "firstdirect.com",
  TSB:          "tsb.co.uk",
  HSBC:         "hsbc.co.uk",
  BARCLAYS:     "barclays.co.uk",
  NATWEST:      "natwest.com",
  STARLING:     "starlingbank.com",
  LLOYDS:       "lloydsbank.com",
  AMEX:         "americanexpress.com",
};

// Finexer alias map
const FINEXER_ALIAS: Record<string, string> = {
  natwest:               "NATWEST",
  natwest_bankline:      "NATWEST",
  natwest_clearspend:    "NATWEST",
  rbs:                   "NATWEST",
  rbs_bankline:          "NATWEST",
  rbs_clearspend:        "NATWEST",
  chase_uk:              "CHASE",
  amex:                  "AMEX",
  first_direct:          "FIRST_DIRECT",
  barclays_personal:     "BARCLAYS",
  barclays:              "BARCLAYS",
  barclays_business:     "BARCLAYS",
  barclays_corporate:    "BARCLAYS",
  barclays_wealth:       "BARCLAYS",
  barclaycard_uk:        "BARCLAYS",
  barclaycard_bcp:       "BARCLAYS",
  hsbc_personal:         "HSBC",
  hsbc:                  "HSBC",
  hsbc_business:         "HSBC",
  hsbc_kinetic:          "HSBC",
  hsbc_net:              "HSBC",
  hsbc_ms:               "HSBC",
  monzo:                 "MONZO",
  starling:              "STARLING",
  lloyds:                "LLOYDS",
  lloyds_personal:       "LLOYDS",
  lloyds_business:       "LLOYDS",
  lloyds_commercial:     "LLOYDS",
  revolut:               "REVOLUT",
  santander:             "SANTANDER",
  santander_business:    "SANTANDER",
  santander_corporate:   "SANTANDER",
  halifax:               "HALIFAX",
  nationwide:            "NATIONWIDE",
  tsb:                   "TSB",
};

// Investment provider gradient colours [from, to]
const INV_META: Record<string, [string, string]> = {
  VANGUARD:              ["#8b0000","#c0392b"],
  WEALTHIFY:             ["#006d6d","#00a896"],
  "HARGREAVES LANSDOWN": ["#002d72","#0057c2"],
  HL:                    ["#002d72","#0057c2"],
  FIDELITY:              ["#7b3f00","#c0602a"],
  "AJ BELL":             ["#003087","#c0932a"],
  NUTMEG:                ["#1a1a2e","#e94560"],
  MONEYBOX:              ["#1b4f72","#2e86c1"],
  TRADING212:            ["#006400","#228b22"],
  FREETRADE:             ["#1a0a4a","#5e35b1"],
};

const INV_DEFAULT: [string, string] = ["#3730a3","#4f46e5"];

function investmentGradient(provider: string): [string, string] {
  const key = provider.toUpperCase().replace(/[\s-]+/g, " ").trim();
  return INV_META[key] ?? INV_DEFAULT;
}

function bankKey(account: Account): string {
  const pid = (account.provider_id ?? "").toLowerCase();
  if (FINEXER_ALIAS[pid]) return FINEXER_ALIAS[pid];
  const norm = (account.provider ?? "").toUpperCase().replace(/[^A-Z]/g, "_");
  return norm in BANK_META ? norm : "DEFAULT";
}

/** Parse "#RRGGBB" or "#RGB" → [r,g,b] 0-255. Returns null on failure. */
function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

/** Darken RGB triple by factor (0-1). Returns "rgb(r,g,b)" string. */
function darkenRgb([r, g, b]: [number, number, number], factor: number): string {
  return `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`;
}

/**
 * Resolve gradient colours for a bank card.
 * Priority (mirrors web AccountMiniCard.tsx accountBrand()):
 *   1. Curated BANK_META (vivid brand gradients) — when bankKey resolves to a known non-DEFAULT key.
 *   2. Finexer bg_colors[0..1] — when >= 2 dynamic colours provided.
 *   3. Finexer bg_colors[0] darkened — when exactly 1 dynamic colour provided.
 *   4. BANK_META.DEFAULT fallback.
 */
function getGradient(account: Account): [string, string] {
  // 1. Curated brand entry (BANK_META priority, same as web)
  const key = bankKey(account);
  if (key !== "DEFAULT" && BANK_META[key]) {
    return BANK_META[key];
  }
  // 2. Finexer dynamic bg_colors — two stops
  if (account.bg_colors && account.bg_colors.length >= 2) {
    return [account.bg_colors[0], account.bg_colors[1]];
  }
  // 3. Finexer dynamic bg_colors — single colour, derive darker second stop
  if (account.bg_colors && account.bg_colors.length === 1) {
    const rgb = hexToRgb(account.bg_colors[0]);
    const darker = rgb ? darkenRgb(rgb, 0.62) : account.bg_colors[0];
    return [account.bg_colors[0], darker];
  }
  // 4. Default
  return BANK_META.DEFAULT;
}

function getLogoUrl(account: Account): string | null {
  const key = bankKey(account);
  const domain = LOGO_DOMAINS[key];
  if (domain) return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  return null;
}

function getInitials(account: Account): string {
  const name = account.provider || account.name || "?";
  return name.slice(0, 2).toUpperCase();
}

function isExpired(account: Account): boolean {
  return account.status === "expired" || account.status === "reconnect_required";
}

function typeLabel(account: Account): string {
  const type = account.type.toLowerCase();
  const sub = (account.subtype ?? "").toLowerCase();
  if (type.includes("credit") || sub.includes("credit")) return "Credit";
  if (sub.includes("isa")) return "ISA";
  if (sub.includes("saving")) return "Savings";
  return "Current";
}

function topPickAccounts(accounts: Account[], pinnedIds: string[], max = 3): Account[] {
  const picks: Account[] = [];
  const seen = new Set<string>();
  const add = (a?: Account) => {
    if (a && !seen.has(a.id)) { seen.add(a.id); picks.push(a); }
  };
  accounts.filter(a => isExpired(a)).forEach(add);
  pinnedIds.forEach(id => add(accounts.find(a => a.id === id)));
  const isSavings = (a: Account) => (a.subtype ?? "").toLowerCase().includes("saving");
  const isCredit = (a: Account) => a.type.toLowerCase().includes("credit") || (a.subtype ?? "").toLowerCase().includes("credit");
  const current = accounts.filter(a => !isSavings(a) && !isCredit(a)).sort((x, y) => y.balance - x.balance);
  const savings = accounts.filter(isSavings).sort((x, y) => y.balance - x.balance);
  for (const a of [...current, ...savings]) { if (picks.length >= max) break; add(a); }
  return picks.slice(0, max);
}

interface MiniCardProps {
  account: Account;
  dark: boolean;
  hidden: boolean;
  onPress: () => void;
  cellWidth?: number;
}

function AccountMiniCard({ account, dark: _dark, hidden, onPress, cellWidth }: MiniCardProps) {
  const [from, to] = getGradient(account);
  const logoUrl = getLogoUrl(account);
  const initials = getInitials(account);
  const expired = isExpired(account);
  const label = typeLabel(account);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.miniCardWrapper,
        cellWidth !== undefined ? { width: cellWidth } : undefined,
        { transform: [{ scale: pressed ? 0.95 : 1 }] },
      ]}
    >
      <LinearGradient
        colors={[from, to] as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.miniCard}
      >
        {/* Top row: logo left, type badge right */}
        <View style={styles.miniCardTopRow}>
          <View style={styles.logoContainer}>
            {logoUrl ? (
              <Image
                source={{ uri: logoUrl }}
                style={styles.logo}
              />
            ) : (
              <View style={styles.logoFallback}>
                <Text style={styles.logoInitials}>{initials}</Text>
              </View>
            )}
          </View>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>{label}</Text>
          </View>
        </View>

        {/* Provider + account name */}
        <View style={styles.miniCardMiddle}>
          <Text style={styles.miniCardProvider} numberOfLines={1}>
            {account.provider}
          </Text>
          <Text style={styles.miniCardName} numberOfLines={1}>
            {account.name}
          </Text>
        </View>

        {/* Balance bottom */}
        <Text style={styles.miniCardBalance}>
          {hidden ? "••••" : fmtBalance(account.balance)}
        </Text>

        {/* Expired overlay */}
        {expired && (
          <View style={styles.expiredOverlay}>
            <Text style={styles.expiredText}>Reconnect</Text>
          </View>
        )}
      </LinearGradient>
    </Pressable>
  );
}

export function AccountsGrid({
  accounts,
  investmentAccounts,
  loading,
  dark,
  hidden,
  pinnedIds,
  onManage,
  onAccountPress,
  onInvestmentsPress,
}: Props) {
  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;

  const { width: winW } = useWindowDimensions();
  const gutter = Math.max(0, (winW - 430) / 2) + tw.space[4];
  const cellW = (winW - gutter * 2 - tw.space[3]) / 2;

  const picks = topPickAccounts(accounts, pinnedIds, 3);
  const firstInv = investmentAccounts[0] ?? null;
  const hiddenCount = Math.max(0, accounts.length - picks.length) + Math.max(0, investmentAccounts.length - 1);

  // Build grid items: picks + investment card
  const gridItems: ("inv" | Account)[] = [...picks];
  if (firstInv) gridItems.push("inv");

  return (
    <View style={styles.section}>
      {/* Header */}
      <View style={styles.sectionHeader}>
        <WhisperLabel style={{ color: dark ? tw.color.slate400 : tw.color.slate500 }}>Accounts</WhisperLabel>
        <Pressable
          onPress={onManage}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <View style={styles.manageRow}>
            <Text style={[styles.manageText, { color: dark ? tw.color.indigo400 : tw.color.indigo500 }]}>Manage</Text>
            <ChevronRight size={14} color={dark ? tw.color.indigo400 : tw.color.indigo500} />
          </View>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.grid}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={[styles.skeletonCard, { backgroundColor: dark ? tw.color.cardBorderDark : tw.color.slate200, width: cellW }]}
            />
          ))}
        </View>
      ) : accounts.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor }]}>
          <Text style={[styles.emptyText, { color: tw.color.slate400 }]}>Connect your first bank</Text>
          <Pressable
            onPress={onManage}
            style={({ pressed }) => [
              styles.ctaBtn,
              { transform: [{ scale: pressed ? 0.95 : 1 }] },
            ]}
          >
            <Text style={styles.ctaBtnText}>Add account</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.grid}>
          {gridItems.map((item, idx) => {
            if (item === "inv" && firstInv) {
              return (
                <Pressable
                  key="inv"
                  onPress={onInvestmentsPress}
                  style={({ pressed }) => ({
                    transform: [{ scale: pressed ? 0.95 : 1 }],
                    width: cellW,
                  })}
                >
                  <LinearGradient
                    colors={investmentGradient(firstInv.provider)}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.invGradientCard}
                  >
                    {/* Top row */}
                    <View style={styles.invTopRow}>
                      <View style={styles.invIconBox}>
                        <TrendingUp size={18} color={tw.color.white} />
                      </View>
                      <View style={styles.invBadge}>
                        <Text style={styles.invBadgeText}>
                          {firstInv.account_type || "Investment"}
                        </Text>
                      </View>
                    </View>

                    {/* Provider name */}
                    <Text style={styles.invProviderName} numberOfLines={1}>
                      {firstInv.provider}
                    </Text>

                    {/* Height spacer — mirrors miniCardName row so both cards are identical height */}
                    <Text style={styles.invNameSpacer} />

                    {/* Value */}
                    <Text style={styles.invValueText}>
                      {hidden ? "••••" : fmtBalance(firstInv.total_value)}
                    </Text>

                    {/* Decorative circle */}
                    <View style={styles.invDecoCircle} pointerEvents="none" />
                  </LinearGradient>
                </Pressable>
              );
            }
            const account = item as Account;
            return (
              <AccountMiniCard
                key={account.id}
                account={account}
                dark={dark}
                hidden={hidden}
                onPress={() => onAccountPress(account.id)}
                cellWidth={cellW}
              />
            );
          })}

          {hiddenCount > 0 && (
            <Pressable
              onPress={onManage}
              style={({ pressed }) => [
                styles.moreCard,
                {
                  borderColor: dark ? tw.color.cardBorderDark : tw.color.slate200,
                  width: cellW,
                  transform: [{ scale: pressed ? 0.95 : 1 }],
                },
              ]}
            >
              <Text style={[styles.moreCount, { color: dark ? tw.color.slate100 : tw.color.slate900 }]}>
                +{hiddenCount}
              </Text>
              <Text style={[styles.moreLabel, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
                more accounts
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const CARD_MIN = 124;

const styles = StyleSheet.create({
  section: { gap: tw.space[3] },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  manageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1],
  },
  manageText: {
    ...tw.text.xs,
    fontWeight: tw.weight.semibold,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tw.space[3],
  },
  skeletonCard: {
    minHeight: CARD_MIN,
    borderRadius: tw.radius["2xl"],
  },
  emptyCard: {
    borderRadius: tw.radius["2xl"],
    padding: tw.space[6],
    borderWidth: 1,
    alignItems: "center",
    gap: tw.space[3],
  },
  emptyText: {
    ...tw.text.sm,
  },
  ctaBtn: {
    backgroundColor: tw.color.indigo600,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: tw.radius.xl,
  },
  ctaBtnText: {
    color: tw.color.white,
    fontWeight: tw.weight.semibold,
    ...tw.text.sm,
  },
  miniCardWrapper: {},
  miniCard: {
    borderRadius: tw.radius["2xl"],
    padding: tw.space[4],
    minHeight: CARD_MIN,
    overflow: "hidden",
  },
  miniCardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: tw.space[3],
  },
  logoContainer: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    backgroundColor: "rgba(255,255,255,0.95)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 4,
  },
  logoFallback: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  logoInitials: {
    color: tw.color.white,
    ...tw.text.xs,
    fontWeight: tw.weight.bold,
  },
  typeBadge: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: tw.space[2],
    paddingVertical: tw.space[0.5],
    borderRadius: tw.radius.full,
  },
  typeBadgeText: {
    color: "rgba(255,255,255,0.9)",
    ...tw.text["10"],
    fontWeight: tw.weight.bold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.wide, 10),
  },
  miniCardMiddle: {
    marginBottom: tw.space[0.5],
  },
  miniCardProvider: {
    color: "rgba(255,255,255,0.6)",
    ...tw.text["10"],
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.widest, 10),
    marginBottom: tw.space[0.5],
  },
  miniCardName: {
    color: "rgba(255,255,255,0.75)",
    ...tw.text["11"],
    marginBottom: tw.space[1],
  },
  miniCardBalance: {
    color: tw.color.white,
    fontSize: 20,
    lineHeight: tw.leadingNone(20),
    fontWeight: tw.weight.bold,
    letterSpacing: tw.tracking(tw.trackingEm.tight, 20),
  },
  expiredOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: tw.radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  expiredText: {
    color: tw.color.amber500,
    fontWeight: tw.weight.bold,
    ...tw.text.sm,
  },
  invGradientCard: {
    width: "100%",
    minHeight: CARD_MIN,
    borderRadius: tw.radius["2xl"],
    padding: tw.space[4],
    overflow: "hidden",
    position: "relative",
  },
  invTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: tw.space[3],
  },
  invIconBox: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  invBadge: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: tw.radius.full,
    paddingHorizontal: tw.space[2],
    paddingVertical: tw.space[0.5],
  },
  invBadgeText: {
    color: tw.color.white,
    ...tw.text["10"],
    fontWeight: tw.weight.bold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.wide, 10),
  },
  invProviderName: {
    color: "rgba(255,255,255,0.6)",
    ...tw.text["10"],
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.widest, 10),
    marginBottom: tw.space[0.5],
  },
  invNameSpacer: {
    ...tw.text["11"],
    marginBottom: tw.space[1],
  },
  invValueText: {
    color: tw.color.white,
    fontSize: 20,
    lineHeight: tw.leadingNone(20),
    fontWeight: tw.weight.bold,
    letterSpacing: tw.tracking(tw.trackingEm.tight, 20),
  },
  invDecoCircle: {
    position: "absolute",
    bottom: -20,
    right: -20,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: tw.color.white,
    opacity: 0.1,
  },
  moreCard: {
    minHeight: CARD_MIN,
    borderRadius: tw.radius["2xl"],
    borderWidth: 2,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: tw.space[1],
  },
  moreCount: {
    ...tw.text.lg,
    fontWeight: tw.weight.bold,
  },
  moreLabel: {
    ...tw.text.xs,
    fontWeight: tw.weight.medium,
  },
});

// suppress unused import warning — HAIRLINE is re-exported for consumers
void HAIRLINE;
