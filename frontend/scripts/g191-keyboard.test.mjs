import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PennyComposer from "../components/PennyComposer.tsx";
import { pennyViewport, pennyKeyboardVisible } from "../lib/pennyKeyboardViewport.ts";
import { pennyTypingActive, pennyNextEngaged, applyPennyTypingAttribute } from "../lib/pennyTyping.ts";

const browser = pennyViewport({ width: 390, height: 800 }, { width: 390, height: 480, top: 0, left: 0 });
const native = pennyViewport({ width: 390, height: 480 }, { width: 390, height: 480, top: 0, left: 0 });
assert.deepEqual(browser, native, "Already-resized WebViews and visual-only resizing yield one identical visible box");
assert.equal(browser.top + browser.height, 480);
const panned = pennyViewport({ width: 390, height: 800 }, { height: 420, top: 60 });
assert.equal(panned.top + panned.height, 480, "Safari visual viewport panning is included once");
assert.deepEqual(pennyViewport({ width: 390, height: 480 }), native, "No VisualViewport uses the native layout size");
assert.equal(pennyKeyboardVisible(800, browser), true);
assert.equal(pennyKeyboardVisible(800, pennyViewport({ width: 390, height: 750 })), false, "Small toolbar changes are not a keyboard");
assert.equal(pennyKeyboardVisible(800, { ...browser, scale: 2 }), false, "Pinch zoom is not a keyboard");
assert.equal(pennyViewport({ width: 320, height: 240 }, { width: 900, height: 1000, top: -10 }).height, 240);

const props = { inputRef: { current: null }, value: "Draft question", onChange() {}, onSend() {}, placeholder: "Ask Penny", loading: false, atCap: false };
const normal = renderToStaticMarkup(React.createElement(PennyComposer, props));
assert.match(normal, /General information, not regulated financial advice/);
assert.match(normal, /aria-label="Ask Penny a spending question"/);
assert.match(normal, /maxLength="160"/);
assert.match(normal, /Draft question/);
assert.match(renderToStaticMarkup(React.createElement(PennyComposer, { ...props, loading: true })), /<input[^>]*disabled=""/, "Non-sheet callers retain their existing busy behaviour");
assert.doesNotMatch(renderToStaticMarkup(React.createElement(PennyComposer, { ...props, loading: true, preserveFocus: true })), /<input[^>]*disabled=""/, "Proposed send does not dismiss the keyboard");
assert.match(renderToStaticMarkup(React.createElement(PennyComposer, { ...props, loading: true, preserveFocus: true })), /<input[^>]*readOnly=""/);
assert.match(renderToStaticMarkup(React.createElement(PennyComposer, { ...props, atCap: true, preserveFocus: true })), /<input[^>]*disabled=""/, "Message limits still disable input");

