import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Modal,
  Switch,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import {
  Bell,
  BellOff,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  LogOut,
  RotateCcw,
} from "lucide-react-native";

import { useTheme } from "@/lib/ThemeContext";
import { usePreferences } from "@/lib/PreferencesContext";
import { useAuth } from "@/lib/AuthContext";
import { api } from "@/lib/api";
import type { Account } from "@/lib/api";
import { tw } from "@/lib/tw";
import { SectionHeader } from "@/components/settings/SectionHeader";
import { SettingRow } from "@/components/settings/SettingRow";
import { AccountMiniCard } from "@/components/settings/AccountMiniCard";
import {
  syncHistory,
  updateSettingsPreferences,
  type NotificationPrefs,
} from "@/lib/api/settings";

// ── Biometric SecureStore key (must match (tabs)/_layout.tsx) ─────────────────
const BIO_KEY = "biometric_lock";

// ── Glass-card section container ──────────────────────────────────────────────
function sectionCard(dark: boolean) {
  return {
    backgroundColor: dark ? tw.color.cardDark : tw.color.cardLight,
    borderColor: dark ? tw.color.cardBorderDark : tw.color.cardBorderLight,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: tw.radius["2xl"],
    overflow: "hidden" as const,
    marginBottom: tw.space[3],
  };
}

// ── Spinning RotateCcw via Animated API ───────────────────────────────────────
function SpinningRotate({ spinning }: { spinning: boolean }) {
  const rotation = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (spinning) {
      animRef.current = Animated.loop(
        Animated.timing(rotation, { toValue: 1, duration: 900, useNativeDriver: true })
      );
      animRef.current.start();
    } else {
      animRef.current?.stop();
      rotation.setValue(0);
    }
    return () => { animRef.current?.stop(); };
  }, [spinning, rotation]);

  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <RotateCcw size={14} color={tw.color.white} />
    </Animated.View>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDigits(v: string): string {
  return v ? Number(v).toLocaleString("en-GB") : "";
}

