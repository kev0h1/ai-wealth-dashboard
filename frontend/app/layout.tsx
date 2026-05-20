import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./Providers";

export const metadata: Metadata = {
  title: "Wealth Dashboard",
  description: "Your personal AI wealth tracker",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#4f46e5",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-[#f0f2f7] antialiased">
        <Providers>
          <div id="app-shell">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
