"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { Check, ChevronDown, Crown, FileText, Globe, Landmark, Smartphone, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { invalidateOpenBankingAccess } from "@/lib/openBankingAccess";
import { trialCancelLine, trialDisclosureLine, trialHeadline, trialTermsLine } from "@/lib/billingCopy";
import { usePurchaseChannel, PURCHASE_UNAVAILABLE_SENTENCE } from "@/lib/nativeAuth";
import { describeProductLookup, errorKind, reportStoreDiagnostic, storePriceState } from "@/lib/storePriceState";
import {
  loadPlayConfig, loadPlaySubscriptionProducts, openManagePlaySubscriptions, purchasePlaySubscription,
  restorePlayPurchases, type PlayBillingConfig, type PlayProductView,
} from "@/lib/playBilling";
import {
  loadIapConfig, loadStoreProducts, openManageSubscriptions, purchaseSubscription, restorePurchases,
  syncUnfinishedTransactions, type AppleIapConfig, type StoreProductView,
} from "@/lib/storekit";
import type {
  SubscriptionBillingPeriod,
  SubscriptionBillingPeriodDetail,
  SubscriptionInfo,
  SubscriptionTier,
} from "@wealth/shared";

type PaidTier = Exclude<SubscriptionTier, "statements">;
type Tier = {
  id: SubscriptionTier;
  name: string;
  lead: string;
  includes: string[];
  icon: typeof FileText;
};

const TIERS: Tier[] = [
  {
    id: "statements",
    name: "Statements",
    lead: "A clear money view from uploaded statements.",
    includes: ["3 statement uploads a month", "90 days of history", "10 Penny messages a month"],
    icon: FileText,
  },
  {
    id: "lite",
    name: "Lite",
    lead: "Keep up with day-to-day money across your main banks.",
    includes: ["Up to 10 connected accounts", "40 Penny messages a month", "All features"],
    icon: Landmark,
  },
  {
    id: "standard",
    name: "Standard",
    lead: "Your full money picture, kept up to date through the day.",
    includes: ["Up to 25 connected accounts", "150 Penny messages a month", "All features"],
    icon: Zap,
  },
  {
    id: "plus",
    name: "Plus",
    lead: "No limit on accounts, and the most Penny messages.",
    includes: ["Unlimited connected accounts", "300 Penny messages a month", "All features"],
    icon: Crown,
  },
];

// Fallback only — used when an older API payload doesn't send
// `info.billing_periods` yet (B22 added it). A live payload drives the
// period buttons entirely off `info.billing_periods[selectedTier]`. Lists
// only the currently-enabled periods (B27, 2026-09-12: three_months
// dropped) — SubscriptionBillingPeriod itself stays a superset because
// `billing_prices_gbp` still carries a three_months column as reference
// data, but nothing offered to a user should include it.
const FALLBACK_PERIODS: { id: SubscriptionBillingPeriod; months: number }[] = [
  { id: "monthly", months: 1 },
  { id: "six_months", months: 6 },
  { id: "annual", months: 12 },
];

// Short button headline and the sentence-form renewal words, both display
// concerns only — every price/saving figure comes from the server. Partial
// because they only need to cover the currently-enabled periods above;
// every lookup site falls back to something sensible if a period turns up
// that isn't listed here.
const SHORT_LABELS: Partial<Record<SubscriptionBillingPeriod, string>> = {
  monthly: "Monthly",
  six_months: "6 months",
  annual: "Yearly",
};
const RENEWAL_WORDS: Partial<Record<SubscriptionBillingPeriod, string>> = {
  monthly: "every month",
  six_months: "every 6 months",
  annual: "every year",
};

// B29: a native build can neither start Checkout nor open the Stripe
// customer portal (see canPurchaseInApp's own doc comment), so a native
// user with an existing paid subscription previously landed on a bare
// status line with no button and, critically, no way anywhere to fix a
// failed payment or cancel — a dead end that contradicts TERMS.md
// section 9's "you can cancel from Settings, Your plan, or the app
// store" promise, since neither route exists on native. This is a
// plain-text pointer, not a link or button, and it names an existing
// account rather than offering to start one, so App Store guideline
// 3.1.1 (which restricts starting a new purchase, not managing one you
// already have) does not apply.
const NATIVE_MANAGE_SUBSCRIPTION_LINE = "You can update your payment method, change your plan, or cancel from a browser at wealth.auriqltd.co.uk, under Settings, Your plan.";

// C21: the key a (tier, period) pair has in the server's product table
// (GET /billing/apple/account-token): the tier name for monthly, then
// "<tier>_<period>". The product id behind it comes from that response, never
// from this file.
function storeProductKey(tier: SubscriptionTier, period: SubscriptionBillingPeriod): string {
  return period === "monthly" ? tier : `${tier}_${period}`;
}

// C21: iOS Settings is where an App Store subscription is changed or
// cancelled, so this is the manage line for an Apple-sourced plan on any
// platform (B29's browser line is for Stripe-sourced plans).
const APPLE_MANAGE_LINE = "Change or cancel it in iOS Settings, under Subscriptions.";

