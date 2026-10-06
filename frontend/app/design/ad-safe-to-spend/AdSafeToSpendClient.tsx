"use client";

// G222 first Sorted ad, design round 1. Three static art directions on one
// message, Safe to Spend, for people who worry about money until payday.
// Channels: TikTok, Instagram, Facebook. Demo (fictional) data only.
//
// The phone imagery is the production components/SafeToSpendCard rendered
// through its real props with fixture data, never hand-copied markup. The
// artboard is an exact-pixel frame so a headless screenshot at that viewport
// is the export.
//
// /design/ad-safe-to-spend?variant=a|b|c&format=feed|story&mode=light|dark[&chrome=1]
//
// Colour is information: emerald is the on-track figure, indigo is the one
// action (CTA). No red, and the indigo to violet gradient is Penny's alone, so
// it appears nowhere here. Type is Figtree (brand sans) with the figure in
// JetBrains Mono, per DESIGN.md's Money Is Mono Rule.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import {
  AD_DATA,
  AD_SPEND_FROM,
  DISCLAIMER,
  PERSONA,
  SIZES,
  STORY_SAFE,
  VARIANTS,
  type Format,
  type Mode,
  type Variant,
} from "./fixtures";

const noop = () => {};

// Card natural width is 360 CSS px (a phone column). Zoom scales the real
// component up to ad size; zoom (unlike transform) keeps layout honest.
const CARD_W = 360;

function pound(n: number): string {
  return `£${n.toLocaleString("en-GB")}`;
}

function Card({ zoom }: { zoom: number }) {
  return (
    <div className="self-center" style={{ width: CARD_W, zoom } as CSSProperties}>
      <SafeToSpendCard
        data={AD_DATA}
        loading={false}
        onRetry={noop}
        spendFrom={AD_SPEND_FROM}
        previewBalancesVisible
      />
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" width={64} height={64} className="block size-[64px] rounded-[16px] ring-1 ring-slate-900/10 dark:ring-white/20" />
      <span className="text-[48px] font-extrabold leading-none tracking-[-0.03em] text-slate-900 dark:text-slate-50">Sorted</span>
    </div>
  );
}

function Cta({ label = "Get Sorted" }: { label?: string }) {
  return (
    <div className="inline-flex items-center whitespace-nowrap rounded-[28px] bg-indigo-600 px-12 py-6 text-[44px] font-bold leading-none tracking-[-0.01em] text-white">
      {label}
    </div>
  );
}

function Fine() {
  return <p className="text-[24px] leading-[1.3] text-slate-600 dark:text-slate-400">{DISCLAIMER}</p>;
}

function Headline({ children, size }: { children: ReactNode; size: number }) {
  return (
    <h1
      className="font-extrabold tracking-[-0.035em] text-slate-900 dark:text-slate-50"
      style={{ fontSize: size, lineHeight: 1.04, textWrap: "pretty" }}
    >
      {children}
    </h1>
  );
}

function Body({ children, size = 40 }: { children: ReactNode; size?: number }) {
  return (
    <p className="font-medium text-slate-700 dark:text-slate-200" style={{ fontSize: size, lineHeight: 1.3, textWrap: "balance" }}>
      {children}
    </p>
  );
}

// ---------- A. The question ----------
function VariantA({ format }: { format: Format }) {
  const story = format === "story";
  return (
    <>
      <div className="flex flex-col gap-8">
        <Headline size={story ? 84 : 88}>
          Payday&apos;s {PERSONA.daysToPayday} days away.
          <br />
          What can you
          <br />
          actually spend?
        </Headline>
        <Body>Sorted works out what&apos;s left after your bills.</Body>
      </div>
      <div className="flex flex-col gap-6">
        <Card zoom={story ? 1.95 : 1.7} />
      </div>
    </>
  );
}

// ---------- B. The number ----------
function VariantB({ format }: { format: Format }) {
  const story = format === "story";
  return (
    <>
      <div className="flex flex-col gap-6">
        <div
          className="money font-bold leading-[0.95] tracking-[-0.06em] text-emerald-700 dark:text-emerald-300"
          style={{ fontSize: story ? 210 : 220 }}
        >
          {pound(PERSONA.safe)}
        </div>
        <Headline size={story ? 80 : 76}>is safe to spend<br />until payday,<br />by our estimate.</Headline>
        <Body>Worked out from your bank, after bills and plans.</Body>
      </div>
      <Card zoom={story ? 1.4 : 1.3} />
    </>
  );
}

