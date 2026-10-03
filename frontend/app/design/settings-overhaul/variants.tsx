"use client";

// G201 variants. Directions drafted by openai/gpt-6-astra (raw output in the
// session notes), rewritten to DESIGN.md and the copy rules. The hubs and the
// pages are hand-authored; the controls inside them are in sections.tsx.

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, UserRound } from "lucide-react";
import { Group, INK, List, NavRow, PageFrame, SheetRow, SOFT, usePreview, type VariantId } from "./ui";
import {
  CoverPlanBlock, DataBlock, DeleteScreen, DisplayBlock, Exits, FinancialBlock, LegalBlock, NotificationsBlock,
  PennyBlock, PlanBlock, ProfileBlock, QuickControls, SecurityBlock, SignInBlock, ToursBlock,
} from "./sections";

const LINK = "inline-flex min-h-11 items-center gap-0.5 rounded-xl px-2 text-sm font-semibold text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300";

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

/** Hub header on the canvas: who you are, how you sign in, status at a glance.
 * No hero card, the status that the old hero carried survives as two links. */
function Header({ securityPage, planPage, profilePage }: { securityPage: string; planPage: string; profilePage: string }) {
  const { model, href } = usePreview();
    return (
    <header>
      <h1 className={`text-xl font-bold ${INK}`}>Account</h1>
      <div className="mt-4 flex items-center gap-3">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-base font-bold text-indigo-700 dark:bg-indigo-400/20 dark:text-indigo-300">
          {model.name ? initialsOf(model.name) : <UserRound size={20} />}
        </span>
        <div className="min-w-0">
          {model.name ? (
            <p className={`truncate text-base font-bold ${INK}`}>{model.name}</p>
          ) : (
            <Link href={href(profilePage)} className="text-base font-bold text-indigo-700 underline underline-offset-2 dark:text-indigo-300">
              Add your name
            </Link>
          )}
          <p className={`truncate text-xs ${SOFT}`}>{model.email}</p>
        </div>
      </div>
      <p className={`mt-3 flex flex-wrap gap-x-4 text-[13px] ${SOFT}`}>{model.providers.map((p) => <span key={p.id}>{p.label} · {p.primary ? "Primary" : "Linked"}</span>)}</p>
      <div className="-ml-2 mt-1 flex flex-wrap items-center">
        <Link href={href(planPage)} className={LINK}>
          Standard plan
          <ChevronRight size={14} aria-hidden="true" />
        </Link>
        <Link href="/accounts" className={LINK}>
          {model.accounts === 0 ? "No accounts connected" : `${model.accounts} accounts connected`}
          <ChevronRight size={14} aria-hidden="true" />
        </Link>
        {model.native && (
          <Link href={href(securityPage)} className={LINK}>
            Face ID on
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        )}
      </div>
    </header>
  );
}

type Page = { title: string; intro?: string; body: ReactNode };

/* ───────────────────────── A · Clear directory ───────────────────────── */

function HubA() {
  const { model, payLabel } = usePreview();
  return (
    <>
      <Header securityPage="security" planPage="plan" profilePage="profile" />
      <Group title="Your money" intro="Set the details Sorted uses for your money.">
        <List>
          <SheetRow sheet="pay-period" label="Pay period" value={payLabel} />
          <NavRow page="financial" label="Financial profile" value={model.hasIncome ? "Income added" : "Not added"} />
          <NavRow page="cover-plan" label="Cover plan safeguards" value={model.accounts === 0 ? "Connect an account" : "Review settings"} />
          <NavRow page="plan" label="Your plan" value="Standard" />
        </List>
      </Group>
      <Group title="How Sorted works for you" intro="Choose what you see and hear.">
        <List>
          <NavRow page="display" label="Display" value="Dark mode off · Tips on" />
          <NavRow page="penny" label="Penny" value="Setting things up on" />
          <NavRow page="notifications" label="Notifications" value={model.notifBlocked ? "Blocked" : "On · 5 topics"} dot={model.notifBlocked} />
        </List>
      </Group>
      <Group title="Your account" intro="Manage your details, access and data.">
        <List>
          <NavRow page="profile" label="Profile" value={model.name ? "Details saved" : "Add your name"} dot={!model.name} />
          <NavRow page="signin" label="Sign-in methods" value={`${model.providers.length} linked`} />
          {model.native && <NavRow page="security" label="Security" value="Face ID on" />}
          <NavRow page="data" label="Data" value="90-day history" />
        </List>
      </Group>
      <Group title="Help" intro="Find your way around and read the small print.">
        <List>
          <NavRow page="tours" label="How Sorted works" value="5 tours" />
          <NavRow page="help" label="Terms and privacy" />
        </List>
      </Group>
      <Exits />
    </>
  );
}

