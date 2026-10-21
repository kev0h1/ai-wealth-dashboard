# Tips review, October 2026 (G315)

Status: awaiting Kevin's sign-off. Nothing here is live. Every figure in the synthetic section is invented; the last section is a read-only render of the owner's own cached tips.

Rules applied (Kevin, 2026-10-21):

- (a) Mortgage, car finance and loans, credit cards and balance transfers, insurance, pensions and investments show only the user's own fact, or no tip. No market list, no broker link, no research query for them.
- (b) Also listed appears only when it is like for like: same product type, a stated monthly price, a named reputable source. Never a product type without a price, a voucher or reseller, or a basket average beside the user's spend. A mobile, broadband or energy bill is not known to be like for like with a market plan (it may include a handset, a bundle or usage), so those carry no Also listed line unless the user has said what their plan is.
- (c) One figure per card: the headline and the lead line are the same sentence; no 'across N places'.
- (d) Cleaned merchant names, one row per brand; an unknown lender reads 'your mortgage lender'.
- (e) Sources show names (MoneySuperMarket, Which?), only from the allowlist; SEO price sites are dropped, and with no allowed source the market lines are dropped.
- (f) One freshness line: 'Checked 16 Oct'.

Cache: stored tips below prompt version 9 are never served, so they show as no tip until the weekly pass rewrites them.

## Synthetic fixtures, before and after

### Kevin 1: mobile

Before:
- Lead: ~£61/mo across 2 places · from your transactions
- Headline: You pay £61 a month on mobile
- Body: By merchant: EE £56 a month, Voxi £5 a month. SIM-only plans are listed at £5 to £14 a month. Also listed: Three Mobile £7 a month, VOXI, SMARTY. Checked 16 Oct, source uswitch.com and moneysupermarket.com.
- Freshness line below the body: Researched 5d ago

After:
- Lead: You pay about £61 a month for mobile · from your transactions
- Headline: (same sentence as the lead, shown once)
- Body: That is based on 6 payments in the last 90 days. Checked 16 Oct.
- Freshness line below the body: (none, the body carries the one "Checked" line)

### Kevin 2: car finance

Before:
- Lead: ~£429/mo at M&S Loans · from your transactions
- Headline: You pay M&S Loans £429 a month
- Body: Also listed: PCP, HP. Checked 16 Oct, source moneysupermarket.com.
- Freshness line below the body: Researched 5d ago

After:
- Lead: You paid M&S Loans £429.00 on 1 Oct · from your transactions
- Headline: (same sentence as the lead, shown once)
- Body: That was the latest of 3 payments in the last 90 days. Checked 16 Oct.
- Freshness line below the body: (none, the body carries the one "Checked" line)

### Kevin 3: groceries

Before:
- Lead: ~£208/mo across 4 places · from your transactions
- Headline: You spend about £208 a month on groceries
- Body: By merchant: Sainsburys Supermarket Birmin £120 a month, Sainsburys S/Mkts £50 a month, Tesco £30 a month, Aldi £8 a month. Also listed: Aldi £162 a month, Lidl £163 a month, Tesco £182 a month. Checked 16 Oct, source trolley.co.uk.
- Freshness line below the body: Researched 5d ago

After:
- Lead: You spend about £208 a month on groceries · from your transactions
- Headline: (same sentence as the lead, shown once)
- Body: That is based on 16 payments in the last 90 days. Checked 16 Oct.
- Freshness line below the body: (none, the body carries the one "Checked" line)

### Kevin 4: mortgage

Before:
- Lead: ~£1,124/mo at Mtg · from your transactions
- Headline: You pay Mtg £1,124 a month
- Body: Also listed: Yorkshire BS £1,167 a month, West Brom £1,385 a month. Lenders list two year fixed rates. Checked 16 Oct, source moneysupermarket.com.
- Freshness line below the body: Researched 5d ago

After:
- Lead: You paid your mortgage lender £1,124.44 on 1 Oct · from your transactions
- Headline: (same sentence as the lead, shown once)
- Body: That was the latest of 3 payments in the last 90 days. Checked 16 Oct.
- Freshness line below the body: (none, the body carries the one "Checked" line)

