import type { Metadata } from "next";
import NavBarPreview from "./NavBarPreview";

export const metadata: Metadata = {
  title: "Bottom navigation proposals · Sorted",
  robots: { index: false, follow: false },
};

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const read = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  return <NavBarPreview initial={{
    variant: read("variant"), appearance: read("appearance"), mode: read("mode"),
    state: read("state"), tab: read("tab"), open: read("open"),
  }} />;
}
