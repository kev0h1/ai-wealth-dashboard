/**
 * AccountDetailSheet — full-screen modal showing an account's detail view.
 * Transactions tab (with search + pagination) or Categories/Rules tab.
 * Header action: Edit (manual), Add statement (statement-*), Reconnect (connected).
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, Pressable, StyleSheet, TextInput, FlatList,
  ActivityIndicator, Modal, KeyboardAvoidingView, Platform,
  ScrollView, Switch,
} from "react-native";
import {
  ArrowLeft, Search, X, Plus, ChevronRight, Pencil, Upload,
  RefreshCw, Trash2, Check,
} from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { tw, HAIRLINE } from "@/lib/tw";

const EXT = { rose500: "#f43f5e", indigo800: "#3730a3" } as const;
import { accountsApi } from "@/lib/api/accounts";
import type { Account, Transaction, ManualAccount, ManualAccountRule } from "@/lib/shared";
import type { AccountCategorySummary } from "@/lib/api/accounts";
import { getGradient, typeLabel } from "./AccountMiniCard";
import { CATEGORY_COLOURS } from "@/lib/shared/categories";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch { return iso; }
}

function fmtAmount(amount: number, currency: string): string {
  const sym = currency === "KES" ? "KES " : "£";
  return `${sym}${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const MERCHANT_INITIALS = (name: string) => {
  const m = name.match(/[a-z0-9]/i);
  return m ? m[0].toUpperCase() : "•";
};

// ── TransactionRow (native) ───────────────────────────────────────────────────

function TxRow({
  tx,
  dark,
  onPress,
}: {
  tx: Transaction;
  dark: boolean;
  onPress: () => void;
}) {
  const ink = dark ? tw.color.slate100 : tw.color.slate800;
  const muted = tw.color.slate400;
  const catColour = CATEGORY_COLOURS[tx.category ?? "Other"] ?? CATEGORY_COLOURS.Other;
  const isCredit = tx.transaction_type === "credit";
  const displayName = tx.merchant_name || tx.description || "Unknown";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.txRow,
        { backgroundColor: pressed ? (dark ? tw.color.slate700 : tw.color.slate50) : "transparent" },
      ]}
    >
      {/* Icon */}
      <View style={[styles.txIcon, { backgroundColor: catColour + "26" }]}>
        <Text style={[styles.txIconText, { color: catColour }]}>
          {MERCHANT_INITIALS(displayName)}
        </Text>
      </View>

      {/* Name + date */}
      <View style={styles.txMiddle}>
        <Text style={[styles.txName, { color: ink }]} numberOfLines={1}>{displayName}</Text>
        <Text style={[styles.txMeta, { color: muted }]}>
          {fmtDate(tx.date)}{tx.category ? ` · ${tx.category}` : ""}
        </Text>
      </View>

      {/* Amount */}
      <Text style={[
        styles.txAmount,
        { color: isCredit ? tw.color.emerald500 : ink },
      ]}>
        {isCredit ? "+" : "−"}{fmtAmount(tx.amount, tx.currency)}
      </Text>
    </Pressable>
  );
}

// ── CategoryCard ──────────────────────────────────────────────────────────────

