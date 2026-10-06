// Remotion CLI config (G223). The reel renders the production
// components/SafeToSpendCard, so the bundler needs the app's "@/" alias, the
// app's Tailwind (via @remotion/tailwind-v4) and stand-ins for the two Next
// router modules the card imports. None of this touches the Next build.
import path from "node:path";
import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

Config.overrideWebpackConfig((current) => {
  const withTailwind = enableTailwind(current);
  return {
    ...withTailwind,
    resolve: {
      ...withTailwind.resolve,
      alias: {
        ...(withTailwind.resolve?.alias ?? {}),
        "next/link$": path.resolve(process.cwd(), "remotion/shims/next-link.tsx"),
        "next/navigation$": path.resolve(process.cwd(), "remotion/shims/next-navigation.ts"),
        "@wealth/shared$": path.resolve(process.cwd(), "../shared/src/index.ts"),
        "@wealth/shared": path.resolve(process.cwd(), "../shared/src"),
        "@": path.resolve(process.cwd()),
      },
    },
  };
});