function deriveBracket(value: number): string {
  if (value < 100_000) return "under_100k";
  if (value <= 125_140) return "100k_125k";
  return "125k_plus";
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const router = useRouter();
  const { dark, setDark } = useTheme();
  const { rawPrefs, setDarkMode } = usePreferences();
  const { token, signOut } = useAuth();

  // ── Derived theme tokens ───────────────────────────────────────────────────
  const canvas   = dark ? tw.color.canvasDark   : tw.color.canvasLight;
  const cardBg   = dark ? tw.color.cardDark     : tw.color.cardLight;
  const cardBorder = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const ink      = dark ? tw.color.slate100     : tw.color.slate800;
  const muted    = dark ? tw.color.slate400     : tw.color.slate500;
  const inputBg  = dark ? tw.color.slate700     : tw.color.slate50;
  const inputBorder = dark ? tw.color.slate600  : tw.color.slate200;

  // ── Display ────────────────────────────────────────────────────────────────
  function handleDarkModeToggle(next: boolean) {
    setDark(next);       // ThemeContext → SecureStore
    setDarkMode(next);   // PreferencesContext → API
  }

  // ── Notifications ──────────────────────────────────────────────────────────
  const [notifPermission, setNotifPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState("");
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs | null>(null);

  useEffect(() => {
    Notifications.getPermissionsAsync()
      .then((s) => {
        if (s.granted) setNotifPermission("granted");
        else if (s.status === "denied") setNotifPermission("denied");
        else setNotifPermission("unknown");
      })
      .catch(() => {});
  }, []);

  async function handleRequestNotifPermission() {
    setNotifLoading(true);
    setNotifError("");
    try {
      const { granted } = await Notifications.requestPermissionsAsync();
      setNotifPermission(granted ? "granted" : "denied");
      if (!granted) {
        setNotifError("Permission denied — enable notifications in your device settings.");
      }
    } catch (e) {
      setNotifError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setNotifLoading(false);
    }
  }

  function toggleNotifPref(key: keyof NotificationPrefs) {
    setNotifPrefs((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: !prev[key] };
      updateSettingsPreferences({ notification_prefs: next }).catch(() => {});
      return next;
    });
  }

  // ── Cover-plan accounts ────────────────────────────────────────────────────
  const [coverAccounts, setCoverAccounts] = useState<Account[]>([]);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [coverOpen, setCoverOpen] = useState(false);
  const chevronAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    api.accounts()
      .then((accs) => {
        const eligible = accs.filter((acc) => {
          const type = (acc.type || "").toLowerCase();
          const sub = (acc.subtype || "").toLowerCase();
          return !type.includes("credit") && !sub.includes("credit");
        });
        setCoverAccounts(eligible);
      })
      .catch(() => {});
  }, []);

  // Hydrate all settings-relevant fields from rawPrefs in one place
  useEffect(() => {
    if (rawPrefs === null) return;
    const ids = (rawPrefs.cover_plan_excluded_accounts as string[] | undefined) ?? [];
    setExcludedIds(new Set(ids));
    if (rawPrefs.notification_prefs) setNotifPrefs(rawPrefs.notification_prefs as NotificationPrefs);
    if (rawPrefs.income_bracket) setIncomeBracket(rawPrefs.income_bracket as string);
    if (rawPrefs.income_value) setIncomeInput(String(rawPrefs.income_value));
    if (rawPrefs.pension_annual) setPensionAnnual(String(rawPrefs.pension_annual));
    if (rawPrefs.has_child_benefit) setHasChildBenefit(rawPrefs.has_child_benefit as boolean);
  }, [rawPrefs]);

  function toggleCoverAccount(id: string) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      updateSettingsPreferences({ cover_plan_excluded_accounts: [...next] }).catch(() => {});
      return next;
    });
  }

  function toggleCoverOpen() {
    Animated.timing(chevronAnim, {
      toValue: coverOpen ? 0 : 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
    setCoverOpen((o) => !o);
  }

  const chevronRotate = chevronAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  const total = coverAccounts.length;
  const allowedCount = coverAccounts.filter((a) => !excludedIds.has(a.id)).length;
  const coverSummary =
    allowedCount === total
      ? `Any of your ${total} ${total === 1 ? "account" : "accounts"}`
      : `${allowedCount} of ${total} ${total === 1 ? "account" : "accounts"}`;

  // ── Financial profile ──────────────────────────────────────────────────────
  const [incomeBracket, setIncomeBracket] = useState("");
  const [incomeInput, setIncomeInput] = useState("");
  const [pensionAnnual, setPensionAnnual] = useState("");
  const [hasChildBenefit, setHasChildBenefit] = useState(false);
  const [financeMsg, setFinanceMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const financeMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleIncomeBlur() {
    const n = parseInt(incomeInput.replace(/[^0-9]/g, ""), 10);
    const value = isNaN(n) ? 0 : n;
    setIncomeInput(value === 0 ? "" : String(value));
    setIncomeBracket(deriveBracket(value));
    if (financeMsgTimer.current) clearTimeout(financeMsgTimer.current);
    setFinanceMsg(null);
    updateSettingsPreferences({ income_value: value })
      .then(() => {
        setFinanceMsg({ text: "Saved", ok: true });
        financeMsgTimer.current = setTimeout(() => setFinanceMsg(null), 2000);
      })
      .catch((e: unknown) => {
        setFinanceMsg({ text: e instanceof Error ? e.message : "Could not save", ok: false });
      });
  }

  function handlePensionBlur() {
    const n = parseInt(pensionAnnual.replace(/[^0-9]/g, ""), 10);
    const value = isNaN(n) ? 0 : n;
    setPensionAnnual(value === 0 ? "" : String(value));
    if (financeMsgTimer.current) clearTimeout(financeMsgTimer.current);
    setFinanceMsg(null);
    updateSettingsPreferences({ pension_annual: value })
      .then(() => {
        setFinanceMsg({ text: "Saved", ok: true });
        financeMsgTimer.current = setTimeout(() => setFinanceMsg(null), 2000);
      })
      .catch((e: unknown) => {
        setFinanceMsg({ text: e instanceof Error ? e.message : "Could not save", ok: false });
      });
  }

  function handleChildBenefitToggle() {
    const next = !hasChildBenefit;
    setHasChildBenefit(next);
    updateSettingsPreferences({ has_child_benefit: next }).catch(() => {});
  }

  const showHighIncomeSections =
    incomeBracket === "100k_125k" || incomeBracket === "125k_plus";

  // ── Security / biometric ───────────────────────────────────────────────────
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);

  useEffect(() => {
    Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ])
      .then(([hasHardware, enrolled]) => {
        if (hasHardware && enrolled) {
          setBioSupported(true);
          SecureStore.getItemAsync(BIO_KEY)
            .then((val) => setBioEnabled(val === "1"))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  function toggleBiometrics() {
    const next = !bioEnabled;
    setBioEnabled(next);
    SecureStore.setItemAsync(BIO_KEY, next ? "1" : "0").catch(() => {});
  }

  // ── Data / sync history ────────────────────────────────────────────────────
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [syncHistoryMsg, setSyncHistoryMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const syncMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleSyncHistory() {
    setSyncingHistory(true);
    setSyncHistoryMsg(null);
    try {
      const res = await syncHistory();
      setSyncHistoryMsg({ text: res.message || "Full sync complete", ok: true });
    } catch (e: unknown) {
      setSyncHistoryMsg({ text: e instanceof Error ? e.message : "Sync failed", ok: false });
    } finally {
      setSyncingHistory(false);
      if (syncMsgTimer.current) clearTimeout(syncMsgTimer.current);
      syncMsgTimer.current = setTimeout(() => setSyncHistoryMsg(null), 4000);
    }
  }

  // ── Account / profile ──────────────────────────────────────────────────────
  const [userEmail, setUserEmail] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    api.validateSession().then((s) => setUserEmail(s.email ?? null)).catch(() => {});
  }, [token]);

  const [profileName, setProfileName] = useState("");
  const [profilePostcode, setProfilePostcode] = useState("");
  const [profileLoaded, setProfileLoaded] = useState<{ name: string; postcode: string } | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const profileDirty =
    profileLoaded !== null &&
    (profileName !== profileLoaded.name || profilePostcode !== profileLoaded.postcode);

  useEffect(() => {
    api.getProfile()
      .then((p) => {
        const name = p.full_name ?? "";
        const postcode = p.postcode ?? "";
        setProfileName(name);
        setProfilePostcode(postcode);
        setProfileLoaded({ name, postcode });
      })
      .catch(() => {});
  }, []);

  async function saveProfile() {
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const p = await api.updateProfile(profileName.trim(), profilePostcode.trim());
      const name = p.full_name ?? "";
      const postcode = p.postcode ?? "";
      setProfileName(name);
      setProfilePostcode(postcode);
      setProfileLoaded({ name, postcode });
      setProfileMsg({ text: "Profile saved", ok: true });
      // Intentionally no auto-hide — stays until next save (spec)
    } catch (e) {
      setProfileMsg({ text: e instanceof Error ? e.message : "Could not save profile", ok: false });
    } finally {
      setProfileSaving(false);
    }
  }

  // ── Delete account ─────────────────────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleDeleteAccount() {
    if (deleteConfirm !== "DELETE" || deleting) return;
    setDeleting(true);
    try {
      await api.deleteUserAccount();
      await signOut();
    } catch {
      setDeleting(false);
      setProfileMsg({ text: "Deletion failed — try again", ok: false });
      setDeleteOpen(false);
    }
  }

  // ── Notification preference rows config ───────────────────────────────────
  const notifRows: { key: keyof NotificationPrefs; title: string; desc: string }[] = [
    { key: "insights",        title: "Tips & insights",    desc: "Ways to save money we spot for you" },
    { key: "budget_alerts",   title: "Budget alerts",      desc: "When you go over a budget category" },
    { key: "bill_alerts",     title: "Bill alerts",        desc: "When an upcoming bill may not clear" },
    { key: "goal_milestones", title: "Goal milestones",    desc: "When you reach a savings goal" },
    { key: "period_digest",   title: "Pay-period digest",  desc: "A fresh-start goals summary each new pay period" },
    { key: "transactions",    title: "New transactions",   desc: "Each time new transactions arrive" },
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: canvas }]} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scroll, { backgroundColor: canvas }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ── Page header hero ────────────────────────────────────────────── */}
          <View style={[styles.heroCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <View style={styles.heroRow}>
              <View>
                <Text style={[styles.heroTitle, { color: dark ? tw.color.slate100 : tw.color.slate900 }]}>
                  Settings
                </Text>
                <Text style={[styles.heroSubtitle, { color: muted }]}>
                  Customise your dashboard
                </Text>
              </View>
            </View>
          </View>

          {/* ════════════════════════════════════════════════════════════════
              Section 1: Display
          ════════════════════════════════════════════════════════════════ */}
          <View style={sectionCard(dark)}>
            <SectionHeader label="Display" dark={dark} />
            <SettingRow
              title="Dark Mode"
              description="Easier on the eyes at night"
              dark={dark}
              right={
                <Switch
                  value={dark}
                  onValueChange={handleDarkModeToggle}
                  trackColor={{ false: dark ? tw.color.slate700 : tw.color.slate200, true: tw.color.indigo500 }}
                  thumbColor={tw.color.white}
                  accessibilityLabel="Dark mode"
                  accessibilityRole="switch"
                />
              }
            />
          </View>

          {/* ════════════════════════════════════════════════════════════════
              Section 2: Notifications
          ════════════════════════════════════════════════════════════════ */}
          <View style={sectionCard(dark)}>
            <SectionHeader label="Notifications" dark={dark} />

            <View style={styles.notifBody}>
              {notifPermission === "denied" ? (
                <View style={styles.notifRow}>
                  <BellOff size={16} color={tw.color.amber500} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: ink }]}>Notifications blocked</Text>
                    <Text style={[styles.rowDesc, { color: muted }]}>
                      To receive alerts, enable notifications for this app in your device settings.
                    </Text>
                  </View>
                </View>
              ) : notifPermission === "unknown" ? (
                <View style={styles.notifRow}>
                  <Bell size={16} color={tw.color.indigo500} />
                  <View style={{ flex: 1, gap: tw.space[2] }}>
                    <View>
                      <Text style={[styles.rowTitle, { color: ink }]}>Push notifications</Text>
                      <Text style={[styles.rowDesc, { color: muted }]}>Allow alerts on this device</Text>
                    </View>
                    {notifLoading ? (
                      <ActivityIndicator size="small" color={tw.color.slate400} />
                    ) : (
                      <Pressable
                        onPress={handleRequestNotifPermission}
                        style={({ pressed }) => [styles.enableNotifBtn, { opacity: pressed ? 0.7 : 1 }]}
                        accessibilityRole="button"
                        accessibilityLabel="Enable push notifications"
                      >
                        <Text style={styles.enableNotifBtnText}>Enable notifications</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              ) : (
                /* granted — informational; granular prefs appear below */
                <View style={styles.notifRow}>
                  <Bell size={16} color={tw.color.indigo500} />
                  <Text style={[styles.rowDesc, { color: muted, flex: 1 }]}>
                    Notifications are delivered natively by the app.
                  </Text>
                </View>
              )}

              {notifError ? (
                <View style={styles.errorRow}>
                  <AlertCircle size={13} color={tw.color.red600} />
                  <Text style={[styles.errorText, { color: tw.color.red600 }]}>{notifError}</Text>
                </View>
              ) : null}
            </View>

            {/* Granular notification preference toggles */}
            {notifPrefs ? (
              <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: cardBorder }}>
                <View style={styles.notifPrefsHeader}>
                  <Text
                    style={[
                      styles.notifPrefsLabel,
                      { color: muted, letterSpacing: tw.tracking(tw.trackingEm.wide, 11) },
                    ]}
                  >
                    NOTIFY ME ABOUT
                  </Text>
                </View>
                {notifRows.map((row, i) => (
                  <View
                    key={row.key}
                    style={[
                      styles.prefRow,
                      i > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: dark ? tw.color.slate700 : tw.color.slate50,
                      },
                    ]}
                  >
                    <View style={{ flex: 1, paddingRight: tw.space[3] }}>
                      <Text style={[styles.rowTitle, { color: ink }]}>{row.title}</Text>
                      <Text style={[styles.rowDesc, { color: muted }]}>{row.desc}</Text>
                    </View>
                    <Switch
                      value={!!notifPrefs[row.key]}
                      onValueChange={() => toggleNotifPref(row.key)}
                      trackColor={{ false: dark ? tw.color.slate700 : tw.color.slate200, true: tw.color.indigo500 }}
                      thumbColor={tw.color.white}
                      accessibilityLabel={row.title}
                      accessibilityRole="switch"
                    />
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {/* ════════════════════════════════════════════════════════════════
              Section 3: Where money can come from (conditional)
          ════════════════════════════════════════════════════════════════ */}
          {coverAccounts.length > 0 ? (
            <View style={sectionCard(dark)}>
              {/* Collapsible header */}
              <Pressable
                onPress={toggleCoverOpen}
                style={({ pressed }) => [
                  styles.coverHeader,
                  coverOpen && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: cardBorder,
                  },
                  { opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ expanded: coverOpen }}
                accessibilityLabel={`Where money can come from — ${coverSummary}`}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.coverHeaderLabel,
                      {
                        color: muted,
                        letterSpacing: tw.tracking(tw.trackingEm.wide, tw.text.xs.fontSize),
                      },
                    ]}
                  >
                    WHERE MONEY CAN COME FROM
                  </Text>
                  <Text style={[styles.coverSummary, { color: ink }]}>{coverSummary}</Text>
                </View>
                <Animated.View style={{ transform: [{ rotate: chevronRotate }] }}>
                  <ChevronDown size={16} color={dark ? tw.color.slate500 : tw.color.slate400} />
                </Animated.View>
              </Pressable>

              {coverOpen ? (
                <View>
                  <Text style={[styles.coverInfoText, { color: muted }]}>
                    By default Penny can move from any of your accounts. Turn one off and it will
                    never be suggested.
                  </Text>
                  <View style={{ marginTop: tw.space[2] }}>
                    {coverAccounts.map((acc, i) => (
                      <AccountMiniCard
                        key={acc.id}
                        account={acc}
                        allowed={!excludedIds.has(acc.id)}
                        onToggle={() => toggleCoverAccount(acc.id)}
                        dark={dark}
                        withTopBorder={i > 0}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* ════════════════════════════════════════════════════════════════
              Section 4: Financial profile (always rendered)
          ════════════════════════════════════════════════════════════════ */}
          <View style={sectionCard(dark)}>
            <SectionHeader
              label="Financial profile"
              subtext="Self-declared — unlocks personalised tax insights"
              dark={dark}
            />

            {/* Income input */}
            <View style={styles.inputBlock}>
              <Text style={[styles.inputLabel, { color: ink }]}>Approximate income (£/yr)</Text>
              <Text style={[styles.inputHint, { color: muted }]}>
                Used to personalise your tax calculations — over £100k unlocks the Tax tab
              </Text>
              <View style={styles.currencyInputWrap}>
                <Text style={[styles.currencyPrefix, { color: tw.color.slate400 }]}>£</Text>
                <TextInput
                  style={[styles.currencyInput, { backgroundColor: inputBg, borderColor: inputBorder, color: ink }]}
                  value={fmtDigits(incomeInput)}
                  onChangeText={(t) => setIncomeInput(t.replace(/[^0-9]/g, ""))}
                  onBlur={handleIncomeBlur}
                  placeholder="e.g. 110000"
                  placeholderTextColor={tw.color.slate400}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  accessibilityLabel="Approximate income per year"
                />
              </View>
              {financeMsg ? (
                <Text style={[styles.statusMsg, { color: financeMsg.ok ? tw.color.emerald500 : tw.color.red600 }]}>
                  {financeMsg.text}
                </Text>
              ) : null}
            </View>

            {/* High-income gated sections: pension + child benefit + tax link */}
            {showHighIncomeSections ? (
              <>
                {/* Pension input */}
                <View
                  style={[
                    styles.inputBlock,
                    { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: dark ? tw.color.slate700 : tw.color.slate50 },
                  ]}
                >
                  <Text style={[styles.inputLabel, { color: ink }]}>
                    Pension contributions this year (£/yr)
                  </Text>
                  <Text style={[styles.inputHint, { color: muted }]}>
                    Used to calculate your adjusted net income
                  </Text>
                  <View style={styles.currencyInputWrap}>
                    <Text style={[styles.currencyPrefix, { color: tw.color.slate400 }]}>£</Text>
                    <TextInput
                      style={[styles.currencyInput, { backgroundColor: inputBg, borderColor: inputBorder, color: ink }]}
                      value={fmtDigits(pensionAnnual)}
                      onChangeText={(t) => setPensionAnnual(t.replace(/[^0-9]/g, ""))}
                      onBlur={handlePensionBlur}
                      placeholder="0"
                      placeholderTextColor={tw.color.slate400}
                      keyboardType="number-pad"
                      returnKeyType="done"
                      accessibilityLabel="Annual pension contributions"
                    />
                  </View>
                </View>

                {/* Child benefit toggle */}
                <View
                  style={[
                    styles.childBenefitRow,
                    { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: dark ? tw.color.slate700 : tw.color.slate50 },
                  ]}
                >
                  <View style={{ flex: 1, paddingRight: tw.space[3] }}>
                    <Text style={[styles.rowTitle, { color: ink }]}>Receiving Child Benefit</Text>
                    <Text style={[styles.rowDesc, { color: muted }]}>
                      High income charge applies over £60k
                    </Text>
                  </View>
                  <Switch
                    value={hasChildBenefit}
                    onValueChange={handleChildBenefitToggle}
                    trackColor={{ false: dark ? tw.color.slate700 : tw.color.slate200, true: tw.color.indigo500 }}
                    thumbColor={tw.color.white}
                    accessibilityLabel="Receiving Child Benefit"
                    accessibilityRole="switch"
                  />
                </View>

                {/* Tax breakdown link */}
                <Pressable
                  onPress={() => router.push("/insights?tab=tax")}
                  style={({ pressed }) => [
                    styles.taxLinkRow,
                    {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: cardBorder,
                      backgroundColor: pressed
                        ? (dark ? tw.color.indigo900 + "19" : tw.color.indigo50)
                        : "transparent",
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="View tax breakdown"
                >
                  <Text style={[styles.taxLinkText, { color: dark ? tw.color.indigo400 : tw.color.indigo600 }]}>
                    View tax breakdown
                  </Text>
                  <ChevronRight size={16} color={dark ? tw.color.indigo400 : tw.color.indigo600} />
                </Pressable>
              </>
            ) : null}
          </View>

          {/* ════════════════════════════════════════════════════════════════
              Section 5: Security — biometric (conditional on hardware support)
          ════════════════════════════════════════════════════════════════ */}
          {bioSupported ? (
            <View style={sectionCard(dark)}>
              <SectionHeader label="Security" dark={dark} />
              <SettingRow
                title="Biometric unlock"
                description="Require fingerprint or face to open the app"
                dark={dark}
                right={
                  <Switch
                    value={bioEnabled}
                    onValueChange={toggleBiometrics}
                    trackColor={{ false: dark ? tw.color.slate700 : tw.color.slate200, true: tw.color.indigo500 }}
                    thumbColor={tw.color.white}
                    accessibilityLabel="Biometric login"
                    accessibilityRole="switch"
                  />
                }
              />
            </View>
          ) : null}

          {/* ════════════════════════════════════════════════════════════════
              Section 6: Data
          ════════════════════════════════════════════════════════════════ */}
          <View style={sectionCard(dark)}>
            <SectionHeader label="Data" dark={dark} />
            <View style={styles.dataBody}>
              <Text style={[styles.rowTitle, { color: ink }]}>Sync all history</Text>
              <Text style={[styles.rowDesc, { color: muted, marginTop: tw.space[0.5], marginBottom: tw.space[3] }]}>
                Re-fetch the last 90 days from all connected banks.
              </Text>
              <Pressable
                onPress={handleSyncHistory}
                disabled={syncingHistory}
                style={({ pressed }) => [
                  styles.syncBtn,
                  {
                    opacity: syncingHistory ? 0.5 : pressed ? 0.85 : 1,
                    transform: [{ scale: pressed && !syncingHistory ? 0.95 : 1 }],
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={syncingHistory ? "Syncing" : "Sync history 90 days"}
              >
                <SpinningRotate spinning={syncingHistory} />
                <Text style={styles.syncBtnText}>
                  {syncingHistory ? "Syncing…" : "Sync history (90 days)"}
                </Text>
              </Pressable>
              {syncHistoryMsg ? (
                <Text style={[styles.statusMsg, { color: syncHistoryMsg.ok ? tw.color.emerald500 : tw.color.red600, marginTop: tw.space[2] }]}>
                  {syncHistoryMsg.text}
                </Text>
              ) : null}
            </View>
          </View>

          {/* ════════════════════════════════════════════════════════════════
              Section 7: Account
          ════════════════════════════════════════════════════════════════ */}
          <View style={sectionCard(dark)}>
            {/* Header with email */}
            <View
              style={[
                styles.accountHeader,
                { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: dark ? tw.color.slate700 : tw.color.slate50 },
              ]}
            >
              <Text
                style={[
                  styles.accountSectionLabel,
                  { color: muted, letterSpacing: tw.tracking(tw.trackingEm.wide, tw.text.xs.fontSize) },
                ]}
              >
                ACCOUNT
              </Text>
              {userEmail ? (
                <Text style={[styles.emailText, { color: muted }]}>{userEmail}</Text>
              ) : null}
            </View>

            {/* Profile fields */}
            <View
              style={[
                styles.profileBlock,
                { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: dark ? tw.color.slate700 : tw.color.slate50 },
              ]}
            >
              {/* Full name */}
              <View>
                <Text style={[styles.profileFieldLabel, { color: muted }]}>
                  {"Full name "}
                  <Text style={{ opacity: 0.7 }}>
                    — used to recognise transfers between your own accounts
                  </Text>
                </Text>
                <TextInput
                  style={[styles.profileInput, { backgroundColor: inputBg, borderColor: inputBorder, color: ink }]}
                  value={profileName}
                  onChangeText={setProfileName}
                  placeholder="First Last"
                  placeholderTextColor={tw.color.slate400}
                  autoCapitalize="words"
                  returnKeyType="next"
                  accessibilityLabel="Full name"
                />
              </View>

              {/* Home postcode */}
              <View style={{ marginTop: tw.space[3] }}>
                <Text style={[styles.profileFieldLabel, { color: muted }]}>
                  {"Home postcode "}
                  <Text style={{ opacity: 0.7 }}>— used for local fuel prices</Text>
                </Text>
                <TextInput
                  style={[styles.profileInput, { backgroundColor: inputBg, borderColor: inputBorder, color: ink, marginTop: tw.space[1] }]}
                  value={profilePostcode}
                  onChangeText={setProfilePostcode}
                  placeholder="e.g. B91 2AB"
                  placeholderTextColor={tw.color.slate400}
                  autoCapitalize="characters"
                  returnKeyType="done"
                  accessibilityLabel="Home postcode"
                />
              </View>

              {/* Save button — only when dirty */}
              {profileDirty ? (
                <Pressable
                  onPress={saveProfile}
                  disabled={profileSaving}
                  style={({ pressed }) => [
                    styles.saveProfileBtn,
                    {
                      marginTop: tw.space[3],
                      opacity: profileSaving ? 0.5 : 1,
                      transform: [{ scale: pressed ? 0.98 : 1 }],
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={profileSaving ? "Saving profile" : "Save profile"}
                >
                  <Text style={styles.saveProfileBtnText}>
                    {profileSaving ? "Saving…" : "Save profile"}
                  </Text>
                </Pressable>
              ) : null}

              {/* Profile message — does NOT auto-hide (spec) */}
              {profileMsg ? (
                <Text
                  style={[
                    styles.statusMsg,
                    { color: profileMsg.ok ? tw.color.emerald500 : tw.color.red600, marginTop: tw.space[2] },
                  ]}
                >
                  {profileMsg.text}
                </Text>
              ) : null}
            </View>

            {/* Sign out */}
            <Pressable
              onPress={signOut}
              style={({ pressed }) => [
                styles.signOutRow,
                { backgroundColor: pressed ? (dark ? tw.color.slate700 : tw.color.slate100) : "transparent" },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
            >
              <LogOut size={16} color={dark ? tw.color.slate300 : tw.color.slate600} />
              <Text style={[styles.signOutText, { color: dark ? tw.color.slate300 : tw.color.slate600 }]}>
                Sign out
              </Text>
            </Pressable>
          </View>

          {/* ════════════════════════════════════════════════════════════════
              Section 8: Danger zone
          ════════════════════════════════════════════════════════════════ */}
          <View
            style={[
              sectionCard(dark),
              // Override border to red-tinted
              {
                // red-900/40 dark (#7f1d1d66); red-100 light (#fee2e2) — danger card border (matches web)
                borderColor: dark ? "#7f1d1d66" : "#fee2e2",
                borderWidth: StyleSheet.hairlineWidth,
              },
            ]}
          >
            <View style={styles.dangerHeader}>
              <Text
                style={[
                  styles.dangerLabel,
                  { letterSpacing: tw.tracking(tw.trackingEm.wide, tw.text.xs.fontSize) },
                ]}
              >
                DANGER ZONE
              </Text>
            </View>
            <View style={styles.dangerBody}>
              <Pressable
                onPress={() => setDeleteOpen(true)}
                style={({ pressed }) => [
                  styles.deleteBtn,
                  // red-900/10 dark (#7f1d1d1a); red-50 light (#fef2f2) — danger pressed tint (matches web active:bg-red-100 / dark:active:bg-red-900/10)
                  { backgroundColor: pressed ? (dark ? "#7f1d1d1a" : "#fef2f2") : "transparent" },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Delete account and all data"
              >
                <Text style={styles.deleteBtnText}>Delete account & all data…</Text>
              </Pressable>
            </View>
          </View>

          {/* Bottom safe-area spacer */}
          <View style={{ height: tw.space[6] }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ════════════════════════════════════════════════════════════════════
          Delete account confirmation modal
      ════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={deleteOpen}
        transparent
        animationType="fade"
        onRequestClose={() => { setDeleteOpen(false); setDeleteConfirm(""); }}
        statusBarTranslucent
      >
        {/* Backdrop — tap to dismiss */}
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => { setDeleteOpen(false); setDeleteConfirm(""); }}
          accessibilityRole="button"
          accessibilityLabel="Close dialog"
        >
          {/* Panel — stop propagation so tapping inside doesn't close */}
          <Pressable
            style={[styles.modalPanel, { backgroundColor: cardBg, borderColor: cardBorder }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: dark ? tw.color.slate100 : tw.color.slate900 }]}>
              Delete everything?
            </Text>

            <Text style={[styles.modalBody, { color: muted }]}>
              {"This permanently erases everything — bank connections, transactions, budgets, plans, insights and chat history. It cannot be undone. Type "}
              <Text style={[styles.modalBodyBold, { color: dark ? tw.color.slate200 : tw.color.slate700 }]}>
                DELETE
              </Text>
              {" to confirm."}
            </Text>

            <TextInput
              style={[
                styles.deleteConfirmInput,
                {
                  backgroundColor: inputBg,
                  // red-200 light (#fecaca) / red-800 dark (#991b1b) — matches web border-red-200 dark:border-red-800
                  borderColor: dark ? "#991b1b" : "#fecaca",
                  color: ink,
                },
              ]}
              value={deleteConfirm}
              onChangeText={setDeleteConfirm}
              placeholder="DELETE"
              placeholderTextColor={tw.color.slate400}
              autoCapitalize="characters"
              returnKeyType="done"
              accessibilityLabel="Type DELETE to confirm account deletion"
            />

            <View style={styles.modalButtons}>
              <Pressable
                onPress={() => { setDeleteOpen(false); setDeleteConfirm(""); }}
                style={({ pressed }) => [
                  styles.modalCancelBtn,
                  { borderColor: cardBorder, opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={[styles.modalCancelText, { color: ink }]}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleDeleteAccount}
                disabled={deleteConfirm !== "DELETE" || deleting}
                style={({ pressed }) => [
                  styles.modalDestructiveBtn,
                  {
                    opacity: deleteConfirm !== "DELETE" || deleting ? 0.4 : pressed ? 0.85 : 1,
                    transform: [{ scale: pressed && deleteConfirm === "DELETE" ? 0.97 : 1 }],
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Delete my account"
                accessibilityState={{ disabled: deleteConfirm !== "DELETE" || deleting }}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color={tw.color.white} />
                ) : (
                  <Text style={styles.modalDestructiveText}>Delete my account</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: tw.space[4],
    paddingTop: tw.space[4],
  },

  // Page hero card
  heroCard: {
    borderRadius: tw.radius["3xl"],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: tw.space[4],
    paddingTop: tw.space[5],
    paddingBottom: tw.space[6],
    marginBottom: tw.space[3],
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroTitle: {
    fontSize: tw.text.xl.fontSize,
    lineHeight: tw.text.xl.lineHeight,
    fontWeight: tw.weight.bold,
  },
  heroSubtitle: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: "400",
    marginTop: tw.space[1],
  },

  // Notifications section
  notifBody: {
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    gap: tw.space[2],
  },
  notifRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tw.space[3],
  },
  rowTitle: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
  },
  rowDesc: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: "400",
    marginTop: tw.space[0.5],
  },
  enableNotifBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[1],
    borderRadius: tw.radius.xl,
    backgroundColor: tw.color.indigo500,
  },
  enableNotifBtnText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
    color: tw.color.white,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1],
    marginTop: tw.space[1],
  },
  errorText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    flex: 1,
  },
  notifPrefsHeader: {
    paddingHorizontal: tw.space[4],
    paddingTop: tw.space[3],
    paddingBottom: tw.space[1],
  },
  notifPrefsLabel: {
    fontSize: tw.text["11"].fontSize,
    lineHeight: tw.text["11"].lineHeight,
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
  },
  prefRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    minHeight: 44,
  },

  // Cover accounts section
  coverHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
  },
  coverHeaderLabel: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
  },
  coverSummary: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
    marginTop: tw.space[0.5],
  },
  coverInfoText: {
    paddingHorizontal: tw.space[4],
    paddingTop: tw.space[3],
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "400",
  },

  // Financial profile inputs
  inputBlock: {
    paddingHorizontal: tw.space[4],
    paddingVertical: 14, // py-3.5
  },
  inputLabel: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
    marginBottom: tw.space[1],
  },
  inputHint: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: "400",
    marginBottom: tw.space[2],
  },
  currencyInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    width: 160,
    position: "relative",
  },
  currencyPrefix: {
    position: "absolute",
    left: 12,
    fontSize: tw.text.sm.fontSize,
    zIndex: 1,
  },
  currencyInput: {
    flex: 1,
    paddingLeft: 28,
    paddingRight: tw.space[3],
    paddingVertical: tw.space[2],
    borderRadius: tw.radius.xl,
    borderWidth: 1,
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
  },
  childBenefitRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tw.space[4],
    paddingVertical: 14,
  },
  taxLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tw.space[4],
    paddingVertical: 14,
  },
  taxLinkText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.semibold,
  },
  statusMsg: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.medium,
  },

  // Data section
  dataBody: {
    paddingHorizontal: tw.space[4],
    paddingVertical: 14,
  },
  syncBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[2],
    borderRadius: tw.radius.xl,
    backgroundColor: tw.color.indigo500,
    alignSelf: "flex-start",
  },
  syncBtnText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
    color: tw.color.white,
  },

  // Account section
  accountHeader: {
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
  },
  accountSectionLabel: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    marginBottom: tw.space[0.5],
  },
  emailText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: "400",
  },
  profileBlock: {
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
  },
  profileFieldLabel: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: "400",
    marginBottom: tw.space[1],
  },
  profileInput: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: "400",
    borderRadius: tw.radius.xl,
    borderWidth: 1,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[2],
    width: "100%",
  },
  saveProfileBtn: {
    width: "100%",
    paddingVertical: tw.space[2],
    borderRadius: tw.radius.xl,
    backgroundColor: tw.color.indigo600,
    alignItems: "center",
    justifyContent: "center",
  },
  saveProfileBtnText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.semibold,
    color: tw.color.white,
  },
  signOutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    paddingHorizontal: tw.space[4],
    paddingVertical: 14,
    minHeight: 44,
  },
  signOutText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
  },

  // Danger zone
  dangerHeader: {
    paddingHorizontal: tw.space[4],
    paddingTop: tw.space[3],
    paddingBottom: tw.space[1],
  },
  dangerLabel: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    color: tw.color.red600,
  },
  dangerBody: {
    paddingHorizontal: tw.space[4],
    paddingBottom: 10,
  },
  deleteBtn: {
    paddingHorizontal: tw.space[4],
    paddingVertical: 10,
    borderRadius: tw.radius.xl,
    alignSelf: "flex-start",
  },
  deleteBtnText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
    color: tw.color.red600,
  },

  // Delete confirm modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tw.space[6],
  },
  modalPanel: {
    width: "100%",
    borderRadius: tw.radius["2xl"],
    borderWidth: StyleSheet.hairlineWidth,
    padding: tw.space[6],
    gap: tw.space[4],
  },
  modalTitle: {
    fontSize: tw.text.base.fontSize,
    lineHeight: tw.text.base.lineHeight,
    fontWeight: tw.weight.bold,
  },
  modalBody: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: 21,
    fontWeight: "400",
  },
  modalBodyBold: {
    fontWeight: tw.weight.bold,
  },
  deleteConfirmInput: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: "400",
    borderRadius: tw.radius.xl,
    borderWidth: 1,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[2],
    width: "100%",
  },
  modalButtons: {
    flexDirection: "row",
    gap: tw.space[3],
    marginTop: tw.space[1],
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: tw.radius.xl,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
  },
  modalDestructiveBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: tw.radius.xl,
    backgroundColor: tw.color.red600,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
  },
  modalDestructiveText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.semibold,
    color: tw.color.white,
  },
});
