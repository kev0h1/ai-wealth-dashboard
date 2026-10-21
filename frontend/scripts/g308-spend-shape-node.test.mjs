// G308: the Spend timeline's emerald "How your pay was split" node must exist
// only when SpendShapeCard draws something. SpendPage is a hook-heavy client
// page that cannot be rendered from raw props, so this checks (1) the shared
// predicate hasShapeContent, (2) the card's rendered output for null/thin
// (which must be empty, agreeing with the predicate), and (3) a source-level
// assertion that SpendPage wraps the section, node included, in that predicate.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SpendShapeCard, { hasShapeContent } from "../components/SpendShapeCard.tsx";

const noop = () => {};
const render = (shape) => renderToStaticMarkup(React.createElement(SpendShapeCard, { shape, hideValues: false, onOpen: noop }));

const thin = { status: "thin", jobs: [] };
const full = { status: "ok", jobs: [] };

assert.equal(hasShapeContent(null), false, "null shape: no node");
assert.equal(hasShapeContent(thin), false, "thin shape: no node");
assert.equal(hasShapeContent(undefined), true, "loading: skeleton shows, node stays");
assert.equal(hasShapeContent(full), true, "full shape: node renders");

assert.equal(render(null), "", "card renders nothing for null");
assert.equal(render(thin), "", "card renders nothing for thin");
assert.notEqual(render(undefined), "", "card renders skeleton while loading");

const page = readFileSync(new URL("../app/components/SpendPage.tsx", import.meta.url), "utf8");
const emerald = page.indexOf("border-emerald-400");
assert.ok(emerald > 0, "emerald node present in SpendPage");
const guard = page.lastIndexOf("{hasShapeContent(moneyShape) && (", emerald);
assert.ok(guard > 0, "section guarded by hasShapeContent(moneyShape)");
const between = page.slice(guard, emerald);
assert.ok(!between.includes("</section>"), "guard opens before the same section that holds the node");
assert.equal((page.match(/border-emerald-400/g) || []).length, 1);
assert.match(page.slice(emerald, emerald + 600), /<SpendShapeCard/, "node and card share one section");
console.log("g308 spend shape node ok");
