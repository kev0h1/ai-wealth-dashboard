import { View, Text, Pressable, Image, StyleSheet } from "react-native";
import { TrendingUp } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { WhisperLabel } from "@/components/ui/WhisperLabel";
import type { Account, InvestmentAccount } from "@/lib/shared";
import { fmtBalance } from "@/lib/format";

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

function getGradient(account: Account): [string, string] {
  if (account.bg_colors && account.bg_colors.length >= 2) {
    return [account.bg_colors[0], account.bg_colors[1]];
  }
  const key = bankKey(account);
  return BANK_META[key] ?? BANK_META.DEFAULT;
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
}

function AccountMiniCard({ account, dark: _dark, hidden, onPress }: MiniCardProps) {
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
  const inkColor = dark ? "#f1f5f9" : "#0f172a";
  const cardBg = dark ? "#1e293b" : "#ffffff";
  const borderColor = dark ? "#334155" : "#f1f5f9";

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
        <WhisperLabel style={{ color: dark ? "#94a3b8" : "#64748b" }}>Accounts</WhisperLabel>
        <Pressable
          onPress={onManage}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Text style={styles.manageLink}>Manage →</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.grid}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={[styles.skeletonCard, { backgroundColor: dark ? "#334155" : "#e2e8f0" }]}
            />
          ))}
        </View>
      ) : accounts.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor }]}>
          <Text style={[styles.emptyText, { color: "#94a3b8" }]}>Connect your first bank</Text>
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
                    width: "47%",
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
                        <TrendingUp size={18} color="#ffffff" />
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
              />
            );
          })}

          {hiddenCount > 0 && (
            <Pressable
              onPress={onManage}
              style={({ pressed }) => [
                styles.moreCard,
                {
                  borderColor: dark ? "#334155" : "#e2e8f0",
                  transform: [{ scale: pressed ? 0.95 : 1 }],
                },
              ]}
            >
              <Text style={[styles.moreCount, { color: dark ? "#f1f5f9" : "#0f172a" }]}>
                +{hiddenCount}
              </Text>
              <Text style={[styles.moreLabel, { color: dark ? "#94a3b8" : "#64748b" }]}>
                more accounts
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const CARD_HEIGHT = 112;

const styles = StyleSheet.create({
  section: { gap: 12 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  manageLink: {
    color: "#6366f1",
    fontSize: 12,
    fontWeight: "600",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  skeletonCard: {
    width: "47%",
    height: CARD_HEIGHT,
    borderRadius: 16,
  },
  emptyCard: {
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    alignItems: "center",
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
  },
  ctaBtn: {
    backgroundColor: "#4f46e5",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  ctaBtnText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 14,
  },
  miniCardWrapper: {
    width: "47%",
  },
  miniCard: {
    borderRadius: 16,
    padding: 16,
    height: CARD_HEIGHT,
    justifyContent: "space-between",
  },
  miniCardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  logoContainer: {
    width: 36,
    height: 36,
    borderRadius: 12,
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
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  logoInitials: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  typeBadge: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  typeBadgeText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  miniCardMiddle: {
    gap: 1,
  },
  miniCardProvider: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  miniCardName: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
  },
  miniCardBalance: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  expiredOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  expiredText: {
    color: "#f59e0b",
    fontWeight: "700",
    fontSize: 13,
  },
  invGradientCard: {
    width: "100%",
    height: CARD_HEIGHT,
    borderRadius: 16,
    padding: 16,
    justifyContent: "space-between",
    overflow: "hidden",
    position: "relative",
  },
  invTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  invIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  invBadge: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  invBadgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  invProviderName: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
  },
  invValueText: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  invDecoCircle: {
    position: "absolute",
    bottom: -20,
    right: -20,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#ffffff",
    opacity: 0.1,
  },
  moreCard: {
    width: "47%",
    height: CARD_HEIGHT,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  moreCount: {
    fontSize: 20,
    fontWeight: "700",
  },
  moreLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
});
