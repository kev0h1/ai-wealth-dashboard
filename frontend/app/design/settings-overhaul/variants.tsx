"use client";

// G201 variants. Directions drafted by openai/gpt-6-astra (raw output in the
// session notes), rewritten to DESIGN.md and the copy rules. The hubs and the
// pages are hand-authored; the controls inside them are in sections.tsx.

import { type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Search, UserRound } from "lucide-react";
import Toggle from "@/components/Toggle";
import { Group, INK, List, NavRow, PageFrame, SheetRow, SOFT, usePreview, type VariantId } from "./ui";
import {
  CoverPlanBlock, DataBlock, DeleteScreen, DisplayBlock, Exits, FinancialBlock, LegalBlock, NotificationsBlock,
  AssistantsBlock, PennyBlock, PlanBlock, ProfileBlock, QuickControls, SecurityBlock, SignInBlock, ToursBlock,
} from "./sections";

const LINK = "inline-flex min-h-11 items-center gap-0.5 rounded-xl px-2 text-sm font-semibold text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300";

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

/** Hub header on the canvas: who you are, how you sign in, status at a glance.
 * No hero card, the status that the old hero carried survives as two links. */
function Header({ securityPage, planPage, profilePage }: { securityPage: string; planPage: string; profilePage: string }) {
  const { model, href, page } = usePreview();
    return (
    <header>
      {page === "hub" ? <h1 className={`text-xl font-bold ${INK}`}>Account</h1> : <h2 className={`text-xl font-bold ${INK}`}>Account</h2>}
      <div className="mt-4 flex items-center gap-3">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-base font-bold text-indigo-700 dark:bg-indigo-400/20 dark:text-indigo-300">
          {model.name ? initialsOf(model.name) : <UserRound size={20} />}
        </span>
        <div className="min-w-0">
          {model.name ? (
            <p className={`truncate text-base font-bold ${INK}`}>{model.name}</p>
          ) : (
            <Link href={href(profilePage)} className="inline-flex min-h-11 items-center rounded-xl text-base font-bold text-indigo-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">
              Add your name
            </Link>
          )}
          <p className={`truncate text-xs ${SOFT}`}>{model.email}</p>
        </div>
      </div>
      <ul aria-label="Sign-in methods" className="mt-3 flex flex-wrap gap-2">{model.providers.map((p) => <li key={p.id} className="rounded-full border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-600 dark:text-slate-300">{p.label}: {p.primary ? "primary" : "linked"}</li>)}</ul>
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
          {model.assistants && <NavRow page="assistants" label="Connected assistants" value="None connected" />}
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
  assistants: { title: "Connected assistants", intro: "Choose which assistants can read your Sorted data.", body: <div className="mt-4"><AssistantsBlock /></div> },
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
          <NavRow page="service" label="Plan and data" helper={model.assistants ? "Penny usage, history, Set aside and connected assistants." : "Penny usage, history and Set aside."} value="Standard" />
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
        <ConnectedAssistants />
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

function ConnectedAssistants() {
  const { model } = usePreview();
  if (!model.assistants) return null;
  return <Group title="Connected assistants" intro="Assistants you allow to read your Sorted data."><AssistantsBlock /></Group>;
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
        <ConnectedAssistants />
      </>
    ),
  },
  plan: PAGES_A.plan,
  data: PAGES_A.data,
  help: PAGES_B.help,
  delete: PAGES_A.delete,
};

/* ───────────────────────── D/E/F · fresh task navigation ───────────────────────── */

function SearchField() {
  const { search, setSearch } = usePreview();
  return <label className="mt-5 flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-slate-700 focus-within:ring-2 focus-within:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"><Search size={16} aria-hidden="true" /><span className="sr-only">Search settings</span><input type="search" name="settings-search" autoComplete="off" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search settings" className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-slate-500" /></label>;
}

function matchesSearch(search: string, ...values: (string | undefined)[]) {
  return !search || values.join(" ").toLowerCase().includes(search.toLowerCase());
}

