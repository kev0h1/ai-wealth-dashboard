// A97: discard the original source and all its imports before bundling.
// Used by both Turbopack and webpack, including production mobile exports.
module.exports = function productionDesignLoader() {
  // A not-found boundary must not throw notFound() back into itself. Error
  // boundaries are client components and must not retain their original UI.
  if (/(?:^|[/\\])(?:not-found|error)\.[jt]sx?$/.test(this.resourcePath)) {
    const client = /(?:^|[/\\])error\.[jt]sx?$/.test(this.resourcePath) ? '"use client";' : "";
    return `${client} export default function UnavailableDesignBoundary() { return null; }`;
  }
  if (/(?:^|[/\\])route\.[jt]sx?$/.test(this.resourcePath)) {
    return `
      export const dynamic = "force-static";
      function unavailable() { return new Response(null, { status: 404 }); }
      export { unavailable as GET, unavailable as HEAD, unavailable as POST,
        unavailable as PUT, unavailable as PATCH, unavailable as DELETE,
        unavailable as OPTIONS };
    `;
  }
  return `
    import { notFound } from "next/navigation";
    export default function UnavailableDesignPreview() { notFound(); }
  `;
};
