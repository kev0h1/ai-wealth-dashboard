// C21: which purchase mechanism a build may use, as one pure function with
// no Capacitor import so scripts/c21-iap.test.mjs can drive it directly.
//
//   web      -> "stripe_web"  Stripe Checkout, unchanged (B5)
//   iOS app  -> "storekit"    StoreKit in-app purchase, only once the native
//                             plugin is genuinely present in the binary
//   anything else native      -> "none"  no purchase UI at all. Android's
//                             billing-choice link-out is C24's, not here, and
//                             until it exists a native Android build may not
//                             reach Stripe (B26).
//
// "none" is also what an uncertain platform resolves to: the caller passes
// native=true on any detection error (fail closed, same direction as
// nativeAuth.canPurchaseInApp). Stripe Checkout is therefore reachable only
// from "stripe_web", and a native iOS build can never fall back to it.

export type PurchaseChannel = "stripe_web" | "storekit" | "none";

export type ChannelInputs = {
  /** True on any Capacitor native build, and true when detection failed. */
  native: boolean;
  /** "ios" | "android" | other, or null when unknown. */
  platform: string | null;
  /** The StoreKit plugin has a native implementation in this binary. */
  storekitPluginPresent: boolean;
};

export function resolvePurchaseChannel(input: ChannelInputs): PurchaseChannel {
  if (!input.native) return "stripe_web";
  if (input.platform === "ios" && input.storekitPluginPresent) return "storekit";
  return "none";
}