### Kevin 5: gym

Before:
- Lead: ~£61/mo across 2 places · from your transactions
- Headline: You pay David Lloyd Leisur £61 a month
- Body: Gym memberships are listed at £25 to £80 a month. Also listed: David Lloyd via Groupon £60 a month, PureGym £25 a month. Checked 16 Oct, source davidlloydmembership-price.co.uk and which.co.uk.
- Freshness line below the body: Researched 5d ago

After:
- Lead: You pay David Lloyd £61 a month · from your transactions
- Headline: (same sentence as the lead, shown once)
- Body: That is based on 6 payments in the last 90 days. Gym memberships are listed at £25 to £80 a month. Also listed: PureGym £25 a month. Checked 16 Oct, source Which?
- Freshness line below the body: (none, the body carries the one "Checked" line)

### Other: energy

Before:
- Lead: ~£130/mo at Octopus Energy · from your transactions
- Headline: You pay Octopus Energy £130 a month
- Body: Energy tariffs are listed at £90 to £140 a month. Also listed: Outfox the Market £112 a month. Octopus lists a 12 month fixed tariff. Offer listed until 31 Oct. Checked 16 Oct, source ofgem.gov.uk and uswitch.com.
- Freshness line below the body: Researched 5d ago

After:
- Lead: You pay Octopus Energy £130 a month · from your transactions
- Headline: (same sentence as the lead, shown once)
- Body: That is based on 3 payments in the last 90 days. Octopus lists a 12 month fixed tariff. Offer listed until 31 Oct. Checked 16 Oct, source Ofgem and Uswitch.
- Freshness line below the body: (none, the body carries the one "Checked" line)

### Other: broadband

Before:
- Lead: ~£38/mo at BT · from your transactions
- Headline: You pay BT £38 a month
- Body: Broadband deals are listed at £22 to £30 a month. Also listed: Community Fibre £22 a month. Checked 16 Oct, source uswitch.com.
- Freshness line below the body: Researched 5d ago

After:
- Lead: You pay BT £38 a month · from your transactions
- Headline: (same sentence as the lead, shown once)
- Body: That is based on 3 payments in the last 90 days. Checked 16 Oct.
- Freshness line below the body: (none, the body carries the one "Checked" line)

### Other: car insurance

Before:
- Lead: ~£70/mo at Admiral · from your transactions
- Headline: You pay Admiral £70 a month
- Body: Car insurance policies are listed at £55 to £85 a month. Also listed: Direct Line £64 a month. Checked 16 Oct, source moneysavingexpert.com.
- Freshness line below the body: Researched 5d ago

After:
- Lead: You paid Admiral £70.00 on 9 Oct · from your transactions
- Headline: (same sentence as the lead, shown once)
- Body: That was the latest of 3 payments in the last 90 days. Checked 16 Oct.
- Freshness line below the body: (none, the body carries the one "Checked" line)

### Other: eating out

Before:
- Lead: ~£60/mo at Nandos · from your transactions
- Headline: You spend about £60 a month on eating out
- Body: That is based on 5 payments in the last 90 days. Also listed: Tastecard £5 a month. Voucher sites list restaurant offers. Checked 16 Oct, source vouchercodes.co.uk.
- Freshness line below the body: Researched 5d ago

After:
- Lead: You spend about £60 a month on eating out · from your transactions
- Headline: (same sentence as the lead, shown once)
- Body: That is based on 5 payments in the last 90 days. Checked 16 Oct.
- Freshness line below the body: (none, the body carries the one "Checked" line)

### Other: subscriptions

Before:
- Lead: ~£25/mo across 2 places · from your transactions
- Headline: You pay £25 a month on subscriptions
- Body: By merchant: Netflix.Com £13 a month, Spotify £12 a month. Streaming subscriptions are listed at £5 to £18 a month. Also listed: Disney+ £5 a month. Checked 16 Oct, source which.co.uk.
- Freshness line below the body: Researched 5d ago