const PAGES_A: Record<string, Page> = {
  financial: { title: "Financial profile", intro: "Add the figures Sorted uses for your tax breakdown.", body: <div className="mt-4"><FinancialBlock /></div> },
  "cover-plan": { title: "Cover plan safeguards", intro: "Choose which accounts Sorted can consider in a cover plan.", body: <div className="mt-4"><CoverPlanBlock /></div> },
  plan: { title: "Your plan", intro: "Your plan, and how much Penny you have used.", body: <div className="mt-4"><PlanBlock /></div> },
  display: { title: "Display", intro: "Choose what you see.", body: <div className="mt-4"><DisplayBlock /></div> },
  penny: { title: "Penny", intro: "Choose whether Penny can help set things up.", body: <div className="mt-4"><PennyBlock /></div> },
  notifications: { title: "Notifications", intro: "Choose which updates reach your phone.", body: <div className="mt-4"><NotificationsBlock /></div> },
  profile: { title: "Profile", intro: "Used to recognise your own transfers and show local fuel prices.", body: <div className="mt-4"><ProfileBlock /></div> },
  signin: { title: "Sign-in methods", intro: "Choose how you sign in to Sorted.", body: <div className="mt-4"><SignInBlock /></div> },
  security: { title: "Security", intro: "Control access to Sorted on this phone.", body: <div className="mt-4"><SecurityBlock /></div> },
  data: { title: "Data", intro: "Manage your transaction history.", body: <div className="mt-4"><DataBlock /></div> },
  tours: { title: "How Sorted works", intro: "Replay a tour of any screen.", body: <div className="mt-4"><ToursBlock /></div> },
  help: { title: "Terms and privacy", intro: "Read the small print.", body: <div className="mt-4"><LegalBlock /></div> },
  delete: { title: "Delete account and all data", body: <DeleteScreen /> },
};

/* ───────────────────────── B · Five jobs ───────────────────────── */

function HubB() {
  const { model, payLabel } = usePreview();
  return (
    <>
      <Header securityPage="access" planPage="service" profilePage="access" />
      <Group title="Your money" intro="Keep your money settings up to date.">
        <List>
          <NavRow page="money" label="Money details" helper="Pay period, income, pension and Child Benefit." value={payLabel} />
          <NavRow page="cover-plan" label="Cover plan safeguards" value={model.accounts === 0 ? "Connect an account" : "Review settings"} />
        </List>
      </Group>
      <Group title="Your experience" intro="Choose how Sorted helps you.">
        <List>
          <NavRow page="experience" label="Display, Penny and notifications" helper="Appearance, saving tips and updates." value={model.notifBlocked ? "Notifications blocked" : "Penny setup on"} dot={model.notifBlocked} />
        </List>
      </Group>
      <Group title="Your access" intro="Manage who you are and how you sign in.">
        <List>
          <NavRow page="access" label="Profile and sign-in" helper="Your details, linked identities and security." value={model.native ? "Face ID on" : `${model.providers.length} sign-in ${model.providers.length === 1 ? "method" : "methods"}`} />
        </List>
      </Group>
      <Group title="Your service" intro="Manage your plan and stored data.">
        <List>
          <NavRow page="service" label="Plan and data" helper="Penny usage, history and Set aside." value="Standard" />
        </List>
      </Group>
      <Group title="Help" intro="Learn the basics and read the small print.">
        <List>
          <NavRow page="help" label="Guides and help" helper="How Sorted works, Terms and Privacy." value="5 tours" />
        </List>
      </Group>
      <Exits />
    </>
  );
}

const PAGES_B: Record<string, Page> = {
  money: {
    title: "Money details",
    intro: "Keep the dates and figures Sorted uses up to date.",
    body: <PayAndFinancial />,
  },
  "cover-plan": PAGES_A["cover-plan"],
  experience: {
    title: "Display, Penny and notifications",
    intro: "Choose how Sorted helps you.",
    body: (
      <>
        <Group title="Display" intro="Choose what you see."><DisplayBlock /></Group>
        <Group title="Penny" intro="Choose whether Penny can help set things up."><PennyBlock /></Group>
        <Group title="Notifications" intro="Choose which updates reach your phone."><NotificationsBlock /></Group>
      </>
    ),
  },
  access: {
    title: "Profile and sign-in",
    intro: "Your details, how you sign in and how Sorted is protected.",
    body: (
      <>
        <Group title="Profile" intro="Used to recognise your own transfers and show local fuel prices."><ProfileBlock /></Group>
        <Group title="Sign-in methods" intro="Choose how you sign in to Sorted."><SignInBlock /></Group>
        <AccessSecurity />
      </>
    ),
  },
  service: {
    title: "Plan and data",
    intro: "Your plan, Penny usage and your transaction history.",
    body: (
      <>
        <Group title="Your plan"><PlanBlock /></Group>
        <Group title="Data" intro="Manage your transaction history."><DataBlock /></Group>
      </>
    ),
  },
  help: {
    title: "Guides and help",
    intro: "Learn the basics and read the small print.",
    body: (
      <>
        <Group title="How Sorted works" intro="Replay a tour of any screen."><ToursBlock /></Group>
        <Group title="Help" intro="Read the small print."><LegalBlock /></Group>
      </>
    ),
  },
  delete: PAGES_A.delete,
};

