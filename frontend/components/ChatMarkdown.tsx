import Markdown from "react-markdown";

// Renders assistant markdown replies. Consumers: ExplainerBubble in
// PennyConversation.tsx (the retired TaxChat popup's bubble usage is gone
// along with that component), BudgetPage.tsx's inline advisor chat, and the
// app/design/penny-thread preview. Colours are inherited from the
// surrounding surface in each case, we only control spacing, list markers
// and weight.
export default function ChatMarkdown({ children }: { children: string }) {
  return (
    <Markdown
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-2 last:mb-0 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 last:mb-0 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        h1: ({ children }) => <p className="font-semibold mb-1">{children}</p>,
        h2: ({ children }) => <p className="font-semibold mb-1">{children}</p>,
        h3: ({ children }) => <p className="font-semibold mb-1">{children}</p>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{children}</a>
        ),
        code: ({ children }) => (
          <code className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[12px]">{children}</code>
        ),
      }}
    >
      {children}
    </Markdown>
  );
}
