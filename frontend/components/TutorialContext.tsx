"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from "react";

export interface TutorialStep {
  id: string;
  route?: string; // pushed on entering the step when pathname differs
  target?: string; // matches [data-tutorial-id="..."]
  fallbackTarget?: string; // tried, same retry budget, if target never resolves; whichever id resolves is tracked for the rest of the step
  action?: string; // tutorial action id awaited BEFORE measuring (e.g. opens a menu)
  cleanup?: string; // action id run when leaving the step in either direction, and on end()
  readyKey?: string; // defaults to the flow's readyKey
  tooltipSide: "above" | "below" | "center";
  iconName: string;
  color: string;
  bg: string;
  title: string;
  description: string;
  tip?: string;
}

export interface TutorialFlow {
  id: string;
  label: string;
  blurb: string;
  route: string; // pathname that auto-offers this flow
  readyKey: string;
  steps: TutorialStep[];
}

export const TUTORIAL_FLOWS: TutorialFlow[] = [
  {
    id: "first-run",
    label: "Getting started",
    blurb: "A one minute look around",
    route: "/",
    readyKey: "home",
    steps: [
      {
        id: "welcome",
        tooltipSide: "center",
        iconName: "Sparkles",
        color: "#4f46e5",
        bg: "#ede9fe",
        title: "Welcome to Sorted",
        description:
          "Everything you own, owe and have coming up, in one place. This takes about a minute.",
      },
      {
        id: "home-verdict",
        target: "tutorial-safe-to-spend",
        fallbackTarget: "tutorial-home-fresh",
        tooltipSide: "below",
        iconName: "Wallet",
        color: "#4f46e5",
        bg: "#ede9fe",
        title: "What is safe to spend",
        description:
          "Home leads with one number: what is genuinely yours to spend, after the bills still to leave and what is sitting on your cards.",
      },
      {
        id: "home-connect",
        target: "tutorial-manage-link",
        fallbackTarget: "tutorial-home-fresh-cta",
        tooltipSide: "below",
        iconName: "Building2",
        color: "#2563eb",
        bg: "#dbeafe",
        title: "Add your accounts",
        description:
          "Nothing here is real until your accounts are in. Manage opens Accounts, where banks, statements, investments and offline pots all get added.",
      },
      {
        id: "home-nav",
        target: "tutorial-bottom-nav",
        tooltipSide: "above",
        iconName: "Compass",
        color: "#4f46e5",
        bg: "#ede9fe",
        title: "Getting around",
        description:
          "Spend is where money went. Upcoming covers this pay period. Planning holds your longer-term goals, debt and growth. Penny, in the middle, answers questions about any of it.",
      },
      {
        id: "home-done",
        tooltipSide: "center",
        iconName: "Sparkles",
        color: "#4f46e5",
        bg: "#ede9fe",
        title: "That is the tour",
        description: "Each screen offers its own short tour the first time you open it.",
        tip: "Replay any of them from Account, under How Sorted works.",
      },
    ],
  },
  {
    id: "accounts",
    label: "Accounts",
    blurb: "Five ways money gets in here",
    route: "/accounts",
    readyKey: "accounts",
    steps: [
      {
        id: "accounts-networth",
        target: "tutorial-networth",
        fallbackTarget: "tutorial-add-account",
        tooltipSide: "below",
        iconName: "Layers",
        color: "#4f46e5",
        bg: "#ede9fe",
        title: "Everything in one total",
        description:
          "Net worth counts what is in your banks, investments and offline pots, minus what is on your cards.",
      },
      {
        id: "accounts-add",
        target: "tutorial-add-account",
        tooltipSide: "below",
        iconName: "Plus",
        color: "#2563eb",
        bg: "#dbeafe",
        action: "accounts:add-menu:open",
        cleanup: "accounts:add-menu:close",
        title: "Every way to add",
        description: "Add opens every route into the app. The next few steps walk through each one.",
      },
      {
        id: "accounts-bank",
        target: "tutorial-add-bank",
        tooltipSide: "below",
        iconName: "Building2",
        color: "#2563eb",
        bg: "#dbeafe",
        action: "accounts:add-menu:open",
        cleanup: "accounts:add-menu:close",
        title: "Connect a bank",
        description:
          "Add Bank links a UK bank through open banking, then transactions and balances keep syncing on their own.",
        tip: "Bank connections expire after a while. Sorted shows a reconnect prompt here when one does.",
      },
      {
        id: "accounts-statement",
        target: "tutorial-add-statement",
        tooltipSide: "below",
        iconName: "Upload",
        color: "#0891b2",
        bg: "#cffafe",
        action: "accounts:add-menu:open",
        cleanup: "accounts:add-menu:close",
        title: "Upload a statement",
        description:
          "For anything that cannot connect live, upload a statement instead. Works with NatWest, Barclays, HSBC, Monzo and more.",
      },
      {
        id: "accounts-investment",
        target: "tutorial-add-investment",
        fallbackTarget: "tutorial-add-account",
        tooltipSide: "below",
        iconName: "TrendingUp",
        color: "#059669",
        bg: "#d1fae5",
        action: "accounts:add-menu:open",
        cleanup: "accounts:add-menu:close",
        title: "Add an investment or ISA",
        description:
          "Investment accounts come from a PDF statement. They are valued from the last statement you uploaded, so upload a newer one when you want the value refreshed.",
      },
      {
        id: "accounts-offline",
        target: "tutorial-add-offline",
        tooltipSide: "below",
        iconName: "PiggyBank",
        color: "#7c3aed",
        bg: "#f3e8ff",
        action: "accounts:add-menu:open",
        cleanup: "accounts:add-menu:close",
        title: "Offline accounts and pots",
        description:
          "Cash, a pot at a bank that cannot connect, anything you track by hand. You set the balance and it counts toward your net worth.",
      },
      {
        id: "accounts-rules",
        target: "tutorial-offline-rules",
        fallbackTarget: "tutorial-offline-empty",
        tooltipSide: "above",
        iconName: "ArrowLeftRight",
        color: "#7c3aed",
        bg: "#f3e8ff",
        title: "Keep a pot updated on its own",
        description:
          "Cash pots do not have to be updated by hand. Add an offline account, then give it a rule, so every matching transfer out of your current account posts into it.",
      },
    ],
  },
  {
    id: "spend",
    label: "Spend",
    blurb: "How categories and corrections work",
    route: "/spend",
    readyKey: "spend",
    steps: [
      {
        id: "spend-verdict",
        target: "tutorial-spend-verdict",
        tooltipSide: "below",
        iconName: "PieChart",
        color: "#0891b2",
        bg: "#cffafe",
        title: "Where money went",
        description:
          "Spend covers the current pay period and compares it against your own usual pace, not a budget you had to set.",
      },
      {
        id: "spend-categories",
        target: "tutorial-spend-categories",
        tooltipSide: "above",
        iconName: "ListChecks",
        color: "#0891b2",
        bg: "#cffafe",
        title: "Open any category",
        description: "Tap a category to see the transactions inside it, and tap a transaction to see it in full.",
      },
      {
        id: "spend-recategorise",
        tooltipSide: "center",
        iconName: "Tag",
        color: "#7c3aed",
        bg: "#f3e8ff",
        title: "Correcting a category",
        description:
          "If something landed in the wrong category, open it and change it. Sorted learns from the correction and applies it to that merchant next time.",
      },
      {
        id: "spend-manage",
        target: "tutorial-spend-manage",
        tooltipSide: "below",
        iconName: "Settings",
        color: "#4f46e5",
        bg: "#ede9fe",
        title: "Money moving between your accounts",
        description:
          "Transfers between your own accounts are not spending. This is where Sorted shows what it treated as a transfer, and where you can put it right.",
      },
      {
        id: "spend-periods",
        target: "tutorial-spend-periods",
        tooltipSide: "below",
        iconName: "CalendarClock",
        color: "#4f46e5",
        bg: "#ede9fe",
        title: "Earlier pay periods",
        description: "Step back through previous periods to see how this one compares.",
      },
    ],
  },
  {
    id: "upcoming",
    label: "Upcoming",
    blurb: "What is still to come this pay period",
    route: "/upcoming",
    readyKey: "upcoming",
    steps: [
      {
        id: "upcoming-left",
        target: "tutorial-planning-left",
        tooltipSide: "below",
        iconName: "CalendarClock",
        color: "#4f46e5",
        bg: "#ede9fe",
        title: "What is left to last",
        description:
          "This is what remains for the rest of the pay period, after the bills still to leave and any income still expected.",
      },
      {
        id: "upcoming-list",
        target: "tutorial-planning-upcoming",
        fallbackTarget: "tutorial-planning-left",
        tooltipSide: "above",
        iconName: "Receipt",
        color: "#4f46e5",
        bg: "#ede9fe",
        title: "What is still coming",
        description: "Every bill Sorted expects before your next payday, with the date it usually lands.",
      },
      {
        id: "upcoming-allocations",
        target: "tutorial-planning-allocations",
        fallbackTarget: "tutorial-planning-plans",
        tooltipSide: "above",
        iconName: "Coins",
        color: "#7c3aed",
        bg: "#f3e8ff",
        title: "Pay-period envelopes",
        description:
          "An envelope holds back money for a category in this pay period, so the runway does not treat it as free to spend.",
      },
      {
        id: "upcoming-add",
        target: "tutorial-planning-add",
        tooltipSide: "above",
        iconName: "Plus",
        color: "#4f46e5",
        bg: "#ede9fe",
        title: "Plan this pay period",
        description: "Add an envelope or a one-off payment without mixing it into your long-term goals.",
      },
    ],
  },
  {
    id: "planning",
    label: "Planning",
    blurb: "Your order, debt and long-term goals",
    route: "/planning",
    readyKey: "planning",
    steps: [
      {
        id: "planning-order",
        target: "tutorial-planning-ladder",
        fallbackTarget: "tutorial-planning-goals",
        tooltipSide: "below",
        iconName: "Target",
        color: "#4f46e5",
        bg: "#ede9fe",
        title: "Your order",
        description: "One ordered path through debt, safety and growth. The top rung is the next move.",
      },
      {
        id: "planning-goals",
        target: "tutorial-planning-goals",
        tooltipSide: "below",
        iconName: "Target",
        color: "#4f46e5",
        bg: "#ede9fe",
        title: "Your longer horizon",
        description: "Each goal shows its target, progress and what it needs from every future pay period.",
      },
    ],
  },
  // The "insights" flow (What Sorted noticed / Work through them / Ask
  // about any of it) retired with the Insights page itself (2026-09-05,
  // /insights is now a client redirect to /spend/shape or /tax). Its two
  // `data-tutorial-id` targets (tutorial-insights-hero on
  // app/spend/shape/MoneyShapeHero.tsx, tutorial-insights-list) are now
  // inert — harmless, unreferenced by any flow — rather than stripped from
  // that file, which is out of scope for this retirement.
];

