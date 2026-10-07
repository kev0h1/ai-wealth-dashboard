// Test-only stand-in for components/SheetFrame.tsx (G225). The real frame
// portals to document.body and renders nothing on the server, so the sheet's
// own markup cannot be asserted through it. This renders title, description,
// body and footer inline. The frame itself is pinned by check:g192-sheet-anatomy.
import { createElement as h } from "react";

export function SheetFrame({ title, description, children, footer }) {
  const controls = { close() {}, closeThen() {} };
  const body = typeof children === "function" ? children(controls) : children;
  const foot = typeof footer === "function" ? footer(controls) : footer;
  return h("section", { "data-stub-frame": "" },
    h("h2", null, title),
    description ? h("p", null, description) : null,
    h("div", { "data-sheet-body": "" }, body),
    foot ? h("footer", null, foot) : null);
}
