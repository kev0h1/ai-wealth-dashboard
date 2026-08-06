import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  Info,
  MessageCircle,
  Calendar,
  Send,
  Sparkles,
} from "lucide-react-native";
import { router } from "expo-router";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useTheme } from "@/lib/ThemeContext";
import { usePreferences } from "@/lib/PreferencesContext";
import { tw } from "@/lib/tw";
import { fmtGBP } from "@/lib/format";
import { insightsApi } from "@/lib/api/insights";

// ── Constants ─────────────────────────────────────────────────────────────────
const PA = 12570;
const TAPER_START = 100000;
const TAPER_END = 125140;

function taperLoss(income: number): number {
  const excess = Math.min(income, TAPER_END) - TAPER_START;
  return excess > 0 ? Math.floor(excess / 2) : 0;
}

function getTaxYear() {
  const now = new Date();
  const year = now.getFullYear();
  const cutoff = new Date(year, 3, 6); // April 6
  const start = now >= cutoff ? year : year - 1;
  const end = start + 1;
  const yearEnd = new Date(end, 3, 5); // April 5
  const daysLeft = Math.ceil((yearEnd.getTime() - now.getTime()) / 86400000);
  const yearStart = new Date(start, 3, 6);
  const totalDays = Math.ceil(
    (yearEnd.getTime() - yearStart.getTime()) / 86400000
  );
  const elapsed = totalDays - daysLeft;
  return {
    label: `${start}/${String(end).slice(2)}`,
    progressPct: Math.round((elapsed / totalDays) * 100),
    daysLeft,
    nextYear: `${end}/${String(end + 1).slice(2)}`,
    yearEnd,
    yearStart,
  };
}

type DoneKey =
  | "giftaid"
  | "isa"
  | "pension_carry"
  | "salary_sacrifice"
  | "eis_seis"
  | "self_assessment"
  | "tax_code";

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ label, dark }: { label: string; dark: boolean }) {
  return (
    <Text
      style={[
        sectionLabelStyles.label,
        { color: dark ? tw.color.slate400 : tw.color.slate500 },
      ]}
    >
      {label}
    </Text>
  );
}

const sectionLabelStyles = StyleSheet.create({
  label: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: tw.weight.bold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.widest, 11),
    marginBottom: tw.space[2],
    marginHorizontal: tw.space[4],
    marginTop: tw.space[2],
  },
});

type ActionRowProps = {
  doneKey: DoneKey;
  title: string;
  detail?: string;
  status: "done" | "warn" | "info";
  highlight?: boolean;
  done: boolean;
  onToggle: (key: DoneKey) => void;
  dark: boolean;
};

function ActionRow({
  doneKey,
  title,
  detail,
  status,
  highlight,
  done,
  onToggle,
  dark,
}: ActionRowProps) {
  const cardBg = dark ? tw.color.cardDark : tw.color.white;
  const cardBorder = highlight
    ? tw.color.amber400
    : dark
    ? tw.color.cardBorderDark
    : tw.color.cardBorderLight;
  const textPrimary = dark ? tw.color.slate100 : tw.color.slate800;
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate500;

  const IconEl =
    done || status === "done"
      ? CheckCircle2
      : status === "warn"
      ? AlertCircle
      : Info;
  const iconColor =
    done || status === "done"
      ? tw.color.emerald500
      : status === "warn"
      ? tw.color.amber500
      : tw.color.slate400;

  return (
    <Pressable
      onPress={() => onToggle(doneKey)}
      style={[
        actionRowStyles.row,
        {
          backgroundColor: cardBg,
          borderColor: cardBorder,
          borderWidth: highlight && !done ? 1.5 : 1,
        },
      ]}
    >
      <IconEl size={20} color={iconColor} />
      <View style={actionRowStyles.textBlock}>
        <Text
          style={[
            actionRowStyles.title,
            {
              color: textPrimary,
              textDecorationLine: done ? "line-through" : "none",
            },
          ]}
        >
          {title}
        </Text>
        {detail ? (
          <Text style={[actionRowStyles.detail, { color: textSecondary }]}>
            {detail}
          </Text>
        ) : null}
      </View>
      <View
        style={[
          actionRowStyles.checkbox,
          {
            backgroundColor: done ? tw.color.emerald500 : "transparent",
            borderColor: done
              ? tw.color.emerald500
              : dark
              ? tw.color.slate600
              : tw.color.slate300,
          },
        ]}
      >
        {done && <View style={actionRowStyles.checkDot} />}
      </View>
    </Pressable>
  );
}

const actionRowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: tw.radius["2xl"],
    padding: tw.space[4],
    marginHorizontal: tw.space[4],
    marginBottom: tw.space[2],
    gap: tw.space[3],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  textBlock: { flex: 1, gap: 2 },
  title: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  detail: {
    ...tw.text.xs,
    lineHeight: 16,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: tw.radius.full,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: tw.color.white,
  },
});

// ── Tax hero card ─────────────────────────────────────────────────────────────
type HeroVariant = "is125k" | "hasTaper" | "higher" | "basic";

function TaxHeroCard({
  variant,
  income,
  taxYear,
  dark,
}: {
  variant: HeroVariant;
  income: number;
  taxYear: ReturnType<typeof getTaxYear>;
  dark: boolean;
}) {
  const configs: Record<
    HeroVariant,
    { bg: string; border: string; title: string; body: string; accent: string }
  > = {
    is125k: {
      bg: dark ? "#1c1018" : tw.color.rose700 + "18",
      border: tw.color.rose500,
      title: "Your personal allowance is gone",
      body: `Above ${fmtGBP(TAPER_END)} your full ${fmtGBP(PA)} personal allowance is tapered away. Every £2 earned above ${fmtGBP(TAPER_START)} costs £1 of allowance — creating an effective 60% tax rate in that band.`,
      accent: tw.color.rose500,
    },
    hasTaper: {
      bg: dark ? "#1c1808" : tw.color.amber50,
      border: tw.color.amber400,
      title: "The 60% trap",
      body: `Your income puts you in the taper zone. A pension contribution of ${fmtGBP(Math.ceil(income - TAPER_START))} would bring you back below ${fmtGBP(TAPER_START)} and restore your personal allowance.`,
      accent: tw.color.amber600,
    },
    higher: {
      bg: dark ? "#0e0f1c" : tw.color.indigo50,
      border: tw.color.indigo200,
      title: "40% taxpayer",
      body:
        "Pension contributions get 40% tax relief at source. For every £600 you pay in, the government adds £400 — making it an easy win to grow your pot and cut your tax bill simultaneously.",
      accent: tw.color.indigo600,
    },
    basic: {
      bg: dark ? "#091a12" : tw.color.emerald50,
      border: tw.color.emerald200,
      title: "Basic rate taxpayer",
      body:
        "You're in a solid position. Focus on maximising your ISA (£20,000/year) and using your pension to build long-term wealth. Small, consistent contributions compound significantly over time.",
      accent: tw.color.emerald600,
    },
  };

  const cfg = configs[variant];

  return (
    <View
      style={[
        heroStyles.card,
        { backgroundColor: cfg.bg, borderColor: cfg.border },
      ]}
    >
      <Text style={[heroStyles.title, { color: cfg.accent }]}>
        {cfg.title}
      </Text>
      <Text
        style={[
          heroStyles.body,
          { color: dark ? tw.color.slate300 : tw.color.slate700 },
        ]}
      >
        {cfg.body}
      </Text>
      {/* Footer row */}
      <View style={heroStyles.footer}>
        <View
          style={[
            heroStyles.calIcon,
            { backgroundColor: dark ? tw.color.indigo800 : tw.color.indigo50 },
          ]}
        >
          <Calendar size={14} color={tw.color.indigo500} />
        </View>
        <Text
          style={[
            heroStyles.footerYear,
            { color: dark ? tw.color.slate300 : tw.color.slate600 },
          ]}
        >
          Tax year {taxYear.label}
        </Text>
        <View style={heroStyles.daysLeftBadge}>
          <Text style={heroStyles.daysLeftText}>
            {taxYear.daysLeft} days left
          </Text>
        </View>
      </View>
    </View>
  );
}