function HubD() {
  const { model, payLabel, search } = usePreview();
  const show = (label: string, helper?: string) => matchesSearch(search, label, helper);
  const groups = [show("Manage your money pay period financial income pension Child Benefit tax cover safeguards accounts"), show("Make the app yours display dark mode hide balances show tips privacy"), show("Notifications push permission registration alerts topics"), show("Your account profile name postcode sign-in Apple Google biometric security data sync history set aside"), show("Penny plan messages assistants connected"), show("Help information tours terms privacy")];
  return <>
    <Header securityPage="account" planPage="penny-plan" profilePage="account" />
    <SearchField />
    {groups[0] && <Group title="Manage your money" intro="Dates, tax details and safeguards behind your plan."><List>
      {show("Pay period") && <SheetRow sheet="pay-period" label="Pay period" value={payLabel} />}
      {show("Financial profile income pension Child Benefit tax") && <NavRow page="financial" label="Financial profile" value={model.hasIncome ? "Income added" : "Not added"} />}
      {show("Cover-plan safeguards accounts") && <NavRow page="cover" label="Cover-plan safeguards" value={model.accounts ? "Review settings" : "Connect an account"} />}
    </List></Group>}
    {groups[1] && <Group title="Make the app yours" intro="Choose what you see and what Sorted highlights."><List><NavRow page="display" label="Display and privacy" value="Display choices" /></List></Group>}
    {groups[2] && <Group title="Notifications" intro="Permission, delivery and the alerts you receive."><List><NavRow page="notifications" label="Notifications" value={model.notifBlocked ? "Blocked" : "5 topics on"} dot={model.notifBlocked} /></List></Group>}
    {groups[3] && <Group title="Your account" intro="Your details, access and history."><List><NavRow page="account" label="Profile, sign-in and data" value={model.native ? "Face ID on" : `${model.providers.length} sign-in methods`} /></List></Group>}
    {groups[4] && <Group title="Penny and your plan" intro="What Penny can help with and your allowance."><List><NavRow page="penny-plan" label="Penny and your plan" value="Standard · 113 messages left" />{model.assistants && <NavRow page="assistants" label="Connected assistants" value="Available when enabled" />}</List></Group>}
    {groups[5] && <Group title="Help and information" intro="Replay a tour or read the small print."><List><NavRow page="help" label="Help, tours and legal" value="5 tours" /></List></Group>}
    {!groups.some(Boolean) && <p role="status" className={`mt-8 text-sm ${SOFT}`}>No settings match “{search}”. Try a different word.</p>}
    <Exits />
  </>;
}

function QuickPreferences() {
  const { prefs, setPrefs } = usePreview();
  return <List><div className="flex items-center justify-between gap-3 px-4 py-3"><span><span className={`block text-sm font-semibold ${INK}`}>Dark mode</span><span className={`block text-xs ${SOFT}`}>Easier on the eyes at night.</span></span><Toggle checked={prefs.dark} onChange={() => setPrefs({ ...prefs, dark: !prefs.dark })} label="Dark mode" /></div><div className="border-t border-slate-100 dark:border-slate-700"><div className="flex items-center justify-between gap-3 px-4 py-3"><span><span className={`block text-sm font-semibold ${INK}`}>Hide balances</span><span className={`block text-xs ${SOFT}`}>Mask balances across Sorted, including on other devices.</span></span><Toggle checked={prefs.hideBalances} onChange={() => setPrefs({ ...prefs, hideBalances: !prefs.hideBalances })} label="Hide balances" /></div></div><div className="border-t border-slate-100 dark:border-slate-700"><div className="flex items-center justify-between gap-3 px-4 py-3"><span><span className={`block text-sm font-semibold ${INK}`}>Show tips</span><span className={`block text-xs ${SOFT}`}>Ways to save on Home, Spend and Transactions.</span></span><Toggle checked={prefs.showTips} onChange={() => setPrefs({ ...prefs, showTips: !prefs.showTips })} label="Show tips on Spend and Transactions" /></div></div></List>;
}