After:
- Lead: You pay about £25 a month for subscriptions · from your transactions
- Headline: (same sentence as the lead, shown once)
- Body: That is based on 6 payments in the last 90 days. Streaming subscriptions are listed at £5 to £18 a month. Also listed: Disney+ £5 a month. Checked 16 Oct, source Which?
- Freshness line below the body: (none, the body carries the one "Checked" line)

## Your own tips on UAT (read-only render)

Read from the cached tips for the account named Premier Current Account. Nothing was written. The 'After' text is what the next weekly pass would write.

#### Car Finance

Now (as served today, from the cached tip):
- Lead: ~£429/mo at M&S Loans · from your transactions
- Headline: You pay M&S Loans £429 a month
- Body: Also listed: PCP Personal Contract Purchase, HP Hire Purchase. Checked 16 Oct, source procalculator.site and clearscore.com.
- Rows: M&S Loans £428.86

After G315 (what the next weekly pass would write, from his current transactions and the cached shared research; nothing is written):
- Lead: You paid M&S Loans £428.86 on 1 Oct · from your transactions
- Headline: (same sentence as the lead, shown once)
- Body: That was the latest of 3 payments in the last 90 days. Checked 21 Oct.
- Freshness line below the body: (none, the body carries the one "Checked" line)
- Rows: M&S Loans £428.86

#### Eating Out

Now (as served today, from the cached tip):
- Lead: ~£41/mo across 4 places · from your transactions
- Headline: You spend about £37 a month on eating out
- Body: By merchant: Wagamama £17 a month, Mcdonalds £11 a month, Nandos £6 a month, Kfc - Castle Bromw On 13 Sep C £4 a month. Also listed: Pizza Express, Hungry Horse, Sizzling Pubs. Checked 16 Oct, source thinkmoney.co.uk and thekrazycouponlady.com.
- Rows: Wagamama £17.40; Mcdonalds £10.67; Nandos £9.73; Kfc - Castle Bromw On 13 Sep C £3.50

After G315 (what the next weekly pass would write, from his current transactions and the cached shared research; nothing is written):
- Lead: You spend about £41 a month on eating out · from your transactions
- Headline: (same sentence as the lead, shown once)
- Body: That is based on 7 payments in the last 90 days. Checked 16 Oct.
- Freshness line below the body: (none, the body carries the one "Checked" line)
- Rows: Wagamama £17.40; McDonald's £10.67; Nando's £9.73; KFC £3.50
- Sources kept: (none); dropped as not allowlisted: 3

#### Energy

Now (as served today, from the cached tip):
- Lead: ~£303/mo across 2 places · from your transactions
- Headline: You pay £303 a month on energy
- Body: Similar energy tariffs typically cost £139 to £144 a month. Fixed energy deals typically offer savings and price certainty versus variable tariffs. Worth comparing: British Gas Economy 7 (Cheaper rates during night hours), British Gas PeakSave (Half-price electricity every Sunday with smart meter), British Gas dual fuel tariff (typically about £155 a month). Market check 16 Oct.
- Rows: British Gas £159.70; Octopus Energy £142.91

After G315 (what the next weekly pass would write, from his current transactions and the cached shared research; nothing is written):
- Lead: You pay about £303 a month for energy · from your transactions
- Headline: (same sentence as the lead, shown once)
- Body: That is based on 4 payments in the last 90 days. Checked 16 Oct.
- Freshness line below the body: (none, the body carries the one "Checked" line)
- Rows: British Gas £159.70; Octopus Energy £142.91
- Sources kept: Uswitch, MoneySuperMarket; dropped as not allowlisted: 1

#### Groceries

Now (as served today, from the cached tip):
- Lead: ~£217/mo across 4 places · from your transactions
- Headline: You spend about £208 a month on groceries
- Body: By merchant: Sainsburys Supermarket Birmin £137 a month, Sainsburys S/Mkts £31 a month, Asda Stores Birmingham £28 a month, Wm Morrisons Stores - C Castle £12 a month. Also listed: Aldi £162 a month, Lidl £163 a month, Tesco with Clubcard £182 a month. Checked 16 Oct, source grocefully.com and which.co.uk.
- Rows: Sainsburys Supermarket Birmin £156.98; Sainsburys S/Mkts £31.46; Asda Stores Birmingham £27.60; Tesco Store 2503 2503Te Birmin £1.08

