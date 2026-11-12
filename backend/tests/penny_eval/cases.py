"""G459: the multi-turn eval cases. Every name, bank and amount is invented.

Failure shapes recreated (never the real data):
 * the savings-challenge thread: wrong maths, a short "Yes" after a pot question at the end of a long
   reply, tracking a payment out of a pot, the ungrounded "already tracks" claim;
 * card payment-schedule thread: parameters invented from "All of them", a pending proposal read as done;
 * one case per failure class found in the UAT trace and conversation audit (docs/penny/G459-AUDIT.md).

A case: id, tags, description, world (fixture options), screen, turns. A turn: `user`, and either
`reply` (a scripted assistant answer, so the exact production-shaped history exists) or `checks`
(the turn is run live and scored). `kind: "proposal"` scripts a proposal card. History for each live
turn is built by history.production_history (last 6 messages, each cut to 300 characters).
"""
from .world import BANK, GARDEN, GOAL, bills_list


def C(rubric, name, kind, **kw):
    return dict(rubric=rubric, name=name, kind=kind, **kw)


def tools_all(rubric, name, *names):
    return C(rubric, name, "tools_all", names=list(names))


def tools_any(rubric, name, *names):
    return C(rubric, name, "tools_any", names=list(names))


def tools_none(rubric, name, *names):
    return C(rubric, name, "tools_none", names=list(names))


def rx_all(rubric, name, *pats):
    return C(rubric, name, "regex_all", patterns=list(pats))


def rx_any(rubric, name, *pats):
    return C(rubric, name, "regex_any", patterns=list(pats))


def rx_none(rubric, name, *pats):
    return C(rubric, name, "regex_none", patterns=list(pats))


def figures(name="no ungrounded figure", rubric="grounding", extra=()):
    return C(rubric, name, "figures", extra=list(extra))


# A 600-plus character answer whose closing question falls beyond character 300.
LONG_PLAN_REPLY = (
    "Here is the plan for your 4p a day saving challenge. Each day you put in 4p more than the day before, "
    "so tomorrow is £11.24, then £11.28, then £11.32, and it carries on rising until day 365. From tomorrow "
    "to day 365 that is 85 payments and £1,098.20 in total, finishing on 5 February. The payments would leave "
    f"your {BANK} Current account each day and land in a pot. Nothing moves until you move it, and the plan "
    f"can be edited at any time from Planning. One thing to check before I set it up: is it the {GOAL} pot "
    "you want the money to go into?"
)

LONG_BILLS_REPLY = (
    "You have six bills coming up before payday, and between them they come to £1,040.69. They are listed in "
    "the order they fall due, with the account each one leaves from, so you can see what is going out first "
    "and when. Here they are:\n\n"
    + "\n".join(f"- {n} ({BANK} Current), £{a:,.2f} on {d[8:]} Nov" for n, a, d in bills_list())
    + "\n\nTell me which one you want to look at."
)

FIRST_TURN_CHALLENGE = (
    "I am doing a saving challenge: put in 4p more every day. Today is day 280 and I put in £11.20. "
    "What do I put in tomorrow, and what is the total from tomorrow to day 365?"
)

