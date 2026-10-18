# Tips as facts: sample wording for Kevin's approval (G283)

Status: awaiting Kevin's approval of the wording. Nothing here blocks the build; the code already composes tips in this style. Change the wording on this page and the composition follows.

Rules every sample follows:

- A tip states what the user pays, to whom and how often (their own transactions), and what comparable options are listed at, with a source and a date.
- No claim or estimate of a saving, no recommendation, no product named as the best option, no call to action.
- A deal is a dated fact ("Offer listed until 31 Oct"), not a prompt.
- British English, no em dashes, no exclamation marks, figures as listed (not hedged into promises).
- Banned in tip text: save, saves, saved, saving, savings (except the category name "Savings" and the account type), cut, cheaper, cheapest, could, should, recommend, best, worth switching, switch to. Enforced by `backend/app/services/tip_copy.py` and `npm run check:g283-no-savings-claims`.
- The source is the host name of the page the market figures came from. The date is the day the shared research was checked.
- Where the app has no provider list for a category (groceries, eating out), the tip states only the user's own figure and its basis, and does not name anyone.

## 1. Mobile

Before:
- Title: "You pay EE £57/mo, SIM-only could cut that sharply"
- Body: "The cheapest SIM only deal right now is 20GB for £6/month from iD Mobile (new customers only). Even Asda Mobile and Lebara offer 3-5GB for £5/month, which could save you ~£52/month compared to your current EE spend."
- Subline on Spend: "1 tip, ~£52/mo"

After:
- Title: "You pay EE £57 a month"
- Body: "SIM-only plans are listed at £5 to £6 a month. Also listed: iD Mobile £6 a month, Asda Mobile £5 a month, Lebara £5 a month. Checked 14 Oct, source uswitch.com."
- Subline on Spend: "1 tip"

## 2. Energy

Before:
- Title: "Your £160/mo energy bill could drop with fixed tariffs"
- Body: "Fixed-price tariffs like Outfox EnergyFix'd Dual offer protection against future price rises. If you have solar panels or a battery, Economy 7 import tariffs could save ~10p per kWh on overnight charging."

After:
- Title: "You pay Octopus Energy £160 a month"
- Body: "Energy tariffs are listed at £90 to £140 a month. Also listed: Outfox the Market £112 a month. Checked 14 Oct, source ofgem.gov.uk."
- Deal line, when the research finds a dated offer: "Octopus lists a 12 month fixed tariff. Offer listed until 31 Oct."

## 3. Broadband

Before:
- Title: "You pay BT £38/mo, a cheaper deal is likely"
- Body: "Switching to a new provider could save you around £14 a month. Best value right now is Community Fibre."

After:
- Title: "You pay BT £38 a month"
- Body: "Broadband deals are listed at £22 to £30 a month. Also listed: Community Fibre £22 a month, Vodafone £26 a month. Checked 14 Oct, source uswitch.com."

## 4. Insurance (car)

Before:
- Title: "Car insurance renews soon, worth switching?"
- Body: "Comparing quotes could cut your premium. We recommend checking three comparison sites at least 21 days before renewal."

After:
- Title: "You pay Admiral £70 a month"
- Body: "Car insurance policies are listed at £55 to £85 a month for comparable cover. You noted your policy renews 12 Dec. Checked 14 Oct, source moneysavingexpert.com."

(The renewal sentence is the user's own noted date echoed back, as before. The source here is only a host name; the tip itself makes no savings claim.)

## 5. Groceries and eating out

Before:
- Groceries title: "You spend about £420/mo on groceries, own-brand swaps could save £60"
- Eating out body: "Cooking at home twice a week could cut this by around £90 a month."

After:
- Groceries title: "You spend about £420 a month on groceries"
- Groceries body: "That is based on 12 payments in the last 90 days. Checked 14 Oct."
- Eating out title: "You spend about £60 a month on eating out"
- Eating out body: "That is based on 5 payments in the last 90 days. Checked 14 Oct."

## Resolved tips (a payment stopped)

Before: "You did it, payments to Nandos have stopped. That's ~£49/mo staying in your pocket." and, on Home, a "£X/mo saved" stat.

After: "Payments to Nandos stopped." No figure. The Home stat and the celebration card are removed.

When the merchant stops but the category did not move: "Payments to Nandos stopped, and Eating Out overall hasn't moved." (the old "Worth a look at where it went." is removed).

## Questions for Kevin

1. Is listing named providers with prices (as in samples 1 to 3) acceptable as a fact, given each is dated and sourced? The alternative is the user's own figure plus the listed range only, with no provider names.
2. Should the Spend subline stay "N tips", or show nothing but a tip icon?
3. Car insurance: keep the user's own renewal date line, or drop it too?
