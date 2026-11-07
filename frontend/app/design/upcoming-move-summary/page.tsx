import MoveSummaryClient from "./MoveSummaryClient";
import { parsePreviewParams } from "./previewParams";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <MoveSummaryClient {...parsePreviewParams(await searchParams)} />;
}
