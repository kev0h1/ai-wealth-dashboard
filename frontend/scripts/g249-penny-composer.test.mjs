import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PennyComposer, { PENNY_MAX_CHARS, PENNY_COUNTER_FROM, PENNY_MAX_LINES } from "../components/PennyComposer.tsx";

const source = path => readFileSync(new URL(path, import.meta.url), "utf8");
const base = { inputRef: { current: null }, value: "", onChange() {}, onSend() {}, placeholder: "Ask Penny", loading: false, atCap: false };
const html = (extra = {}) => renderToStaticMarkup(React.createElement(PennyComposer, { ...base, ...extra }));

// Textarea, not input; one row to start; styling tokens and 44px targets kept.
const markup = html();
assert.match(markup, /<textarea[^>]*data-penny-input/);
assert.doesNotMatch(markup, /<input/, "No single-line input remains");
assert.match(markup, /rows="1"/);
assert.match(markup, /min-h-\[44px\]/);
assert.match(markup, /w-11 h-11/, "44px send target kept");
assert.match(markup, /flex items-end gap-2/, "Send button stays bottom-aligned to the field");
assert.match(markup, /resize-none/);

// Growth: up to 5 lines then internal scroll, measured, resets on clear.
assert.equal(PENNY_MAX_LINES, 5);
const src = source("../components/PennyComposer.tsx");
assert.match(src, /useLayoutEffect/);
assert.match(src, /el\.style\.height = "auto"/, "Height resets so the field shrinks after send or clear");
assert.match(src, /Math\.min\(full, max\)/, "Height clamps to the max");
assert.match(src, /lineHeight \* PENNY_MAX_LINES/);
assert.match(src, /overflowY = full > max \? "auto" : "hidden"/, "Scrolls internally past 5 lines");
assert.match(src, /\[value, inputRef\]/, "Re-measures on every value change, including clear");
assert.match(src, /text-sm/, "Base size kept; globals.css lifts it to 16px on coarse pointers (G81)");
assert.match(source("../app/globals.css"), /pointer: coarse\)[\s\S]*?textarea[\s\S]*?font-size: 16px/);

// Keys.
const field = () => React.createElement(PennyComposer, { ...base, onSend: () => { sent++; } });
let sent = 0;
const handler = props => PennyComposer({ ...base, ...props }).props.children[0].props.children[0].props.onKeyDown;
const key = (props, ev, coarse = false) => {
  globalThis.window = { matchMedia: q => ({ matches: coarse && /coarse/.test(q) }) };
  let prevented = false;
  handler({ ...props, onSend() { sent++; } })({ key: "Enter", keyCode: 13, shiftKey: false, nativeEvent: { isComposing: false }, ...ev, preventDefault() { prevented = true; } });
  delete globalThis.window;
  return prevented;
};
sent = 0;
assert.equal(key({}, {}), true, "Desktop Enter is intercepted");
assert.equal(sent, 1, "Desktop Enter sends");
assert.equal(key({}, { shiftKey: true }), false, "Shift+Enter is left to insert a newline");
assert.equal(sent, 1);
assert.equal(key({}, {}, true), false, "Coarse pointer: return inserts a newline");
assert.equal(sent, 1, "Coarse pointer: return does not send");
key({ loading: true }, {});
key({ atCap: true }, {});
assert.equal(sent, 1, "Enter never sends while loading or at cap");
// IME guard (G198) preserved, including keyCode 229.
key({}, { nativeEvent: { isComposing: true } });
key({}, { keyCode: 229 });
assert.equal(sent, 1, "Enter during IME composition does not send");
assert.match(src, /event\.nativeEvent\.isComposing \|\| event\.keyCode === 229/);
// Send button still sends on touch.
assert.match(src, /onClick=\{onSend\}/);

// Limit and counter: 500, counter quiet until 400.
assert.equal(PENNY_MAX_CHARS, 500);
assert.equal(PENNY_COUNTER_FROM, 400);
assert.match(markup, /maxLength="500"/);
assert.doesNotMatch(html({ value: "a".repeat(399) }), /data-penny-counter(?!-status)/);
assert.match(html({ value: "a".repeat(400) }), /data-penny-counter[^>]*>400\/500/);
assert.match(html({ value: "a".repeat(500) }), />500\/500</);
assert.match(source("../../backend/app/routers/can_i.py"), /3 <= len\(question\) <= 500/, "Backend gate matches the composer limit");

// Layout reads the composer's actual height: the sheet composer is a flex
// sibling under a flex-1 min-h-0 scroller (no fixed height anywhere), and the
// thread's ResizeObserver follows the latest turn when the scroller shrinks.
const convo = source("../components/PennyConversation.tsx");
assert.match(convo, /data-penny-composer-wrap className="shrink-0 px-5 pt-2 pb-6"/);
assert.match(convo, /flex-1 min-h-0 overflow-y-auto/);
assert.doesNotMatch(convo, /composerHeight|--composer-h/);
assert.match(source("../lib/usePennyThreadAnchor.ts"), /new ResizeObserver/);
assert.match(convo, /useRef<HTMLTextAreaElement>/);
assert.match(convo, /function UserBubble[\s\S]*?whitespace-pre-wrap/, "Typed line breaks survive in the sent bubble");
assert.match(html({ value: "a".repeat(420) }), /data-penny-counter aria-live="off"/, "Counter itself never announces per keystroke");
assert.doesNotMatch(html({ value: "a".repeat(449) }), /Fewer than 50|Character limit/);
assert.match(html({ value: "a".repeat(450) }), /role="status"[^>]*>Fewer than 50 characters left/);
assert.equal(html({ value: "a".repeat(450) }).match(/Fewer than 50[^<]*/)[0], html({ value: "a".repeat(499) }).match(/Fewer than 50[^<]*/)[0], "Same text across the band, so one announcement");
assert.match(html({ value: "a".repeat(500) }), /Character limit reached/);
console.log("G249 composer: textarea, growth cap, keys, IME, limit, counter and layout passed");
