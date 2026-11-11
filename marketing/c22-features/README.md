# C22 capability stories

Creative review draft, refreshed 11 November 2026. UAT and publication approval remain pending. This round extends the approved typography-led product style with current production UI, fictional data and authored sound. It contains no generated scenery or synthetic interface lettering.

Nine stories are Movement, Month, Spend, Split, Penny, Aside, Upcoming, Plans and Schedule. Each has light and dark feed and story stills: 36 feature PNGs. Twelve original images remain, for 48 social PNGs overall. Each new story has light and dark 15-second films: 18 feature films. Four original films remain, for 22 MP4s overall. Every film ends with “Coming soon”.

See [the capability brief](../c22-capabilities/README.md) for the direction contract and financial boundaries. The gallery is `/design/marketing-kit`; the store sequence is `/design/marketing-kit#stores`.

## Current capability evidence

| Story | Product truth shown | Boundary |
| --- | --- | --- |
| Movement | £188 Energy payment, £68 in Bills, suggested £80 Everyday + £40 Joint | Customer transfers in their bank. |
| Month | £2,400 in, £1,800 spent, £400 moved and £200 left | September is a separate dated scenario. |
| Spend | £860 out versus £740 usual by day 10; Eating Out £240 versus £120 usual | £400 moved stays separate from spending. |
| Split | Actual amounts beside an adapted 50/30/20 reference | Reference is not a budget or grade. |
| Penny | A real chart comparison in chat | Same pay-period window, not a full-month forecast. |
| Aside | Groceries £250 every pay period | Plan changes the estimate; it does not move bank money. |
| Upcoming | Create Boiler service £90 due 24 November, then edit to £95 due 26 November | Planned entry is not a bank payment. |
| Plans | Car insurance £600 split into £200 on 30 November, 30 December and 30 January | Confirmation creates a goal schedule. |
| Schedule | Change planned Boiler payment £90 on 24 November to £95 on 26 November | Confirmation updates the plan only. |

Captures block unexpected API requests and record fixture status and source hashes. No account connection, bank write or live customer data is used.

## Reproduction

```sh
python3 marketing/c22-features/export_round.py --base http://127.0.0.1:3146 --proofs-only
python3 marketing/c22-features/export_round.py --base http://127.0.0.1:3146 --stills-only
python3 marketing/c22-features/sound_design.py
node marketing/c22-features/render_films.mjs
python3 marketing/c22-features/validate_assets.py
python3 marketing/c22-features/review_frames.py
python3 marketing/c22-features/verify_gallery.py --base http://127.0.0.1:3146
```

Final build, TypeScript, asset validation, browser playback and independent visual review are recorded by the root C22 hand-off after complete media export. The earlier 5 November six-story review is historical and does not prove this nine-story round.
