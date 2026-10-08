// Independent C22 entrypoint. It intentionally does not register G223's Root.
import { registerRoot } from "remotion";
import { MarketingKitRoot } from "./Root";

registerRoot(MarketingKitRoot);
