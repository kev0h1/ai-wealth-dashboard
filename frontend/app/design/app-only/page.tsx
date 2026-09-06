import AppOnlyPage from "@/components/AppOnlyPage";

// Design preview for the web-product lock's shell (backlog A10) — renders
// the real components/AppOnlyPage.tsx standalone, outside AuthProvider's
// gating, so it's reachable without the flag or a session. "Owner sign-in"
// is fully functional here (it swaps in the real LoginScreen, same as in
// production) but harmless: nothing about this route depends on the tap.
export default function Page() {
  return <AppOnlyPage />;
}
