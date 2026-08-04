import type { NextConfig } from "next";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  // Vercel builds natively (it sets VERCEL=1); "standalone" is only for the
  // self-hosted `next start` path and can break Vercel builds, so opt out there.
  output: process.env.VERCEL ? undefined : "standalone",
  transpilePackages: ["@wealth/shared"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND}/:path*`,
      },
    ];
  },
  async redirects() {
    return [
      { source: "/budget", destination: "/spend", permanent: false },
      { source: "/debt", destination: "/debt-plan", permanent: false },
    ];
  },
};

export default nextConfig;
