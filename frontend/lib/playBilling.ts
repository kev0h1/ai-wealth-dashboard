// C24: Google Play Billing for the Android build (docs/pricing/store-billing-c13.md
// section 9, as built). Everything the plugin does is reached through
// withPlay() below, and everything the server needs comes from
// GET /billing/play/config: the product ids (from server config, none is
// written in this file), the obfuscatedAccountId to set on the purchase and
// whether a purchase may start. The picker shows the store's own price strings
// and describes the free trial only when the store itself returns a trial offer.
//
// The client never grants entitlement. After a purchase it hands the purchase
// token to POST /billing/play/purchase, where the server verifies it with the
// Google Play Developer API and acknowledges or consumes it. Purchases are
// bought with autoAcknowledgePurchases off and no client-side consume, so
// Google only ever sees a verified purchase acknowledged.
//
// Stripe is never reachable from here. This module imports no checkout or
// portal call; lib/purchaseChannel.ts decides a build may use it at all.
//
// Two Capacitor rules this file is built around:
//  1. A registerPlugin() proxy is not thenable. Returning it from an async
//     function or resolving a promise with it makes the runtime call .then on
//     it and the call spins forever, so the plugin object never leaves
//     withPlay(); callers only ever receive plain data.
//  2. A plugin call with no native implementation also spins forever, so
//     hasPlayPlugin() checks Capacitor.PluginHeaders (what the native side
//     registered) before anything is called.

import { Capacitor } from "@capacitor/core";
import type { NativePurchasesPlugin, Product, Transaction } from "@capgo/native-purchases";
import { api } from "./api";

const PLUGIN_NAME = "NativePurchases";

export type PlayBillingConfig = {
  enabled: boolean;
  package_name?: string;
  /** key (lite, lite_six_months, ..., penny_small) -> Play product id */
  products?: Record<string, string>;
  /** Set as the purchase's obfuscatedAccountId. A salted hash, never the email. */
  account_id?: string;
  /** A sentence when buying must not start (an active web plan already covers the user). */
  purchase_blocked?: string | null;
};

/** True only when the binary really contains the plugin's native side. */
export function hasPlayPlugin(): boolean {
  try {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return false;
    const headers = (Capacitor as unknown as { PluginHeaders?: { name: string }[] }).PluginHeaders;
    return Array.isArray(headers) && headers.some((h) => h?.name === PLUGIN_NAME);
  } catch {
    return false;
  }
}

type PlayHandle = {
  plugin: NativePurchasesPlugin;
  subs: Parameters<NativePurchasesPlugin["getProducts"]>[0]["productType"];
  inapp: Parameters<NativePurchasesPlugin["getProducts"]>[0]["productType"];
};

let configured = false;

/** Runs `fn` with the plugin. The plugin proxy is passed in a plain object
 *  and never returned: see rule 1 above. */
async function withPlay<T>(fn: (play: PlayHandle) => Promise<T>): Promise<T> {
  if (!hasPlayPlugin()) throw new Error("Google Play purchases are not available in this build.");
  const mod = await import("@capgo/native-purchases");
  const play: PlayHandle = { plugin: mod.NativePurchases, subs: mod.PURCHASE_TYPE.SUBS, inapp: mod.PURCHASE_TYPE.INAPP };
  if (!configured) {
    // The server acknowledges and consumes after verifying. capacitor.config.json
    // sets the same flag so it holds before this runs (the plugin's launch-time
    // recovery would otherwise acknowledge unverified purchases).
    await play.plugin.configure({ autoFinishTransactions: false });
    configured = true;
  }
  return fn(play);
}

export function loadPlayConfig(): Promise<PlayBillingConfig> {
  return api.getPlayBillingConfig();
}

// ── Store offer data ─────────────────────────────────────────────────────────

/** What the plan picker may say about a product, taken from the store only. */
export type PlayProductView = {
  productId: string;
  /** The store's own formatted price, e.g. "£5.99". */
  priceString: string;
  /** Base plan and offer to hand back to purchaseProduct. */
  planIdentifier: string | null;
  offerToken: string | null;
  /** Set only when the store returned a free-trial offer for this user.
   *  Play lists only the offers a user is eligible for, so no trial offer
   *  means no trial is promised. Never inferred, never hard-coded. */
  freeTrial: { periodText: string } | null;
};

type PeriodLike = { numberOfUnits?: number; unitString?: string };
type OfferLike = {
  introductoryPrice?: { price?: number; subscriptionPeriod?: PeriodLike } | null;
};

