/**
 * Debt Plan screen — mobile port of frontend/app/debt-plan/DebtPlanPage.tsx.
 *
 * Layout order (top → bottom):
 *   1. Back nav
 *   2. Burndown chart (when projection exists)
 *   3. Verdict block
 *   4. Agency block (optional)
 *   5. Penny insight (optional)
 *   6. Missing-rates callout (optional)
 *   7. Trajectory blocks (optional)
 *   8. The Cards
 *   9. Transfer routes (optional)
 *
 * CardTermsSheet is a BottomSheet overlay driven by cardTermsOpen state.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { usePreferences } from "@/lib/PreferencesContext";
import { useTheme } from "@/lib/ThemeContext";
import { tw } from "@/lib/tw";
import {
  getDebtPlanView,
  getCardTerms,
  type DebtPlanView,
  type CardTermsCard,
} from "@/lib/api/debt";

import { BurndownChart } from "@/components/debt/BurndownChart";
import { VerdictBlock } from "@/components/debt/VerdictBlock";
import { AgencyBlock } from "@/components/debt/AgencyBlock";
import { PennyInsight } from "@/components/debt/PennyInsight";
import { MissingRatesCallout } from "@/components/debt/MissingRatesCallout";
import { TrajectoryBlock } from "@/components/debt/TrajectoryBlock";
import { DebtCard } from "@/components/debt/DebtCard";
import { TransferRoutes } from "@/components/debt/TransferRoutes";
import { CardTermsSheet } from "@/components/debt/CardTermsSheet";
import { Skeleton } from "@/components/ui/Skeleton";

// ── Skeleton loading state ────────────────────────────────────────────────────

function SkeletonCard({ dark }: { dark?: boolean }) {
  return (
    <View style={[sk.card, dark && sk.cardDark]}>
      <Skeleton width="40%" height={16} />
      <View style={sk.gap} />
      <Skeleton width="100%" height={12} />
      <View style={sk.gap} />
      <Skeleton width="75%" height={12} />
    </View>
  );
}

const sk = StyleSheet.create({
  card: {
    backgroundColor: tw.color.white,
    borderRadius: tw.radius["2xl"],
    padding: tw.space[4],
    borderWidth: 1,
    borderColor: tw.color.cardBorderLight,
  },
  cardDark: {
    backgroundColor: tw.color.slate800,
    borderColor: tw.color.cardBorderDark,
  },
  gap: { height: tw.space[2] },
});

// ── Screen ────────────────────────────────────────────────────────────────────

export default function DebtPlanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { hideNetWorth } = usePreferences();
  const { dark } = useTheme();

  const [plan, setPlan] = useState<DebtPlanView | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const [cardTermsCards, setCardTermsCards] = useState<CardTermsCard[]>([]);
  const [cardTermsReady, setCardTermsReady] = useState(false);
  const [cardTermsOpen, setCardTermsOpen] = useState(false);
  const [cardTermsStartId, setCardTermsStartId] = useState<string | null>(null);

  const loadPlan = useCallback(async () => {
    try {
      const data = await getDebtPlanView();
      setPlan(data);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCardTerms = useCallback(() => {
    getCardTerms()
      .then(r => {
        setCardTermsCards(r.cards);
        setCardTermsReady(true);
      })
      .catch(() => setCardTermsReady(true));
  }, []);

  useEffect(() => { loadPlan(); }, [loadPlan]);
  useEffect(() => { loadCardTerms(); }, [loadCardTerms]);

  function openSheet(accountId: string | null) {
    setCardTermsStartId(accountId);
    setCardTermsOpen(true);
  }

  function handleSaved() {
    loadCardTerms();
    loadPlan();
  }

  // ── Derived visibility flags ──────────────────────────────────────────────

  const showMissingRates =
    plan != null && plan.cards.some(c => c.flags.terms_missing && c.debt > 0);

  const showTwoTrajectory =
    plan != null &&
    (plan.totals.monthly_interest_now >= 1 ||
      (plan.totals.nonclearing.count > 0 &&
        plan.totals.nonclearing.monthly_interest_share >= 1) ||
      plan.totals.potential_monthly_interest >= 1 ||
      (!("note" in plan.scenario_b) &&
        plan.scenario_b.debt_free_month != null &&
        (plan.scenario_b.interest_saved ?? 0) >= 50));

  const showTransferRoutes = (plan?.refinance_options?.length ?? 0) > 0;

  const showAgency =
    plan != null &&
    (plan.extra_to_clear != null || (plan.whats_working?.length ?? 0) > 0);

  const showPennyInsight = plan != null && !!plan.narration?.text;

  const showBurndown = (plan?.projection?.length ?? 0) >= 1;

  // ── Render ────────────────────────────────────────────────────────────────

  const canvas = dark ? tw.color.canvasDark : tw.color.canvasLight;

  return (
    <View style={[s.root, { backgroundColor: canvas, paddingTop: insets.top }]}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + tw.space[10] },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Back nav */}
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [s.backBtn, pressed && s.backBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={15} color={dark ? tw.color.slate300 : tw.color.slate600} />
          <Text style={[s.backLabel, dark && s.backLabelDark]}>Back</Text>
        </Pressable>

        {/* Burndown chart (behind content, non-interactive) */}
        {showBurndown && plan?.projection && (
          <BurndownChart
            history={plan.history}
            projection={plan.projection}
            dark={dark}
          />
        )}

        {loading ? (
          <View style={s.stack}>
            <SkeletonCard dark={dark} />
            <SkeletonCard dark={dark} />
            <SkeletonCard dark={dark} />
          </View>
        ) : fetchError || !plan ? (
          <View style={[s.errorCard, dark && s.errorCardDark]}>
            <Text style={[s.errorText, dark && s.errorTextDark]}>
              The plan couldn't load — pull back and try again.
            </Text>
          </View>
        ) : (
          <View style={s.stack}>
            {/* 1. Verdict — always visible */}
            <VerdictBlock plan={plan} hide={hideNetWorth} dark={dark} />

            {/* 2. Agency block */}
            {showAgency && (
              <AgencyBlock plan={plan} hide={hideNetWorth} dark={dark} />
            )}

            {/* 3. Penny insight */}
            {showPennyInsight && (
              <PennyInsight
                plan={plan}
                hide={hideNetWorth}
                onAddRates={() => openSheet(null)}
                onOpenCard={id => openSheet(id)}
                dark={dark}
              />
            )}

            {/* 4. Missing-rates callout */}
            {showMissingRates && (
              <MissingRatesCallout
                plan={plan}
                onAddRates={() => openSheet(null)}
                dark={dark}
              />
            )}

            {/* 5. Trajectory: as-it-stands + dearest-card-first */}
            {showTwoTrajectory && (
              <TrajectoryBlock plan={plan} hide={hideNetWorth} dark={dark} />
            )}

            {/* 6. The Cards — always visible */}
            <DebtCard
              cards={plan.cards}
              hide={hideNetWorth}
              onOpenSheet={openSheet}
              dark={dark}
            />

            {/* 7. Transfer routes */}
            {showTransferRoutes && (
              <TransferRoutes plan={plan} hide={hideNetWorth} dark={dark} />
            )}
          </View>
        )}
      </ScrollView>

      {/* CardTermsSheet overlay */}
      <CardTermsSheet
        visible={cardTermsOpen}
        cards={cardTermsCards}
        ready={cardTermsReady}
        startAccountId={cardTermsStartId}
        onClose={() => {
          setCardTermsOpen(false);
          setCardTermsStartId(null);
        }}
        onSaved={handleSaved}
        dark={dark}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: tw.space[4],
    paddingTop: tw.space[6],
    paddingBottom: tw.space[10],
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1.5],
    marginBottom: tw.space[5],
    alignSelf: "flex-start",
    minHeight: 44,
  },
  backBtnPressed: {
    opacity: 0.7,
  },
  backLabel: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
    color: tw.color.slate600,
  },
  backLabelDark: {
    color: tw.color.slate300,
  },
  stack: {
    gap: tw.space[8],
  },
  errorCard: {
    backgroundColor: tw.color.white,
    borderRadius: tw.radius["2xl"],
    padding: tw.space[5],
    borderWidth: 1,
    borderColor: tw.color.cardBorderLight,
  },
  errorCardDark: {
    backgroundColor: tw.color.slate800,
    borderColor: tw.color.cardBorderDark,
  },
  errorText: {
    ...tw.text.sm,
    color: tw.color.slate700,
  },
  errorTextDark: {
    color: tw.color.slate200,
  },
});
