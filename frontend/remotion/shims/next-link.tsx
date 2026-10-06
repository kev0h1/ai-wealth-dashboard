// Remotion CLI only: next/link needs the Next router. The card's links are
// never interacted with in a video, so render a plain anchor.
import type { AnchorHTMLAttributes, ReactNode } from "react";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string | { pathname?: string }; children?: ReactNode };

export default function Link({ href, children, ...rest }: Props) {
  return (
    <a href={typeof href === "string" ? href : href.pathname ?? "#"} {...rest}>
      {children}
    </a>
  );
}