// ---------- C. The relief ----------
function Sum({ figure, label, strong }: { figure: string; label: string; strong?: boolean }) {
  // Set in Figtree with tabular-nums so U+2212 reads as a true minus (JetBrains Mono draws it like a hyphen).
  // The figure column is fixed and right-aligned so the minus signs and digits
  // line up like the app's own ledger.
  return (
    <div className={`grid grid-cols-[200px_1fr] items-baseline gap-x-6 text-[40px] leading-[1.2] ${strong ? "font-bold text-slate-800 dark:text-slate-100" : "font-medium text-slate-600 dark:text-slate-400"}`}>
      <span className="text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{figure}</span>
      <span>{label}</span>
    </div>
  );
}

function VariantC({ format }: { format: Format }) {
  const story = format === "story";
  return (
    <>
      <div className="flex flex-col gap-5">
        <p className="text-[40px] font-semibold leading-[1.2] text-slate-600 dark:text-slate-400">The late-month maths</p>
        <div>
          <Sum figure={pound(PERSONA.inAccount)} label="in the account" />
          <Sum figure={`−${pound(PERSONA.bills)}`} label="bills" />
          <Sum figure={`−${pound(PERSONA.planSetAside)}`} label="plans" />
          <Sum figure={`−${pound(PERSONA.buffer)}`} label="buffer" />
          <Sum figure="?" label="left to spend" strong />
        </div>
      </div>
      <div className="flex flex-col gap-8">
        <Headline size={story ? 76 : 76}>Or one number, already worked out.</Headline>
        <Card zoom={story ? 1.7 : 1.45} />
      </div>
    </>
  );
}

// ---------- Artboard ----------
function Artboard({ variant, format, mode }: { variant: Variant; format: Format; mode: Mode }) {
  const { w, h } = SIZES[format];
  const story = format === "story";
  const pad: CSSProperties = story
    ? { paddingTop: STORY_SAFE.top + 16, paddingLeft: STORY_SAFE.left, paddingRight: STORY_SAFE.right + 8, paddingBottom: STORY_SAFE.bottom }
    : { padding: "64px 72px 56px 72px" };

  return (
    <div
      data-artboard
      className={`${mode === "dark" ? "dark bg-slate-900" : "bg-[#f0f2f7]"} font-sans`}
      style={{ position: "fixed", top: 0, left: 0, width: w, height: h, overflow: "hidden", colorScheme: mode, zIndex: 100000 }}
    >
      <div className={`flex h-full flex-col ${story ? "justify-center gap-12" : "justify-between"}`} style={pad}>
        <div data-content className={story ? "flex flex-col gap-8" : "flex flex-1 flex-col justify-start gap-9 pb-10"}>
          {variant === "a" && <VariantA format={format} />}
          {variant === "b" && <VariantB format={format} />}
          {variant === "c" && <VariantC format={format} />}
        </div>
        <div data-bottom className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <Brand />
            <Cta />
          </div>
          <Fine />
        </div>
      </div>
    </div>
  );
}

export default function AdSafeToSpendClient() {
  const params = useSearchParams();
  const rawV = params.get("variant");
  const variant: Variant = rawV === "b" || rawV === "c" ? rawV : "a";
  const rawF = params.get("format") ?? params.get("state"); // index links pass state=
  const format: Format = rawF === "story" ? "story" : "feed";
  const mode: Mode = params.get("mode") === "light" ? "light" : "dark";
  const chrome = params.get("chrome") === "1";
  const { w } = SIZES[format];

  const href = (n: Partial<{ variant: Variant; format: Format; mode: Mode }>) =>
    `?variant=${n.variant ?? variant}&format=${n.format ?? format}&mode=${n.mode ?? mode}&chrome=1`;
  const pill = "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold";

  return (
    <>
      <Artboard variant={variant} format={format} mode={mode} />
      {chrome && (
        <div className="fixed top-4 z-[100001] flex flex-col gap-3 rounded-2xl bg-white p-4 text-slate-900 shadow-sm" style={{ left: w + 24 }}>
          <nav aria-label="Variant" className="flex gap-2">
            {VARIANTS.map((v) => (
              <Link key={v.id} href={href({ variant: v.id })} className={`${pill} ${variant === v.id ? "bg-indigo-600 text-white" : "bg-indigo-50 text-indigo-700"}`}>{v.label}</Link>
            ))}
          </nav>
          <nav aria-label="Format" className="flex gap-2">
            {(["feed", "story"] as Format[]).map((f) => (
              <Link key={f} href={href({ format: f })} className={`${pill} ${format === f ? "bg-indigo-600 text-white" : "bg-indigo-50 text-indigo-700"}`}>{f === "feed" ? "Feed 1080x1350" : "Story 1080x1920"}</Link>
            ))}
          </nav>
          <nav aria-label="Mode" className="flex gap-2">
            {(["light", "dark"] as Mode[]).map((m) => (
              <Link key={m} href={href({ mode: m })} className={`${pill} ${mode === m ? "bg-indigo-600 text-white" : "bg-indigo-50 text-indigo-700"}`}>{m === "light" ? "Light" : "Dark"}</Link>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
