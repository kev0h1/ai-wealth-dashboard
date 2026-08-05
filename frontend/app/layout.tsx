import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./Providers";
import Sidebar from "@/components/Sidebar";
import ScrollReset from "@/components/ScrollReset";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import ThemeColor from "@/components/ThemeColor";
import { TutorialProvider } from "@/components/TutorialContext";
import TutorialOverlay from "@/components/TutorialOverlay";

export const metadata: Metadata = {
  title: "Wealth Dashboard",
  description: "Your personal AI wealth tracker",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Wealth",
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        {/* Apply cached dark mode before first paint — the server-fetched
            preference confirms/corrects it later, but we never flash white */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('wd_dark')==='1')document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body className="relative isolate min-h-full bg-[#f0f2f7] dark:bg-[#0f172a] antialiased">
        {/* Ambient glow fields — Liquid Glass canvas lighting, behind every screen */}
        <div aria-hidden="true" className="app-glow pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="glow-ambient absolute left-1/2 -translate-x-1/2 top-[4vh] h-[96vh] w-[135vw] max-w-[780px]" />
        </div>
        <Providers>
          <TutorialProvider>
            <ServiceWorkerRegistrar />
            <ThemeColor />
            <TutorialOverlay />
            <ScrollReset />
            <Sidebar />
            <div id="app-shell">
              {children}
            </div>
          </TutorialProvider>
        </Providers>
      </body>
    </html>
  );
}
