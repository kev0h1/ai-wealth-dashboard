import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pennyFixedGap, pennyViewport, pennyKeyboardVisible, pennyLayoutShrank } from "../lib/pennyKeyboardViewport.ts";

// Android Chrome, 390x844, keyboard 300px.
// resizes-content: layout and visual both 544, the probe lands on the keyboard top.
assert.equal(pennyFixedGap(544, { height: 544, top: 0, scale: 1 }), 0, "resizes-content: composer sits on the keyboard");
// resizes-visual: layout stays 844, visual 544, the whole keyboard is the gap.
assert.equal(pennyFixedGap(844, { height: 544, top: 0, scale: 1 }), 300, "resizes-visual: dock above the keyboard");
// The G335 case: the layout shrank (so the old shortcut said 0) but the fixed
// bottom still sits 28px below the visible bottom (toolbar or pan remainder).
const visual = { height: 516, top: 0, scale: 1 };
assert.equal(pennyLayoutShrank(844, 544), true, "layout shrank by a keyboard's worth");
assert.equal(pennyFixedGap(544, visual), 28, "residual gap under a shrunk layout is no longer dropped");
// A pan offset is part of the same sum, counted once.
assert.equal(pennyFixedGap(544, { height: 500, top: 16, scale: 1 }), 28);
// iOS: layout keeps its height, offsetTop counted once.
assert.equal(pennyFixedGap(844, { height: 470, top: 50, scale: 1 }), 324);
// Noise, zoom and missing visual viewport never dock.
assert.equal(pennyFixedGap(544, { height: 543, top: 0, scale: 1 }), 0, "sub-2px rounding is not a gap");
assert.equal(pennyFixedGap(844, { height: 544, top: 0, scale: 2 }), 0, "pinch zoom never docks");
assert.equal(pennyFixedGap(844, null), 0);
assert.equal(pennyFixedGap(Number.NaN, visual), 0);
assert.equal(pennyKeyboardVisible(844, pennyViewport({ width: 390, height: 844 }, { height: 516, top: 0, scale: 1 })), true);

// Wiring: the hook measures through a fixed probe, not window.innerHeight alone.
const hook = readFileSync(new URL("../lib/usePennyKeyboard.ts", import.meta.url), "utf8");
assert.match(hook, /position:fixed;left:0;bottom:0/, "fixed probe exists");
assert.match(hook, /pennyFixedGap\(probe\.getBoundingClientRect\(\)\.bottom/);
assert.match(hook, /probe\.remove\(\)/, "probe is removed on cleanup");
// The advice note is never hidden while typing.
const composer = readFileSync(new URL("../components/PennyComposer.tsx", import.meta.url), "utf8");
assert.match(composer, /General information, not regulated financial advice\./);
const css = readFileSync(new URL("../components/PennySheetPanel.styles.ts", import.meta.url), "utf8");
assert.doesNotMatch(css, /penny-keyboard-typing[^{]*\[data-penny-composer-wrap\][^{]*\{[^}]*display:\s*none/);
console.log("g335-composer-keyboard ok");