const heroStyles = StyleSheet.create({
  card: {
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
    marginHorizontal: tw.space[4],
    marginBottom: tw.space[3],
    padding: tw.space[4],
    gap: tw.space[3],
  },
  title: {
    ...tw.text.lg,
    fontWeight: tw.weight.bold,
  },
  body: {
    ...tw.text.sm,
    lineHeight: 21,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    marginTop: tw.space[1],
  },
  calIcon: {
    width: 28,
    height: 28,
    borderRadius: tw.radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  footerYear: {
    ...tw.text.xs,
    fontWeight: tw.weight.medium,
    flex: 1,
  },
  daysLeftBadge: {
    backgroundColor: tw.color.amber50,
    borderRadius: tw.radius.full,
    paddingHorizontal: tw.space[2],
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: tw.color.amber300,
  },
  daysLeftText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: tw.weight.semibold,
    color: tw.color.amber700,
  },
});

// ── Chat message type ─────────────────────────────────────────────────────────
type ChatMsg = { role: "user" | "assistant"; content: string };

function ChatBubble({ msg, dark }: { msg: ChatMsg; dark: boolean }) {
  const isUser = msg.role === "user";
  const parts = msg.content.split(/(\*\*[^*]+\*\*)/g);

  return (
    <View
      style={[
        chatStyles.bubble,
        isUser ? chatStyles.bubbleUser : chatStyles.bubbleAssistant,
        {
          backgroundColor: isUser
            ? tw.color.indigo600
            : dark
            ? tw.color.slate800
            : tw.color.white,
          alignSelf: isUser ? "flex-end" : "flex-start",
        },
      ]}
    >
      <Text
        style={[
          chatStyles.bubbleText,
          { color: isUser ? tw.color.white : dark ? tw.color.slate100 : tw.color.slate800 },
        ]}
      >
        {parts.map((part, i) => {
          if (part.startsWith("**") && part.endsWith("**")) {
            return (
              <Text key={i} style={{ fontWeight: tw.weight.bold }}>
                {part.slice(2, -2)}
              </Text>
            );
          }
          return part;
        })}
      </Text>
    </View>
  );
}

