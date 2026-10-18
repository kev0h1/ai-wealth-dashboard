// C21: StoreKit 2 in-app purchase for the iOS build (docs/pricing/store-billing-c13.md
// sections 4, 6, 7). Everything the plugin does is reached through
// withStoreKit() below, and everything the server needs comes from
// GET /billing/apple/account-token: the appAccountToken, the product ids and
// whether a purchase may start. No product id, price or trial length is
// written in this file. The plan picker shows the store's own price strings
// and describes the introductory offer from the store's own offer data.
//
// Stripe is never reachable from here. This module imports no checkout or
// portal call, and lib/purchaseChannel.ts is what decides a build may use it.
//
// Two Capacitor rules this file is built around:
//  1. A registerPlugin() proxy is not thenable. Returning it from an async
//     function or resolving a promise with it makes the runtime call .then on
//     it and the call spins forever, so the plugin object never leaves
//     withStoreKit(); callers only ever receive plain data.
//  2. A plugin call with no native implementation also spins forever, so
//     hasStoreKitPlugin() checks Capacitor.PluginHeaders (what the native
//     side registered) before anything is called.

import { Capacitor } from "@capacitor/core";
import type { NativePurchasesPlugin, Product, Transaction } from "@capgo/native-purchases";
import { api } from "./api";

const PLUGIN_NAME = "NativePurchases";

export type AppleIapConfig = {
  enabled: boolean;
  app_account_token: string | null;
  /** key (lite, lite_six_months, ..., penny_small) -> store product id */
  products: Record<string, string>;
  trial_days?: number;
  purchase_allowed: boolean;
  blocked_reason: string | null;
  blocked_message?: string | null;
};

/** True only when the binary really contains the plugin's native side. */
export function hasStoreKitPlugin(): boolean {
  try {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return false;
    const headers = (Capacitor as unknown as { PluginHeaders?: { name: string }[] }).PluginHeaders;
    return Array.isArray(headers) && headers.some((h) => h?.name === PLUGIN_NAME);
  } catch {
    return false;
  }
}

type StoreKitHandle = { plugin: NativePurchasesPlugin; subs: Parameters<NativePurchasesPlugin["getProducts"]>[0]["productType"] };

let configured = false;

/** Runs `fn` with the plugin. The plugin proxy is passed in a plain object
 *  and never returned: see rule 1 above. */
async function withStoreKit<T>(fn: (sk: StoreKitHandle) => Promise<T>): Promise<T> {
  if (!hasStoreKitPlugin()) throw new Error("In-app purchase is not available in this build.");
  const mod = await import("@capgo/native-purchases");
  const sk: StoreKitHandle = { plugin: mod.NativePurchases, subs: mod.PURCHASE_TYPE.SUBS };
  if (!configured) {
    // Finish a transaction only after the server has verified it, so a
    // dropped connection leaves it queued for the next launch instead of
    // lost (see syncUnfinishedTransactions).
    await sk.plugin.configure({ autoFinishTransactions: false });
    configured = true;
  }
  return fn(sk);
}

export function loadIapConfig(): Promise<AppleIapConfig> {
  return api.getAppleIapConfig();
}

// ── Store offer data ─────────────────────────────────────────────────────────

/** What the plan picker may say about a product, taken from the store only. */
export type StoreProductView = {
  productId: string;
  /** The store's own formatted price, e.g. "£5.99". */
  priceString: string;
  /** Set only when the store says this user is eligible for the introductory
   *  free trial. Never inferred. */
  freeTrial: { periodText: string } | null;
};

// INTRO_ELIGIBILITY_STATUS in @capgo/native-purchases: 0 unknown, 1 ineligible, 2 eligible.
const INTRO_ELIGIBLE = 2;
// StoreKit payment mode of an introductory offer: 2 is a free trial.
const PAYMENT_MODE_FREE_TRIAL = 2;

type OfferLike = {
  introductoryPrice?: {
    price?: number;
    paymentMode?: number;
    subscriptionPeriod?: { numberOfUnits?: number; unitString?: string };
  } | null;
  introEligibility?: number;
};

