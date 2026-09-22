import type { MetadataRoute } from "next";

// A76 (DSGN-04, A48 pentest): /design/* previews are unreleased product
// directions with no robots.txt, per-route noindex meta, or X-Robots-Tag
// header, so search engines could index them. This disallows the /design
// subtree while leaving the rest of the app crawlable. See also the
// X-Robots-Tag rule in next.config.ts (covers a crawler that already has a
// /design URL from elsewhere, since robots.txt alone only stops crawling,
// not indexing) and the per-route metadata in app/design/page.tsx.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/design", "/design/"],
      },
    ],
  };
}