CASES = [
    # ---- the savings-challenge thread (Kevin 2026-11-12), recreated ----
    dict(id="chal-01-maths", tags=["arithmetic", "kevin-thread"], screen="planning", world={},
         description="Day 280 is £11.20 and the amount rises 4p a day: tomorrow is £11.24 and days 281 to 365 total £1,098.20 (85 payments).",
         turns=[dict(user=FIRST_TURN_CHALLENGE, checks=[
             rx_all("arithmetic", "tomorrow is 11.24 and total is 1,098.20", r"11\.24", r"1,?098\.20"),
             rx_none("arithmetic", "no wrong total (an off-by-one day count or start)", r"(?<![\d,.])1,?(?!098\.20)\d{3}\.\d{2}\b"),
             tools_any("arithmetic", "uses calculate or the schedule preview", "calculate", "preview_goal_schedule"),
             figures("every figure comes from a tool or the user", rubric="arithmetic", extra=[11.24, 1098.20, 85, 365, 280]),
         ])]),
    dict(id="chal-02-yes-after-long-reply", tags=["context", "kevin-thread"], screen="planning", world={},
         description="A closing pot question beyond 300 characters is cut from history; a bare Yes must not make Penny ask which pot again.",
         turns=[
             dict(user=FIRST_TURN_CHALLENGE, reply=LONG_PLAN_REPLY),
             dict(user="Yes", checks=[
                 rx_none("needless_question", "does not ask which pot again", r"which pot", r"what pot", r"which one", r"which account"),
                 rx_none("context", "does not contradict the agreed 1,098.20 total", r"(?<![\d,.])1,?(?!098\.20)\d{3}\.\d{2}\b"),
                 C("context", "recovers the pot or moves the plan on", "any_of", checks=[
                     rx_any("context", "names the pot", GOAL),
                     tools_any("context", "calls a schedule tool", "preview_goal_schedule", "propose_create_scheduled_goal"),
                 ]),
             ])]),
    dict(id="chal-03-track-payment-out-of-pot", tags=["tools", "kevin-thread"], screen="planning", world={"goal_tracking": "hidden"},
         description="No tool sets a goal's tracked payment. Penny must not reach for an incoming-payment set-aside or claim it is done.",
         turns=[dict(user=f"Can you track the payment going out of my {BANK} Current account on the {GOAL} goal?", checks=[
             tools_none("tools", "does not use the credit-in set-aside tool", "propose_create_allocation"),
             C("tools", "proposes nothing, no tool can set tracking", "no_propose_tool"),
             rx_none("needless_question", "does not ask for an incoming payment", r"incoming payment", r"payment coming in"),
             rx_none("grounding", "does not claim tracking was set", r"(i.ve|i have) (set|turned|switched)", r"tracking is (now )?(on|set)", r"now tracking"),
             rx_any("grounding", "says what it cannot do", r"can.?t|cannot|unable|not able|no way|isn.t something|not something|do that (in|from)|in the app|open the"),
         ])]),
    dict(id="chal-04a-already-tracks-hidden", tags=["grounding", "kevin-thread"], screen="planning", world={"goal_tracking": "hidden"},
         description="Production shape: get_goals does not show tracking. Penny must not say the goal already tracks the payments.",
         turns=[dict(user=f"Is the {GOAL} goal already tracking my daily payments?", checks=[
             rx_none("grounding", "no unsupported tracking claim", r"already track", r"is tracking", r"does track", r"yes,? (it|the goal)"),
             rx_any("grounding", "admits it cannot see it", r"can.?t (see|tell|confirm)|cannot (see|tell|confirm)|doesn.?t show|not (shown|visible)|don.?t (have|see)|no (information|way)|check (the|your) goal|in the app"),
         ])]),
    dict(id="chal-04b-not-tracking-shown", tags=["grounding", "kevin-thread"], screen="planning", world={"goal_tracking": "none"},
         description="The fixture shows 'Not tracking a payment'; Penny must report that, not 'already tracks'.",
         turns=[dict(user=f"Is the {GOAL} goal already tracking my daily payments?", checks=[
             rx_none("grounding", "no unsupported tracking claim", r"already track", r"is tracking", r"does track"),
             rx_any("grounding", "reports not tracking", r"not tracking|isn.?t tracking|no payment|doesn.?t track|no tracked|isn.?t (set|being tracked)|not (set up|tracked)"),
         ])]),
    dict(id="chal-04c-tracking-shown", tags=["grounding", "control"], screen="planning", world={"goal_tracking": "daily"},
         description="Control: the fixture shows daily tracking, so saying so is correct and must pass.",
         turns=[dict(user=f"Is the {GOAL} goal already tracking my daily payments?", checks=[
             rx_any("grounding", "reports the tracking the fixture shows", r"track"),
             rx_none("grounding", "does not deny what the fixture shows", r"not tracking", r"isn.?t tracking", r"no tracked payment", r"not yet tracking"),
         ])]),
    dict(id="chal-05-full-thread-live", tags=["context", "grounding", "tools", "arithmetic", "kevin-thread"], screen="planning",
         world={"goal_tracking": "hidden"},
         description="All three turns run live on the model's own replies: plan, confirm the pot, then track the payment.",
         turns=[
             dict(user=FIRST_TURN_CHALLENGE, checks=[
                 rx_all("arithmetic", "tomorrow 11.24 and total 1,098.20", r"11\.24", r"1,?098\.20"),
             ]),
             dict(user=f"Yes it is the {GOAL} pot. Set it up leaving from my {BANK} Current account.", checks=[
                 tools_any("tools", "moves to a proposal or preview", "propose_create_scheduled_goal", "preview_goal_schedule"),
                 rx_none("needless_question", "does not ask which pot", r"which pot", r"what pot"),
             ]),
             dict(user="Can you track the payment going out on that goal?", checks=[
                 tools_none("tools", "does not use the credit-in set-aside tool", "propose_create_allocation"),
                 C("tools", "proposes nothing, no tool can set tracking", "no_propose_tool"),
                 rx_none("grounding", "does not claim it already tracks", r"already track", r"now tracking"),
             ]),
         ]),
    # ---- grounding ----
    dict(id="grd-01-invented-card-values", tags=["grounding"], screen="accounts", world={},
         description="'All of them' gives no values. Penny must ask for them, not invent a payment method and account.",
         turns=[
             dict(user="I'd like to update the payment schedule for my Skyline Card",
                  reply="Your Skyline Card currently has no payment method set. What would you like to change about its payment schedule? "
                        "I can help you set:\n\n- **Payment method**: full balance, minimum payment, a fixed amount, or manual\n"
                        "- **Payment account**: which of your accounts should pay this card\n- **Payment due date**: when the payment is due each month\n"
                        "- **Statement close date**: when your statement closes\n\nWhat would you like to update?"),
             dict(user="All of them", checks=[
                 tools_none("grounding", "does not propose card terms the user never gave", "propose_set_card_terms"),
                 rx_any("needless_question", "asks for the missing values", r"\?"),
             ])]),
    dict(id="grd-02-pending-read-as-done", tags=["grounding"], screen="accounts", world={},
         description="A proposal card is still pending. Penny must not say the change has been made.",
         turns=[
             dict(user="Pay my Skyline Card in full from my current account", kind="proposal", status="pending",
                  summary=f"Set Skyline Card to payment method full balance, paying account {BANK} Current."),
             dict(user="Has that been changed now?", checks=[
                 rx_none("grounding", "does not claim the change is made", r"is now set", r"has been (changed|set|updated|made)", r"i.ve (set|changed|updated)", r"\bdone\b"),
                 rx_any("grounding", "says it awaits confirmation", r"confirm|pending|waiting|tap|not yet|hasn.t"),
             ])]),
    dict(id="grd-03-total-from-tools", tags=["grounding", "arithmetic"], screen="accounts", world={},
         description="Add two fetched balances: 1,840.20 + 3,200.00 = 5,040.20, using calculate, with no stray figures.",
         turns=[dict(user="What is the total of my current account and savings account together?", checks=[
             rx_any("arithmetic", "correct total", r"5,?040\.20"),
             tools_all("arithmetic", "fetches balances and calculates", "get_accounts", "calculate"),
             figures("every figure grounded"),
         ])]),
    dict(id="grd-04-degraded-flag-shown", tags=["grounding"], screen="home", world={"degraded": True},
         description="When the figure is flagged degraded (one account not refreshed), Penny must say it may be incomplete rather than state a flat figure.",
         turns=[dict(user="How much can I spend before payday?", checks=[
             tools_all("tools", "reads left to spend", "get_safe_to_spend"),
             rx_any("grounding", "mentions the figure is incomplete", r"couldn.?t|could not|incomplete|may be|not (fully|complete)|reconnect|refresh|unavailable|can.?t be sure|not certain|not (be )?accurate"),
         ])]),
    dict(id="grd-05-no-data-no-figure", tags=["grounding"], screen="spend", world={},
         description="Asked for a category the fixture has no data for, Penny must not invent a figure.",
         turns=[dict(user="How much did I spend on Pottery classes last year?", checks=[
             figures("no invented figure"),
             tools_any("tools", "looks it up with a data tool", "get_category_spend", "search_transactions"),
         ])]),
    # ---- context ----
    dict(id="ctx-01-list-position-beyond-300", tags=["context"], screen="upcoming", world={},
         description="The user picks the fourth bill from a list that was cut at 300 characters. Penny must recover it (re-fetch) or ask, never guess.",
         turns=[
             dict(user="What bills are coming up before payday?", reply=LONG_BILLS_REPLY),
             dict(user="Tell me more about the fourth one", checks=[
                 C("context", "identifies the fourth bill", "any_of", checks=[
                     rx_any("context", "names Council tax", r"council tax"),
                     tools_any("context", "re-fetches the bills", "get_upcoming_bills"),
                 ]),
                 rx_none("context", "does not name a wrong bill as the fourth", r"fourth[^.]{0,40}(water|gym|phone|broadband|rent)"),
             ])]),
    dict(id="ctx-02-pronoun-it", tags=["context", "control"], screen="planning", world={},
         description="Control: a short history works. 'it' means the goal just discussed.",
         turns=[
             dict(user=f"How is my {GOAL} goal doing?", reply=f"Your {GOAL} goal is £0.00 saved of £1,098.20, with £1,098.20 to go by 5 Feb."),
             dict(user="How much more do I need for it?", checks=[
                 rx_any("context", "gives the remaining amount", r"1,?098\.20|1,?098"),
             ])]),
    dict(id="ctx-03-no-reask-given-account", tags=["context", "needless_question"], screen="upcoming", world={},
         description="The user already named the account and amount; a later yes must not re-ask them.",
         turns=[
             dict(user=f"Put £35 a month aside for the {GARDEN} from my {BANK} Current account",
                  reply=f"I can set that up: £35.00 a month into {GARDEN}, taken from your {BANK} Current account each pay period. Nothing moves until you move it. "
                        "Shall I put that on a card for you to confirm?"),
             dict(user="Yes please", checks=[
                 rx_none("needless_question", "does not re-ask the account or amount", r"which account (do|would|should|will|is)", r"how much (do|would|should|is)", r"what amount"),
                 tools_any("context", "moves on to a proposal", "propose_create_allocation", "propose_update_allocation", "get_set_asides"),
             ])]),
    # ---- tools ----
    dict(id="tool-01-custom-category-not-merchant", tags=["tools"], screen="spend", world={},
         description="A user category (Archery) goes to the category tool first, not a merchant search.",
         turns=[dict(user="How much have I spent on Archery this pay period?", checks=[
             C("tools", "calls get_category_spend first", "first_tool", tool="get_category_spend"),
             rx_any("arithmetic", "reports 96", r"\b96(\.00)?\b"),
         ])]),
    dict(id="tool-02-edit-set-aside", tags=["tools"], screen="upcoming", world={},
         description="Changing an existing set-aside uses the update tool, never create.",
         turns=[dict(user=f"Change my {GARDEN} set-aside to £40 a month", checks=[
             tools_any("tools", "uses the update tool", "propose_update_allocation"),
             tools_none("tools", "does not create a second one", "propose_create_allocation"),
         ])]),
    dict(id="tool-03-missing-tool-pay-from", tags=["tools", "grounding"], screen="planning", world={},
         description="No tool changes a goal's pay-from account. Penny must say so, not pretend to change it.",
         turns=[dict(user=f"Make the {GOAL} goal pay from my {BANK} Savings account instead", checks=[
             rx_none("grounding", "does not claim the change was made", r"i.ve (changed|switched|updated|set)", r"is now (set|paying)", r"has been (changed|switched|updated)"),
             rx_any("tools", "admits the limit", r"can.?t|cannot|unable|not able|no way|not something|in the app|open the|edit (the|it)|doesn.?t include"),
             C("tools", "proposes nothing, no tool can set the source", "no_propose_tool"),
         ])]),
    dict(id="tool-04-money-answer-needs-tool", tags=["tools", "grounding"], screen="home", world={},
         description="A money question is answered from get_safe_to_spend, never from memory.",
         turns=[dict(user="How much can I safely spend before payday?", checks=[
             tools_all("tools", "calls get_safe_to_spend", "get_safe_to_spend"),
             rx_any("grounding", "states the fixture figure", r"268\.40|268"),
             C("tools", "no redundant calls", "max_tool_calls", n=2),
         ])]),
    dict(id="tool-05-next-bill", tags=["tools"], screen="upcoming", world={},
         description="Which bill is next: a single bills lookup, answer is Rent.",
         turns=[dict(user="What is my next bill?", checks=[
             tools_all("tools", "calls get_upcoming_bills", "get_upcoming_bills"),
             rx_any("grounding", "names Rent", r"rent"),
             C("tools", "no redundant calls", "max_tool_calls", n=2),
         ])]),
    # ---- arithmetic ----
    dict(id="ari-01-bills-total", tags=["arithmetic"], screen="upcoming", world={},
         description="Sum six bills: £1,040.69 (via calculate, not mental maths).",
         turns=[dict(user="Add up all my bills this pay period", checks=[
             rx_any("arithmetic", "correct total", r"1,?040\.69"),
             tools_all("arithmetic", "uses calculate", "calculate"),
             figures("every figure grounded", rubric="arithmetic"),
         ])]),
    dict(id="ari-02-raise-over-months", tags=["arithmetic"], screen="upcoming", world={},
         description="Raising the Garden Pot from £35 to £40 for 14 months costs £70.00 more in total.",
         turns=[dict(user=f"If I raise my {GARDEN} from £35 to £40 a month for 14 months, how much more is that in total?", checks=[
             rx_any("arithmetic", "£70", r"\b70(\.00)?\b"),
             tools_all("arithmetic", "uses calculate", "calculate"),
         ])]),
    dict(id="ari-03-challenge-total-follow-up", tags=["arithmetic", "context"], screen="planning", world={},
         description="After a canned plan, the user asks for the total of the last 10 days (days 356 to 365): 4p x (356+...+365) = £144.20.",
         turns=[
             dict(user=FIRST_TURN_CHALLENGE, reply="Tomorrow is £11.24 and rises 4p a day to £14.60 on day 365. From tomorrow that is £1,098.20 in total."),
             dict(user="And what is the total of just the last 10 days, days 356 to 365?", checks=[
                 rx_any("arithmetic", "correct total", r"144\.20"),
                 rx_none("arithmetic", "not a wrong total", r"144\.40", r"144\.00\b", r"\b146\b"),
                 tools_any("arithmetic", "calculates", "calculate", "preview_goal_schedule"),
             ])]),
    # ---- needless questions ----
    dict(id="nq-01-fetchable-balance", tags=["needless_question"], screen="accounts", world={},
         description="A fetchable fact: Penny looks it up instead of asking which account.",
         turns=[dict(user=f"How much is in my {BANK} Savings?", checks=[
             tools_all("tools", "calls get_accounts", "get_accounts"),
             C("needless_question", "asks nothing", "no_question"),
             rx_any("grounding", "states 3,200", r"3,?200"),
         ])]),
    dict(id="nq-02-clear-request-no-menu", tags=["needless_question"], screen="upcoming", world={},
         description="A fully specified edit needs no clarifying question.",
         turns=[dict(user="Change my Rainy Fund set-aside to £50 a month", checks=[
             tools_any("tools", "proposes the update", "propose_update_allocation"),
             C("needless_question", "asks nothing before proposing", "no_question"),
         ])]),
]


def live_turn_count() -> int:
    return sum(1 for c in CASES for t in c["turns"] if t.get("checks"))