function CatCard({ cat, total, dark }: { cat: AccountCategorySummary; total: number; dark: boolean }) {
  const ink = dark ? tw.color.slate100 : tw.color.slate900;
  const muted = tw.color.slate400;
  const colour = CATEGORY_COLOURS[cat.name] ?? CATEGORY_COLOURS.Other;
  const pct = total > 0 ? cat.total / total : 0;

  return (
    <View style={[styles.catCard, { backgroundColor: dark ? tw.color.cardDark : tw.color.cardLight, borderColor: dark ? tw.color.cardBorderDark : tw.color.cardBorderLight }]}>
      <View style={styles.catCardHeader}>
        <View style={[styles.catIcon, { backgroundColor: colour + "26" }]}>
          <Text style={{ color: colour, fontSize: 14 }}>•</Text>
        </View>
        <View style={styles.catHeaderText}>
          <Text style={[styles.catName, { color: ink }]} numberOfLines={1}>{cat.name}</Text>
          <Text style={[styles.catCount, { color: muted }]}>{cat.count} txn{cat.count !== 1 ? "s" : ""}</Text>
        </View>
      </View>
      <Text style={[styles.catTotal, { color: ink }]}>
        £{cat.total.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
      </Text>
      <View style={[styles.catBarTrack, { backgroundColor: dark ? tw.color.slate700 : tw.color.slate100 }]}>
        <View style={[styles.catBarFill, { backgroundColor: colour, width: `${Math.min(pct * 100, 100)}%` as `${number}%` }]} />
      </View>
    </View>
  );
}

// ── RuleRow ───────────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  dark,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: ManualAccountRule;
  dark: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const ink = dark ? tw.color.slate100 : tw.color.slate900;
  const muted = tw.color.slate400;
  const matchLabel = rule.match_type === "description_contains" ? "Contains" : "Category";

  return (
    <View style={[styles.ruleRow, { backgroundColor: dark ? tw.color.cardDark : tw.color.cardLight, borderColor: dark ? tw.color.cardBorderDark : tw.color.cardBorderLight }]}>
      <View style={styles.ruleLeft}>
        <Text style={[styles.ruleName, { color: ink }]}>{rule.name}</Text>
        <Text style={[styles.ruleMeta, { color: muted }]}>
          {matchLabel} "{rule.match_value}" · {rule.sign === "opposite" ? "Offset" : "Shadow"}
        </Text>
      </View>
      <View style={styles.ruleRight}>
        <View style={[styles.ruleActivePill, { backgroundColor: rule.active ? tw.color.emerald100 : tw.color.slate200 }]}>
          <Text style={[styles.ruleActivePillText, { color: rule.active ? tw.color.emerald600 : tw.color.slate500 }]}>
            {rule.active ? "On" : "Off"}
          </Text>
        </View>
        <Pressable onPress={onEdit} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
          <Pencil size={16} color={muted} />
        </Pressable>
        <Pressable onPress={onDelete} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
          <Trash2 size={16} color={EXT.rose500} />
        </Pressable>
      </View>
    </View>
  );
}

// ── Manual transaction form ───────────────────────────────────────────────────

interface ManualTxFormProps {
  accountId: string;
  tx?: Transaction | null;
  dark: boolean;
  onDone: () => void;
  onClose: () => void;
}