function HubE() {
  const { model, payLabel, search } = usePreview(); const show = (label: string) => matchesSearch(search, label);
  const groups = [show("Manage your money pay period financial income pension Child Benefit tax cover safeguards accounts"), show("Notifications push permission registration alerts topics"), show("Your account profile name postcode sign-in Apple Google biometric security data sync history set aside"), show("Penny plan messages assistants connected"), show("Help tours legal terms privacy")];
  const quickMatches = show("Display privacy dark mode hide balances show tips");
  return <><Header securityPage="account" planPage="penny-plan" profilePage="account" /><SearchField />
    {quickMatches && <Group title="Display and privacy" intro="Quick choices for how Sorted looks and what it shows."><QuickPreferences /></Group>}
    {groups.some(Boolean) && <Group title="Deeper tasks" intro="Open a workspace when a setting needs more context."><List>
      {groups[0] && <NavRow page="money" label="Manage your money" helper="Pay period, tax details and Cover-plan safeguards." value={payLabel} />}
      {groups[1] && <NavRow page="notifications" label="Notifications" value={model.notifBlocked ? "Blocked" : "5 topics on"} dot={model.notifBlocked} />}
      {groups[2] && <NavRow page="account" label="Your account" helper="Profile, sign-in, biometrics and data." value={`${model.providers.length} methods`} />}
      {groups[3] && <NavRow page="penny-plan" label="Penny and your plan" value="Standard" />}
      {model.assistants && groups[3] && <NavRow page="assistants" label="Connected assistants" value="Available when enabled" />}
      {groups[4] && <NavRow page="help" label="Help and information" value="5 tours" />}
    </List></Group>}{!quickMatches && !groups.some(Boolean) && <p role="status" className={`mt-4 text-sm ${SOFT}`}>No settings match “{search}”. Try a different word.</p>}<Exits /></>;
}

function Chapter({ title, summary, page, children, forceOpen = false }: { title: string; summary: string; page: string; children: ReactNode; forceOpen?: boolean }) {
  const { href, openChapter, setOpenChapter, setReturnY } = usePreview(); const open = forceOpen || openChapter === page;
  return <section className="border-t border-slate-200 py-1 first:border-t-0 dark:border-slate-700"><button type="button" onClick={() => setOpenChapter(open ? null : page)} aria-expanded={open} className="flex min-h-14 w-full items-center gap-3 px-1 text-left focus-visible:ring-2 focus-visible:ring-indigo-500"><span className="min-w-0 flex-1"><span className={`block text-sm font-semibold ${INK}`}>{title}</span><span className={`block text-xs ${SOFT}`}>{summary}</span></span><ChevronDown size={16} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" /></button>{open && <div className="pb-4"><div className="rounded-2xl bg-slate-100/70 p-3 dark:bg-slate-800/70">{children}<Link onClick={() => setReturnY(window.scrollY)} href={href(page)} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Open full settings <ChevronRight size={16} aria-hidden="true" /></Link></div></div>}</section>;
}

