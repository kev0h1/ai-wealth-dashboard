// Figtree (brand sans) and JetBrains Mono (money figures), loaded for both the
// Remotion renderer and the Next Player. The app itself loads them through
// next/font; these are the same families, exposed on the composition root as
// the --font-figtree / --font-jbmono variables the app's Tailwind theme reads.
import { loadFont as loadFigtree } from "@remotion/google-fonts/Figtree";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

const figtree = loadFigtree("normal", { weights: ["400", "500", "600", "700", "800"], subsets: ["latin"] });
const mono = loadMono("normal", { weights: ["400", "500", "700"], subsets: ["latin"] });

export const FONT_VARS = {
  "--font-figtree": figtree.fontFamily,
  "--font-jbmono": mono.fontFamily,
} as Record<string, string>;