type ActionHandler = () => void | Promise<void>;

interface TutorialContextValue {
  isActive: boolean;
  flow: TutorialFlow | null;
  step: TutorialStep | null;
  currentStep: number;
  total: number;
  startFlow: (flowId: string) => void;
  next: () => void;
  prev: () => void;
  goTo: (n: number) => void;
  end: () => void;
  // Internal — used by TutorialOverlay/TutorialOffer only, not part of the
  // documented public useTutorial() contract other pages code against.
  runAction: (id: string | undefined) => Promise<void>;
  isReady: (key: string | undefined) => boolean;
  isReadyNow: (key: string | undefined) => boolean;
  registerAction: (id: string, fn: ActionHandler) => void;
  unregisterAction: (id: string, fn: ActionHandler) => void;
  setReady: (key: string, ready: boolean) => void;
}

const Ctx = createContext<TutorialContextValue | null>(null);

function persistSeen(flowId: string) {
  try {
    localStorage.setItem(`sorted_tour_seen_${flowId}`, "1");
    // Legacy key, kept for anything still reading it (e.g. onboarding gate).
    if (flowId === "first-run") localStorage.setItem("wealth_tutorial_seen", "1");
  } catch {}
}

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [readyMap, setReadyMap] = useState<Record<string, boolean>>({});
  const readyRef = useRef<Record<string, boolean>>({});
  const actionsRef = useRef<Map<string, ActionHandler>>(new Map());

  const flow = activeFlowId ? TUTORIAL_FLOWS.find((f) => f.id === activeFlowId) ?? null : null;
  const step = flow ? flow.steps[currentStep] ?? null : null;

  const registerAction = useCallback((id: string, fn: ActionHandler) => {
    actionsRef.current.set(id, fn);
  }, []);

  const unregisterAction = useCallback((id: string, fn: ActionHandler) => {
    if (actionsRef.current.get(id) === fn) actionsRef.current.delete(id);
  }, []);

  const runAction = useCallback(async (id: string | undefined) => {
    if (!id) return;
    const fn = actionsRef.current.get(id);
    if (fn) await fn();
  }, []);

  const setReady = useCallback((key: string, ready: boolean) => {
    readyRef.current = { ...readyRef.current, [key]: ready };
    setReadyMap((prev) => (prev[key] === ready ? prev : { ...prev, [key]: ready }));
  }, []);

  const isReady = useCallback(
    (key: string | undefined) => (key ? !!readyMap[key] : false),
    [readyMap]
  );

  // Ref-backed, stable across renders — safe to read from inside a
  // long-lived async closure (e.g. TutorialOverlay's polling loop) without
  // being pulled from the render that captured it.
  const isReadyNow = useCallback(
    (key: string | undefined) => (key ? !!readyRef.current[key] : false),
    []
  );

  const startFlow = useCallback((flowId: string) => {
    const f = TUTORIAL_FLOWS.find((fl) => fl.id === flowId);
    if (!f) return;
    setActiveFlowId(flowId);
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  const finishFlow = useCallback((flowId: string) => {
    setIsActive(false);
    setActiveFlowId(null);
    persistSeen(flowId);
  }, []);

  const next = useCallback(() => {
    if (!flow || !step) return;
    const n = currentStep + 1;
    const nextStep = flow.steps[n];
    const skipCleanup = !!step.action && nextStep?.action === step.action;
    if (step.cleanup && !skipCleanup) void runAction(step.cleanup);
    if (n >= flow.steps.length) {
      finishFlow(flow.id);
    } else {
      setCurrentStep(n);
    }
  }, [flow, step, currentStep, runAction, finishFlow]);

  const prev = useCallback(() => {
    if (!flow || !step) return;
    const n = currentStep - 1;
    if (n < 0) return;
    const prevStep = flow.steps[n];
    const skipCleanup = !!step.action && prevStep?.action === step.action;
    if (step.cleanup && !skipCleanup) void runAction(step.cleanup);
    setCurrentStep(n);
  }, [flow, step, currentStep, runAction]);

  const goTo = useCallback(
    (n: number) => {
      if (!flow || !step) return;
      if (n === currentStep || n < 0 || n >= flow.steps.length) return;
      const destStep = flow.steps[n];
      const skipCleanup = !!step.action && destStep?.action === step.action;
      if (step.cleanup && !skipCleanup) void runAction(step.cleanup);
      setCurrentStep(n);
    },
    [flow, step, currentStep, runAction]
  );

  const end = useCallback(() => {
    if (step?.cleanup) void runAction(step.cleanup);
    if (flow) {
      finishFlow(flow.id);
    } else {
      setIsActive(false);
      setActiveFlowId(null);
    }
  }, [flow, step, runAction, finishFlow]);

  // Auto-start the tour when the user just finished onboarding.
  useEffect(() => {
    try {
      if (localStorage.getItem("wealth_tutorial_pending") === "1") {
        localStorage.removeItem("wealth_tutorial_pending");
        const t = setTimeout(() => {
          setActiveFlowId("first-run");
          setCurrentStep(0);
          setIsActive(true);
        }, 800);
        return () => clearTimeout(t);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = flow ? flow.steps.length : 0;

  const value: TutorialContextValue = useMemo(
    () => ({
      isActive,
      flow,
      step,
      currentStep,
      total,
      startFlow,
      next,
      prev,
      goTo,
      end,
      runAction,
      isReady,
      isReadyNow,
      registerAction,
      unregisterAction,
      setReady,
    }),
    [
      isActive,
      flow,
      step,
      currentStep,
      total,
      startFlow,
      next,
      prev,
      goTo,
      end,
      runAction,
      isReady,
      isReadyNow,
      registerAction,
      unregisterAction,
      setReady,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Public hook — the exact contract other screens code against. */
export function useTutorial() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTutorial must be inside TutorialProvider");
  const { isActive, flow, step, currentStep, total, startFlow, next, prev, goTo, end } = ctx;
  return { isActive, flow, step, currentStep, total, startFlow, next, prev, goTo, end };
}

/**
 * Internal — full context including the action registry and ready map.
 * Used only by TutorialOverlay.tsx and TutorialOffer.tsx.
 */
export function useTutorialInternal(): TutorialContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTutorialInternal must be inside TutorialProvider");
  return ctx;
}

/**
 * Registers an imperative handler for a step's `action`/`cleanup` while the
 * calling component is mounted. Handlers are kept in a ref map keyed by id
 * so re-registering on every render never leaves a stale closure behind —
 * the wrapper always calls through to the latest `fn` passed in.
 */
export function useTutorialAction(id: string, fn: ActionHandler): void {
  const ctx = useContext(Ctx);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const { registerAction, unregisterAction } = ctx ?? {};

  useEffect(() => {
    if (!registerAction || !unregisterAction) return;
    const wrapper: ActionHandler = () => fnRef.current();
    registerAction(id, wrapper);
    return () => unregisterAction(id, wrapper);
  }, [registerAction, unregisterAction, id]);
}

/**
 * Page reports whether its own data has loaded. The overlay will not
 * measure until this is true. Resets to false on unmount so a re-mount
 * (e.g. after a route push) starts from "not ready" again.
 */
export function useTutorialReady(key: string, ready: boolean): void {
  const ctx = useContext(Ctx);
  const setReady = ctx?.setReady;

  useEffect(() => {
    if (!setReady) return;
    setReady(key, ready);
  }, [setReady, key, ready]);

  // Unmount-only cleanup. Reads key/setReady through refs so this effect's
  // own deps ([]) never change, and its cleanup fires exactly once, on
  // actual unmount, rather than on every provider re-render.
  const keyRef = useRef(key);
  keyRef.current = key;
  const setReadyRef = useRef(setReady);
  setReadyRef.current = setReady;

  useEffect(() => {
    return () => {
      setReadyRef.current?.(keyRef.current, false);
    };
  }, []);
}
