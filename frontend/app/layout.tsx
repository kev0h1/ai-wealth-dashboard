import type { Metadata, Viewport } from "next";
import { Figtree, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./Providers";
import Sidebar from "@/components/Sidebar";
import ScrollReset from "@/components/ScrollReset";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import NativePushResync from "@/components/NativePushResync";
import NotificationNavigator from "@/components/NotificationNavigator";
import ThemeColor from "@/components/ThemeColor";
import BiometricLock from "@/components/BiometricLock";
import { TutorialProvider } from "@/components/TutorialContext";
import TutorialOverlay from "@/components/TutorialOverlay";

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
  maximumScale: 1,
  userScalable: false,
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
            <ScrollReset />
            <Sidebar />
            <div id="app-shell">
              <BiometricLock>
                {children}
              </BiometricLock>
            </div>
          </TutorialProvider>
        </Providers>
      </body>
    </html>
  );
}