function ManualTxForm({ accountId, tx, dark, onDone, onClose }: ManualTxFormProps) {
  const ink = dark ? tw.color.slate100 : tw.color.slate900;
  const muted = tw.color.slate400;
  const inputBg = dark ? tw.color.slate700 : tw.color.slate50;
  const inputBorder = dark ? tw.color.slate600 : tw.color.slate200;

  const [desc, setDesc] = useState(tx?.description ?? "");
  const [amount, setAmount] = useState(tx ? String(tx.amount) : "");
  const [type, setType] = useState<"debit" | "credit">(tx?.transaction_type ?? "debit");
  const [date, setDate] = useState(tx?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!tx;

  async function handleSave() {
    if (!desc.trim() || !amount.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const body = { description: desc.trim(), amount: parseFloat(amount), transaction_type: type, date };
      if (isEdit) {
        await accountsApi.updateManualTransaction(accountId, tx!.id, body);
      } else {
        await accountsApi.addManualTransaction(accountId, body);
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!isEdit || saving) return;
    setSaving(true);
    try {
      await accountsApi.deleteManualTransaction(accountId, tx!.id);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.formContainer}>
      <View style={styles.formHeader}>
        <Text style={[styles.formTitle, { color: ink }]}>{isEdit ? "Edit Transaction" : "Add Transaction"}</Text>
        <Pressable onPress={onClose} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <X size={20} color={muted} />
        </Pressable>
      </View>

      <View style={styles.formFields}>
        <TextInput
          style={[styles.formInput, { backgroundColor: inputBg, borderColor: inputBorder, color: ink }]}
          placeholder="Description"
          placeholderTextColor={muted}
          value={desc}
          onChangeText={setDesc}
        />
        <TextInput
          style={[styles.formInput, { backgroundColor: inputBg, borderColor: inputBorder, color: ink }]}
          placeholder="Amount"
          placeholderTextColor={muted}
          value={amount}
          onChangeText={setAmount}
          inputMode="decimal"
          keyboardType="decimal-pad"
        />
        <TextInput
          style={[styles.formInput, { backgroundColor: inputBg, borderColor: inputBorder, color: ink }]}
          placeholder="Date (YYYY-MM-DD)"
          placeholderTextColor={muted}
          value={date}
          onChangeText={setDate}
          maxLength={10}
        />

        {/* Type picker */}
        <View style={styles.typeGrid}>
          {(["debit", "credit"] as const).map(t => (
            <Pressable
              key={t}
              onPress={() => setType(t)}
              style={[
                styles.typeBtn,
                { borderColor: type === t ? tw.color.indigo600 : inputBorder, backgroundColor: type === t ? tw.color.indigo50 : inputBg },
              ]}
            >
              <Text style={[styles.typeBtnText, { color: type === t ? tw.color.indigo600 : muted }]}>
                {t === "debit" ? "Debit (out)" : "Credit (in)"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {error && <Text style={styles.formError}>{error}</Text>}

      <View style={styles.formActions}>
        {isEdit && (
          <Pressable
            onPress={handleDelete}
            disabled={saving}
            style={({ pressed }) => [styles.deleteBtn, { opacity: pressed || saving ? 0.5 : 1 }]}
          >
            <Trash2 size={16} color={EXT.rose500} />
          </Pressable>
        )}
        <Pressable onPress={onClose} style={styles.cancelBtn}>
          <Text style={[styles.cancelBtnText, { color: muted }]}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={!desc.trim() || !amount.trim() || saving}
          style={({ pressed }) => [
            styles.saveBtn,
            { opacity: (!desc.trim() || !amount.trim() || saving || pressed) ? 0.5 : 1 },
          ]}
        >
          {saving
            ? <ActivityIndicator size="small" color={tw.color.white} />
            : <Text style={styles.saveBtnText}>Save</Text>}
        </Pressable>
      </View>
    </View>
  );
}

// ── Main AccountDetailSheet ───────────────────────────────────────────────────

interface AccountDetailSheetProps {
  account: Account | ManualAccount | null;
  dark: boolean;
  hidden: boolean;
  visible: boolean;
  onClose: () => void;
  onStatementUpload: () => void;
  onReconnect: (account: Account) => void;
  onDeleteAccount: (id: string) => void;
}

export function AccountDetailSheet({
  account,
  dark,
  hidden,
  visible,
  onClose,
  onStatementUpload,
  onReconnect,
  onDeleteAccount,
}: AccountDetailSheetProps) {
  const insets = useSafeAreaInsets();
  const ink = dark ? tw.color.slate100 : tw.color.slate900;
  const muted = tw.color.slate400;
  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;

  const isManual = !!(account as ManualAccount)?.account_type;
  const isStatement = !isManual && (account as Account)?.id?.startsWith("statement-");
  const acc = account as Account;
  const manAcc = account as ManualAccount;

  const segments = isManual ? ["Transactions", "Rules"] : ["Transactions", "Categories"];
  const [tab, setTab] = useState(0);

  // Transactions state
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [txnPage, setTxnPage] = useState(1);
  const [txnPages, setTxnPages] = useState(1);
  const [txnLoading, setTxnLoading] = useState(false);
  const [txnSearch, setTxnSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Categories state
  const [categories, setCategories] = useState<AccountCategorySummary[]>([]);
  const [catLoading, setCatLoading] = useState(false);

  // Rules state
  const [rules, setRules] = useState<ManualAccountRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);

  // Manual tx form
  const [showTxForm, setShowTxForm] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  // Tx categorisation toast
  const [savedToast, setSavedToast] = useState(false);

  // ── Load transactions ─────────────────────────────────────────────────────
  const loadTxns = useCallback(async (page = 1, q = "") => {
    if (!account) return;
    setTxnLoading(true);
    try {
      if (isManual) {
        const items = await accountsApi.manualTransactions(manAcc.id);
        const filtered = q
          ? items.filter(t => t.description.toLowerCase().includes(q.toLowerCase()))
          : items;
        setTxns(filtered);
        setTxnPages(1);
      } else {
        const res = await accountsApi.transactionsPaged(acc.id, { page, pageSize: 20, q: q || undefined });
        setTxns(res.items);
        setTxnPages(res.pages);
        setTxnPage(res.page);
      }
    } catch {
      // non-fatal
    } finally {
      setTxnLoading(false);
    }
  }, [account, isManual, acc?.id, manAcc?.id]);

  // ── Load categories ───────────────────────────────────────────────────────
  const loadCategories = useCallback(async () => {
    if (!account || isManual) return;
    setCatLoading(true);
    try {
      const cats = await accountsApi.accountCategories(acc.id);
      setCategories(cats);
    } catch {
      // non-fatal
    } finally {
      setCatLoading(false);
    }
  }, [account, isManual, acc?.id]);

  // ── Load rules ────────────────────────────────────────────────────────────
  const loadRules = useCallback(async () => {
    if (!account || !isManual) return;
    setRulesLoading(true);
    try {
      const all = await accountsApi.manualAccountRules();
      setRules(all.filter(r => r.target_account_id === manAcc.id));
    } catch {
      // non-fatal
    } finally {
      setRulesLoading(false);
    }
  }, [account, isManual, manAcc?.id]);

  // Reload when sheet opens or account changes
  useEffect(() => {
    if (!visible || !account) return;
    setTab(0);
    setTxnSearch("");
    setTxnPage(1);
    loadTxns(1, "");
  }, [visible, account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load tab content when switching
  useEffect(() => {
    if (!visible || !account) return;
    if (tab === 1) {
      if (isManual) loadRules();
      else loadCategories();
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
  function handleSearch(q: string) {
    setTxnSearch(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadTxns(1, q), 350);
  }

  async function handleCategorise(tx: Transaction, category: string) {
    try {
      await accountsApi.patchTransaction(tx.id, { category });
      setTxns(prev => prev.map(t => t.id === tx.id ? { ...t, category } : t));
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 900);
    } catch {
      // non-fatal
    }
  }

  async function handleToggleRule(rule: ManualAccountRule) {
    try {
      await accountsApi.updateManualAccountRule(rule.id, { active: !rule.active });
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, active: !r.active } : r));
    } catch {
      // non-fatal
    }
  }

  async function handleDeleteRule(rule: ManualAccountRule) {
    try {
      await accountsApi.deleteManualAccountRule(rule.id);
      setRules(prev => prev.filter(r => r.id !== rule.id));
    } catch {
      // non-fatal
    }
  }

  if (!account) return null;

  // Gradient for the header
  const [gradFrom, gradTo] = isManual
    ? [tw.color.indigo600, EXT.indigo800]
    : getGradient(acc);

  const balance = isManual ? manAcc.balance : acc.balance;
  const balanceStr = hidden
    ? "••••"
    : `${balance < 0 ? "−" : ""}£${Math.abs(balance).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const catTotal = categories.reduce((s, c) => s + c.total, 0);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: dark ? tw.color.canvasDark : tw.color.canvasLight }]}>
        {/* Gradient header */}
        <LinearGradient
          colors={[gradFrom, gradTo]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.detailHeader, { paddingTop: insets.top + tw.space[3] }]}
        >
          {/* Back + action buttons */}
          <View style={styles.detailTopRow}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.7 : 1 }]}
            >
              <ArrowLeft size={18} color="rgba(255,255,255,0.85)" />
              <Text style={styles.backLabel}>Accounts</Text>
            </Pressable>

            <View style={styles.actionBtns}>
              {/* Primary action */}
              {isManual ? (
                <Pressable style={styles.headerActionBtn} onPress={() => {}}>
                  <Pencil size={14} color="rgba(255,255,255,0.9)" />
                  <Text style={styles.headerActionText}>Edit</Text>
                </Pressable>
              ) : isStatement ? (
                <Pressable style={styles.headerActionBtn} onPress={onStatementUpload}>
                  <Upload size={14} color="rgba(255,255,255,0.9)" />
                  <Text style={styles.headerActionText}>Add statement</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.headerActionBtn} onPress={() => onReconnect(acc)}>
                  <RefreshCw size={14} color="rgba(255,255,255,0.9)" />
                  <Text style={styles.headerActionText}>Reconnect</Text>
                </Pressable>
              )}
              {/* Remove */}
              <Pressable
                style={[styles.headerActionBtn, styles.headerActionBtnDestructive]}
                onPress={() => { onDeleteAccount(account.id); onClose(); }}
              >
                <Trash2 size={14} color={EXT.rose500} />
              </Pressable>
            </View>
          </View>

          {/* Account name + type + balance */}
          <Text style={styles.detailAccountName} numberOfLines={1}>
            {isManual ? manAcc.name : acc.name}
          </Text>
          <View style={styles.detailMeta}>
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>
                {isManual ? manAcc.account_type.replace("_", " ") : typeLabel(acc)}
              </Text>
            </View>
            <Text style={[styles.detailBalance, { color: balance < 0 ? tw.color.rose300 : tw.color.white }]}>
              {balanceStr}
            </Text>
          </View>
        </LinearGradient>

        {/* Segmented control */}
        <View style={[styles.segmentedWrapper, { backgroundColor: dark ? tw.color.cardDark : tw.color.cardLight, borderBottomColor: borderColor }]}>
          <SegmentedControl
            options={segments}
            selected={tab}
            onChange={setTab}
          />
        </View>

        {/* Tab content */}
        {tab === 0 ? (
          /* Transactions tab */
          <View style={styles.tabContent}>
            {/* Search bar */}
            <View style={[styles.searchBar, { backgroundColor: dark ? tw.color.slate700 : tw.color.white, borderColor }]}>
              <Search size={15} color={muted} />
              <TextInput
                style={[styles.searchInput, { color: ink }]}
                placeholder="Search transactions…"
                placeholderTextColor={muted}
                value={txnSearch}
                onChangeText={handleSearch}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {txnSearch.length > 0 && (
                <Pressable onPress={() => { setTxnSearch(""); loadTxns(1, ""); }}>
                  <X size={13} color={muted} />
                </Pressable>
              )}
            </View>

            {/* Add transaction (manual accounts) */}
            {isManual && (
              <Pressable
                onPress={() => { setEditingTx(null); setShowTxForm(true); }}
                style={({ pressed }) => [styles.addTxBtn, { opacity: pressed ? 0.8 : 1 }]}
              >
                <Plus size={16} color={tw.color.white} />
                <Text style={styles.addTxBtnText}>Add transaction</Text>
              </Pressable>
            )}

            {/* Pagination */}
            {!isManual && txnPages > 1 && (
              <View style={styles.pagination}>
                <Pressable
                  disabled={txnPage <= 1}
                  onPress={() => { const p = txnPage - 1; setTxnPage(p); loadTxns(p, txnSearch); }}
                  style={[styles.pageBtn, { borderColor, opacity: txnPage <= 1 ? 0.4 : 1 }]}
                >
                  <Text style={[styles.pageBtnText, { color: ink }]}>Prev</Text>
                </Pressable>
                <Text style={[styles.pageLabel, { color: muted }]}>
                  {txnPage} / {txnPages}
                </Text>
                <Pressable
                  disabled={txnPage >= txnPages}
                  onPress={() => { const p = txnPage + 1; setTxnPage(p); loadTxns(p, txnSearch); }}
                  style={[styles.pageBtn, { borderColor, opacity: txnPage >= txnPages ? 0.4 : 1 }]}
                >
                  <Text style={[styles.pageBtnText, { color: ink }]}>Next</Text>
                </Pressable>
              </View>
            )}

            {txnLoading ? (
              <ActivityIndicator color={tw.color.indigo500} style={styles.centeredSpinner} />
            ) : txns.length === 0 ? (
              <Text style={[styles.emptyText, { color: muted }]}>
                {txnSearch ? "No matching transactions" : "No transactions"}
              </Text>
            ) : (
              <FlatList
                data={txns}
                keyExtractor={t => t.id}
                style={styles.txList}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ backgroundColor: cardBg, borderRadius: tw.radius["2xl"] }}
                renderItem={({ item: tx }) => {
                  const isMirror = tx.id.startsWith("mirror:");
                  return (
                    <TxRow
                      tx={tx}
                      dark={dark}
                      onPress={() => {
                        if (isManual && !isMirror) {
                          setEditingTx(tx);
                          setShowTxForm(true);
                        }
                        // For connected accounts, categorisation could open a sheet here
                      }}
                    />
                  );
                }}
              />
            )}

            {/* Saved toast */}
            {savedToast && (
              <View style={styles.savedToast}>
                <Check size={14} color={tw.color.white} />
                <Text style={styles.savedToastText}>Saved</Text>
              </View>
            )}
          </View>
        ) : isManual ? (
          /* Rules tab */
          <ScrollView style={styles.tabContent} contentContainerStyle={styles.rulesContainer}>
            <Text style={[styles.rulesDesc, { color: muted }]}>
              Auto-post matching transactions to this account.
            </Text>
            <Pressable
              onPress={() => {}}
              style={({ pressed }) => [styles.addRuleBtn, { opacity: pressed ? 0.8 : 1 }]}
            >
              <Plus size={16} color={tw.color.white} />
              <Text style={styles.addRuleBtnText}>Add rule</Text>
            </Pressable>

            {rulesLoading ? (
              <ActivityIndicator color={tw.color.indigo500} style={styles.centeredSpinner} />
            ) : rules.length === 0 ? (
              <Text style={[styles.emptyText, { color: muted }]}>No rules yet.</Text>
            ) : (
              <View style={styles.rulesList}>
                {rules.map(rule => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    dark={dark}
                    onToggle={() => handleToggleRule(rule)}
                    onEdit={() => {}}
                    onDelete={() => handleDeleteRule(rule)}
                  />
                ))}
              </View>
            )}
          </ScrollView>
        ) : (
          /* Categories tab */
          <ScrollView style={styles.tabContent} contentContainerStyle={styles.catsContainer}>
            {catLoading ? (
              <ActivityIndicator color={tw.color.indigo500} style={styles.centeredSpinner} />
            ) : categories.length === 0 ? (
              <Text style={[styles.emptyText, { color: muted }]}>No category data yet.</Text>
            ) : (
              <View style={styles.catsGrid}>
                {categories.map(cat => (
                  <View key={cat.name} style={styles.catGridCell}>
                    <CatCard cat={cat} total={catTotal} dark={dark} />
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        )}

        {/* Manual transaction form */}
        {showTxForm && (
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.formOverlay}
          >
            <Pressable style={styles.formBackdrop} onPress={() => setShowTxForm(false)} />
            <View style={[styles.formSheet, {
              backgroundColor: cardBg,
              paddingBottom: insets.bottom + tw.space[4],
            }]}>
              <View style={styles.formHandle} />
              <ManualTxForm
                accountId={account.id}
                tx={editingTx}
                dark={dark}
                onDone={() => {
                  setShowTxForm(false);
                  setEditingTx(null);
                  loadTxns(txnPage, txnSearch);
                }}
                onClose={() => { setShowTxForm(false); setEditingTx(null); }}
              />
            </View>
          </KeyboardAvoidingView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  detailHeader: {
    paddingHorizontal: tw.space[4],
    paddingBottom: tw.space[5],
  },
  detailTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: tw.space[4],
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1.5],
  },
  backLabel: {
    color: "rgba(255,255,255,0.8)",
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
  actionBtns: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
  },
  headerActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1],
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[1.5],
    borderRadius: tw.radius.xl,
  },
  headerActionBtnDestructive: {
    backgroundColor: "rgba(239,68,68,0.15)",
    paddingHorizontal: tw.space[2],
  },
  headerActionText: {
    color: "rgba(255,255,255,0.9)",
    ...tw.text.xs,
    fontWeight: tw.weight.semibold,
  },
  detailAccountName: {
    color: tw.color.white,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: tw.weight.bold,
    marginBottom: tw.space[2],
  },
  detailMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
  },
  typeBadge: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: tw.radius.full,
    paddingHorizontal: tw.space[2],
    paddingVertical: 2,
  },
  typeBadgeText: {
    color: "rgba(255,255,255,0.9)",
    ...tw.text.xs,
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.wide, 12),
  },
  detailBalance: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: tw.weight.bold,
    letterSpacing: tw.tracking(tw.trackingEm.tight, 24),
  },
  segmentedWrapper: {
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    borderBottomWidth: HAIRLINE,
  },
  tabContent: {
    flex: 1,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    marginHorizontal: tw.space[4],
    marginVertical: tw.space[3],
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[2.5],
  },
  searchInput: {
    flex: 1,
    ...tw.text.sm,
    padding: 0,
  },
  addTxBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1.5],
    backgroundColor: tw.color.indigo600,
    alignSelf: "flex-start",
    marginHorizontal: tw.space[4],
    marginBottom: tw.space[3],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[2],
    borderRadius: tw.radius.xl,
  },
  addTxBtnText: {
    color: tw.color.white,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  pagination: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: tw.space[4],
    marginBottom: tw.space[3],
  },
  pageBtn: {
    borderWidth: 1,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[1.5],
  },
  pageBtnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
  pageLabel: {
    ...tw.text.sm,
  },
  centeredSpinner: {
    marginTop: tw.space[8],
  },
  emptyText: {
    ...tw.text.sm,
    textAlign: "center",
    marginTop: tw.space[8],
  },
  txList: {
    marginHorizontal: tw.space[4],
    borderRadius: tw.radius["2xl"],
    overflow: "hidden",
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
  },
  txIcon: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  txIconText: {
    fontSize: 14,
    fontWeight: tw.weight.bold,
  },
  txMiddle: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  txName: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
  txMeta: {
    ...tw.text.xs,
  },
  txAmount: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
    flexShrink: 0,
  },
  savedToast: {
    position: "absolute",
    bottom: tw.space[6],
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1.5],
    backgroundColor: tw.color.emerald500,
    borderRadius: tw.radius.full,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[2],
  },
  savedToastText: {
    color: tw.color.white,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  rulesContainer: {
    padding: tw.space[4],
    gap: tw.space[4],
  },
  rulesDesc: {
    ...tw.text.sm,
  },
  addRuleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1.5],
    backgroundColor: tw.color.indigo600,
    alignSelf: "flex-start",
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[2],
    borderRadius: tw.radius.xl,
  },
  addRuleBtnText: {
    color: tw.color.white,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  rulesList: {
    gap: tw.space[2],
  },
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: tw.radius["2xl"],
    borderWidth: HAIRLINE,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    gap: tw.space[3],
  },
  ruleLeft: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  ruleName: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  ruleMeta: {
    ...tw.text.xs,
  },
  ruleRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    flexShrink: 0,
  },
  ruleActivePill: {
    borderRadius: tw.radius.full,
    paddingHorizontal: tw.space[2],
    paddingVertical: 2,
  },
  ruleActivePillText: {
    ...tw.text.xs,
    fontWeight: tw.weight.semibold,
  },
  catsContainer: {
    padding: tw.space[4],
  },
  catsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tw.space[3],
  },
  catGridCell: {
    width: "48%",
  },
  catCard: {
    borderRadius: tw.radius["2xl"],
    borderWidth: HAIRLINE,
    padding: tw.space[3],
    gap: tw.space[2],
  },
  catCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
  },
  catIcon: {
    width: 32,
    height: 32,
    borderRadius: tw.radius.lg,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  catHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  catName: {
    ...tw.text.xs,
    fontWeight: tw.weight.semibold,
  },
  catCount: {
    ...tw.text.xs,
  },
  catTotal: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
  },
  catBarTrack: {
    height: 4,
    borderRadius: tw.radius.full,
    overflow: "hidden",
  },
  catBarFill: {
    height: 4,
    borderRadius: tw.radius.full,
  },
  formOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  formBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  formSheet: {
    borderTopLeftRadius: tw.radius["3xl"],
    borderTopRightRadius: tw.radius["3xl"],
    paddingTop: tw.space[2],
    paddingHorizontal: tw.space[4],
    borderTopWidth: HAIRLINE,
  },
  formHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: tw.color.slate300,
    alignSelf: "center",
    marginBottom: tw.space[4],
  },
  formContainer: {
    gap: tw.space[4],
  },
  formHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  formTitle: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
  },
  formFields: {
    gap: tw.space[3],
  },
  formInput: {
    ...tw.text.sm,
    borderWidth: 1,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[2.5],
  },
  typeGrid: {
    flexDirection: "row",
    gap: tw.space[2],
  },
  typeBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: tw.radius.xl,
    paddingVertical: tw.space[2.5],
    alignItems: "center",
  },
  typeBtnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
  formError: {
    color: EXT.rose500,
    ...tw.text.xs,
  },
  formActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
  },
  deleteBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tw.radius.xl,
    backgroundColor: EXT.rose500 + "15",
  },
  cancelBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: tw.space[3],
  },
  cancelBtnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
  saveBtn: {
    flex: 2,
    backgroundColor: tw.color.indigo600,
    borderRadius: tw.radius["2xl"],
    paddingVertical: tw.space[3],
    alignItems: "center",
  },
  saveBtnText: {
    color: tw.color.white,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
});
