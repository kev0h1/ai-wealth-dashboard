// Scoped to the opt-in docked presentation; imported as text so the shared
// production component also remains renderable by the repo's SSR tests.
export const PENNY_PANEL_CSS = `
.penny-keyboard-frame {
  position: fixed;
  z-index: 58;
  inset-inline: 0;
  bottom: calc(110px + env(safe-area-inset-bottom, 0px));
  padding-inline: 12px;
}

.penny-keyboard-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 420px;
  min-height: min(26rem, 65dvh);
  max-height: 65dvh;
  margin-inline: auto;
  border-radius: 24px;
  box-shadow: 0 16px 32px rgb(15 23 42 / 18%);
  border: 1px solid rgb(100 116 139 / 25%);
  overflow: hidden;
}

@media (min-width: 1024px) {
  .penny-keyboard-frame { left: auto; right: 24px; bottom: 24px; width: 420px; padding: 0; }
}
/* Short landscape phones collapse the secondary row. Gated on the DEVICE
   orientation (data-penny-device, set from screen.orientation in
   PennySheetPanel), never on the layout viewport's aspect ratio, because under
   interactive-widget=resizes-content a portrait phone with its keyboard up
   also measures short and wide. */
@media (max-height: 480px) and (max-width: 1023px) {
  .penny-keyboard-frame[data-penny-device="landscape"]:not(.penny-keyboard-typing) { bottom: 8px; }
  .penny-keyboard-frame[data-penny-device="landscape"] .penny-keyboard-panel { min-height: 0; height: calc(100dvh - 16px); max-height: calc(100dvh - 16px); }
  .penny-keyboard-frame[data-penny-device="landscape"] [data-penny-secondary] { display: none; }
}

/* Typing (G197, Codex's approved variant B restored over the G196 dock
   mechanics): a full-width conversation-first takeover. The window spans the
   visible area, from 8px inside the top (safe-area aware) down to the keyboard
   top, with no side inset. The header links row and the question chips yield
   their space (data-penny-secondary), so the thread (flex-1, min-h-0) takes the
   slack and the composer with its general-information note sits on the
   keyboard edge. The header rule gets a clear gap below the 44px close button
   (data-penny-header-rule), which otherwise overhangs the compact header row
   and touches it. No transition, so nothing animates or jumps as the keyboard
   opens or closes (reduced-motion safe by construction). */
.penny-keyboard-typing {
  top: max(var(--penny-typing-top), calc(env(safe-area-inset-top, 0px) + 8px));
  bottom: var(--penny-typing-bottom, 0px);
  display: flex;
  padding-inline: 0;
}
.penny-keyboard-typing .penny-keyboard-panel {
  height: 100%;
  min-height: 0;
  max-height: none;
  max-width: 100%;
  border-radius: 24px 24px 0 0;
  border-bottom: 0;
  box-shadow: none;
}
.penny-keyboard-typing [data-penny-secondary] { display: none; }
.penny-keyboard-typing [data-penny-header-rule] { margin-top: 16px; }
.penny-keyboard-typing [data-penny-composer-wrap] { padding-bottom: 8px; }
`;