function PayAndFinancial() {
  const { payLabel } = usePreview();
  return (
    <>
      <Group title="Pay period" intro="Set how your spending periods are grouped.">
        <List><SheetRow sheet="pay-period" label="Pay period" value={payLabel} /></List>
      </Group>
      <Group title="Financial profile" intro="Used for your tax breakdown."><FinancialBlock /></Group>
    </>
  );
}

function AccessSecurity() {
  const { model } = usePreview();
  if (!model.native) return null;
  return <Group title="Security" intro="Control access to Sorted on this phone."><SecurityBlock /></Group>;
}

/* ───────────────────────── C · Quick adjustments first ───────────────────────── */

function HubC() {
  const { model, payLabel } = usePreview();
  return (
    <>
      <Header securityPage="account" planPage="plan" profilePage="account" />
      <Group title="Make Sorted yours" intro="Change the everyday things here.">
        <QuickControls />
      </Group>
      <Group title="Keep your money current" intro="Update the details behind your money view.">
        <List>
          <SheetRow sheet="pay-period" label="Pay period" value={payLabel} />
          <SheetRow sheet="financial" label="Financial profile" value={model.hasIncome ? "Income added" : "Not added"} />
          <NavRow page="cover-plan" label="Cover plan safeguards" value={model.accounts === 0 ? "Connect an account" : "Review settings"} />
        </List>
      </Group>
      <Group title="Manage your account" intro="Check your details, access and plan.">
        <List>
          <NavRow page="account" label="Account details" value={`${model.providers.length} sign-in ${model.providers.length === 1 ? "method" : "methods"}`} />
          <NavRow page="plan" label="Your plan" value="Standard" />
          <NavRow page="data" label="Data" value="90-day history" />
        </List>
      </Group>
      <Group title="Get help" intro="Take a tour or read the small print.">
        <List>
          <NavRow page="help" label="Guides and help" value="5 tours · Legal" />
        </List>
      </Group>
      <Exits />
    </>
  );
}

const PAGES_C: Record<string, Page> = {
  notifications: PAGES_A.notifications,
  "cover-plan": PAGES_A["cover-plan"],
  account: {
    title: "Account details",
    intro: "Your details, how you sign in and how Sorted is protected.",
    body: (
      <>
        <Group title="Profile" intro="Used to recognise your own transfers and show local fuel prices."><ProfileBlock /></Group>
        <Group title="Sign-in methods" intro="Choose how you sign in to Sorted."><SignInBlock /></Group>
        <AccessSecurity />
      </>
    ),
  },
  plan: PAGES_A.plan,
  data: PAGES_A.data,
  help: PAGES_B.help,
  delete: PAGES_A.delete,
};

/* ───────────────────────── exports ───────────────────────── */

export const HUBS: Record<VariantId, () => ReactNode> = { a: HubA, b: HubB, c: HubC };
export const PAGES: Record<VariantId, Record<string, Page>> = { a: PAGES_A, b: PAGES_B, c: PAGES_C };

export function PageView({ variant, page }: { variant: VariantId; page: string }) {
  const def = PAGES[variant][page];
  if (!def) return null;
  return (
    <PageFrame title={def.title} intro={def.intro}>
      {def.body}
    </PageFrame>
  );
}

export const VARIANT_NOTES: Record<VariantId, { name: string; thesis: string; tradeoff: string; inline: string; exits: string }> = {
  a: {
    name: "A · Clear directory",
    thesis: "Four plain groups by job, one row per familiar setting, each row showing its real status. It is G94's approved intent grouping with the grid and the merged exit card removed.",
    tradeoff: "More destinations on the hub than B (13 rows), so it is the longest hub of the three, but nothing is hidden behind a vague label.",
    inline: "Inline: status only, no switches on the hub. Pay period opens the real sheet. Everything else is a page one level down. Cover plan safeguards has its own page.",
    exits: "Sign out is a plain row after Help. Delete is a separate plain row 24px below it and opens its own screen.",
  },
  b: {
    name: "B · Five jobs",
    thesis: "The hub is five jobs, each a single destination that holds its related controls, so the hub is the shortest of the three and answers 'there is quite a lot' directly.",
    tradeoff: "One more tap to reach most controls, and the workspace pages are longer scrolls than A's single-purpose pages.",
    inline: "Inline: status only. Pay period is a sheet inside Money details. Notifications, Display and Penny live together in one experience workspace. Cover plan safeguards stays on the hub as its own page.",
    exits: "Both exits sit below all five jobs, outside any card. Delete always opens its own screen.",
  },
  c: {
    name: "C · Quick adjustments first",
    thesis: "The few switches people actually flip (dark mode, saving tips, Penny setup) live on the hub; bounded edits open sheets; account administration sits further down.",
    tradeoff: "A busier hub and a new Penny turn-on switch that does not exist in production today (consent is granted in Penny chat). Needs a consent-flow decision before it could ship.",
    inline: "Inline: three switches. Sheets: Pay period (real sheet) and Financial profile. Pages: Notifications, Account details, Your plan, Data, Help, Cover plan safeguards.",
    exits: "Same isolated treatment as A: Sign out is not inside Account details, Delete opens its own screen.",
  },
};
