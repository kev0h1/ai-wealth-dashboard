import { Viewport } from "next";
import InsightsPage from "./InsightsPage";

export const viewport: Viewport = { themeColor: "#0f172a" };

export default function Page() {
  return <InsightsPage />;
}
