import type { Metadata } from "next";
import AccountRowsClient from "./AccountRowsClient";
import { parsePreviewParams } from "./previewParams";

export const metadata: Metadata = { title: "G429 · By account layouts", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = parsePreviewParams(await searchParams);
  return <AccountRowsClient key={JSON.stringify(params)} {...params} />;
}
