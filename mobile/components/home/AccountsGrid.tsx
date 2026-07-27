import { View, Text, Pressable, Image, StyleSheet } from "react-native";
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
};

// Finexer alias map
const FINEXER_ALIAS: Record<string, string> = {
  natwest:           "NATWEST",
  chase_uk:          "CHASE",
  amex:              "AMEX",
  first_direct:      "FIRST_DIRECT",
  barclays_personal: "BARCLAYS",
  barclays:          "BARCLAYS",
  hsbc_personal:     "HSBC",
  hsbc:              "HSBC",
  monzo:             "MONZO",
  starling:          "STARLING",
  lloyds:            "LLOYDS",
  revolut:           "REVOLUT",
  santander:         "SANTANDER",
  halifax:           "HALIFAX",
  nationwide:        "NATIONWIDE",
  tsb:               "TSB",
};

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

function topPickAccounts(
  accounts: Account[],
  pinnedIds: string[],
  max = 3,
): Account[] {
  const expired = accounts.filter((a) => isExpired(a));
  const pinned = accounts.filter((a) => !isExpired(a) && pinnedIds.includes(a.id));
  const rest = accounts
    .filter((a) => !isExpired(a) && !pinnedIds.includes(a.id))
    .filter((a) => a.type === "current" || a.type === "savings")
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  return [...expired, ...pinned, ...rest].slice(0, max);
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
        {/* Provider badge */}
        <View style={styles.miniCardHeader}>
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
          <Text style={styles.miniCardProvider} numberOfLines={1}>
            {account.provider}
          </Text>
        </View>

        {/* Balance */}
        <Text style={styles.miniCardBalance}>
          {hidden ? "••••" : fmtBalance(account.balance)}
        </Text>

        {/* Type badge */}
        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>
            {account.type === "current" ? "Current" : account.type === "savings" ? "Savings" : account.type}
          </Text>
        </View>

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
  const hiddenCount = Math.max(0, accounts.length - picks.length);

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
                  style={({ pressed }) => [
                    styles.invCard,
                    {
                      backgroundColor: cardBg,
                      borderColor,
                      transform: [{ scale: pressed ? 0.95 : 1 }],
                      shadowOpacity: dark ? 0 : 0.06,
                    },
                  ]}
                >
                  <Text style={[styles.invProvider, { color: dark ? "#94a3b8" : "#64748b" }]}>
                    {firstInv.provider}
                  </Text>
                  <Text style={[styles.invValue, { color: inkColor }]}>
                    {hidden ? "••••" : fmtBalance(firstInv.total_value)}
                  </Text>
                  <Text style={[styles.invType, { color: "#94a3b8" }]}>
                    {firstInv.account_type}
                  </Text>
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
              <Text style={[styles.moreText, { color: dark ? "#94a3b8" : "#64748b" }]}>
                +{hiddenCount} more
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
  section: { gap: 10 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  manageLink: {
    color: "#4f46e5",
    fontSize: 13,
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
    padding: 14,
    height: CARD_HEIGHT,
    justifyContent: "space-between",
  },
  miniCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  logo: {
    width: 20,
    height: 20,
    borderRadius: 4,
  },
  logoFallback: {
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  logoInitials: {
    color: "#ffffff",
    fontSize: 8,
    fontWeight: "700",
  },
  miniCardProvider: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontWeight: "600",
    flex: 1,
  },
  miniCardBalance: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  typeBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  typeBadgeText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 10,
    fontWeight: "600",
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
  invCard: {
    width: "47%",
    height: CARD_HEIGHT,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
    justifyContent: "space-between",
  },
  invProvider: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  invValue: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  invType: {
    fontSize: 11,
  },
  moreCard: {
    width: "47%",
    height: CARD_HEIGHT,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  moreText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
