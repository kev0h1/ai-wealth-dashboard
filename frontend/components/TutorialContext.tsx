"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

export interface TutorialStep {
  id: string;
  route: string | null;
  target: string | null;
  tooltipSide: "above" | "below" | "center";
  iconName: string;
  color: string;
  bg: string;
  title: string;
  description: string;
  tip?: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    route: null,
    target: null,
    tooltipSide: "center",
    iconName: "Sparkles",
    color: "#4f46e5",
    bg: "#ede9fe",
    title: "Welcome to Wealth Dashboard",
    description: "Track all your money in one place. This short tour will walk you through the key features — tap Next to get started.",
  },
  {
    id: "manage-accounts",
    route: "/",
    target: "tutorial-manage-link",
    tooltipSide: "below",
    iconName: "Building2",
    color: "#2563eb",
    bg: "#dbeafe",
    title: "Open Your Accounts",
    description: "Tap Manage to go to the Accounts page, where you can connect a bank via open banking or upload a bank statement.",
  },
  {
    id: "add-account",
    route: "/accounts",
    target: "tutorial-add-account",
    tooltipSide: "below",
    iconName: "Building2",
    color: "#2563eb",
    bg: "#dbeafe",
    title: "Connect Open Banking",
    description: "Tap Add Bank to securely link your account. Your transactions will sync automatically from that point on.",
    tip: "Supports most UK banks via TrueLayer and Yapily.",
  },
  {
    id: "upload-statement",
    route: "/accounts",
    target: "tutorial-upload-statement",
    tooltipSide: "below",
    iconName: "Upload",
    color: "#0891b2",
    bg: "#cffafe",
    title: "Upload a Statement",
    description: "If your bank isn't supported for open banking, export a CSV from your bank's website and upload it here instead.",
    tip: "Works with NatWest, Barclays, HSBC, Monzo and more.",
  },
  {
    id: "view-spending",
    route: "/spend",
    target: null,
    tooltipSide: "center",
    iconName: "PieChart",
    color: "#0891b2",
    bg: "#cffafe",
    title: "View Your Spending",
    description: "The Spend page breaks down your outgoings by category for the current pay period. Tap any category to see the individual transactions, and tap a transaction to change its category.",
    tip: "Tap Manage, top right, to set rules that auto-categorise merchants in future.",
  },
  {
    id: "planning",
    route: "/planning",
    target: null,
    tooltipSide: "center",
    iconName: "CalendarClock",
    color: "#4f46e5",
    bg: "#e0e7ff",
    title: "See What's Coming",
    description: "The Planning tab shows what's left to last the pay period — with the bills still to leave and income still expected before your next one.",
    tip: "Plan a one-off payment, save toward a big expense, or ask Penny Can I…? for a quick verdict.",
  },
  {
    id: "settings-income",
    route: "/settings",
    target: "tutorial-income",
    tooltipSide: "below",
    iconName: "Settings",
    color: "#4f46e5",
    bg: "#ede9fe",
    title: "Tell Penny your income",
    description: "Add your income and pension in Settings — Grow and your tax levers personalise from them.",
  },
];

interface TutorialContextType {
  isActive: boolean;
  currentStep: number;
  total: number;
  step: TutorialStep;
  start: () => void;
  next: () => void;
  prev: () => void;
  goTo: (n: number) => void;
  end: () => void;
}

const Ctx = createContext<TutorialContextType | null>(null);

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const navigatingRef = useRef(false);

  const navigateTo = useCallback((n: number) => {
    const s = TUTORIAL_STEPS[n];
    if (s?.route) {
      navigatingRef.current = true;
      router.push(s.route);
    }
    setCurrentStep(n);
  }, [router]);

  const start = useCallback(() => {
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  const next = useCallback(() => {
    setCurrentStep(prev => {
      const n = prev + 1;
      if (n >= TUTORIAL_STEPS.length) { setIsActive(false); return prev; }
      const s = TUTORIAL_STEPS[n];
      if (s?.route) router.push(s.route);
      return n;
    });
  }, [router]);

  const prev = useCallback(() => {
    setCurrentStep(prev => {
      const n = prev - 1;
      if (n < 0) return prev;
      const s = TUTORIAL_STEPS[n];
      if (s?.route) router.push(s.route);
      return n;
    });
  }, [router]);

  const goTo = useCallback((n: number) => {
    const s = TUTORIAL_STEPS[n];
    if (s?.route) router.push(s.route);
    setCurrentStep(n);
  }, [router]);

  const end = useCallback(() => {
    setIsActive(false);
    // Persist so we don't auto-start again on future logins.
    try { localStorage.setItem("wealth_tutorial_seen", "1"); } catch {}
  }, []);

  // Auto-start the tour when the user just finished onboarding.
  useEffect(() => {
    try {
      if (localStorage.getItem("wealth_tutorial_pending") === "1") {
        localStorage.removeItem("wealth_tutorial_pending");
        const t = setTimeout(() => { setCurrentStep(0); setIsActive(true); }, 800);
        return () => clearTimeout(t);
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Ctx.Provider value={{
      isActive, currentStep, total: TUTORIAL_STEPS.length,
      step: TUTORIAL_STEPS[currentStep],
      start, next, prev, goTo, end,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTutorial() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTutorial must be inside TutorialProvider");
  return ctx;
}
