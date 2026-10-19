// Synthetic board examples only. No ids, prose, links, notes or history are
// copied from the real board. Large totals and long titles exercise layout;
// the arrays are illustrative samples, not a snapshot of current work.
import type { GoLiveItem } from "@/lib/goLive";

function item(partial: Partial<GoLiveItem> & Pick<GoLiveItem, "id" | "section" | "title" | "owner" | "state">): GoLiveItem {
  return {
    text: "", reason: null, branch: null, link: null, uat_review: false,
    done_at: null, commit: null, notes: [], priority: "p3", unblocks: [],
    ...partial,
  };
}

export const IN_FLIGHT: GoLiveItem[] = [
  item({ id: "A9001", section: "A", title: "Clarify the example account summary labels", owner: "codex", state: "in-progress", priority: "p2", branch: "feature-A9001-example" }),
  item({ id: "B9001", section: "B", title: "Improve the accessible name for balance actions", owner: "claude", state: "in-progress", priority: "p1" }),
  item({ id: "C9001", section: "C", title: "Review the mobile savings forecast presentation", owner: "claude", state: "review", priority: "p1", branch: "feature-C9001-example" }),
  item({ id: "D9001", section: "D", title: "Confirm the empty-state wording with the product owner", owner: "kevin", state: "blocked", reason: "Awaiting an example content decision.", notes: [{ date: "2026-09-16", actor: "codex", text: "Illustrative note: the empty-state example needs one short explanation and one clear action." }] }),
  item({ id: "E9001", section: "E", title: "Add a synthetic example for a delayed statement", owner: "codex", state: "blocked", reason: "Waiting for a representative test scenario." }),
  item({ id: "F9001", section: "F", title: "Check an illustrative card with a deliberately long title: the explanation should remain readable on a narrow screen, wrap without clipping, and leave the state and next action easy to find. Opening its detail should show the same complete sentence, with no information lost when the compact row shortens it.", owner: "kevin", state: "blocked", reason: "The example needs a content review.", notes: [{ date: "2026-09-17", actor: "claude", text: "Synthetic review note: check the whole title in the detail sheet as well as the compact row." }] }),
  item({ id: "G9001", section: "G", title: "Compare account grouping on narrow screens", owner: "claude", state: "uat", priority: "p2", uat_review: true, link: "https://example.invalid/design/account-groups" }),
  item({ id: "G9002", section: "G", title: "Choose a concise monthly progress summary", owner: "codex", state: "uat", uat_review: true, link: "https://example.invalid/design/monthly-progress" }),
  item({ id: "H9001", section: "H", title: "Test the synthetic import status card", owner: "codex", state: "uat", uat_review: true, link: "https://example.invalid/design/import-status" }),
  item({ id: "H9002", section: "H", title: "Review an illustrative account update that needs a calm explanation across several lines. Keep the example figure distinct from the next action, give every control a clear label, and retain all of the wording when a reviewer opens the detail sheet on a phone or a wider screen.", owner: "claude", state: "uat", priority: "p1", uat_review: true, link: "https://example.invalid/design/long-title" }),
  item({ id: "A9002", section: "A", title: "Check the compact board controls", owner: "kevin", state: "uat", uat_review: true, link: "https://example.invalid/design/board-controls" }),
  item({ id: "B9002", section: "B", title: "Restore the example keyboard focus treatment", owner: "codex", state: "rejected", priority: "p2", reason: "The submitted example needs a clearer focus state.", branch: "feature-B9002-example" }),
];

export const TODO_TOTAL_COUNT = 65;
export const TODO_SAMPLE: GoLiveItem[] = [
  item({ id: "A9003", section: "A", title: "Add a short cash flow helper", owner: "codex", state: "todo", priority: "p2", unblocks: ["C9002"] }),
  item({ id: "B9003", section: "B", title: "Check the account filter wording", owner: "claude", state: "todo" }),
  item({ id: "C9002", section: "C", title: "Prepare an example loading state", owner: "codex", state: "todo", priority: "p1" }),
  item({ id: "D9002", section: "D", title: "Document the synthetic data fixture", text: "Every value is invented for this example. It does not describe a real account or a real piece of work.", owner: "kevin", state: "todo" }),
  item({ id: "E9002", section: "E", title: "Review the alert colour tokens", owner: "claude", state: "todo", priority: "p2" }),
  item({ id: "F9002", section: "F", title: "Tidy the offline status example", owner: "codex", state: "todo" }),
  item({ id: "G9003", section: "G", title: "Write a longer example task describing how a household can understand a projected shortfall without decoding a compressed financial equation on a small screen. The example should explain which period is shown and offer one next step, with supporting detail available when the row is opened.", owner: "kevin", state: "todo", priority: "p1" }),
  item({ id: "H9003", section: "H", title: "Check the empty board message", owner: "claude", state: "todo" }),
];

export const DONE_TOTAL_COUNT = 219;
export const DONE_SAMPLE: GoLiveItem[] = [
  item({ id: "A8991", section: "A", title: "Set the sample account order", owner: "codex", state: "done", done_at: "2026-09-10" }),
  item({ id: "B8991", section: "B", title: "Add the illustrative balance label", owner: "claude", state: "done", done_at: "2026-09-11" }),
  item({ id: "C8991", section: "C", title: "Check the calm empty state", owner: "kevin", state: "done", done_at: "2026-09-12" }),
  item({ id: "D8991", section: "D", title: "Simplify the sample filter", owner: "codex", state: "done", done_at: "2026-09-13" }),
  item({ id: "E8991", section: "E", title: "Test the example error notice", owner: "claude", state: "done", done_at: "2026-09-14" }),
  item({ id: "F8991", section: "F", title: "Finish the mobile spacing example", owner: "kevin", state: "done", done_at: "2026-09-15" }),
];

export const CANCELLED_TOTAL_COUNT = 1;
export const CANCELLED_SAMPLE: GoLiveItem[] = [
  item({ id: "H8991", section: "H", title: "Retire the unused example panel", owner: "kevin", state: "cancelled", reason: "No longer needed for the example board." }),
];

export const ALL_FIXTURE_ITEMS: GoLiveItem[] = [...IN_FLIGHT, ...TODO_SAMPLE, ...DONE_SAMPLE, ...CANCELLED_SAMPLE];
export const IN_FLIGHT_TOTAL_COUNT = 17;
export const TOTAL_ITEM_COUNT = TODO_TOTAL_COUNT + DONE_TOTAL_COUNT + IN_FLIGHT_TOTAL_COUNT;
