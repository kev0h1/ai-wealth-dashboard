import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import LegalDocument from "@/components/LegalDocument";

// Public, unauthenticated legal document. Read once at build time and
// prerendered as static HTML (`dynamic = "force-static"`) — no runtime fs
// access, so this stays static-export-safe (see AGENTS.md/mobile build)
// and works when Vercel deploys with root directory frontend/, where a
// ../PRIVACY.md reference would resolve outside the deployed tree entirely.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Sorted Privacy Policy",
};

export default function PrivacyPage() {
  const markdown = fs.readFileSync(path.join(process.cwd(), "content/privacy.md"), "utf-8");

  return <LegalDocument markdown={markdown} otherDocHref="/terms" otherDocLabel="Read the Terms & Conditions" />;
}
