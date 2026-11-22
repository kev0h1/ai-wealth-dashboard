import type { Metadata } from "next";
import HomeHeaderControls from "./HomeHeaderControls";

export const metadata: Metadata = {
  title: "Home header options · Sorted",
  robots: { index: false, follow: false },
};

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <HomeHeaderControls key={`${params.variant}:${params.mode}:${params.state}`}
    variant={params.variant === "b" ? "b" : "a"}
    mode={params.mode === "dark" ? "dark" : "light"}
    state={typeof params.state === "string" ? params.state : "ready"}
    chrome={params.chrome !== "0"}
  />;
}
