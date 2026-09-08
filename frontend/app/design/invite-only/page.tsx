import LoginScreen from "@/components/LoginScreen";

// D5: preview of the "Sorted is invite-only right now" screen LoginScreen
// renders in place of the sign-in buttons when a refused sign-in carries
// the invite_only signal (web redirect ?error=invite_only, or a native
// nativeGoogleLogin()/nativeAppleLogin() "invite_only" result — see
// lib/nativeAuth.ts). Renders the real component with error="invite_only"
// so this is byte-identical to what a refused sign-in actually shows, no
// fixture duplication. No fetching, no session.
export default function Page() {
  return <LoginScreen error="invite_only" />;
}
