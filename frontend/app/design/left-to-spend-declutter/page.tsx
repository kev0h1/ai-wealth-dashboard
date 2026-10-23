import { connection } from "next/server";
import LeftToSpendDeclutterClient from "./LeftToSpendDeclutterClient";

export const metadata = { robots: { index: false, follow: false } };

export default async function Page() {
  // Keep this preview request-selected, without statically prefetching every
  // fixture combination into the design route.
  await connection();
  return <LeftToSpendDeclutterClient />;
}