const chatStyles = StyleSheet.create({
  bubble: {
    maxWidth: "80%",
    borderRadius: tw.radius["2xl"],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    marginBottom: tw.space[2],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  bubbleUser: {
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    ...tw.text.sm,
    lineHeight: 20,
  },
});

// ── Tax Chat ──────────────────────────────────────────────────────────────────
function TaxChat({ dark }: { dark: boolean }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    const next: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setSending(true);
    try {
      const { reply } = await insightsApi.taxChat(
        next.map((m) => ({ role: m.role, content: m.content }))
      );
      setMessages([...next, { role: "assistant", content: reply }]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
      setMessages([
        ...next,
        {
          role: "assistant",
          content: "Sorry, I couldn't get a response. Please try again.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [input, sending, messages]);

  const inputBg = dark ? tw.color.slate700 : tw.color.slate100;
  const inputBorder = dark ? tw.color.slate600 : tw.color.slate200;
  const textPrimary = dark ? tw.color.slate100 : tw.color.slate800;
  const canvasBg = dark ? tw.color.canvasDark : tw.color.canvasLight;

  return (
    <>
      {/* FAB */}
      <Pressable
        onPress={() => setOpen(true)}
        style={fabStyles.fab}
        accessibilityLabel="Open tax chat"
      >
        <LinearGradient
          colors={["#4f46e5", "#7c3aed"]}
          style={fabStyles.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <MessageCircle size={24} color={tw.color.white} />
        </LinearGradient>
      </Pressable>

      <BottomSheet visible={open} onClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={fabStyles.sheetInner}
        >
          {/* Penny gradient header */}
          <LinearGradient
            colors={["#4f46e5", "#7c3aed"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={fabStyles.chatHeader}
          >
            <Sparkles size={16} color="rgba(255,255,255,0.85)" />
            <View style={fabStyles.chatHeaderText}>
              <Text style={fabStyles.chatHeaderName}>Penny</Text>
              <Text style={fabStyles.chatHeaderSub}>
                Tax questions · Powered by Claude
              </Text>
            </View>
          </LinearGradient>
          <ScrollView
            ref={scrollRef}
            style={fabStyles.chatScroll}
            contentContainerStyle={[
              fabStyles.chatContent,
              { backgroundColor: canvasBg },
            ]}
            onContentSizeChange={() =>
              scrollRef.current?.scrollToEnd({ animated: false })
            }
          >
            {messages.length === 0 && (
              <Text
                style={[
                  fabStyles.emptyHint,
                  { color: dark ? tw.color.slate500 : tw.color.slate400 },
                ]}
              >
                Ask me anything about UK tax — ISA limits, pension relief, self
                assessment…
              </Text>
            )}
            {messages.map((m, i) => (
              <ChatBubble key={i} msg={m} dark={dark} />
            ))}
            {sending && (
              <View
                style={[
                  chatStyles.bubble,
                  chatStyles.bubbleAssistant,
                  {
                    backgroundColor: dark ? tw.color.slate800 : tw.color.white,
                    alignSelf: "flex-start",
                  },
                ]}
              >
                <ActivityIndicator size="small" color={tw.color.indigo600} />
              </View>
            )}
          </ScrollView>
          <View
            style={[
              fabStyles.inputRow,
              { borderTopColor: dark ? tw.color.slate700 : tw.color.slate200 },
            ]}
          >
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Ask about UK tax…"
              placeholderTextColor={dark ? tw.color.slate500 : tw.color.slate400}
              style={[
                fabStyles.textInput,
                {
                  backgroundColor: inputBg,
                  borderColor: inputBorder,
                  color: textPrimary,
                },
              ]}
              onSubmitEditing={handleSend}
              returnKeyType="send"
              multiline={false}
            />
            <Pressable
              onPress={handleSend}
              disabled={sending || !input.trim()}
              style={[
                fabStyles.sendBtn,
                { opacity: sending || !input.trim() ? 0.5 : 1 },
              ]}
            >
              <Send size={18} color={tw.color.white} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </BottomSheet>
    </>
  );
}

const fabStyles = StyleSheet.create({
  fab: {
    position: "absolute",
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: tw.radius.full,
    shadowColor: tw.color.indigo600,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  gradient: {
    width: 56,
    height: 56,
    borderRadius: tw.radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetInner: {
    height: 480,
  },
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[3],
    marginBottom: tw.space[3],
  },
  chatHeaderText: {
    gap: 2,
  },
  chatHeaderName: {
    ...tw.text.sm,
    fontWeight: tw.weight.bold,
    color: tw.color.white,
  },
  chatHeaderSub: {
    fontSize: 11,
    lineHeight: 14,
    color: "rgba(255,255,255,0.75)",
  },
  chatScroll: {
    flex: 1,
    borderRadius: tw.radius.xl,
    marginBottom: tw.space[3],
  },
  chatContent: {
    padding: tw.space[3],
    flexGrow: 1,
    borderRadius: tw.radius.xl,
  },
  emptyHint: {
    ...tw.text.sm,
    textAlign: "center",
    marginTop: tw.space[8],
    lineHeight: 22,
    paddingHorizontal: tw.space[4],
  },
  inputRow: {
    flexDirection: "row",
    gap: tw.space[2],
    borderTopWidth: 1,
    paddingTop: tw.space[3],
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    ...tw.text.sm,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: tw.radius.full,
    backgroundColor: tw.color.indigo600,
    alignItems: "center",
    justifyContent: "center",
  },
});

// ── Also worth knowing (collapsible) ─────────────────────────────────────────
const ALSO_WORTH = [
  {
    key: "pension_carry" as DoneKey,
    title: "Pension carry forward",
    detail:
      "You can use unused annual pension allowances from the past 3 tax years, potentially contributing up to £180,000 in one year.",
  },
  {
    key: "salary_sacrifice" as DoneKey,
    title: "Salary sacrifice",
    detail:
      "Salary sacrifice pension contributions also save National Insurance — typically 2–13.8% extra saving on top of income tax relief.",
  },
  {
    key: "eis_seis" as DoneKey,
    title: "EIS / SEIS",
    detail:
      "Enterprise Investment Scheme (30% relief) and Seed EIS (50% relief) can significantly cut your tax bill while backing UK startups.",
  },
  {
    key: "self_assessment" as DoneKey,
    title: "Self assessment deadline",
    detail:
      "Online returns must be filed by 31 Jan. Late filing incurs a £100 immediate penalty, with further charges after 3 and 6 months.",
  },
  {
    key: "tax_code" as DoneKey,
    title: "Check your tax code",
    detail:
      "Millions of PAYE workers have the wrong tax code. Check yours via HMRC online — errors can mean overpaying for years.",
  },
];

// ── Key dates card ────────────────────────────────────────────────────────────
const KEY_DATES = [
  {
    date: "5 Apr",
    label: "Tax year end",
    detail: "ISA & pension allowances reset. Last day to use this year's limits.",
    urgent: false,
  },
  {
    date: "31 Jul",
    label: "Second payment on account",
    detail: "If you're in self assessment, your second instalment is due.",
    urgent: false,
  },
  {
    date: "31 Jan",
    label: "Self assessment deadline",
    detail: "Online tax returns due. Balance of tax owed must be paid.",
    urgent: true,
  },
];

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  embedded?: boolean;
}

// ── Main component ────────────────────────────────────────────────────────────
export function TaxPage({ embedded = false }: Props) {
  const { dark } = useTheme();
  const { rawPrefs } = usePreferences();

  const [doneItems, setDoneItems] = useState<Set<DoneKey>>(new Set());
  const [alsoOpen, setAlsoOpen] = useState(false);

  const taxYear = getTaxYear();

  // Pull income data from rawPrefs (income_value, income_bracket, etc.)
  const incomeValue: number =
    typeof rawPrefs?.income_value === "number" ? rawPrefs.income_value : 0;
  const hasChildBenefit: boolean =
    typeof rawPrefs?.has_child_benefit === "boolean"
      ? rawPrefs.has_child_benefit
      : false;

  // Determine variant
  let heroVariant: HeroVariant = "basic";
  if (incomeValue >= TAPER_END) {
    heroVariant = "is125k";
  } else if (incomeValue > TAPER_START) {
    heroVariant = "hasTaper";
  } else if (incomeValue > 50270) {
    heroVariant = "higher";
  }

  const hasTaperIssue = incomeValue > TAPER_START && incomeValue < TAPER_END;
  const pensionNeeded = hasTaperIssue ? Math.ceil(incomeValue - TAPER_START) : 0;

  const toggleDone = useCallback((key: DoneKey) => {
    setDoneItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const canvasBg = dark ? tw.color.canvasDark : tw.color.canvasLight;
  const textPrimary = dark ? tw.color.slate100 : tw.color.slate800;
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate500;
  const cardBg = dark ? tw.color.cardDark : tw.color.white;
  const cardBorder = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;

  // ── Embedded summary ───────────────────────────────────────────────────────
  if (embedded) {
    return (
      <View style={embeddedStyles.container}>
        <TaxHeroCard
          variant={heroVariant}
          income={incomeValue}
          taxYear={taxYear}
          dark={dark}
        />
        <Pressable
          onPress={() => router.push("/insights/tax")}
          style={[
            embeddedStyles.openBtn,
            { backgroundColor: cardBg, borderColor: cardBorder },
          ]}
        >
          <Text style={[embeddedStyles.openBtnText, { color: textPrimary }]}>
            Open full tax planner
          </Text>
          <ChevronLeft
            size={16}
            color={tw.color.indigo500}
            style={{ transform: [{ rotate: "180deg" }] }}
          />
        </Pressable>
      </View>
    );
  }

  // ── Full screen ────────────────────────────────────────────────────────────
  return (
    <SafeAreaView
      edges={["top"]}
      style={[fullStyles.safeArea, { backgroundColor: canvasBg }]}
    >
      {/* Header */}
      <View style={[fullStyles.header, { backgroundColor: canvasBg }]}>
        <Pressable
          onPress={() => router.back()}
          style={fullStyles.backBtn}
          hitSlop={8}
          accessibilityLabel="Go back"
        >
          <ChevronLeft size={24} color={textPrimary} />
        </Pressable>
        <View style={fullStyles.headerCenter}>
          <Text style={[fullStyles.headerTitle, { color: textPrimary }]}>
            Tax efficiency
          </Text>
          <Text style={[fullStyles.headerYear, { color: textSecondary }]}>
            {taxYear.label}
          </Text>
        </View>
        <View style={fullStyles.headerRight} />
      </View>

      {/* Progress bar */}
      <View style={fullStyles.progressTrack}>
        <View
          style={[
            fullStyles.progressFill,
            { width: `${taxYear.progressPct}%` },
          ]}
        />
      </View>
      <View style={[fullStyles.progressLabels, { paddingHorizontal: tw.space[4] }]}>
        <Text style={[fullStyles.progressLabel, { color: textSecondary }]}>
          6 Apr
        </Text>
        <Text style={[fullStyles.progressLabelCenter, { color: tw.color.amber600 }]}>
          {taxYear.daysLeft} days left
        </Text>
        <Text style={[fullStyles.progressLabel, { color: textSecondary }]}>
          5 Apr
        </Text>
      </View>

      <ScrollView
        style={fullStyles.scroll}
        contentContainerStyle={fullStyles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <TaxHeroCard
          variant={heroVariant}
          income={incomeValue}
          taxYear={taxYear}
          dark={dark}
        />

        {/* YOUR LEVERS */}
        <SectionLabel label="Your levers" dark={dark} />

        {/* Pension lever */}
        <ActionRow
          doneKey="pension_carry"
          title={
            hasTaperIssue
              ? `Pension: contribute ${fmtGBP(pensionNeeded)} to escape taper`
              : incomeValue > 50270
              ? "Pension: 40% tax relief available"
              : "Pension: 20% tax relief on contributions"
          }
          detail={
            hasTaperIssue
              ? `Your income of ${fmtGBP(incomeValue)} falls in the 60% trap. A contribution of ${fmtGBP(pensionNeeded)} brings you back to ${fmtGBP(TAPER_START)}.`
              : incomeValue > 50270
              ? "For every £600 you put in, the government adds £400."
              : "Basic rate relief is automatic — provider claims it for you."
          }
          status={hasTaperIssue ? "warn" : "done"}
          done={doneItems.has("pension_carry")}
          onToggle={toggleDone}
          dark={dark}
        />

        {/* Gift Aid */}
        <ActionRow
          doneKey="giftaid"
          title="Gift Aid your charitable donations"
          detail="Charities claim 25p per £1 donated. Higher-rate taxpayers can claim the extra 20% via self assessment."
          status="info"
          done={doneItems.has("giftaid")}
          onToggle={toggleDone}
          dark={dark}
        />

        {/* Child Benefit trap */}
        {hasChildBenefit && incomeValue > 60000 && (
          <ActionRow
            doneKey="salary_sacrifice"
            title="Child Benefit High Income Charge"
            detail={`Your income exceeds £60,000. You'll repay some Child Benefit via your tax return. Pension contributions that bring income below £60,000 remove this charge.`}
            status="warn"
            done={doneItems.has("salary_sacrifice")}
            onToggle={toggleDone}
            dark={dark}
          />
        )}

        {/* ISA */}
        <ActionRow
          doneKey="isa"
          title="Use your ISA allowance (£20,000)"
          detail="Gains and interest in an ISA are tax-free for life. Once the tax year ends, this year's allowance is gone forever."
          status="info"
          highlight={taxYear.daysLeft < 90}
          done={doneItems.has("isa")}
          onToggle={toggleDone}
          dark={dark}
        />

        {/* Also worth knowing */}
        <Pressable
          onPress={() => setAlsoOpen((o) => !o)}
          style={[
            collapsibleStyles.header,
            { borderColor: dark ? tw.color.slate700 : tw.color.slate200 },
          ]}
        >
          <Text style={[collapsibleStyles.title, { color: textSecondary }]}>
            Also worth knowing
          </Text>
          {alsoOpen ? (
            <ChevronUp size={16} color={textSecondary} />
          ) : (
            <ChevronDown size={16} color={textSecondary} />
          )}
        </Pressable>
        {alsoOpen &&
          ALSO_WORTH.map((item) => (
            <ActionRow
              key={item.key}
              doneKey={item.key}
              title={item.title}
              detail={item.detail}
              status="info"
              done={doneItems.has(item.key)}
              onToggle={toggleDone}
              dark={dark}
            />
          ))}

        {/* KEY DATES */}
        <SectionLabel label="Key dates" dark={dark} />

        <View
          style={[
            keyDatesStyles.card,
            { backgroundColor: cardBg, borderColor: cardBorder },
          ]}
        >
          {KEY_DATES.map((d, i) => (
            <React.Fragment key={d.date}>
              {i > 0 && (
                <View
                  style={[
                    keyDatesStyles.divider,
                    {
                      backgroundColor: dark
                        ? tw.color.slate700
                        : tw.color.slate100,
                    },
                  ]}
                />
              )}
              <View style={keyDatesStyles.dateRow}>
                <View
                  style={[
                    keyDatesStyles.dateBadge,
                    {
                      backgroundColor: d.urgent
                        ? tw.color.amber50
                        : dark
                        ? tw.color.slate700
                        : tw.color.indigo50,
                    },
                  ]}
                >
                  <Text
                    style={[
                      keyDatesStyles.dateText,
                      {
                        color: d.urgent ? tw.color.amber700 : tw.color.indigo600,
                      },
                    ]}
                  >
                    {d.date}
                  </Text>
                </View>
                <View style={keyDatesStyles.dateInfo}>
                  <Text style={[keyDatesStyles.dateLabel, { color: textPrimary }]}>
                    {d.label}
                  </Text>
                  <Text style={[keyDatesStyles.dateDetail, { color: textSecondary }]}>
                    {d.detail}
                  </Text>
                </View>
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* Disclaimer */}
        <Text style={[fullStyles.disclaimer, { color: textSecondary }]}>
          This is general information, not personal tax advice. Consult a
          qualified accountant or tax adviser before making financial decisions.
        </Text>
      </ScrollView>

      {/* Tax Chat FAB */}
      <TaxChat dark={dark} />
    </SafeAreaView>
  );
}

const embeddedStyles = StyleSheet.create({
  container: {
    gap: tw.space[2],
  },
  openBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: tw.space[4],
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  openBtnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
});

const fullStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tw.radius.full,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    ...tw.text.lg,
    fontWeight: tw.weight.bold,
  },
  headerYear: {
    ...tw.text.xs,
  },
  headerRight: {
    width: 40,
  },
  progressTrack: {
    height: 4,
    backgroundColor: tw.color.indigo200,
    marginHorizontal: tw.space[4],
    borderRadius: tw.radius.full,
    overflow: "hidden",
    marginBottom: 4,
  },
  progressFill: {
    height: 4,
    backgroundColor: tw.color.indigo600,
    borderRadius: tw.radius.full,
  },
  progressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: tw.space[3],
  },
  progressLabel: {
    ...tw.text["11"],
  },
  progressLabelCenter: {
    ...tw.text["11"],
    fontWeight: tw.weight.semibold,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  disclaimer: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginHorizontal: tw.space[6],
    marginTop: tw.space[4],
    marginBottom: tw.space[4],
  },
});

const collapsibleStyles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    borderTopWidth: 1,
    marginBottom: tw.space[2],
  },
  title: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
});

const keyDatesStyles = StyleSheet.create({
  card: {
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
    marginHorizontal: tw.space[4],
    marginBottom: tw.space[3],
    padding: tw.space[4],
    gap: tw.space[3],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  divider: {
    height: 1,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tw.space[3],
  },
  dateBadge: {
    borderRadius: tw.radius.lg,
    paddingHorizontal: tw.space[2],
    paddingVertical: tw.space[1],
    minWidth: 52,
    alignItems: "center",
  },
  dateText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: tw.weight.bold,
  },
  dateInfo: {
    flex: 1,
    gap: 2,
  },
  dateLabel: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  dateDetail: {
    ...tw.text.xs,
    lineHeight: 17,
  },
});
