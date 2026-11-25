"use client";

import SpendShapeCard from "@/components/SpendShapeCard";
import type { MoneyShape } from "@/lib/api";

export interface PaySplitScreenProps {
  /** A completed Money Shape payload. The production renderer refuses an incomplete split. */
  shape: MoneyShape;
}

/**
 * Focus on Spend's real completed-period instrument and compact comparison.
 * The drill-in hero plus detailed comparison cannot fit a complete phone.
 * The compact renderer keeps the actual product layout, labels and arithmetic.
 */
export default function PaySplitScreen({ shape }: PaySplitScreenProps) {
  return (
    <section data-c22-pay-split-screen>
      <div data-c22-pay-split-comparison>
        <SpendShapeCard
          shape={shape}
          hideValues={false}
          reference="50-30-20"
          onOpen={() => {}}
        />
      </div>
    </section>
  );
}