/** "2 weeks" from the store's own period, or null. Singular and plural only. */
export function periodText(period: { numberOfUnits?: number; unitString?: string } | undefined): string | null {
  const n = period?.numberOfUnits;
  const unit = period?.unitString;
  if (typeof n !== "number" || n < 1 || !unit || unit === "unknown") return null;
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** The introductory free trial the store is offering THIS user, or null. The
 *  trial length is read from the store's offer, never written here: if the
 *  store offers 2 weeks the picker says "2 weeks", if it offers nothing the
 *  picker says nothing. Conservative on purpose: unknown or ineligible
 *  shows no trial, because promising a free trial that is then charged is
 *  the worse error. */
export function describeFreeTrial(product: OfferLike): { periodText: string } | null {
  const offer = product.introductoryPrice;
  if (!offer || product.introEligibility !== INTRO_ELIGIBLE) return null;
  const free = offer.paymentMode === PAYMENT_MODE_FREE_TRIAL || offer.price === 0;
  if (!free) return null;
  const text = periodText(offer.subscriptionPeriod);
  return text ? { periodText: text } : null;
}

export function toProductView(product: Pick<Product, "identifier" | "priceString"> & OfferLike): StoreProductView {
  return { productId: product.identifier, priceString: product.priceString, freeTrial: describeFreeTrial(product) };
}

/** Loads the given store products by id. Returns plain views keyed by id. */
export async function loadStoreProducts(productIds: string[]): Promise<Record<string, StoreProductView>> {
  if (productIds.length === 0) return {};
  return withStoreKit(async ({ plugin, subs }) => {
    const { products } = await plugin.getProducts({ productIdentifiers: productIds, productType: subs });
    const out: Record<string, StoreProductView> = {};
    for (const p of products) out[p.identifier] = toProductView(p);
    return out;
  });
}

// ── Purchase, restore, manage ────────────────────────────────────────────────

export const PURCHASE_FAILED_MESSAGE = "The purchase did not go through. You have not been charged.";
export const PURCHASE_RECORDED_MESSAGE = "Your purchase is recorded with Apple and will show here shortly.";

export type PurchaseOutcome =
  | { ok: true }
  | { ok: false; cancelled: boolean; message: string };

function isCancellation(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err ?? "");
  return /cancel/i.test(text);
}

async function verifyAndFinish(sk: StoreKitHandle, tx: Pick<Transaction, "jwsRepresentation" | "transactionId">): Promise<boolean> {
  if (!tx.jwsRepresentation) return false;
  const res = await api.verifyAppleTransaction(tx.jwsRepresentation);
  // Finish only once the server has actually applied it; an unhandled answer
  // leaves the transaction queued for syncUnfinishedTransactions.
  if (!res.ok || !res.handled) return false;
  try {
    await sk.plugin.finishTransaction({ transactionId: tx.transactionId });
  } catch {
    /* already finished: the server has the entitlement either way */
  }
  return true;
}

/** Buys one subscription product, carrying the user's appAccountToken, then
 *  has the server verify the signed transaction. The server, not this
 *  function, decides what the user is entitled to. */
export async function purchaseSubscription(productKey: string, config: AppleIapConfig): Promise<PurchaseOutcome> {
  // Two failure copies. Before Apple completes the purchase nothing was
  // charged; once Apple has charged and only our server step fails, the
  // purchase exists and will be picked up, so the user must not be told they
  // were not charged.
  let charged = false;
  const productIdentifier = config.products[productKey];
  if (!config.enabled || !config.app_account_token || !productIdentifier) {
    return { ok: false, cancelled: false, message: "This plan cannot be bought in the app yet." };
  }
  if (!config.purchase_allowed) {
    return { ok: false, cancelled: false, message: config.blocked_message || "You already have a plan." };
  }
  try {
    return await withStoreKit(async (sk) => {
      const tx = await sk.plugin.purchaseProduct({
        productIdentifier,
        productType: sk.subs,
        appAccountToken: config.app_account_token as string,
        autoAcknowledgePurchases: false,
      });
      charged = true;
      const verified = await verifyAndFinish(sk, tx);
      return verified
        ? ({ ok: true } as const)
        : ({ ok: false, cancelled: false, message: PURCHASE_RECORDED_MESSAGE } as const);
    });
  } catch (err) {
    if (isCancellation(err)) return { ok: false, cancelled: true, message: "" };
    if (charged) return { ok: false, cancelled: false, message: PURCHASE_RECORDED_MESSAGE };
    return { ok: false, cancelled: false, message: PURCHASE_FAILED_MESSAGE };
  }
}

/** Restore purchases: asks the store for this Apple ID's current
 *  subscriptions that carry this user's token and has the server verify each.
 *  Idempotent. */
export async function restorePurchases(config: AppleIapConfig): Promise<{ restored: number; failed: number }> {
  if (!config.enabled || !config.app_account_token) return { restored: 0, failed: 0 };
  return withStoreKit(async (sk) => {
    await sk.plugin.restorePurchases();
    const { purchases } = await sk.plugin.getPurchases({
      productType: sk.subs,
      appAccountToken: config.app_account_token as string,
      onlyCurrentEntitlements: true,
    });
    let restored = 0;
    let failed = 0;
    for (const tx of purchases) {
      try {
        if (await verifyAndFinish(sk, tx)) restored += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    return { restored, failed };
  });
}

/** Transactions StoreKit still has queued because an earlier verification
 *  never completed (dropped connection, app closed mid-purchase). */
export async function syncUnfinishedTransactions(config: AppleIapConfig): Promise<number> {
  if (!config.enabled || !config.app_account_token) return 0;
  return withStoreKit(async (sk) => {
    const { transactions } = await sk.plugin.getUnfinishedTransactions();
    let synced = 0;
    for (const tx of transactions) {
      if (tx.appAccountToken && tx.appAccountToken.toLowerCase() !== config.app_account_token!.toLowerCase()) continue;
      try {
        if (await verifyAndFinish(sk, tx)) synced += 1;
      } catch {
        /* left queued: tried again next time */
      }
    }
    return synced;
  });
}

/** Opens iOS's own subscription management sheet (change plan, cancel). */
export async function openManageSubscriptions(): Promise<void> {
  await withStoreKit(async ({ plugin }) => {
    await plugin.manageSubscriptions();
  });
}
