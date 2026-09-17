import type { Metadata, Viewport } from "next";
import { PRE_PAINT_NAV_SCRIPT } from "@/lib/navExemptRoutes";
import { Figtree, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./Providers";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import ScrollReset from "@/components/ScrollReset";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import NativePushResync from "@/components/NativePushResync";
import NotificationNavigator from "@/components/NotificationNavigator";
import ThemeColor from "@/components/ThemeColor";
import BiometricLock from "@/components/BiometricLock";
import { TutorialProvider } from "@/components/TutorialContext";
import TutorialOverlay from "@/components/TutorialOverlay";
import TutorialOffer from "@/components/TutorialOffer";
import { PennySheetProvider } from "@/components/PennySheetProvider";

export const metadata: Metadata = {
  title: "Sorted",
  description: "Your personal AI wealth tracker",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Sorted",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // `maximumScale: 1` and `userScalable: false` were deliberately removed
  // (accessibility audit) — disabling pinch zoom is a named WCAG anti-pattern
  // and this viewport export applies to every screen in the app. Do not
  // reinstate them.
  viewportFit: "cover",
};

const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono" });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`h-full ${figtree.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Chrome Auto Dark opt-out (server-rendered default). The globals.css
            `color-scheme: only light` on :root is belt-and-braces — Chrome's
            force-dark detection also reads this meta, and unlike the CSS
            property it survives production minification verbatim (the CSS
            minifier reorders "only light" to "light only", which silently
            defeats Chrome's opt-out sniffing). Flipped to "dark" by the
            inline script below when cached dark mode applies, and kept in
            sync at runtime by ThemeColor. */}
        <meta name="color-scheme" content="only light" />
        {/* Apply cached dark mode before first paint — the server-fetched
            preference confirms/corrects it later, but we never flash white.
            Also flips the color-scheme meta above so Chrome's Auto Dark
            opt-out is correct from first paint, not just after hydration. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('wd_dark')==='1'){document.documentElement.classList.add('dark');var m=document.querySelector('meta[name="color-scheme"]');if(m)m.setAttribute('content','dark')}}catch(e){}`,
          }}
        />
        {/* Pre-paint <html> classes for the nav-exempt routes (H75). The
            script itself is BUILT from lib/navExemptRoutes.ts — the same
            file BottomNav.tsx and Sidebar.tsx read, and the same
            normalisation normaliseNavPath applies — rather than written out
            here, so the list exists in one place and cannot drift between
            a runtime check and a pre-paint one. This layout is a server
            component, so importing it costs nothing at runtime; the string
            is inlined into the HTML at build time.

            Why pre-paint rather than an effect: the same reason as the
            dark-mode class above. `nav-exempt` hides the desktop rail AND
            releases the 16rem of margin-left #app-shell reserves for it
            (globals.css), so doing it after hydration would flash the full
            shell, with a 256px gutter, on every exempt route. Client-side
            route changes are the half this script cannot see, and
            components/Sidebar.tsx's effect keeps the class in sync there.
            `legal-page` continues to mark the two published legal
            documents, which are full-bleed at every width. */}
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT_NAV_SCRIPT }} />
      </head>
      <body className="relative isolate min-h-full bg-[#f0f2f7] dark:bg-[#0f172a] antialiased">
        <Providers>
          <TutorialProvider>
            <ServiceWorkerRegistrar />
            <NativePushResync />
            <NotificationNavigator />
            <ThemeColor />
            {/* Status-bar safe-area frost — mobile shell only (desktop uses the
                sidebar, no overlay). Fixed above the scroll so content frosts
                out before it reaches the clock/Wi-Fi glyphs, instead of
                colliding with them. Height matches the env() inset every page
                already pads by (reliable on iOS; on Android this is 0 until
                edge-to-edge + a real inset plugin land, at which point this
                frost is simply zero-height and inert — no regression). z-40:
                above page content, below BottomNav (z-50) and every
                sheet/modal (z-[60]+). */}
            <div
              aria-hidden="true"
              className="safe-top-frost lg:hidden fixed inset-x-0 top-0 z-40 pointer-events-none"
              style={{ height: "env(safe-area-inset-top, 0px)" }}
            />
            <TutorialOverlay />
            <TutorialOffer />
            <ScrollReset />
            <Sidebar />
            {/* G79: mounted once, here, as Sidebar's sibling — every route
                gets the nav by default now, instead of each of the ~15 page
                components that used to render <BottomNav /> individually
                needing to remember to (app/spend/shape/ShapePage.tsx never
                did, which is what this fix closes off structurally). Placed
                outside PennySheetProvider/#app-shell exactly like Sidebar
                above: BottomNav's own usePennySheet() call is a module-level
                useSyncExternalStore singleton (see PennySheetProvider.tsx's
                own "STATE MODEL" comment for why — Sidebar hit the identical
                DOM-nesting problem first), not a React Context, so it does
                not need to be a descendant of PennySheetProvider to reach
                the sheet's open/close state. The only routes that don't get
                it are the small, named, reasoned list in
                lib/navExemptRoutes.ts (design previews, legal pages, the
                OAuth consent screen, the full-screen month-story player, the
                two owner-only /ops pages, and the two blank client
                redirects) — guarded against silent drift by
                scripts/check-nav-coverage.mjs. Auth-gated states
                (signed-out, onboarding, the web-product lock) still show no
                nav at all, same as Sidebar: components/AuthProvider.tsx
                substitutes the whole subtree below it (this Sidebar/BottomNav
                pair included) with LoginScreen/Onboarding/AppOnlyPage before
                a session exists, so there's nothing extra to gate here. */}
            <BottomNav />
            {/* PennySheetProvider wraps #app-shell rather than nesting
                inside it: it renders <PennySheet /> (a portal to
                document.body, so its actual DOM position is unaffected
                either way) as its own extra child, alongside #app-shell
                rather than inside it, so #app-shell stays the thing that
                blurs behind the sheet (useSheetOpen toggles `.sheet-open`
                on #app-shell by id, see lib/useSheetOpen.ts) instead of the
                sheet risking being read as part of the content it's
                fronting for. */}
            <PennySheetProvider>
              <div id="app-shell">
                <BiometricLock>
                  {children}
                </BiometricLock>
              </div>
            </PennySheetProvider>
          </TutorialProvider>
        </Providers>
      </body>
    </html>
  );
}