const source = path => readFileSync(new URL(path, import.meta.url), "utf8");
const live = source("../components/PennySheet.tsx");
assert.match(live, /<PennySheetPanel isOpen=/);
assert.match(live, /layout="focus"/, "Approved B gives the live conversation the available viewport");
assert.match(source("../components/PennyConversation.tsx"), /<PennyComposer/);
assert.match(source("../components/PennyConversation.tsx"), /preserveFocus=\{Boolean\(inSheet\)\}/);
assert.match(source("../components/PennyConversation.tsx"), /usePennyThreadAnchor/);
assert.match(source("../lib/usePennyThreadAnchor.ts"), /ResizeObserver/);
assert.match(source("../lib/usePennyThreadAnchor.ts"), /followLatestRef/);
assert.match(source("../components/PennyConversation.tsx"), /data-penny-secondary/);
assert.match(source("../components/PennyConversation.tsx"), /data-penny-composer-wrap/);
const frame = source("../components/PennySheetPanel.tsx");
assert.match(frame, /layout = "legacy"/);
assert.doesNotMatch(frame, /keyboardHeight/, "Native keyboard heights are never added to an already-resized viewport");
const touchHandler = frame.split("onPointerDownCapture=")[1].split("onFocusCapture=")[0];
assert.doesNotMatch(touchHandler, /setFocused|setDidFocus|setNativeKeyboard|setComposerEngaged/, "Touch-down must not resize the panel before the input receives its tap");
assert.match(frame, /pennyTypingActive\(\{[^}]*engaged: composerEngaged, keyboardVisible: Boolean\(viewport\?\.keyboardVisible\)/, "The panel decides typing only through the tested pure rule");
assert.match(frame, /!event.currentTarget.contains\(next\)/, "Tab within the dialog cannot collapse the typing layout under an open keyboard");
assert.doesNotMatch(frame, /setNativeKeyboard/, "Native show events cannot expand the panel before the viewport resizes");
const preview = source("../app/design/penny-keyboard/PennyKeyboardClient.tsx");
assert.match(preview, /PennySheetHeader, PennySheetPanel.*components\/PennySheet/);
assert.match(preview, /<PennyComposer/);
assert.match(preview, /usePennyThreadAnchor/);
assert.doesNotMatch(preview, /\bapi\.|\bfetch\(/);
assert.match(preview, /FixtureBottomNav/);
assert.match(source("../components/BottomNav.tsx"), /data-penny-navigation/);
assert.doesNotMatch(source("../app/layout.tsx").replace(/\/\/[^\n]*/g, ""), /maximumScale|userScalable/, "Pinch zoom remains enabled");
// Touch sequence: a simulated device driving the same pure rules the panel uses.
const device = { isOpen: true, proposed: true, mobile: true, engaged: false, keyboardVisible: false };
const typingNow = () => pennyTypingActive(device);
const resting = pennyViewport({ width: 390, height: 800 }, { width: 390, height: 800 });
const withKeyboard = pennyViewport({ width: 390, height: 800 }, { width: 390, height: 480 });
const measure = (v) => { device.keyboardVisible = pennyKeyboardVisible(800, v); };
assert.equal(typingNow(), false, "Resting window is not typing");
// touchstart on the input: the panel handler changes no state at all.
assert.equal(typingNow(), false, "Touch-down alone does not switch layout");
// iOS focuses the input on touch-up, before the keyboard has resized anything.
device.engaged = pennyNextEngaged(device.engaged, { type: "composer-focus" });
measure(resting);
assert.equal(typingNow(), false, "Focus without a viewport change keeps the geometry still (also a hardware keyboard)");
// Native will-show only requests a re-measure; the viewport has not shrunk yet.
measure(resting);
assert.equal(typingNow(), false, "keyboardWillShow before the WebView resizes does not expand");
measure(withKeyboard);
assert.equal(typingNow(), true, "Switches once the software keyboard is measured");
// Toolbar-sized change and pinch zoom while engaged never enter typing.
const toolbar = { ...device, keyboardVisible: pennyKeyboardVisible(800, pennyViewport({ width: 390, height: 740 })) };
assert.equal(pennyTypingActive(toolbar), false);
assert.equal(pennyTypingActive({ ...device, keyboardVisible: pennyKeyboardVisible(800, { ...withKeyboard, scale: 2 }) }), false);
// Desktop widths and legacy layout never take over.
assert.equal(pennyTypingActive({ ...device, mobile: false }), false);
assert.equal(pennyTypingActive({ ...device, proposed: false }), false);
assert.equal(pennyTypingActive({ ...device, isOpen: false }), false);

// Keyboard dismissal with DOM focus retained: collapse, stay engaged, draft untouched.
measure(resting);
assert.equal(typingNow(), false, "Viewport restore collapses the layout even though the input keeps focus");
assert.equal(device.engaged, true, "A null blur or restore keeps engagement so a second tap can reopen typing");
device.engaged = pennyNextEngaged(device.engaged, { type: "blur", toOutsideDialog: false });
assert.equal(device.engaged, true, "Null or in-dialog blur (keyboard swipe-down, tapping the header) does not lose engagement");
measure(withKeyboard);
assert.equal(typingNow(), true, "Second tap with retained focus fires no focus event yet reopens typing from the measured keyboard");
// Focus leaving the dialog or closing clears engagement.
assert.equal(pennyNextEngaged(true, { type: "blur", toOutsideDialog: true }), false);
assert.equal(pennyNextEngaged(true, { type: "close" }), false);
measure(resting);
device.engaged = pennyNextEngaged(true, { type: "close" });
measure(withKeyboard);
assert.equal(typingNow(), false, "A stale viewport change after close cannot resurrect typing");
// The draft is component state in PennyConversation, never owned by the frame.
assert.doesNotMatch(frame, /setValue|setDraft|onChange/, "The panel never touches the draft");

// Root attribute: cleanup restores the previous value, or removes it.
const fakeRoot = (initial) => { const a = new Map(initial == null ? [] : [["data-penny-typing", initial]]);
  return { a, getAttribute: n => a.get(n) ?? null, setAttribute: (n, v) => a.set(n, v), removeAttribute: n => a.delete(n) }; };
const rootA = fakeRoot(null); const undoA = applyPennyTypingAttribute(rootA);
assert.equal(rootA.a.get("data-penny-typing"), "true"); undoA();
assert.equal(rootA.a.has("data-penny-typing"), false, "Cleanup removes the attribute when there was none");
const rootB = fakeRoot("false"); const undoB = applyPennyTypingAttribute(rootB); undoB();
assert.equal(rootB.a.get("data-penny-typing"), "false", "Cleanup restores the previous attribute value");
assert.match(frame, /return applyPennyTypingAttribute\(document\.documentElement\)/, "The panel uses the tested apply/restore helper");

// IME: Enter while composing must not send (Safari reports keyCode 229 after compositionend).
let sent = 0;
const composer = PennyComposer({ ...props, onSend() { sent++; } });
const input = composer.props.children[0].props.children[0];
const press = (nativeEvent, keyCode = 13) => input.props.onKeyDown({ key: "Enter", keyCode, nativeEvent });
press({ isComposing: true });
press({ isComposing: false }, 229);
assert.equal(sent, 0, "Enter during IME composition does not send");
press({ isComposing: false });
assert.equal(sent, 1, "A plain Enter still sends");

console.log("G191 viewport, composer, fixture safety and approved live focus layout passed");
