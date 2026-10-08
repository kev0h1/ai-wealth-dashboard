// Scoped to the opt-in docked presentation; imported as text so the shared
// production component also remains renderable by the repo's SSR tests.
export const PENNY_PANEL_CSS = `
.penny-keyboard-frame {
  position: fixed;
  z-index: 58;
  inset-inline: 0;
  --penny-safe-top: max(env(safe-area-inset-top, 0px), var(--penny-safe-top-fallback, 0px));
  --penny-safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--penny-safe-bottom-fallback, 0px));
  bottom: calc(110px + var(--penny-safe-bottom));
  padding-inline: max(12px, env(safe-area-inset-left, 0px)) max(12px, env(safe-area-inset-right, 0px));
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
  .penny-keyboard-frame[data-penny-device="landscape"]:not(.penny-keyboard-typing) { bottom: calc(8px + var(--penny-safe-bottom)); }
  .penny-keyboard-frame[data-penny-device="landscape"] .penny-keyboard-panel { min-height: 0; height: calc(100dvh - 16px - var(--penny-safe-top) - var(--penny-safe-bottom)); max-height: calc(100dvh - 16px - var(--penny-safe-top) - var(--penny-safe-bottom)); }
  .penny-keyboard-frame[data-penny-device="landscape"] [data-penny-secondary] { display: none; }
}

/* Typing (G197, Codex's approved variant B restored over the G196 dock
   mechanics): a full-width conversation-first takeover. The window spans the
   visible area, from 8px plus the top safe-area inset below the visible top down to the keyboard
   top, with no side inset. The header links row and the question chips yield
   their space (data-penny-secondary), so the thread (flex-1, min-h-0) takes the
   slack and the composer with its general-information note sits on the
   keyboard edge. The header rule gets a clear gap below the 44px close button
   (data-penny-header-rule), which otherwise overhangs the compact header row
   and touches it. No transition, so nothing animates or jumps as the keyboard
   opens or closes (reduced-motion safe by construction). G206: the top is the
   visual-viewport top PLUS the safe-area inset, never max() of the two: the
   visual top (offsetTop) is measured from the screen edge, under the status
   bar, so max() let the header sit beneath the clock and battery. */
.penny-keyboard-typing {
  top: calc(var(--penny-typing-top, 8px) + var(--penny-safe-top));
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

/* G211 (iOS only, rendered and attributed only while the pan guard runs): an
   opaque canvas-coloured underlay over the whole layout viewport so no page
   shows above the window or in a pan gap. Not a scrim: no blur, no dim. pointer-events: none so taps reach the
   click-catcher beneath and still close the window; every touch outside
   the conversation scroller is cancelled by usePennyIosPanGuard. */
.penny-typing-underlay { position: fixed; inset: 0; z-index: 57; background: var(--background); pointer-events: none; }
.penny-keyboard-frame[data-penny-ios-guard] { touch-action: none; }
.penny-keyboard-frame[data-penny-ios-guard] [data-penny-scroll] { touch-action: pan-y; overscroll-behavior: contain; }

/* G240 fullscreen presentation (opt-in via presentation="fullscreen"; phones
   only, lg keeps the floating window). The frame spans the layout viewport
   edge to edge; the panel pads itself by the safe-area insets so the header
   clears the status bar and the composer clears the home indicator, and the
   opaque underlay above (z-57) means no page ever shows around it. While
   typing the bottom edge is the measured keyboard edge, so the bottom inset
   is dropped (the keyboard covers the home indicator). Same G191 keyboard
   strategy: no second margin is added. */
@media (max-width: 1023px) {
  .penny-fs-underlay { position: fixed; inset: 0; z-index: 57; background: var(--background); pointer-events: none; }
  .penny-fs-frame, .penny-fs-frame.penny-keyboard-typing { top: var(--penny-fs-top, 0px); bottom: 0; left: 0; right: 0; padding: 0; }
  .penny-fs-frame.penny-keyboard-typing { bottom: var(--penny-typing-bottom, 0px); }
  /* Out-specify the landscape resting rule (0,3,0) so landscape is flush to the
     bottom edge too; the panel's own safe-area padding is the only inset. */
  .penny-keyboard-frame.penny-fs-frame[data-penny-device="landscape"]:not(.penny-keyboard-typing) { bottom: 0; }
  .penny-fs-frame .penny-keyboard-panel {
    height: 100%; min-height: 0; max-height: none; max-width: 100%;
    border: 0; border-radius: 0; box-shadow: none;
    padding-top: var(--penny-safe-top);
    padding-bottom: var(--penny-safe-bottom);
    padding-inline: max(0px, env(safe-area-inset-left, 0px)) max(0px, env(safe-area-inset-right, 0px));
  }
  .penny-fs-frame.penny-keyboard-typing .penny-keyboard-panel { padding-bottom: 0; }
  .penny-keyboard-frame.penny-fs-frame[data-penny-device="landscape"] .penny-keyboard-panel { height: 100%; max-height: none; min-height: 0; }
  /* Variant-owned starter content (empty-state chips, history, prompt stack)
     yields to the conversation once the keyboard is up. */
  .penny-fs-frame.penny-keyboard-typing [data-penny-fs-secondary] { display: none; }
}
`;
