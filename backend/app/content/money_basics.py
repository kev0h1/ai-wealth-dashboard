"""Curated UK personal-finance explainers ("Money basics").

General educational information, not financial advice. Figures are for the
2026/27 UK tax year; review each April when allowances are confirmed. Keep this
list curated by hand rather than LLM-generated so the numbers stay accurate.
"""

TAX_YEAR = "2026/27"

# Each card: id, topic, icon, title, body, takeaway.
# `topic` doubles as the chip label; investing-stage topics are tagged via GROW_TOPICS.
MONEY_BASICS: list[dict] = [
    {
        "id": "isa-allowance",
        "topic": "ISAs",
        "icon": "🏦",
        "title": "You can shelter £20,000 a year in ISAs",
        "body": "Each tax year you can pay up to £20,000 into ISAs and pay no tax on the interest, dividends or growth, ever. The allowance resets every 6 April and you can't carry unused amounts forward, so it's use-it-or-lose-it.",
        "takeaway": "Unused ISA allowance disappears each April: it doesn't roll over.",
    },
    {
        "id": "cash-vs-ss-isa",
        "topic": "ISAs",
        "icon": "⚖️",
        "title": "Cash ISA vs Stocks & Shares ISA",
        "body": "A Cash ISA works like a tax-free savings account: safe, predictable, good for money you'll need soon. A Stocks & Shares ISA invests in funds or shares: more ups and downs, but historically higher returns over the long run. Both share the same £20,000 yearly limit.",
        "takeaway": "Cash ISA for short-term safety; S&S ISA for long-term growth.",
    },
    {
        "id": "lisa",
        "topic": "ISAs",
        "icon": "🔑",
        "title": "The Lifetime ISA adds a 25% government bonus",
        "body": "If you're 18-39 you can open a Lifetime ISA and pay in up to £4,000 a year (part of your £20,000 ISA allowance). The government tops it up by 25%, up to £1,000 free each year, toward a first home under £450,000 or retirement from age 60. Withdraw early for anything else and you lose 25%.",
        "takeaway": "Up to £1,000/year free toward a first home or retirement.",
    },
    {
        "id": "personal-savings-allowance",
        "topic": "Tax",
        "icon": "💸",
        "title": "Your first £1,000 of savings interest is tax-free",
        "body": "The Personal Savings Allowance lets basic-rate taxpayers earn £1,000 of interest a year tax-free (£500 if you're a higher-rate taxpayer, £0 for additional-rate). Interest inside an ISA never counts toward it: that's the ISA's edge once your savings grow.",
        "takeaway": "Past the allowance, an ISA keeps the rest tax-free.",
    },
    {
        "id": "emergency-fund",
        "topic": "Saving",
        "icon": "🛟",
        "title": "Aim for 3-6 months of essential spending",
        "body": "An emergency fund is cash set aside for the unexpected: a boiler, a job gap, a car repair. The rule of thumb is 3-6 months of essential outgoings, kept somewhere instant-access (an easy-access or Cash ISA), not invested. It's the foundation everything else is built on.",
        "takeaway": "Build the buffer before you invest or overpay debt.",
    },
    {
        "id": "high-interest-debt-first",
        "topic": "Debt",
        "icon": "🔥",
        "title": "Clear pricey debt before you invest",
        "body": "Credit cards often charge ~20%+ a year. No mainstream investment reliably beats that, so paying off expensive debt is a guaranteed, tax-free 'return' equal to the interest rate. Once a small buffer is in place, throwing spare cash at high-interest balances usually wins.",
        "takeaway": "Paying off a 20% card beats almost any investment.",
    },
    {
        "id": "pension-match",
        "topic": "Pensions",
        "icon": "🎁",
        "title": "An employer pension match is free money",
        "body": "Many workplace pensions match what you pay in, up to a limit. If your employer adds 5% when you add 5%, that's an instant 100% return before any investment growth. Contributing at least enough to grab the full match is one of the best-value moves available.",
        "takeaway": "Always pay in enough to capture the full employer match.",
    },
    {
        "id": "pension-tax-relief",
        "topic": "Pensions",
        "icon": "📈",
        "title": "Pensions get topped up by tax relief",
        "body": "Pay into a pension and the government adds back the tax you'd have paid. For a basic-rate taxpayer, £80 becomes £100 automatically; higher-rate taxpayers can claim more back. The annual allowance for most people is £60,000 (or 100% of earnings, if lower).",
        "takeaway": "£80 in can become £100, or more for higher earners.",
    },
    {
        "id": "compound-interest",
        "topic": "Investing",
        "icon": "🪴",
        "title": "Compounding rewards starting early",
        "body": "Compounding means your returns earn returns. Money invested has time to snowball, which is why £100/month started in your 20s can dwarf the same amount started in your 40s. Time in the market matters more than timing it.",
        "takeaway": "The earliest pound you invest works the hardest.",
    },
    {
        "id": "investment-fees",
        "topic": "Investing",
        "icon": "🧮",
        "title": "Fees quietly eat returns",
        "body": "A 1% annual fee sounds small but compounds against you over decades, potentially tens of thousands over an investing lifetime. Low-cost index funds (often 0.1-0.3%) are why many long-term investors favour them over pricier actively managed funds.",
        "takeaway": "Lower fees leave more of the growth with you.",
    },
    {
        "id": "diversification",
        "topic": "Investing",
        "icon": "🧺",
        "title": "Don't put all your eggs in one basket",
        "body": "Spreading money across many companies, sectors and countries softens the blow when any single one falls. A global index fund does this in one purchase, thousands of companies worldwide, which is why it's a common starting point for new investors.",
        "takeaway": "A global fund diversifies in a single holding.",
    },
    {
        "id": "dividend-allowance",
        "topic": "Tax",
        "icon": "📊",
        "title": "£500 of dividends a year is tax-free",
        "body": "Outside an ISA, you can receive £500 in dividends each year before tax. Above that, dividend tax applies at rates depending on your income band. Hold the same shares or funds inside a Stocks & Shares ISA and dividends are tax-free with no limit.",
        "takeaway": "An ISA removes the dividend tax worry entirely.",
    },
    {
        "id": "cgt-allowance",
        "topic": "Tax",
        "icon": "✂️",
        "title": "Capital gains have a £3,000 tax-free band",
        "body": "Sell investments held outside an ISA for a profit and you can make £3,000 of gains a year before Capital Gains Tax applies. Gains inside an ISA are completely tax-free, another reason to use your ISA allowance before investing in a taxable account.",
        "takeaway": "ISA gains never trigger Capital Gains Tax.",
    },
    {
        "id": "tax-year-dates",
        "topic": "Tax",
        "icon": "📅",
        "title": "The UK tax year runs 6 April to 5 April",
        "body": "Allowances for ISAs, pensions, dividends and capital gains all reset on 6 April. If you've got spare allowance and the cash, using it before 5 April means you don't lose that year's slice. Many people do a quick 'tax-year-end' check each spring.",
        "takeaway": "Use this year's allowances before 5 April.",
    },
    {
        "id": "premium-bonds",
        "topic": "Saving",
        "icon": "🎲",
        "title": "Premium Bonds: tax-free prizes, no guaranteed return",
        "body": "Instead of interest, Premium Bonds enter you into a monthly prize draw (£25 up to £1 million), all tax-free, with your capital backed by the government. The catch: many months you may win nothing, so the average return can trail a good savings account. Max holding is £50,000.",
        "takeaway": "Safe and tax-free, but returns aren't guaranteed.",
    },
    {
        "id": "marriage-allowance",
        "topic": "Tax",
        "icon": "💍",
        "title": "Couples can share unused tax allowance",
        "body": "If one partner earns under the £12,570 personal allowance and the other is a basic-rate taxpayer, Marriage Allowance lets you transfer £1,260 of allowance, worth up to £252 a year off your tax bill. You can also backdate claims by up to four years.",
        "takeaway": "Up to £252/year if one partner is a low earner.",
    },
    {
        "id": "conscious-spending-plan",
        "topic": "Budgeting",
        "icon": "🧭",
        "title": "Ramit Sethi's Conscious Spending Plan: four buckets for take-home pay",
        "body": "The Conscious Spending Plan, from Ramit Sethi's book I Will Teach You To Be Rich, splits take-home pay into four buckets: fixed costs (50-60%), investments (10%), savings goals (5-10%) and guilt-free spending (20-35%). It's a US framework, so his 401(k) and Roth IRA map loosely onto a UK workplace pension and ISA, and the percentages are his suggested starting points, not fixed rules everyone should hit.",
        "takeaway": "The useful part is the shape, roughly how pay splits between jobs, not the exact numbers. The app shows your own shape on Insights and doesn't grade it against these ranges.",
    },
    {
        "id": "fifty-thirty-twenty",
        "topic": "Budgeting",
        "icon": "📐",
        "title": "The 50/30/20 rule: needs, wants, savings",
        "body": "Popularised by US senator Elizabeth Warren in the book All Your Worth, the 50/30/20 rule splits after-tax income into three bands: 50% needs (rent or mortgage, bills, groceries, minimum debt payments), 30% wants (eating out, subscriptions, holidays) and 20% savings or extra debt repayment. A common criticism, especially in UK cities, is that rent or mortgage alone can eat past 50% of take-home pay, before any other need is counted.",
        "takeaway": "It's a rough starting point for thinking about proportions, not a target to hit exactly.",
    },
    {
        "id": "pay-yourself-first",
        "topic": "Saving",
        "icon": "⏩",
        "title": "Pay yourself first: move money to savings before you spend",
        "body": "Pay yourself first means moving a slice of your income into savings the moment it lands, on payday, before any spending happens, rather than saving whatever is left at the end of the month. The idea is behavioural: once the transfer happens automatically, there's no daily decision to make and no temptation to skip it.",
        "takeaway": "It's the same logic behind the app's Payday Plan, which groups that payday transfer into one step rather than leaving it to memory.",
    },
    {
        "id": "pension-carry-forward",
        "topic": "Pensions",
        "icon": "⏳",
        "title": "Unused pension allowance can carry forward 3 years",
        "body": "The annual pension allowance is £60,000, but if you didn't use it all in the previous 3 tax years, you can carry the unused amount forward, provided you were a member of a registered pension scheme in those years and have enough relevant earnings to support the contribution. Carry-forward is only used once this year's £60,000 allowance is exhausted, oldest unused year first. Allowance older than 3 tax years back is lost for good.",
        "takeaway": "Check the last 3 tax years' unused allowance before assuming £60,000 is the ceiling.",
    },
    {
        "id": "salary-sacrifice",
        "topic": "Tax",
        "icon": "🔄",
        "title": "Salary sacrifice lowers pay before tax and National Insurance",
        "body": "Salary sacrifice means agreeing to give up part of your gross salary in exchange for a non-cash benefit, most often extra pension contributions, but also schemes like cycle to work or an electric car. Because the sacrificed amount never counts as pay, it reduces income tax and National Insurance for both you and your employer, and it lowers adjusted net income, which is what the personal allowance taper and the Child Benefit charge are measured against. A sacrificed pension contribution still counts towards the £60,000 annual allowance like any other contribution.",
        "takeaway": "It reduces taxable pay directly, rather than paying tax on it and claiming relief back afterwards.",
    },
    {
        "id": "gift-aid",
        "topic": "Tax",
        "icon": "🎗️",
        "title": "Gift Aid turns an £80 donation into £100",
        "body": "Gift Aid lets a UK charity reclaim basic-rate tax on your donation, so an £80 gift becomes £100 in the charity's hands at no extra cost to you. If you pay higher or additional-rate tax, you can claim back the difference between your rate and basic rate when you file a self-assessment return. The grossed-up amount, the £100, not the £80 you actually paid, is also what reduces adjusted net income for the personal allowance taper and the Child Benefit high income charge.",
        "takeaway": "The grossed-up figure, not what you actually paid, is what counts against the taper and the Child Benefit charge.",
    },
]

# Topics that belong to the post-buffer "grow your money" stage.
GROW_TOPICS = {"ISAs", "Investing", "Pensions"}
