/**
 * Accounts screen — complete estate view.
 * Banks tab: connected accounts (2-col grid) + offline accounts list.
 * Investments tab: collapsible investment account cards.
 * Supports ?tab=Investments query param (deep-link from Home).
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  ActivityIndicator, useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import {
  AlertTriangle, RefreshCw, Landmark, ChevronRight,
} from "lucide-react-native";
import { tw, HAIRLINE } from "@/lib/tw";

const EXT = {
  amber200: "#fde68a",
  amber800: "#92400e",
  indigo200: "#c7d2fe",
  indigo800: "#3730a3",
  rose500: "#f43f5e",
} as const;
import { api } from "@/lib/api";
import { accountsApi } from "@/lib/api/accounts";
import { usePreferences } from "@/lib/PreferencesContext";
import { useTheme } from "@/lib/ThemeContext";
import type { Account, ManualAccount, KPIs } from "@/lib/shared";
import { AccountMiniCard, isCreditAccount, typeLabel } from "@/components/accounts/AccountMiniCard";
import { NetWorthHeader } from "@/components/accounts/NetWorthHeader";
import { InvestmentSection } from "@/components/accounts/InvestmentSection";
import { BankPickerSheet } from "@/components/accounts/BankPickerSheet";
import { StatementUploadSheet } from "@/components/accounts/StatementUploadSheet";
import { InvestmentUploadSheet } from "@/components/accounts/InvestmentUploadSheet";
import { AccountDetailSheet } from "@/components/accounts/AccountDetailSheet";
import type { TermsPill } from "@/lib/api/accounts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function termsPillFor(cardTerms: import("@/lib/api/accounts").CardTermsCard | undefined): TermsPill | null {
  const t = cardTerms?.terms;
  if (!t || t.status !== "confirmed") return null;
  const now = Date.now();
  const active = (t.promos ?? [])
    .map(p => ({ ...p, end: new Date(`${p.until}T00:00:00`) }))
    .filter(p => Math.ceil((p.end.getTime() - now) / 86_400_000) >= 0)
    .sort((a, b) => a.end.getTime() - b.end.getTime());
  if (active.length > 0) {
    const soonest = active[0];
    const days = Math.ceil((soonest.end.getTime() - now) / 86_400_000);
    const rateStr = `${soonest.apr_pct}%`;
    let label = days <= 60
      ? `${rateStr} ends ${soonest.end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
      : `${rateStr} until ${soonest.end.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`;
    if (active.length > 1) label += ` · +${active.length - 1}`;
    return { label, amber: days <= 60 };
  }
  if (t.apr_pct != null) return { label: `${t.apr_pct}% APR` };
  return null;
}

function groupAccounts(accounts: Account[]) {
  const current: Account[] = [];
  const savings: Account[] = [];
  const credit: Account[] = [];
  for (const a of accounts) {
    const t = a.type.toLowerCase();
    const s = (a.subtype ?? "").toLowerCase();
    if (t.includes("credit") || s.includes("credit")) credit.push(a);
    else if (t.includes("saving") || s.includes("saving") || s.includes("isa")) savings.push(a);
    else current.push(a);
  }
  return { current, savings, credit };
}

// ── Alert banner ──────────────────────────────────────────────────────────────

function AlertBanner({ type, message, onDismiss }: {
  type: "syncing" | "reconnect" | "expired";
  message: string;
  onDismiss?: () => void;
}) {
  const colors = {
    syncing: { bg: tw.color.indigo50, border: EXT.indigo200, text: EXT.indigo800 },
    reconnect: { bg: tw.color.rose50, border: tw.color.rose300, text: tw.color.rose700 },
    expired: { bg: tw.color.amber50, border: EXT.amber200, text: EXT.amber800 },
  }[type];

  return (
    <View style={[styles.alertBanner, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      {type === "syncing"
        ? <ActivityIndicator size="small" color={tw.color.indigo500} />
        : <AlertTriangle size={14} color={colors.text} />}
      <Text style={[styles.alertText, { color: colors.text }]} numberOfLines={2}>{message}</Text>
      {onDismiss && (
        <Pressable onPress={onDismiss} style={styles.alertDismiss}>
          <Text style={[styles.alertDismissText, { color: colors.text }]}>×</Text>
        </Pressable>
      )}
    </View>
  );
}

// ── Offline account row ───────────────────────────────────────────────────────

function OfflineAccountRow({ account, dark, onPress }: {
  account: ManualAccount;
  dark: boolean;
  onPress: () => void;
}) {
  const ink = dark ? tw.color.slate100 : tw.color.slate900;
  const muted = tw.color.slate400;
  const isCredit = account.account_type === "credit_card";
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.offlineRow,
        { backgroundColor: dark ? tw.color.cardDark : tw.color.cardLight, borderColor: dark ? tw.color.cardBorderDark : tw.color.cardBorderLight },
        { opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <View style={[styles.offlineIconBox, { backgroundColor: dark ? tw.color.slate700 : tw.color.slate100 }]}>
        <Landmark size={18} color={dark ? tw.color.slate300 : tw.color.slate600} />
      </View>
      <View style={styles.offlineMeta}>
        <Text style={[styles.offlineName, { color: ink }]} numberOfLines={1}>{account.name}</Text>
        <Text style={[styles.offlineType, { color: muted }]}>
          {account.account_type.replace("_", " ")} · Offline
        </Text>
      </View>
      <Text style={[styles.offlineBalance, { color: isCredit ? EXT.rose500 : ink }]}>
        {isCredit ? "−" : ""}£{Math.abs(account.balance).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
      </Text>
      <ChevronRight size={16} color={muted} />
    </Pressable>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function AccountsScreen() {
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const { dark } = useTheme();
  const { hideNetWorth, setHideNetWorth, region, rawPrefs } = usePreferences();
  const params = useLocalSearchParams<{ tab?: string }>();

  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const ink = dark ? tw.color.slate100 : tw.color.slate900;
  const muted = tw.color.slate400;

  // ── Tab: 0 = Banks, 1 = Investments ────────────────────────────────────────
  const [tab, setTab] = useState(() => params.tab === "Investments" ? 1 : 0);

  // ── Data state ──────────────────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [manualAccounts, setManualAccounts] = useState<ManualAccount[]>([]);
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [cardTermsMap, setCardTermsMap] = useState<Record<string, import("@/lib/api/accounts").CardTermsCard>>({});
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [reconnectDismissed, setReconnectDismissed] = useState(false);
  const [invReloadKey, setInvReloadKey] = useState(0);

  // ── Sheet visibility ────────────────────────────────────────────────────────
  const [bankPickerOpen, setBankPickerOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  const [investmentUploadOpen, setInvestmentUploadOpen] = useState(false);
  const [detailAccount, setDetailAccount] = useState<Account | ManualAccount | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  // ── Grid cell width ─────────────────────────────────────────────────────────
  const gutter = Math.max(0, (winW - 430) / 2) + tw.space[4];
  const cellW = (winW - gutter * 2 - tw.space[3]) / 2;

  // ── Loaders ─────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [accs, manual] = await Promise.all([
        api.accounts(),
        accountsApi.manualAccounts(),
      ]);
      setAccounts(accs);
      setManualAccounts(manual);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  const loadKpis = useCallback(async () => {
    setKpisLoading(true);
    try {
      const k = await api.kpis();
      setKpis(k);
    } catch {
      // non-fatal
    } finally {
      setKpisLoading(false);
    }
  }, []);

  const loadCardTerms = useCallback(async () => {
    try {
      const { cards } = await accountsApi.getCardTerms();
      const map: Record<string, import("@/lib/api/accounts").CardTermsCard> = {};
      for (const c of cards) map[c.account_id] = c;
      setCardTermsMap(map);
    } catch {
      // non-fatal
    }
  }, []);

  const loadPinnedIds = useCallback(() => {
    const pinned = (rawPrefs?.home_pinned_accounts as string[] | undefined) ?? [];
    setPinnedIds(pinned);
  }, [rawPrefs]);

  useEffect(() => {
    loadAll();
    loadKpis();
    loadCardTerms();
  }, [loadAll, loadKpis, loadCardTerms]);

  useEffect(() => {
    loadPinnedIds();
  }, [loadPinnedIds]);

  // ── Deep-link: ?tab=Investments ─────────────────────────────────────────────
  useEffect(() => {
    if (params.tab === "Investments") setTab(1);
  }, [params.tab]);

  // ── Derived data ─────────────────────────────────────────────────────────────
  const { current, savings, credit } = groupAccounts(accounts);
  const connectedAccounts = [...current, ...savings, ...credit];
  const expiredAccounts = accounts.filter(a => a.status === "expired" || a.status === "reconnect_required");
  const hasReconnect = !reconnectDismissed && expiredAccounts.length > 0;
  const creditTotal = credit.reduce((s, a) => s + Math.abs(Math.min(0, a.balance)), 0);

  // ── Pin toggle ────────────────────────────────────────────────────────────────
  async function handleTogglePin(accountId: string) {
    const next = pinnedIds.includes(accountId)
      ? pinnedIds.filter(id => id !== accountId)
      : pinnedIds.length < 3 ? [...pinnedIds, accountId] : pinnedIds;
    setPinnedIds(next);
    try {
      await accountsApi.updatePinnedAccounts(next);
    } catch {
      // revert on failure
      loadPinnedIds();
    }
  }

  // ── Reconnect via Finexer OAuth ───────────────────────────────────────────────
  async function handleReconnect(account: Account) {
    try {
      const { auth_url } = await accountsApi.finexerConnectLink();
      await openBrowserAsync(auth_url, { presentationStyle: 1, showTitle: false });
      // Poll for reconnect
      await loadAll();
    } catch {
      // non-fatal
    }
  }

  // ── Delete account ────────────────────────────────────────────────────────────
  async function handleDeleteAccount(id: string) {
    try {
      const manual = manualAccounts.find(m => m.id === id);
      if (manual) {
        await accountsApi.deleteManualAccount(id);
        setManualAccounts(prev => prev.filter(m => m.id !== id));
      } else {
        await api.deleteAccount(id);
        setAccounts(prev => prev.filter(a => a.id !== id));
      }
      loadKpis();
    } catch {
      // non-fatal
    }
  }

  // ── Open detail ───────────────────────────────────────────────────────────────
  function openDetail(account: Account | ManualAccount) {
    setDetailAccount(account);
    setDetailVisible(true);
  }

  // ── Create offline account ─────────────────────────────────────────────────────
  async function handleAddOffline() {
    // Minimal inline creation — full modal deferred post-MVP
    try {
      const acc = await accountsApi.createManualAccount({
        name: "New Account",
        balance: 0,
        account_type: "savings",
      });
      setManualAccounts(prev => [...prev, acc]);
      openDetail(acc);
    } catch {
      // non-fatal
    }
  }

  // ── Account section renderer ──────────────────────────────────────────────────
  function renderAccountGroup(label: string, items: Account[]) {
    if (items.length === 0) return null;
    return (
      <View style={styles.group} key={label}>
        {items.map((account, idx) => (
          <AccountMiniCard
            key={account.id}
            account={account}
            hidden={hideNetWorth}
            dark={dark}
            onPress={() => openDetail(account)}
            pinned={pinnedIds.includes(account.id)}
            onTogglePin={() => handleTogglePin(account.id)}
            onReconnect={() => handleReconnect(account)}
            termsPill={termsPillFor(cardTermsMap[account.id])}
            style={{ width: cellW }}
          />
        ))}
      </View>
    );
  }

  // ── Section header label ────────────────────────────────────────────────────
  function SectionLabel({ label }: { label: string }) {
    return (
      <Text style={[styles.sectionLabel, { color: muted }]}>{label.toUpperCase()}</Text>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: dark ? tw.color.canvasDark : tw.color.canvasLight }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + tw.space[8] }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header card */}
        <NetWorthHeader
          kpis={kpis}
          kpisLoading={kpisLoading}
          hidden={hideNetWorth}
          onToggleHide={() => setHideNetWorth(!hideNetWorth)}
          dark={dark}
          bankCount={connectedAccounts.length}
          investmentCount={0 /* loaded inside InvestmentSection */}
          offlineCount={manualAccounts.length}
          creditTotal={creditTotal}
          tab={tab}
          onTabChange={setTab}
          onAddBank={() => setBankPickerOpen(true)}
          onStatementUpload={() => setStatementOpen(true)}
          onAddOffline={handleAddOffline}
          onFinexer={async () => {
            try {
              const { auth_url } = await accountsApi.finexerConnectLink();
              await openBrowserAsync(auth_url, { presentationStyle: 1, showTitle: false });
              loadAll();
            } catch {}
          }}
          onInvestmentUpload={() => setInvestmentUploadOpen(true)}
          onAddContractNote={() => setInvestmentUploadOpen(true)}
        />

        {/* Alert banners */}
        {tab === 0 && (
          <View style={styles.banners}>
            {syncing && (
              <AlertBanner type="syncing" message="Syncing your accounts…" />
            )}
            {hasReconnect && (
              <AlertBanner
                type="reconnect"
                message={`${expiredAccounts.length} account${expiredAccounts.length !== 1 ? "s" : ""} need reconnecting`}
                onDismiss={() => setReconnectDismissed(true)}
              />
            )}
          </View>
        )}

        {/* Banks tab */}
        {tab === 0 && (
          <View style={styles.tabSection}>
            {loading ? (
              <View style={styles.centeredLoader}>
                <ActivityIndicator color={tw.color.indigo500} />
              </View>
            ) : connectedAccounts.length === 0 && manualAccounts.length === 0 ? (
              /* Empty state */
              <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor }]}>
                <View style={[styles.emptyIconBox, { backgroundColor: dark ? tw.color.slate700 : tw.color.indigo50 }]}>
                  <Landmark size={28} color={tw.color.indigo600} />
                </View>
                <Text style={[styles.emptyHeading, { color: ink }]}>No banks connected</Text>
                <Text style={[styles.emptyBody, { color: muted }]}>
                  Connect your bank via open banking, upload a statement, or add an offline account.
                </Text>
                <Pressable
                  onPress={() => setBankPickerOpen(true)}
                  style={({ pressed }) => [styles.emptyPrimaryBtn, { opacity: pressed ? 0.8 : 1 }]}
                >
                  <Text style={styles.emptyPrimaryBtnText}>Add Bank</Text>
                </Pressable>
                <Pressable
                  onPress={() => setStatementOpen(true)}
                  style={({ pressed }) => [styles.emptySecondaryBtn, { opacity: pressed ? 0.7 : 1, borderColor }]}
                >
                  <Text style={[styles.emptySecondaryBtnText, { color: ink }]}>Upload Statement</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.accountsContent}>
                {/* Current accounts */}
                {current.length > 0 && (
                  <>
                    <SectionLabel label="Current" />
                    <View style={styles.grid}>
                      {current.map(account => (
                        <AccountMiniCard
                          key={account.id}
                          account={account}
                          hidden={hideNetWorth}
                          dark={dark}
                          onPress={() => openDetail(account)}
                          pinned={pinnedIds.includes(account.id)}
                          onTogglePin={() => handleTogglePin(account.id)}
                          onReconnect={() => handleReconnect(account)}
                          termsPill={termsPillFor(cardTermsMap[account.id])}
                          style={{ width: cellW }}
                        />
                      ))}
                    </View>
                  </>
                )}

                {/* Savings */}
                {savings.length > 0 && (
                  <>
                    <SectionLabel label="Savings" />
                    <View style={styles.grid}>
                      {savings.map(account => (
                        <AccountMiniCard
                          key={account.id}
                          account={account}
                          hidden={hideNetWorth}
                          dark={dark}
                          onPress={() => openDetail(account)}
                          pinned={pinnedIds.includes(account.id)}
                          onTogglePin={() => handleTogglePin(account.id)}
                          onReconnect={() => handleReconnect(account)}
                          termsPill={termsPillFor(cardTermsMap[account.id])}
                          style={{ width: cellW }}
                        />
                      ))}
                    </View>
                  </>
                )}

                {/* Credit cards */}
                {credit.length > 0 && (
                  <>
                    <SectionLabel label="Credit" />
                    <View style={styles.grid}>
                      {credit.map(account => (
                        <AccountMiniCard
                          key={account.id}
                          account={account}
                          hidden={hideNetWorth}
                          dark={dark}
                          onPress={() => openDetail(account)}
                          pinned={pinnedIds.includes(account.id)}
                          onTogglePin={() => handleTogglePin(account.id)}
                          onReconnect={() => handleReconnect(account)}
                          termsPill={termsPillFor(cardTermsMap[account.id])}
                          style={{ width: cellW }}
                        />
                      ))}
                    </View>
                  </>
                )}

                {/* Offline accounts */}
                <View style={styles.offlineSection}>
                  <View style={styles.offlineSectionHeader}>
                    <View>
                      <Text style={[styles.offlineSectionTitle, { color: ink }]}>Offline accounts</Text>
                      <Text style={[styles.offlineSectionSub, { color: muted }]}>
                        Manual balance tracking
                      </Text>
                    </View>
                  </View>
                  {manualAccounts.length === 0 ? (
                    <Text style={[styles.offlineEmpty, { color: muted }]}>No offline accounts yet.</Text>
                  ) : (
                    <View style={styles.offlineList}>
                      {manualAccounts.map(acc => (
                        <OfflineAccountRow
                          key={acc.id}
                          account={acc}
                          dark={dark}
                          onPress={() => openDetail(acc)}
                        />
                      ))}
                    </View>
                  )}
                </View>
              </View>
            )}
          </View>
        )}

        {/* Investments tab */}
        {tab === 1 && (
          <View style={styles.tabSection}>
            <InvestmentSection
              dark={dark}
              hidden={hideNetWorth}
              onUploadStatement={() => setInvestmentUploadOpen(true)}
              onReload={() => {
                setInvReloadKey(k => k + 1);
                loadKpis();
              }}
            />
          </View>
        )}
      </ScrollView>

      {/* Sheets */}
      <BankPickerSheet
        visible={bankPickerOpen}
        onClose={() => setBankPickerOpen(false)}
        dark={dark}
        onConnecting={() => setSyncing(true)}
      />

      <StatementUploadSheet
        visible={statementOpen}
        onClose={() => setStatementOpen(false)}
        onSuccess={() => { loadAll(); loadKpis(); }}
        dark={dark}
        region={region}
      />

      <InvestmentUploadSheet
        visible={investmentUploadOpen}
        onClose={() => setInvestmentUploadOpen(false)}
        onSuccess={() => { setInvReloadKey(k => k + 1); loadKpis(); }}
        dark={dark}
      />

      <AccountDetailSheet
        account={detailAccount}
        visible={detailVisible}
        onClose={() => { setDetailVisible(false); setDetailAccount(null); }}
        dark={dark}
        hidden={hideNetWorth}
        onStatementUpload={() => { setDetailVisible(false); setStatementOpen(true); }}
        onReconnect={handleReconnect}
        onDeleteAccount={handleDeleteAccount}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    gap: tw.space[4],
  },
  banners: {
    paddingHorizontal: tw.space[4],
    gap: tw.space[2],
  },
  alertBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    borderRadius: tw.radius["2xl"],
    borderWidth: HAIRLINE,
    paddingVertical: tw.space[2],
    paddingHorizontal: tw.space[3],
  },
  alertText: {
    flex: 1,
    ...tw.text.xs,
    fontWeight: tw.weight.medium,
  },
  alertDismiss: {
    padding: tw.space[1],
  },
  alertDismissText: {
    fontSize: 18,
    lineHeight: 18,
    fontWeight: tw.weight.bold,
  },
  tabSection: {
    gap: tw.space[3],
  },
  centeredLoader: {
    paddingVertical: tw.space[12],
    alignItems: "center",
  },
  emptyCard: {
    marginHorizontal: tw.space[4],
    borderRadius: tw.radius["2xl"],
    borderWidth: HAIRLINE,
    padding: tw.space[6],
    alignItems: "center",
    gap: tw.space[3],
  },
  emptyIconBox: {
    width: 56,
    height: 56,
    borderRadius: tw.radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  emptyHeading: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
    textAlign: "center",
  },
  emptyBody: {
    ...tw.text.sm,
    textAlign: "center",
    lineHeight: 20,
  },
  emptyPrimaryBtn: {
    backgroundColor: tw.color.indigo600,
    paddingHorizontal: tw.space[6],
    paddingVertical: tw.space[2.5],
    borderRadius: tw.radius.xl,
  },
  emptyPrimaryBtnText: {
    color: tw.color.white,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  emptySecondaryBtn: {
    borderWidth: 1,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[5],
    paddingVertical: tw.space[2],
  },
  emptySecondaryBtnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
  accountsContent: {
    gap: tw.space[4],
    paddingHorizontal: tw.space[4],
  },
  sectionLabel: {
    ...tw.text["10"],
    fontWeight: tw.weight.semibold,
    letterSpacing: tw.tracking(tw.trackingEm.wide, 10),
    marginBottom: tw.space[1],
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tw.space[3],
  },
  group: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tw.space[3],
  },
  offlineSection: {
    gap: tw.space[3],
  },
  offlineSectionHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  offlineSectionTitle: {
    ...tw.text.sm,
    fontWeight: tw.weight.bold,
  },
  offlineSectionSub: {
    ...tw.text.xs,
    marginTop: 2,
  },
  offlineEmpty: {
    ...tw.text.sm,
  },
  offlineList: {
    gap: tw.space[2],
  },
  offlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    borderRadius: tw.radius["2xl"],
    borderWidth: HAIRLINE,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  offlineIconBox: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  offlineMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  offlineName: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  offlineType: {
    ...tw.text.xs,
  },
  offlineBalance: {
    ...tw.text.sm,
    fontWeight: tw.weight.bold,
    flexShrink: 0,
  },
});