// C24: Google Play is where a Play subscription is changed or cancelled. The
// plugin cannot send Play's replacement mode, so a second subscription is
// never bought on top of a live one; the change happens in Google Play.
const PLAY_MANAGE_LINE = "Change or cancel it in Google Play, under Subscriptions.";

function money(value: number): string {
  return Number.isFinite(value) ? `£${value.toFixed(2)}` : "Price unavailable";
}

function tierPrice(info: SubscriptionInfo, tier: SubscriptionTier, period: SubscriptionBillingPeriod): number {
  const configured = info?.billing_prices_gbp?.[tier]?.[period];
  if (typeof configured === "number") return configured;
  const monthly = info.prices_gbp?.[tier];
  const months = FALLBACK_PERIODS.find((item) => item.id === period)?.months ?? 1;
  return typeof monthly === "number" ? monthly * months : Number.NaN;
}

/** B22: every period's months/label/total/saving_gbp/per_month_gbp for
 * `tier`, driven by `info.billing_periods[tier]` (the ordered,
 * already-enabled-only list the server builds from
 * app.core.subscription.billing_period_detail). Falls back to computing
 * the same shape from `billing_prices_gbp`/`prices_gbp` against a fixed
 * period list for an older API payload that predates `billing_periods` —
 * that fallback has no discount data, so its saving is always £0. */
function periodDetailsFor(info: SubscriptionInfo, tier: SubscriptionTier): SubscriptionBillingPeriodDetail[] {
  const fromApi = info.billing_periods?.[tier];
  if (fromApi && fromApi.length > 0) return fromApi;
  return FALLBACK_PERIODS.map(({ id, months }) => {
    const total = tierPrice(info, tier, id);
    const perMonth = Number.isFinite(total) ? Math.round((total / months) * 100) / 100 : Number.NaN;
    return { id, label: SHORT_LABELS[id] ?? id, months, total, saving_gbp: 0, per_month_gbp: perMonth };
  });
}

function displayIsoDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function accountDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }).format(date) : null;
}

function MoneyCopy({ text }: { text: string }) {
  return <>{text.split(/(£\d+(?:\.\d+)?)/g).map((part, index) => part.startsWith("£") ? <span key={index} className="money tabular-nums">{part}</span> : part)}</>;
}

function moveRadio(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  count: number,
  select: (nextIndex: number) => void,
) {
  let next = index;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % count;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + count) % count;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = count - 1;
  else return;
  event.preventDefault();
  select(next);
  const group = event.currentTarget.closest('[role="radiogroup"]');
  requestAnimationFrame(() => group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus());
}