After G315 (what the next weekly pass would write, from his current transactions and the cached shared research; nothing is written):
- Lead: You spend about £217 a month on groceries · from your transactions
- Headline: (same sentence as the lead, shown once)
- Body: That is based on 16 payments in the last 90 days. Checked 16 Oct.
- Freshness line below the body: (none, the body carries the one "Checked" line)
- Rows: Sainsbury's £188.44; Asda £27.60; Tesco £1.08
- Sources kept: Which?; dropped as not allowlisted: 2

#### Gym

Now (as served today, from the cached tip):
- Lead: ~£117/mo at David Lloyd Leisur · from your transactions
- Headline: You pay David Lloyd Leisur £117 a month
- Body: Gym memberships are listed at £75 to £230 a month. Also listed: David Lloyd via Groupon £60 a month. Checked 16 Oct, source davidlloydmembership-price.co.uk and groupon.co.uk.
- Rows: David Lloyd Leisur £117.00

After G315 (what the next weekly pass would write, from his current transactions and the cached shared research; nothing is written):
- Lead: You pay David Lloyd £117 a month · from your transactions
- Headline: (same sentence as the lead, shown once)
- Body: That is based on 3 payments in the last 90 days. Checked 16 Oct.
- Freshness line below the body: (none, the body carries the one "Checked" line)
- Rows: David Lloyd £117.00
- Sources kept: (none); dropped as not allowlisted: 3

#### Mobile

Now (as served today, from the cached tip):
- Lead: ~£61/mo across 2 places · from your transactions
- Headline: You pay £61 a month on mobile
- Body: By merchant: EE £56 a month, Lycamobile £5 a month. Also listed: Three Mobile £7 a month, VOXI (1-month rolling plans available), SMARTY (1-month rolling plans available). Checked 16 Oct, source moneysupermarket.com and techradar.com.
- Rows: Ee £55.99; Lycamobile £5.00

After G315 (what the next weekly pass would write, from his current transactions and the cached shared research; nothing is written):
- Lead: You pay about £61 a month for mobile · from your transactions
- Headline: (same sentence as the lead, shown once)
- Body: That is based on 9 payments in the last 90 days. Checked 16 Oct.
- Freshness line below the body: (none, the body carries the one "Checked" line)
- Rows: EE £55.99; Lycamobile £5.00
- Sources kept: MoneySuperMarket, Uswitch; dropped as not allowlisted: 1

#### Mortgage

Now (as served today, from the cached tip):
- Lead: ~£1,124/mo at Mtg · from your transactions
- Headline: You pay Mtg £1,124 a month
- Body: Also listed: Yorkshire Building Society £1,167 a month, West Brom Building Society £1,385 a month, TemboMoney panel. Checked 16 Oct, source uswitch.com and moneysupermarket.com.
- Rows: Mtg £1,124.44

After G315 (what the next weekly pass would write, from his current transactions and the cached shared research; nothing is written):
- Lead: You paid your mortgage lender £1,124.44 on 1 Oct · from your transactions
- Headline: (same sentence as the lead, shown once)
- Body: That was the latest of 3 payments in the last 90 days. Checked 21 Oct.
- Freshness line below the body: (none, the body carries the one "Checked" line)
- Rows: Your mortgage lender £1,124.44

#### Subscriptions

Now (as served today, from the cached tip):
- Lead: ~£22/mo across 2 places · from your transactions
- Headline: You pay £22/month on Netflix and Prime
- Body: The search results provided are US pricing (in dollars) and don't include UK equivalents or availability. To find genuine savings on your current subscriptions, check if UK streaming bundles or cheaper tiers are available on Netflix and Amazon Prime directly, or compare with other UK services you might switch to.
- Rows: Netflix.Com £12.99; Amazon Prime £8.99

After G315 (what the next weekly pass would write, from his current transactions and the cached shared research; nothing is written):
- (no cached shared research for this tip yet, so the weekly pass would fetch it, then show the user's own fact and any like-for-like listing)
- Own-fact only: You pay about £22 a month for subscriptions That is based on 6 payments in the last 90 days. Checked 21 Oct.