/** "14 days" from the store's own period, or null. Singular and plural only. */
export function periodText(period: PeriodLike | undefined): string | null {
  const n = period?.numberOfUnits;
  const unit = period?.unitString;
  if (typeof n !== "number" || n < 1 || !unit || unit === "unknown") return null;
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** The free trial this store entry carries, or null. A free phase is an
 *  introductory price of exactly zero. */
export function describeFreeTrial(entry: OfferLike): { periodText: string } | null {
  const offer = entry.introductoryPrice;
  if (!offer || offer.price !== 0) return null;
  const text = periodText(offer.subscriptionPeriod);
  return text ? { periodText: text } : null;
}

type EntryLike = Pick<Product, "identifier" | "priceString"> &
  OfferLike & { planIdentifier?: string; offerToken?: string };

/** One view per product id. Play returns one entry per base plan and offer;
 *  an entry carrying a free trial wins over the plain base plan, because the
 *  store only lists it when this user can have it. */
export function toProductViews(entries: EntryLike[]): Record<string, PlayProductView> {
  const out: Record<string, PlayProductView> = {};
  for (const entry of entries) {
    const view: PlayProductView = {
      productId: entry.identifier,
      priceString: entry.priceString,
      planIdentifier: entry.planIdentifier ?? null,
      offerToken: entry.offerToken ?? null,
      freeTrial: describeFreeTrial(entry),
    };
    const current = out[entry.identifier];
    if (!current || (!current.freeTrial && view.freeTrial)) out[entry.identifier] = view;
  }
  return out;
}

async function loadViews(productIds: string[], kind: "subs" | "inapp"): Promise<Record<string, PlayProductView>> {
  if (productIds.length === 0) return {};
  return withPlay(async (play) => {
    const { products } = await play.plugin.getProducts({
      productIdentifiers: productIds,
      productType: kind === "subs" ? play.subs : play.inapp,
    });
    return toProductViews(products);
  });
}

export const loadPlaySubscriptionProducts = (ids: string[]) => loadViews(ids, "subs");
export const loadPlayPackProducts = (ids: string[]) => loadViews(ids, "inapp");

// ── Purchase, restore, manage ────────────────────────────────────────────────

export type PurchaseOutcome =
  | { ok: true }
  | { ok: false; cancelled: boolean; message: string };

const NOT_CONFIRMED = "We could not confirm your purchase yet. Try Restore purchases in a moment.";
const DID_NOT_GO_THROUGH = "The purchase did not go through. You have not been charged.";

function isCancellation(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err ?? "");
  return /cancel/i.test(text);
}

async function verify(tx: Pick<Transaction, "purchaseToken" | "productIdentifier">): Promise<boolean> {
  if (!tx.purchaseToken || !tx.productIdentifier) return false;
  const res = await api.verifyPlayPurchase(tx.purchaseToken, tx.productIdentifier);
  return res.handled !== false;
}

function canStart(config: PlayBillingConfig, productId: string | undefined): string | null {
  if (!config.enabled || !config.account_id || !productId) return "This cannot be bought in the app yet.";
  if (config.purchase_blocked) return config.purchase_blocked;
  return null;
}

/** Buys one subscription base plan, carrying the user's obfuscatedAccountId,
 *  then has the server verify the purchase token. The server, not this
 *  function, decides what the user is entitled to. Plan changes while a
 *  subscription is active go through Play (see openManagePlaySubscriptions):
 *  the plugin cannot send Play's replacement mode, so buying a second
 *  subscription on top would charge twice. */
export async function purchasePlaySubscription(
  productKey: string, config: PlayBillingConfig, view: PlayProductView,
): Promise<PurchaseOutcome> {
  const productIdentifier = config.products?.[productKey];
  const refusal = canStart(config, productIdentifier);
  if (refusal) return { ok: false, cancelled: false, message: refusal };
  try {
    return await withPlay(async (play) => {
      const tx = await play.plugin.purchaseProduct({
        productIdentifier: productIdentifier as string,
        productType: play.subs,
        planIdentifier: view.planIdentifier ?? undefined,
        offerToken: view.offerToken ?? undefined,
        appAccountToken: config.account_id as string,
        autoAcknowledgePurchases: false,
      });
      return (await verify(tx))
        ? ({ ok: true } as const)
        : ({ ok: false, cancelled: false, message: NOT_CONFIRMED } as const);
    });
  } catch (err) {
    if (isCancellation(err)) return { ok: false, cancelled: true, message: "" };
    return { ok: false, cancelled: false, message: DID_NOT_GO_THROUGH };
  }
}

/** Buys one Penny pack (a one-time product). Not consumed here: the server
 *  grants the messages once and consumes the purchase after verifying it. */
export async function purchasePlayPack(
  productKey: string, config: PlayBillingConfig,
): Promise<PurchaseOutcome> {
  const productIdentifier = config.products?.[productKey];
  const refusal = canStart(config, productIdentifier);
  if (refusal) return { ok: false, cancelled: false, message: refusal };
  try {
    return await withPlay(async (play) => {
      const tx = await play.plugin.purchaseProduct({
        productIdentifier: productIdentifier as string,
        productType: play.inapp,
        appAccountToken: config.account_id as string,
        isConsumable: false,
        autoAcknowledgePurchases: false,
      });
      return (await verify(tx))
        ? ({ ok: true } as const)
        : ({ ok: false, cancelled: false, message: NOT_CONFIRMED } as const);
    });
  } catch (err) {
    if (isCancellation(err)) return { ok: false, cancelled: true, message: "" };
    return { ok: false, cancelled: false, message: DID_NOT_GO_THROUGH };
  }
}

/** Restore purchases: asks Play for this Google account's current purchases
 *  that carry this user's account id and has the server verify each. Also the
 *  recovery path for a purchase whose verification never completed (dropped
 *  connection, app closed mid-purchase). Idempotent: the server dedupes on
 *  the purchase token. */
export async function restorePlayPurchases(config: PlayBillingConfig): Promise<{ restored: number; failed: number }> {
  if (!config.enabled || !config.account_id) return { restored: 0, failed: 0 };
  return withPlay(async (play) => {
    let restored = 0;
    let failed = 0;
    for (const productType of [play.subs, play.inapp]) {
      const { purchases } = await play.plugin.getPurchases({ productType, appAccountToken: config.account_id as string });
      for (const tx of purchases) {
        // Only this account's purchases: another signed-in user on the same
        // Google account is verified under their own id, never this one.
        if (tx.appAccountToken && tx.appAccountToken !== config.account_id) continue;
        try {
          if (await verify(tx)) restored += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
    }
    return { restored, failed };
  });
}

/** Opens Google Play's own subscriptions page (change plan, cancel, fix
 *  payment). The only place a Play subscription is cancelled. */
export async function openManagePlaySubscriptions(): Promise<void> {
  await withPlay(async ({ plugin }) => {
    await plugin.manageSubscriptions();
  });
}
