import Link from "next/link";
import { Children, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import MoneyText from "@/components/MoneyText";
import PennyTable from "@/components/PennyTable";
import { isSafeAppHref, looksLikeMarkdown, splitReplySegments } from "@/lib/pennyTable";

/**
 * G251: the safe markdown subset for the model's OWN text.
 *
 * The model's output is untrusted. Whitelist: table, thead, tbody, tr, th, td,
 * p, ul, ol, li, strong, em, code (plus br and a, below). Raw HTML is skipped
 * (`skipHtml`), any other element is unwrapped to its text, images never
 * render, and a link survives only when it points at an in-app route (a
 * single leading slash); anything else shows as plain text. Nothing here can
 * execute. GFM pipe tables are parsed by lib/pennyTable.ts (remark-gfm is not
 * a dependency) and drawn by PennyTable; the table elements stay on the
 * whitelist so a future plugin cannot sneak other markup in. Amounts in text
 * go through MoneyText.
 */
export const PENNY_MARKDOWN_ALLOWED = [
  "table", "thead", "tbody", "tr", "th", "td", "p", "ul", "ol", "li", "strong", "em", "code", "br", "a",
] as const;

function money(children: ReactNode, unmasked = false): ReactNode {
  return Children.map(children, (c) => (typeof c === "string" ? <MoneyText text={c} unmasked={unmasked} /> : c));
}

// B56: figures mask under Hide balances (MoneyText reads BalancesHiddenContext);
// `unmasked` is the opt-out for text that is only fixed prices or thresholds.
function makeComponents(unmasked: boolean): Components {
  const money_ = (children: ReactNode) => money(children, unmasked);
  return {
  p: ({ children }) => <p className="mb-2 last:mb-0">{money_(children)}</p>,
  ul: ({ children }) => <ul className="list-disc pl-4 mb-2 last:mb-0 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 last:mb-0 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{money_(children)}</li>,
  strong: ({ children }) => <strong className="font-semibold">{money_(children)}</strong>,
  em: ({ children }) => <em className="italic">{money_(children)}</em>,
  code: ({ children }) => <code className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[12px]">{money_(children)}</code>,
  a: ({ href, children }) =>
    isSafeAppHref(href) ? (
      <Link href={href as string} className="underline">{money_(children)}</Link>
    ) : (
      <span>{money_(children)}</span>
    ),
  };
}

const MASKING = makeComponents(false);
const UNMASKED = makeComponents(true);

export function PennyMarkdownBlock({ text, unmasked = false }: { text: string; unmasked?: boolean }) {
  return (
    <Markdown
      skipHtml
      allowedElements={[...PENNY_MARKDOWN_ALLOWED]}
      unwrapDisallowed
      components={unmasked ? UNMASKED : MASKING}
    >
      {text}
    </Markdown>
  );
}

/** A reply as Penny's bubble shows it: plain text through MoneyText unless it
 * carries block markdown, in which case prose and tables are drawn separately. */
export default function PennyReplyText({ text, unmasked = false }: { text: string; unmasked?: boolean }) {
  if (!looksLikeMarkdown(text)) return <MoneyText text={text} unmasked={unmasked} />;
  return (
    <>
      {splitReplySegments(text).map((seg, i) =>
        seg.type === "table" ? (
          <PennyTable key={i} table={seg.table} />
        ) : (
          <PennyMarkdownBlock key={i} text={seg.text} unmasked={unmasked} />
        ),
      )}
    </>
  );
}
