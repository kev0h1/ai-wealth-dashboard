# C22: campaign features extension

Creative review draft. UAT approval is pending. No advert has been approved or published.

This approved extension adds six story directions to the existing C22 campaign kit: Movement, Month, Spend, Split, Penny and Aside. Each direction has a light and dark feed still and a light and dark story still, producing 24 new PNGs. Each direction also has a light and dark edited 15-second MP4, producing 12 new films. The original 12 PNGs and 4 MP4s remain available, for 36 PNGs and 16 MP4s across the preserved and new rounds.

## Source, meaning and motion

| Story | Source and meaning | Motion |
| --- | --- | --- |
| Movement | Production `MoveCard` with movement and account fixtures | A dated movement resolves into the account context and its consequence. |
| Month | Production `StoryPlayer` `SpendingSlide` and `WhereItWentSlide`, using the September fixture | The month establishes the frame, then spending and where-it-went evidence enter. |
| Spend | Production `SpendPaceHero` and `SpendShapeCard` | The pace arrives first, then the spending shape gives the detail. |
| Split | Production `PaySplitComparison` beside the adapted 50 / 30 / 20 reference | Income, actual split and reference comparison separate into a readable sequence. |
| Penny | Production Penny task proposal: request, local confirmation and done state | The task moves from proposal to real local confirmation, then done; no bank transfer occurs. |
| Aside | Production `SetAsideSheet` wizard and saved `SetAsideList` | Review the form, save the set-aside, then show the saved list. |

The source is the latest real production leaf components rendered with fixture data. No bank writes, account connections or live money operations occur. The source paths and dependency hashes for this new round are recorded by `marketing/c22-features/export_round.py` and its generated manifest. The new manifest is separate from the earlier campaign manifest. These are review assets, not evidence of customer approval or advertising approval.

## Review decisions

| Before | After | Why |
| --- | --- | --- |
| Whole screens fitted into small image areas | Closer views of the relevant production detail | Keep amounts and controls readable on a phone. |
| Five leading month categories beside the full spending total | Explicit £1,600 shown plus £200 other spending | Reconcile the displayed categories with the £1,800 total. |
| Two approved film stories | Six additional five-shot stories with the same type, colour and sound motif | Extend the agreed campaign style across the product. |
| Every execution in one long gallery | Feature filters, separate image and video sections, and URL state | Make each feature easy to review and share. |

## Financial truth and fixture boundaries

The September fixture uses £2,400 income, £1,800 spend, £400 moved and £200 left, with an actual split of £1,200 Fixed, £600 Free, £400 Moved and £200 Left. The five categories shown by the production month slide total £1,600; the film explicitly adds £200 other spending to reconcile the £1,800 total. The adapted reference remains visibly separate: £1,200 Fixed, £720 Free and £480 Moved. October's separate figures are £860 spend, £400 moved and £2,400 income. The movement fixture shows a £188 bill against a £68 balance, a £120 gap. Penny and Aside use £200 annual costs each pay period; confirming creates a plan and does not transfer money.

## Deliverables and reproduction

The 24 new stills use feed 1080×1350 and story 1080×1920 dimensions, with paired light and dark themes. The 12 new films are 15 seconds, use original sound design and caption tracks, and contain no synthetic voice or stock photography. The earlier C22 assets remain in the gallery; this round's manifest records the new deliverables separately.

Run from the repository root with a local preview:

```sh
/usr/bin/python3 marketing/c22-features/export_round.py --base http://127.0.0.1:3146 --proofs-only
/usr/bin/python3 marketing/c22-features/export_round.py --base http://127.0.0.1:3146 --stills-only
python3 marketing/c22-features/sound_design.py
node marketing/c22-features/render_films.mjs
python3 marketing/c22-features/validate_assets.py
python3 marketing/c22-features/review_frames.py
python3 marketing/c22-features/verify_gallery.py --base http://127.0.0.1:3146
```

Use the development preview for captures. After exporting all media, build and start the production preview for the gallery checks. If it was already running, restart that local preview so its static-file index includes the new exports.

The export captures the current production components, the sound script produces the authored audio assets, the film renderer writes the 12 MP4s and captions, and the validator checks the dimensions, hashes, source dependency record and new-round media counts. The gallery verifier checks the six new story directions and the preserved earlier archive. Final placement, copy, compliance and UAT approval remain pending.

The creative process reused the verified [official Remotion skills](https://www.remotion.dev/docs/ai/skills) and [source](https://github.com/remotion-dev/skills), plus the local Impeccable, frontend-design and Emil motion guidance. These tools support reproducibility and craft; they do not by themselves establish a strong campaign direction or prove performance.

The final production build, TypeScript, scoped ESLint, asset validation and native browser checks pass. All 12 new films decode completely and have measured non-silent AAC sound. Browser checks play, pause and seek all 16 combined MP4s, load all five caption cues, verify feature filters and rapid theme/format changes, and inspect 320, 390 and 1440 pixel layouts. Independent review passed the stills and decoded held shots for all six stories in both themes; it did not watch continuous playback. See `review.json` for the recorded checks. Repository-wide delivery gates run separately through `scripts/session.sh finish`.
