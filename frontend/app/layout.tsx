import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./Providers";
import Sidebar from "@/components/Sidebar";
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
    <html lang="en" className="h-full">
      <body className="min-h-full bg-[#f0f2f7] dark:bg-[#0f172a] antialiased">
        <Providers>
          <TutorialProvider>
            <ServiceWorkerRegistrar />
            <ThemeColor />
            <TutorialOverlay />
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
