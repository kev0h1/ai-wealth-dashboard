import assert from "node:assert/strict";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ConnectedAssistantsCard, { supportedAssistantsMessage } from "../components/ConnectedAssistantsCard.tsx";

const shared = {
  onDisconnect: async () => true,
  tierAllowance: null,
  allowance: null,
  mcpPacks: [],
  tier: null,
  billingLive: false,
};
const names = (supportedAssistants) => renderToStaticMarkup(h(ConnectedAssistantsCard, {
  ...shared,
  state: { status: "ready", connections: [], supportedAssistants },
}));

assert.equal(supportedAssistantsMessage([]), "No assessed assistants can connect right now.");
assert.equal(supportedAssistantsMessage([{ id: "claude", name: "Claude" }]), "Claude can connect to Sorted. Other assistants cannot connect.");
assert.equal(supportedAssistantsMessage([{ id: "claude", name: "Claude" }, { id: "chatgpt", name: "ChatGPT" }]), "Claude and ChatGPT can connect to Sorted. Other assistants cannot connect.");
assert.equal(supportedAssistantsMessage([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }]), "A, B, and C can connect to Sorted. Other assistants cannot connect.");
assert.match(names([{ id: "claude", name: "Claude" }]), /Claude can connect to Sorted\. Other assistants cannot connect\./);
assert.match(names([]), /No assessed assistants can connect right now\./);
assert.match(names([]), /Check back for assessed assistants\./, "empty assessed list does not invite an unavailable connection");
assert.doesNotMatch(names([]), /Connect a supported assistant/, "empty assessed list does not imply a supported provider");
assert.doesNotMatch(names(null), /can connect to Sorted|assessed assistants/, "missing metadata makes no unverified assistant claim");
assert.match(names(null), /Assistant availability could not be confirmed\. Try reopening Settings\./, "missing metadata has a neutral empty-state recovery");
assert.doesNotMatch(names(null), /Connect a supported assistant/, "missing metadata does not imply a supported provider");
assert.match(names([{ id: "claude", name: "Claude" }]), /Connect a supported assistant to Sorted/, "empty-state instruction does not hardcode an assistant");
const settings = await (async () => (await import("node:fs")).readFileSync(new URL("../app/settings/SettingsPage.tsx", import.meta.url), "utf8"))();
assert.match(settings, /isSupportedAssistants\(r\.supported_assistants\) \? r\.supported_assistants : null/, "malformed metadata is not presented as assessed");
console.log("f30-supported-assistants: ok");
