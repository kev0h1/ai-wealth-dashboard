"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/${window.location.search}${window.location.hash}`);
  }, [router]);

  return null;
}
