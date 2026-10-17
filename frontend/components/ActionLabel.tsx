import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

// G281: the single affordance for a server-supplied action link. The API never
// bakes a glyph into a label; the chevron icon is drawn here, decorative only.
export default function ActionLabel({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ChevronRight size={15} aria-hidden="true" className="shrink-0" />
    </>
  );
}