export default function PlanPicker({
  info,
  context,
  onContinue,
  previewOnly = false,
  nativeOverride,
}: {
  info: SubscriptionInfo;
  context: "settings" | "onboarding";
  onContinue?: () => void;
  previewOnly?: boolean;
  /** B29: design-preview-only escape hatch. `canPurchaseInApp()` reads the
   * real Capacitor runtime, which is never native inside a browser preview,
   * so `/design/your-plan` had no way to render the native-gated states at
   * all (the review that raised B29 flagged this). Leave undefined in every
   * production call site (Settings, onboarding) so real behaviour is
   * untouched; the preview alone passes `true`/`false` to force the branch
   * it wants to screenshot. */
  nativeOverride?: boolean;
}) {
  const current = info.tier;
  const [selected, setSelected] = useState<SubscriptionTier>(() => context === "onboarding" ? "statements" : (info?.tier ?? "statements"));
  const [period, setPeriod] = useState<SubscriptionBillingPeriod>(info?.billing_period ?? "monthly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = TIERS.find((tier) => tier.id === selected) ?? TIERS[0];
  const periods = useMemo(() => periodDetailsFor(info, selected), [info, selected]);
  const chosenPeriod = periods.find((item) => item.id === period) ?? periods[0];
  const effectivePeriod = chosenPeriod?.id ?? period;
  const total = chosenPeriod?.total ?? Number.NaN;
  const priceReady = Number.isFinite(total) && total > 0;
  const renewalWords = RENEWAL_WORDS[effectivePeriod] ?? "each period";
  const trialDays = info.trial_days ?? 14;
  // B22: which periods carry the trial is server-decided (Kevin-flippable,
  // app.core.subscription.SUBSCRIPTION_TRIAL_PERIODS) — no longer hardcoded
  // to annual. An older API payload without `trial_periods` falls back to
  // annual-only, matching pre-B22 behaviour.
  const trialPeriods = info.trial_periods ?? ["annual"];
  const isTrialPeriod = trialPeriods.includes(effectivePeriod);
  const chargeDateText = info.trial_charge_on ? displayIsoDate(info.trial_charge_on) : null;
  const trialChargeTiming = chargeDateText ? `on ${chargeDateText}` : `after your ${trialDays}-day trial`;
  const cancelByText = chargeDateText ? `before ${chargeDateText}` : "before your trial ends";
  const billingLive = info.billing_live ?? false;
  const hasPaidSubscription = info.has_paid_subscription === true;
  const managedPaidSubscription = hasPaidSubscription && ["active", "trialing", "past_due"].includes(info.status);
  // C21: an Apple-sourced plan never goes to the Stripe portal (that account
  // does not exist); it is managed in iOS Settings.
  // C24: likewise a Google Play plan is managed in Google Play, never Stripe.
  const billingChangeInPortal = context === "settings" && managedPaidSubscription && info.billing_provider !== "apple" && info.billing_provider !== "google";
  // B45: every paid plan starts with the trial, so it is no longer an
  // opt-in switch. It simply applies whenever the period carries one and
  // Checkout would grant it (one per person, `trial_eligible` from the
  // server; absent or null when the check could not run, in which case no trial
  // statement is promised and Checkout still decides).
  const trialEligible = info.trial_eligible ?? false;
  const trialActive = isTrialPeriod && trialEligible && !hasPaidSubscription && priceReady;
  // B26: Apple's guideline 3.1.1 (and, for now, Android not being enrolled
  // in Play's billing-choice programme) means a native build can never
  // start Stripe Checkout or open the Stripe customer portal, regardless
  // of whether billing is live server-side. Free-plan selection is
  // untouched by this, it never talks to Stripe. B29: `nativeOverride`
  // only exists for the design preview (see the prop's own doc comment);
  // every real caller leaves it undefined, so this reduces to the
  // real availability everywhere it matters. B40: real availability comes
  // from usePurchaseAvailability(), not a direct canPurchaseInApp() call,
  // so this starts (and, on the server, stays) "unknown" — never "web" —
  // until an effect resolves it against the real Capacitor bridge after
  // mount; see that hook's own comment.
  const channel = usePurchaseChannel();
  const purchasingAllowed = nativeOverride === undefined ? channel === "stripe_web" : !nativeOverride;
  // C21: the iOS build buys through StoreKit, never Stripe. `storekit` is only
  // true in a real iOS binary that contains the plugin (see
  // lib/purchaseChannel.ts); the design preview's nativeOverride never
  // enables it.
  const storekit = nativeOverride === undefined && channel === "storekit";
  const appleManaged = context === "settings" && managedPaidSubscription && info.billing_provider === "apple";
  const [iap, setIap] = useState<AppleIapConfig | null>(null);
  const [iapState, setIapState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [storeProducts, setStoreProducts] = useState<Record<string, StoreProductView>>({});
  const [notice, setNotice] = useState<string | null>(null);

  // C24: the Android build buys through Google Play Billing, never Stripe.
  // `play` is only true in a real Android binary that contains the plugin
  // (lib/purchaseChannel.ts); the design preview's nativeOverride never
  // enables it. Product ids, prices and the trial all come from the server
  // config and the store, nothing is written in this file.
  const play = nativeOverride === undefined && channel === "play";
  const playManaged = context === "settings" && managedPaidSubscription && info.billing_provider === "google";
  const [playCfg, setPlayCfg] = useState<PlayBillingConfig | null>(null);
  const [playState, setPlayState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [playProducts, setPlayProducts] = useState<Record<string, PlayProductView>>({});
  // G294: bumping this re-runs the store loaders ("Try again").
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!play) return;
    let live = true;
    setPlayState("loading");
    setPlayProducts({});
    (async () => {
      try {
        const config = await loadPlayConfig();
        if (!live) return;
        setPlayCfg(config);
        if (!config.enabled) { setPlayState("failed"); return; }
        const ids = Object.entries(config.products ?? {}).filter(([key]) => !key.startsWith("penny_")).map(([, id]) => id);
        const views = await loadPlaySubscriptionProducts(ids);
        if (!live) return;
        reportStoreDiagnostic("playProductsLoaded", describeProductLookup(ids, Object.keys(views)), "android");
        setPlayProducts(views);
        setPlayState("ready");
        // A purchase whose verification was interrupted is still held by Play;
        // restoring re-sends it (idempotent) and refreshes the plan.
        const { restored } = await restorePlayPurchases(config);
        if (restored > 0) { await invalidateOpenBankingAccess(); }
      } catch (e) {
        if (live) {
          reportStoreDiagnostic("playProductsFailed", errorKind(e), "android");
          setPlayState("failed");
        }
      }
    })();
    return () => { live = false; };
  }, [play, reloadNonce]);

  useEffect(() => {
    if (!storekit) return;
    let live = true;
    setIapState("loading");
    setStoreProducts({});
    (async () => {
      try {
        const config = await loadIapConfig();
        if (!live) return;
        setIap(config);
        if (!config.enabled) { setIapState("failed"); return; }
        const ids = Object.entries(config.products).filter(([key]) => !key.startsWith("penny_")).map(([, id]) => id);
        const views = await loadStoreProducts(ids);
        if (!live) return;
        reportStoreDiagnostic("iapProductsLoaded", describeProductLookup(ids, Object.keys(views)), "ios");
        setStoreProducts(views);
        setIapState("ready");
        // A purchase whose verification was interrupted is still queued in StoreKit.
        if (await syncUnfinishedTransactions(config)) { await invalidateOpenBankingAccess(); }
      } catch (e) {
        if (live) {
          reportStoreDiagnostic("iapProductsFailed", errorKind(e), "ios");
          setIapState("failed");
        }
      }
    })();
    return () => { live = false; };
  }, [storekit, reloadNonce]);

  const selectedStoreKey = selected === "statements" ? null : storeProductKey(selected, effectivePeriod);
  const selectedStoreView = selectedStoreKey && iap ? storeProducts[iap.products[selectedStoreKey]] : undefined;
  const storeBuy = storekit && !billingChangeInPortal && !appleManaged && selected !== "statements";
  const storeReady = Boolean(iap?.enabled && iap.purchase_allowed && iapState === "ready" && selectedStoreView);

  const selectedPlayKey = selected === "statements" ? null : storeProductKey(selected, effectivePeriod);
  const selectedPlayView = selectedPlayKey && playCfg?.products ? playProducts[playCfg.products[selectedPlayKey]] : undefined;
  // G294: loading only while the store is still being asked; a finished call
  // with no entry for the selected product is unavailable, not loading.
  const playPrice = storePriceState(playState, Boolean(selectedPlayView));
  const storePrice = storePriceState(iapState, Boolean(selectedStoreView));
  const playBuy = play && !billingChangeInPortal && !playManaged && selected !== "statements";
  const playReady = Boolean(
    playCfg?.enabled && !playCfg.purchase_blocked && !playCfg.subscription_managed_in_play
    && playState === "ready" && selectedPlayView,
  );
  // One in-app store purchase at a time: StoreKit or Play, never both.
  const inAppBuy = storeBuy || playBuy;
  const inAppView = storeBuy ? selectedStoreView : playBuy ? selectedPlayView : undefined;

  // B22: the exact disclosure the trial control needs adjacent to it —
  // the amount, the named charge date, and a cancel-any-time line naming
  // where to cancel. Kept as two named strings (not one) so both can be
  // rendered right under the trial switch as well as echoed in the
  // confirm-button panel below.
  const trialDisclosureText = trialDisclosureLine(trialDays, total, trialChargeTiming, renewalWords);
  const trialCancelText = trialCancelLine(cancelByText);

  const disclosure = useMemo(() => {
    if (appleManaged) {
      if (info.status === "past_due") return "Your last payment did not go through. Update your payment method in your Apple ID settings.";
      if (info.cancel_at_period_end) return "Your subscription is cancelled and will not renew. You keep access until the end of the period you have paid for.";
      return "Your plan is billed through the App Store and renews automatically.";
    }
    if (playManaged) {
      if (info.status === "past_due") return "Your last payment did not go through. Update your payment method in Google Play.";
      if (info.cancel_at_period_end) return "Your subscription is cancelled and will not renew. You keep access until the end of the period you have paid for.";
      return "Your plan is billed through Google Play and renews automatically.";
    }
    if (playBuy) {
      // C24: every figure here is the store's own (price string, offer
      // period); nothing is taken from the web price table or written here.
      if (playCfg?.purchase_blocked) return playCfg.purchase_blocked;
      if (playCfg?.subscription_managed_in_play) return "Change or cancel your plan in Google Play.";
      if (!selectedPlayView) return playPrice === "unavailable" ? PURCHASE_UNAVAILABLE_SENTENCE : "Loading the price from Google Play.";
      const trial = selectedPlayView.freeTrial;
      const cancelIn = "Cancel any time in Google Play, under Subscriptions.";
      if (trial) return `${trial.periodText} free, then ${selectedPlayView.priceString} ${renewalWords} unless you cancel before the free period ends. ${cancelIn}`;
      return `${selectedPlayView.priceString} ${renewalWords} unless you cancel. ${cancelIn}`;
    }
    if (storeBuy) {
      // C21: every figure here is the store's own (price string, offer
      // period); nothing is taken from the web price table or written here.
      if (!selectedStoreView) return storePrice === "unavailable" ? PURCHASE_UNAVAILABLE_SENTENCE : "Loading the price from the App Store.";
      const trial = selectedStoreView.freeTrial;
      const cancelIn = "Cancel any time in iOS Settings, under Subscriptions.";
      if (trial) return `${trial.periodText} free, then ${selectedStoreView.priceString} ${renewalWords} unless you cancel at least 24 hours before the free days end. ${cancelIn}`;
      return `${selectedStoreView.priceString} ${renewalWords} unless you cancel. ${cancelIn}`;
    }
    if (billingChangeInPortal) {
      if (!purchasingAllowed) {
        // B26: no "open billing" phrasing (there is nothing to open here)
        // and no naming of where billing actually happens, just the
        // status itself, which the user is still entitled to see. B29:
        // a subscription that is cancelled but still inside its paid
        // period gets its own honest line — the generic "renews
        // automatically" below would otherwise be a false statement once
        // `cancel_at_period_end` is true, and that line sat unread by
        // anyone until B29 added a manage/cancel pointer next to it.
        if (info.status === "past_due") return "Your last payment did not go through.";
        if (info.cancel_at_period_end) return "Your subscription is cancelled and will not renew. You keep access until the end of the period you have paid for.";
        return "Your active subscription renews automatically.";
      }
      if (info.status === "past_due") return "Your payment needs attention. Open billing to update the payment method or change the plan.";
      return "Your active subscription and its renewal are managed securely in billing.";
    }
    if (selected === "statements") return "Free. No card and no automatic renewal.";
    if (!purchasingAllowed) return PURCHASE_UNAVAILABLE_SENTENCE;
    if (!priceReady) return "This plan’s price is unavailable. Refresh the page to try again.";
    if (trialActive) return `${trialDisclosureText} ${trialCancelText}`;
    return `${money(total)} today, then ${money(total)} ${renewalWords} unless you cancel. Cancel any time from Settings, Your plan.`;
  }, [appleManaged, billingChangeInPortal, iapState, info.cancel_at_period_end, info.status, playBuy, playCfg, playManaged, playState, priceReady, selectedPlayView, selectedStoreView, storeBuy, purchasingAllowed, renewalWords, selected, total, trialActive, trialCancelText, trialDisclosureText]);

  async function openPortal() {
    const { url } = await api.openBillingPortal();
    window.location.assign(url);
  }

  async function handlePrimary() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (previewOnly) {
        setError("Preview only. No plan or payment has changed.");
        setBusy(false);
        return;
      }
      // C21: an App Store plan is managed in iOS Settings, never the Stripe portal.
      if (appleManaged) {
        if (storekit) await openManageSubscriptions();
        setBusy(false);
        return;
      }
      // C24: a Google Play plan is managed in Google Play, never the Stripe portal.
      if (playManaged) {
        if (play) await openManagePlaySubscriptions();
        setBusy(false);
        return;
      }
      // C24: the Android build buys through Google Play Billing and has no
      // route to Stripe. The server verifies the purchase; this call only
      // hands it the token.
      if (playBuy) {
        if (!playCfg || !selectedPlayKey || !selectedPlayView) { setBusy(false); return; }
        if (context === "onboarding") localStorage.setItem("wealth_onboarding_resume", "plan");
        const outcome = await purchasePlaySubscription(selectedPlayKey, playCfg, selectedPlayView);
        if (outcome.ok) {
          await invalidateOpenBankingAccess();
          setBusy(false);
          onContinue?.();
          return;
        }
        setBusy(false);
        if (!outcome.cancelled) setError(outcome.message);
        return;
      }
      // C21: the iOS build buys through StoreKit and has no route to Stripe.
      // Reaching here with a paid selection on a build that is not "storekit"
      // or "stripe_web" falls to the B26 guard below and does nothing.
      if (storeBuy) {
        if (!iap || !selectedStoreKey) { setBusy(false); return; }
        if (context === "onboarding") localStorage.setItem("wealth_onboarding_resume", "plan");
        const outcome = await purchaseSubscription(selectedStoreKey, iap);
        if (outcome.ok) {
          await invalidateOpenBankingAccess();
          setBusy(false);
          onContinue?.();
          return;
        }
        setBusy(false);
        if (!outcome.cancelled) setError(outcome.message);
        return;
      }
      // B26: belt and braces alongside the button itself not rendering in
      // this case (see showActionButton below) — Checkout and the Stripe
      // portal are never reachable when purchasing isn't allowed, even if
      // this function were somehow called another way.
      if (!purchasingAllowed && (billingChangeInPortal || selected !== "statements")) {
        setBusy(false);
        return;
      }
      if (selected === "statements") {
        if (billingChangeInPortal) {
          await openPortal();
          return;
        }
        if (current !== "statements") await api.selectFreePlan();
        // A67: the plan just changed, so the shared GET /subscription cache
        // is stale. Signup's very next step is the bank step, which asks
        // that cache whether this plan includes open banking — without this
        // it would answer from the pre-selection snapshot for up to the full
        // TTL and offer Connect a bank to someone who just chose the free
        // plan.
        //
        // AWAITED, not fire and forget. `onContinue()` below is a
        // synchronous `setStep("income")`, and the income step can be left
        // with a single tap (`Onboarding.skipIncome` is just
        // `setStep("bank")`), so the bank step can render one commit and one
        // tap later — faster than a cold `GET /subscription` on a
        // single-worker API. Unawaited, the user sees "Connect your first
        // bank" swap to the statements copy mid-signup, and can reach a 402
        // in the gap. The button stays busy for the extra round trip, which
        // is the right trade on a screen that has just taken a decision.
        // See lib/openBankingAccess.ts.
        await invalidateOpenBankingAccess();
        onContinue?.();
        return;
      }

      if (!billingLive) return;
      if (billingChangeInPortal) {
        await openPortal();
        return;
      }
      if (!priceReady) { setBusy(false); return; }
      if (context === "onboarding") localStorage.setItem("wealth_onboarding_resume", "plan");
      const { url } = await api.startCheckout("subscription", selected as PaidTier, {
        billing_period: effectivePeriod,
        trial: trialActive,
        flow: context,
      });
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing. Try again in a moment.");
      setBusy(false);
    }
  }

  // B26 follow-up: one derived notion of "can this file actually start a
  // Stripe action right now" (platform gate AND server billing_live),
  // used by primaryLabel, disabled and showActionButton alike so they
  // cannot drift out of sync with each other — previously primaryLabel
  // and disabled branched on billingLive only, which was harmless while
  // showActionButton hid the button outright, but would have silently
  // reopened the native purchase gate the moment showActionButton's own
  // condition was loosened by someone who never looked at these two.
  const canStartPurchaseFlow = (purchasingAllowed && billingLive) || (storeBuy && storeReady) || (playBuy && playReady);

  const primaryLabel = (() => {
    if (busy) return "Opening…";
    if (appleManaged || playManaged) return "Manage plan and renewal";
    if (billingChangeInPortal) return info.status === "past_due" ? "Fix payment in billing" : "Manage plan and renewal";
    if (selected === "statements") {
      return context === "onboarding" ? "Continue with Statements" : current === "statements" ? "Current plan" : "Choose Statements";
    }
    if (storeBuy && !storeReady && iapState !== "failed") {
      if (iap && !iap.purchase_allowed) return "Manage in Your plan";
      return storePrice === "unavailable" ? "Price unavailable" : "Loading plans…";
    }
    if (playBuy && !playReady && playState !== "failed") {
      if (playCfg?.subscription_managed_in_play || playCfg?.purchase_blocked) return "Manage in Your plan";
      return playPrice === "unavailable" ? "Price unavailable" : "Loading plans…";
    }
    if (!inAppBuy && !priceReady) return "Price unavailable";
    if (!canStartPurchaseFlow) return "Paid plans are not available yet";
    if (inAppBuy && inAppView?.freeTrial) return `Start ${inAppView.freeTrial.periodText} free trial`;
    if (trialActive) return `Start ${trialDays}-day free trial`;
    return `Choose ${chosen.name}`;
  })();

  const disabled = busy || (!appleManaged && !playManaged && !billingChangeInPortal && selected !== "statements" && (!canStartPurchaseFlow || (!inAppBuy && !priceReady))) || (context === "settings" && selected === "statements" && current === "statements");
  // B26: the primary button itself only ever starts a Stripe action
  // (Checkout or the customer portal) unless the selection is the free
  // Statements plan with no existing paid subscription to manage — that
  // free-plan path stays available everywhere, the Stripe paths never
  // render on a platform that can't legally reach them.
  // C21: an Apple-managed plan only ever offers iOS's own manage sheet, and
  // only inside the iOS build; a StoreKit purchase button renders only there too.
  // C24: likewise a Play-managed plan only offers Google Play's own page, and
  // only inside the Android build.
  const showActionButton = appleManaged
    ? storekit
    : playManaged
      ? play
      : purchasingAllowed || storeBuy || playBuy || (!billingChangeInPortal && selected === "statements");
  const trialEnds = accountDate(info.trial_ends_at);
  const accessEnds = info.status === "trialing" ? trialEnds : accountDate(info.renews_at);
  const renewsOn = accountDate(info.renews_at);

  const periodControls = selected !== "statements" && !billingChangeInPortal && !appleManaged && !playManaged && (purchasingAllowed || inAppBuy) && (
    <section aria-label="Billing period" className="py-1">
      <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Billing period</h3>
      <div role="radiogroup" aria-label="Billing period" className="flex flex-wrap gap-2">
        {periods.map((item, index) => <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={effectivePeriod === item.id}
          tabIndex={effectivePeriod === item.id ? 0 : -1}
          disabled={busy}
          onClick={() => setPeriod(item.id)}
          onKeyDown={event => moveRadio(event, index, periods.length, next => setPeriod(periods[next].id))}
          className={`min-h-11 touch-manipulation rounded-xl border px-3 text-sm font-semibold outline-none transition-colors hover:opacity-80 active:opacity-70 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 motion-reduce:transition-none ${effectivePeriod === item.id ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 text-slate-700 dark:border-slate-500 dark:text-slate-200"}`}
        >{SHORT_LABELS[item.id] ?? item.label}</button>)}
      </div>
    </section>
  );

  return (
    <div className="space-y-3" data-plan-picker="focused">
      <div className="text-sm text-slate-900 dark:text-slate-100">
        <p className="font-semibold">Current plan: {TIERS.find(tier => tier.id === current)?.name ?? current}</p>
        {info.cancel_at_period_end ? <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">Renewal cancelled. {accessEnds ? `Access ends on ${accessEnds}.` : "Access continues until your current period ends."}</p>
          : info.status === "trialing" ? <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{trialEnds ? `Free until ${trialEnds}.` : "Your free trial is active."} Choosing a plan here does not restart it.</p>
          : managedPaidSubscription && info.status === "active" && renewsOn ? <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">Your current renewal is on {renewsOn}. Comparing plans does not change it.</p> : null}
        {info.status === "past_due" && <p className="mt-1 flex items-center gap-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300"><span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />Your payment needs attention.</p>}
      </div>
      {periodControls}
      <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
        Every paid plan has all features, savings tips and investments included. Plans differ only in connected accounts and Penny messages.
      </p>
      <div role="radiogroup" aria-label="Choose a plan" className="flex flex-wrap gap-2">
        {TIERS.map((tier, index) => {
          const active = tier.id === selected;
          return (
              <button
                key={tier.id}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                disabled={busy}
                onClick={() => { setSelected(tier.id); setError(null); }}
                onKeyDown={(event) => moveRadio(event, index, TIERS.length, (next) => { setSelected(TIERS[next].id); setError(null); })}
                className={`min-h-11 touch-manipulation rounded-xl border px-3 text-sm font-semibold outline-none transition-colors hover:opacity-80 active:opacity-70 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 motion-reduce:transition-none ${active ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 text-slate-700 dark:border-slate-500 dark:text-slate-200"}`}
              >
                {tier.name}
                {tier.id === current && <span className="sr-only">, current plan</span>}
              </button>
          );
        })}
      </div>

      <section aria-label="Selected plan and offer" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 dark:bg-slate-800 dark:shadow-none dark:ring-white/[0.07]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 aria-live="polite" className="text-[19px] font-bold leading-snug text-slate-900 dark:text-slate-100">{chosen.name}</h3>
          {selected === current && <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600 dark:bg-white/[0.07] dark:text-slate-300">Current plan</span>}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{chosen.lead}</p>
        <ul className="my-3 space-y-2">
          {chosen.includes.map(item => <li key={item} className="flex items-start gap-2 text-sm leading-relaxed text-slate-700 dark:text-slate-200"><Check size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" /><span>{item}</span></li>)}
        </ul>
        <div className="space-y-1 border-y border-slate-200 py-3 dark:border-slate-600">
          <p aria-live="polite" aria-atomic="true" className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-slate-900 dark:text-slate-100">
            <strong className={`text-[19px] ${selected !== "statements" && (inAppBuy || priceReady) ? "money tabular-nums" : ""}`}>{selected === "statements" ? "Free" : inAppBuy ? (inAppView?.priceString ?? "…") : priceReady ? money(total) : "Price unavailable"}</strong>
            {selected !== "statements" && (inAppBuy || priceReady) && <span className="text-sm">{renewalWords}</span>}
          </p>
          {selected !== "statements" && !inAppBuy && priceReady && chosenPeriod && chosenPeriod.id !== "monthly" && <>
            {chosenPeriod.saving_gbp > 0 && <p className="text-xs text-slate-600 dark:text-slate-300"><MoneyCopy text={`Save ${money(chosenPeriod.saving_gbp)} against monthly`} /></p>}
            <p className="text-xs text-slate-600 dark:text-slate-300"><MoneyCopy text={`${money(chosenPeriod.per_month_gbp)} equivalent per month`} /></p>
          </>}
          {selected !== "statements" && !purchasingAllowed && !inAppBuy && <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">Web plan price for comparison only.</p>}
          {billingChangeInPortal && <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">Comparison price, not a change to your current renewal. Billing confirms any change.</p>}
        </div>
        {inAppBuy && inAppView?.freeTrial && <div className="mt-3">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{inAppView.freeTrial.periodText} free trial</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {storeBuy ? "Billed by the App Store. Cancel any time in iOS Settings, under Subscriptions." : "Billed by Google Play. Cancel any time in Google Play, under Subscriptions."}
          </p>
        </div>}
        {trialActive && purchasingAllowed && !billingChangeInPortal && <div className="mt-3">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{trialHeadline(trialDays)}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300"><MoneyCopy text={trialTermsLine(total, renewalWords)} /></p>
        </div>}
        {/* B29: the only path a native user with an existing paid
            subscription has anywhere in the app. Plain ink text with a
            small neutral signifier (DESIGN.md's "figures are ink, amber
            lives in the signifier" rule) rather than a coloured sentence,
            since needing a browser is a fact of the platform, not a
            financial risk. Never a link or button: this names an
            existing account, it does not start a purchase. */}
        {appleManaged && (
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            <Smartphone size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" />
            <span>{APPLE_MANAGE_LINE}</span>
          </p>
        )}
        {playManaged && (
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            <Smartphone size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" />
            <span>{PLAY_MANAGE_LINE}</span>
          </p>
        )}
        {billingChangeInPortal && !purchasingAllowed && (
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            <Globe size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" />
            <span>{NATIVE_MANAGE_SUBSCRIPTION_LINE}</span>
          </p>
        )}
        {/* B26: no button at all (not a disabled one) once purchasing isn't
            allowed and there's nothing free left to choose, so the card
            never reads as a broken control, just a status. */}
        {showActionButton && (
          <button
            type="button"
            onClick={handlePrimary}
            disabled={disabled}
            className="mt-3 min-h-11 w-full touch-manipulation rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white outline-none transition-colors hover:bg-indigo-700 active:opacity-80 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400 motion-reduce:transition-none"
          >
            {primaryLabel}
          </button>
        )}
        <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          <MoneyCopy text={disclosure} />
          {((storeBuy && storePrice === "unavailable") || (playBuy && playPrice === "unavailable" && !playCfg?.purchase_blocked && !playCfg?.subscription_managed_in_play)) && (
            <>
              {" "}
              <button
                type="button"
                onClick={() => setReloadNonce((n) => n + 1)}
                className="inline-flex min-h-11 touch-manipulation items-center underline underline-offset-4 hover:text-indigo-600 active:opacity-70 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:text-indigo-400"
              >
                Try again
              </button>
            </>
          )}
        </p>
        {purchasingAllowed && selected !== "statements" && !billingLive && (
          <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">You can compare every plan now. Paid checkout will open when billing is live.</p>
        )}
        {storekit && iap?.enabled && (
          <button
            type="button"
            onClick={async () => {
              if (busy || !iap) return;
              setBusy(true);
              setError(null);
              setNotice(null);
              try {
                const { restored } = await restorePurchases(iap);
                if (restored > 0) {
                  await invalidateOpenBankingAccess();
                  setBusy(false);
                  setNotice("Your plan has been restored.");
                  onContinue?.();
                  return;
                }
                setNotice("There were no purchases to restore.");
              } catch {
                setError("Could not restore purchases. Try again in a moment.");
              }
              setBusy(false);
            }}
            disabled={busy}
            className="mt-2 min-h-11 w-full touch-manipulation rounded-xl px-4 text-sm font-medium text-indigo-600 outline-none transition-colors hover:bg-indigo-50 active:opacity-70 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:text-slate-500 dark:text-indigo-400 dark:hover:bg-indigo-900/10"
          >
            Restore purchases
          </button>
        )}
        {/* C24: the same restore on the Google Play channel. */}
        {play && playCfg?.enabled && (
          <button
            type="button"
            onClick={async () => {
              if (busy || !playCfg) return;
              setBusy(true);
              setError(null);
              setNotice(null);
              try {
                const { restored } = await restorePlayPurchases(playCfg);
                if (restored > 0) {
                  await invalidateOpenBankingAccess();
                  setBusy(false);
                  setNotice("Your plan has been restored.");
                  onContinue?.();
                  return;
                }
                setNotice("There were no purchases to restore.");
              } catch {
                setError("Could not restore purchases. Try again in a moment.");
              }
              setBusy(false);
            }}
            disabled={busy}
            className="mt-2 min-h-11 w-full touch-manipulation rounded-xl px-4 text-sm font-medium text-indigo-600 outline-none transition-colors hover:bg-indigo-50 active:opacity-70 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:text-slate-500 dark:text-indigo-400 dark:hover:bg-indigo-900/10"
          >
            Restore purchases
          </button>
        )}
        {notice && <p role="status" className="mt-2 text-xs text-slate-600 dark:text-slate-300">{notice}</p>}
        {error && <p role="alert" className="mt-2 text-xs text-slate-600 dark:text-slate-300">{error}</p>}
        <p className="mt-3 flex gap-4 text-xs text-slate-600 dark:text-slate-300"><Link href="/terms" className="inline-flex min-h-11 touch-manipulation items-center underline underline-offset-4 hover:text-indigo-600 active:opacity-70 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:text-indigo-400">Terms</Link><Link href="/privacy" className="inline-flex min-h-11 touch-manipulation items-center underline underline-offset-4 hover:text-indigo-600 active:opacity-70 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:text-indigo-400">Privacy</Link></p>
      </section>

      <details className="group" data-plan-comparison>
        <summary className="flex min-h-11 touch-manipulation cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-1 text-sm font-semibold text-slate-700 outline-none hover:bg-slate-100 active:opacity-70 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-white/[0.05] [&::-webkit-details-marker]:hidden">
          Compare all plans
          <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-slate-500 group-open:rotate-180 dark:text-slate-400" />
        </summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {TIERS.map(tier => <article key={tier.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 dark:bg-slate-800 dark:shadow-none dark:ring-white/[0.07]">
            <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">{tier.name}{tier.id === current && <span className="ml-2 text-xs font-normal text-slate-600 dark:text-slate-300">Current plan</span>}</h4>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{tier.lead}</p>
            <ul className="mt-3 list-disc space-y-1 pl-4 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{tier.includes.map(item => <li key={item}>{item}</li>)}</ul>
          </article>)}
        </div>
      </details>
    </div>
  );
}
