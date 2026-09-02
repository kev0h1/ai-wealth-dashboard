import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import LegalDocument from "@/components/LegalDocument";

// Public, unauthenticated legal document. Read once at build time and
// prerendered as static HTML (`dynamic = "force-static"`) — no runtime fs
// access, so this stays static-export-safe (see AGENTS.md/mobile build)
// and works when Vercel deploys with root directory frontend/, where a
// ../TERMS.md reference would resolve outside the deployed tree entirely.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Sorted Terms & Conditions",
};

// GFM pipe tables aren't used in terms.md, but LegalDocument itself is
// dependency-free (no remark-gfm) — see components/LegalDocument.tsx for
// why, and frontend/content/privacy.md's tables for the case that needed
// the workaround.
export default function TermsPage() {
  const markdown = fs.readFileSync(path.join(process.cwd(), "content/terms.md"), "utf-8");

  return <LegalDocument markdown={markdown} otherDocHref="/privacy" otherDocLabel="Read the Privacy Policy" />;
}
