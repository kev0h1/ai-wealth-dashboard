"use client";

// Mounts Penny's aim nudge (G242) wherever Penny's cards live (Home, Penny).
// The server decides everything (backend/app/services/checkpoints.py
// get_aim_nudge): a trait the user marked "change" in the Mirror (Layer 2),
// one at a time (Layer 3), the aim looks likely to be passed from transactions
// (Layer 4), and not dismissed. This component only asks and renders; a
// failure or an empty answer renders nothing.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type AimNudge as AimNudgeData } from "@/lib/api";
import AimNudgeCard from "@/components/AimNudgeCard";

export default function AimNudge({ className }: { className?: string }) {
  const router = useRouter();
  const [nudge, setNudge] = useState<AimNudgeData | null>(null);

  useEffect(() => {
    let active = true;
    api.aimNudge()
      .then((r) => { if (active) setNudge(r.nudge); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  if (!nudge) return null;
  return (
    <div className={className}>
      <AimNudgeCard
        category={nudge.category}
        traitTitle={nudge.trait_title}
        aimAmount={nudge.aim_amount}
        spentSoFar={nudge.spent_so_far}
        projected={nudge.projected}
        daysLeft={nudge.days_left}
        onOpen={() => {
          const params = new URLSearchParams({ category: nudge.category, from: nudge.period_start, to: nudge.period_end });
          router.push(`/transactions?${params.toString()}`);
        }}
        onDismiss={() => {
          const id = nudge.id;
          setNudge(null);
          api.dismissAimNudge(id).catch(() => {});
        }}
      />
    </div>
  );
}