function HubF() {
  const { model, payLabel, href, search } = usePreview(); const show = (label: string) => matchesSearch(search, label);
  const groups = [show("Manage money pay period financial income pension Child Benefit tax cover safeguards accounts"), show("Make app yours display dark balances tips privacy"), show("Notifications push permission registration alerts topics"), show("Your account profile name postcode sign-in Apple Google biometric security data sync history set aside"), show("Penny plan assistants connected"), show("Help tours legal terms privacy")];
  return <><Header securityPage="account" planPage="penny-plan" profilePage="account" /><SearchField /><div className="mt-6">
    {groups[0] && <Chapter forceOpen={!!search} title="Manage your money" summary={payLabel} page="money"><p className={`text-sm ${SOFT}`}>Pay period, Financial profile and Cover-plan safeguards.</p><Link href={href("cover")} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-indigo-700 dark:text-indigo-300">Cover-plan safeguards</Link></Chapter>}
    {groups[1] && <Chapter forceOpen={!!search} title="Make the app yours" summary="Display, balances and tips" page="display"><QuickPreferences /></Chapter>}
    {groups[2] && <Chapter forceOpen={!!search} title="Notifications" summary={model.notifBlocked ? "Permission blocked" : "5 topics on"} page="notifications"><p className={`text-sm ${SOFT}`}>Permission, registration and individual alert topics stay separate.</p></Chapter>}
    {groups[3] && <Chapter forceOpen={!!search} title="Your account" summary={`${model.providers.length} sign-in methods`} page="account"><p className={`text-sm ${SOFT}`}>Profile, sign-in, biometric unlock and history.</p></Chapter>}
    {groups[4] && <Chapter forceOpen={!!search} title="Penny and your plan" summary="Standard plan" page="penny-plan"><p className={`text-sm ${SOFT}`}>Penny can answer questions and help set things up when you ask.</p>{model.assistants && <Link href={href("assistants")} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-indigo-700 dark:text-indigo-300">Connected assistants</Link>}</Chapter>}
    {groups[5] && <Chapter forceOpen={!!search} title="Help and information" summary="Tours, terms and privacy" page="help"><p className={`text-sm ${SOFT}`}>Replay a tour or read the small print.</p></Chapter>}
    {!groups.some(Boolean) && <p role="status" className={`mt-6 text-sm ${SOFT}`}>No settings match “{search}”. Try a different word.</p>}
  </div><Exits /></>;
}

const PAGES_FRESH: Record<string, Page> = {
  money: { title: "Manage your money", intro: "Pay period, tax details and safeguards behind your plan.", body: <><PayAndFinancial /><Group title="Cover-plan safeguards" intro="Choose which accounts Sorted can consider for a cover plan."><List><NavRow page="cover" label="Cover-plan safeguards" value="Review settings" /></List></Group></> },
  financial: PAGES_A.financial, cover: { title: "Cover-plan safeguards", intro: "Choose which accounts Sorted can consider for a cover plan.", body: <div className="mt-4"><CoverPlanBlock /></div> },
  display: PAGES_A.display, notifications: PAGES_A.notifications, account: { title: "Your account", intro: "Your details, access and transaction history.", body: <><Group title="Profile" intro="Used to recognise transfers and local fuel prices."><ProfileBlock /></Group><Group title="Sign-in methods" intro="Choose how you sign in to Sorted."><SignInBlock /></Group><AccessSecurity /><Group title="Data" intro="Manage your history and excluded payments."><DataBlock /></Group></> },
  "penny-plan": { title: "Penny and your plan", intro: "Your plan, Penny usage and what Penny may propose.", body: <><Group title="Your plan"><PlanBlock /></Group><Group title="Penny" intro="Penny can answer questions. Setting things up can only be switched off here when already on."><PennyBlock /></Group></> },
  assistants: PAGES_A.assistants, help: PAGES_B.help, delete: PAGES_A.delete,
};

/* ───────────────────────── exports ───────────────────────── */

export const HUBS: Record<VariantId, () => ReactNode> = { a: HubA, b: HubB, c: HubC, d: HubD, e: HubE, f: HubF };
export const PAGES: Record<VariantId, Record<string, Page>> = { a: PAGES_A, b: PAGES_B, c: PAGES_C, d: PAGES_FRESH, e: PAGES_FRESH, f: PAGES_FRESH };

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
  d: {
    name: "D · Task directory",
    thesis: "A calm task directory puts every job in one named place, with search and useful trailing values so the next action is clear before opening a page.",
    tradeoff: "The hub has more destinations than E, but each destination is narrow and easy to return from on a phone.",
    inline: "Search filters task destinations locally. Desktop keeps the directory beside the active detail; phone uses the same back path.",
    exits: "Sign out sits outside routine tasks. Delete remains a separate type-DELETE screen.",
  },
  e: {
    name: "E · Quick preferences and deeper tasks",
    thesis: "Three safe display and privacy choices are immediately available, while every stateful, financial or authentication task remains a deliberate destination.",
    tradeoff: "The split asks users to recognise whether a change is quick or deep, but it avoids a long list of unrelated switches.",
    inline: "Desktop holds the preference rail apart from the directory. The controls are local fixtures only and do not save.",
    exits: "Sign out and deletion stay outside the preference and task areas.",
  },
  f: {
    name: "F · Expandable task chapters",
    thesis: "One expanded chapter lets a user orient themselves without leaving the hub, while full editors retain protected drill-ins.",
    tradeoff: "The hub can grow vertically when a chapter is open, so the strongest implementation must preserve scroll and the open chapter after returning.",
    inline: "Search reveals matching chapters. Each chapter offers a local continuation into its full destination.",
    exits: "The final, isolated exit area is shared with D and E.",
  },
};
