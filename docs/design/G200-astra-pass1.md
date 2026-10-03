## Shared foundation

All three directions ship the **real setting available today: an account allow-list**. Order and the £10 buffer are read-only. None introduces a drag handle or stepper that implies otherwise.

The fixture contains **five** accounts that cannot help right now, not ten. The designs accommodate ten or more without changing the saved choices or expanding the default view.

**Implementation conventions**
- Mount on the Settings canvas or directly below a drill-in page’s navigation. No surrounding card.
- Use Figtree throughout. `.money` uses JetBrains Mono and tabular numerals.
- The existing `Toggle` must provide a 44px target, keyboard operation and switch semantics.
- Secondary text uses slightly stronger slate tones where necessary for AA contrast. Pale muted colours are reserved for non-essential decoration.
- Balances are account balances, **not** calculated amounts available for cover.
- Manual accounts use a wallet icon. Their account class, not their connection method, determines their position.

The following fixture and primitives are shared by the JSX examples.

```jsx
import { useId, useState } from "react";
import {
  AlertCircle, ChevronDown, Landmark, ShieldCheck, Wallet
} from "lucide-react";

// Toggle and BankBadge are existing Sorted components.
const ACCOUNTS = [
  { id: "everyday", name: "Everyday household joint current account",
    bank: "Barclays", kind: "current", balance: 610 },
  { id: "monzo", name: "Monzo current",
    bank: "Monzo", kind: "current", balance: 260 },
  { id: "bills", name: "Bills account",
    bank: "Starling", kind: "current", balance: -35, reason: "needsMoney" },
  { id: "petty", name: "Petty cash tin",
    manual: true, kind: "current", balance: 120 },

  { id: "rainy", name: "Rainy day",
    bank: "NatWest", kind: "savings", balance: 2390 },
  { id: "emergency", name: "Emergency fund",
    bank: "Chase", kind: "savings", balance: 3400 },
  { id: "isa", name: "ISA",
    bank: "NatWest", kind: "savings", balance: 1200 },
  { id: "house", name: "House deposit",
    bank: "NatWest", kind: "savings", balance: 5200, defaultOff: true },
  { id: "wedding", name: "Wedding fund",
    bank: "Starling", kind: "savings", balance: 890, defaultOff: true },
  { id: "car", name: "Car fund", kind: "savings", balance: 150 },
  { id: "gift", name: "Gift fund", kind: "savings", balance: 60 },
  { id: "christmas", name: "Christmas pot", kind: "savings", balance: 40 },
  { id: "reserve", name: "Cash reserve",
    manual: true, kind: "savings", balance: 790 },
  ...["Groceries", "Transport", "Round up", "Holiday"].map(name => ({
    id: name.toLowerCase().replaceAll(" ", "-"),
    name, bank: "Monzo", kind: "savings", balance: 0, reason: "zero"
  }))
];

const focus =
  "focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-[#4f46e5] focus-visible:ring-offset-2 " +
  "dark:focus-visible:ring-offset-[#1e293b]";

const secondary = "text-slate-600 dark:text-slate-300";
const link =
  "inline-flex min-h-11 items-center rounded-xl text-sm font-semibold " +
  "text-[#4f46e5] dark:text-indigo-300 " + focus;

function pounds(value) {
  return `${value < 0 ? "−" : ""}£${Math.abs(value).toLocaleString("en-GB")}`;
}

function useCover(accounts) {
  const [allowed, setAllowed] = useState(
    () => new Set(accounts.filter(a => !a.defaultOff).map(a => a.id))
  );
  function setAccount(id, checked) {
    setAllowed(previous => {
      const next = new Set(previous);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  }
  const on = accounts.filter(a => allowed.has(a.id));
  const off = accounts.filter(a => !allowed.has(a.id));
  return { allowed, setAccount, on, off };
}

function Frame({ title, intro, children }) {
  return (
    <section
      className="mx-auto w-full max-w-[390px] bg-[#f0f2f7] p-4
                 font-[Figtree] text-[#0f172a]
                 dark:bg-[#0f172a] dark:text-[#f1f5f9]"
    >
      <header className="mb-3">
        <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${secondary}`}>
          Cover settings
        </p>
        <h2 className="mt-1 text-base font-bold">{title}</h2>
        <p className={`mt-1 text-sm leading-5 ${secondary}`}>{intro}</p>
      </header>
      <div className="rounded-2xl border border-[#f1f5f9] bg-white
                      dark:border-[#334155] dark:bg-[#1e293b]">
        {children}
      </div>
    </section>
  );
}

function Disclosure({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="border-t border-[#f1f5f9] dark:border-[#334155]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className={`flex min-h-11 w-full items-center justify-between
                    gap-3 rounded-xl py-3 text-left text-sm font-semibold ${focus}`}
      >
        <span>{title}</span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 transition-transform duration-200
                      motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        id={id}
        aria-hidden={!open}
        inert={!open}
        className={`grid transition-[grid-template-rows] duration-200
                    motion-reduce:transition-none
                    ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

function Rules() {
  return (
    <div className={`space-y-2 pb-4 text-[13px] leading-5 ${secondary}`}>
      <p>These rules are fixed. You choose which accounts Sorted may consider.</p>
      <p>Current accounts come first. Savings are considered only if all
        allowed current accounts together cannot cover the amount.</p>
      <p>Within each group, accounts with the most money available after
        protections come first. Sorted prefers using fewer accounts.</p>
      <p>Every source keeps £10. Its own bills and set-asides stay protected.</p>
      <p>Manual accounts follow the same rules in their own account group.
        You would make any suggested transfer yourself.</p>
    </div>
  );
}

function AccountRow({ account: a, model }) {
  const checked = model.allowed.has(a.id);
  const reason = a.reason === "needsMoney"
    ? "Not usable right now. This account needs money itself."
    : a.reason === "zero"
      ? "Not usable right now. Balance is £0."
      : null;

  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)_84px] gap-x-2
                   gap-y-1 border-t border-[#f1f5f9] py-3
                   dark:border-[#334155]">
      <span aria-hidden="true" className="flex size-7 items-center justify-center">
        {a.manual ? <Wallet className="size-5" /> :
          a.bank ? <BankBadge provider={a.bank} /> :
          <Landmark className="size-5" />}
      </span>

      <div className="min-w-0">
        <p className="break-words text-sm font-semibold leading-5">{a.name}</p>
        <p className={`text-xs leading-5 ${secondary}`}>
          {a.manual ? "Manual transfer" : a.bank || "Savings pot"}
        </p>
      </div>

      <p
        aria-label={`Balance ${pounds(a.balance)}`}
        className="money text-right font-['JetBrains_Mono'] text-[13px]
                   leading-5 tabular-nums"
      >
        {pounds(a.balance)}
      </p>

      <div className="col-start-2 col-span-2 flex items-center justify-between gap-3">
        <span className={`text-xs ${secondary}`}>
          {checked ? "Allowed for cover" : "Turned off by you"}
        </span>
        <span className="flex min-h-11 min-w-11 items-center justify-center
                         rounded-xl focus-within:ring-2 focus-within:ring-[#4f46e5]">
          <Toggle
            checked={checked}
            onChange={value => model.setAccount(a.id, value)}
            label={`Allow ${a.name} for cover`}
          />
        </span>
      </div>

      {reason && (
        <p className={`col-start-2 col-span-2 text-xs leading-5 ${secondary}`}>
          {reason}
        </p>
      )}
    </li>
  );
}

function Rows({ accounts, model }) {
  return (
    <ul>
      {accounts.map(a => <AccountRow key={a.id} account={a} model={model} />)}
    </ul>
  );
}

function Search({ value, onChange }) {
  const id = useId();
  return (
    <div className="py-3">
      <label htmlFor={id} className="mb-2 block text-sm font-semibold">
        Find an account
      </label>
      <input
        id={id}
        type="search"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder="Name or provider"
        className={`min-h-11 w-full rounded-xl border border-slate-300
                    bg-transparent px-3 text-sm placeholder:text-slate-500
                    dark:border-slate-500 dark:placeholder:text-slate-400 ${focus}`}
      />
    </div>
  );
}

function matches(account, query) {
  return `${account.name} ${account.bank || ""} ${account.manual ? "manual" : ""}`
    .toLowerCase().includes(query.trim().toLowerCase());
}

function StateNotice({ accounts, model }) {
  if (!accounts.length) return (
    <div className="py-4">
      <p className="text-sm font-semibold">Add an account to set up cover.</p>
      <p className={`mt-1 text-sm ${secondary}`}>
        Then choose which accounts Sorted may use.
      </p>
      <a href="/accounts/add" className={link}>Add an account</a>
    </div>
  );

  if (!model.on.length) return (
    <div role="status" className="flex gap-2 py-3">
      <AlertCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[#ef4444]" />
      <p className="text-sm leading-5">
        No accounts are allowed. A future gap would have no cover source.
        Choose an account to allow below.
      </p>
    </div>
  );

  if (model.on.every(a => a.reason)) return (
    <p role="status" className={`py-3 text-sm leading-5 ${secondary}`}>
      Your choices are saved. None of your allowed accounts can help right now.
      Review any turned-off accounts, or check again later.
    </p>
  );

  return null;
}
```

List order is for browsing, not a claim about engine ranking. Within each account class, the engine’s ranking changes with protected funds.

---

## 1. Permission slip

**Art direction:** An exception-led setting, almost editorial in its restraint. The canvas explains the intent. Inside one white or dark-slate surface, a plain verdict leads, followed by the two exceptions and a single management doorway. No bank badges appear until the user opens the account list. Indigo is reserved for the route forward and switches.

1. **Choice:** Allow-list only, real today. Current-first ordering and the £10 buffer are stated as fixed rules, not editable controls.
2. **Current answer:** No live move or availability total in Settings. Use the exact link “See today's suggestion on Upcoming”.
3. **Not usable right now:** Plain explanatory text beside a still-operable toggle. Availability never changes the saved permission.

```jsx
function PermissionSlip({ accounts = ACCOUNTS }) {
  const model = useCover(accounts);
  const [query, setQuery] = useState("");
  const results = accounts.filter(a => matches(a, query));

  return (
    <Frame
      title="Choose where cover can come from"
      intro="Keep the accounts you are happy to use switched on."
    >
      <div className="px-4">
        <StateNotice accounts={accounts} model={model} />

        {!!accounts.length && (
          <>
            <div className="py-4">
              <h3 className="text-base font-bold">
                {model.on.length} accounts allowed for cover
              </h3>
              <p className={`mt-1 text-sm leading-5 ${secondary}`}>
                {model.off.length
                  ? `Turned off: ${model.off.map(a => a.name).join(", ")}.`
                  : "Nothing turned off. Every account may be considered."}
              </p>
            </div>

            <Disclosure title="Current accounts first. £10 kept in each source.">
              <Rules />
            </Disclosure>

            <Disclosure
              title={`Manage ${accounts.length} accounts`}
              defaultOpen={!model.on.length}
            >
              <p className={`text-xs leading-5 ${secondary}`}>
                Your switch is a saved choice, not a statement about today.
                Balances shown are not cover amounts.
              </p>
              <Search value={query} onChange={setQuery} />

              {!results.length && (
                <p className={`pb-4 text-sm ${secondary}`}>
                  No accounts match. Try another name or provider.
                </p>
              )}

              {[
                ["current", "Current accounts"],
                ["savings", "Savings pots"]
              ].map(([kind, label]) => {
                const group = results.filter(a => a.kind === kind);
                return group.length ? (
                  <Disclosure
                    key={`${kind}-${Boolean(query)}`}
                    title={`${label} · ${group.length} accounts`}
                    defaultOpen={kind === "current" || Boolean(query)}
                  >
                    <Rows accounts={group} model={model} />
                  </Disclosure>
                ) : null;
              })}
            </Disclosure>

            <div className="border-t border-[#f1f5f9] py-1 dark:border-[#334155]">
              <a href="/upcoming" className={link}>
                See today's suggestion on Upcoming
              </a>
            </div>
          </>
        )}
      </div>
    </Frame>
  );
}
```

**Empty / edge states**
- **Nothing turned off:** “Nothing turned off. Every account may be considered.” Keep account management collapsed.
- **Everything turned off:** Red risk icon with the shared warning. Open management on entry. Never automatically restore permissions.
- **Only not-usable accounts allowed:** Show the neutral saved-choices notice. The Upcoming link remains available.
- **0 accounts:** Replace the settings controls with “Add an account to set up cover.” and **Add an account**.

---

## 2. The cover route

**Art direction:** A compact, vertical route map. Large, quiet step numbers establish the engine’s two-stage order, with expandable account lists directly beneath each stage. A final shield row holds the protections. This is the most explanatory direction, but the explanation is structural rather than a paragraph-heavy help panel. No connecting gradient, decorative colour or nested cards.

1. **Choice:** Switch accounts on or off within their real class. The numbered order and £10 safeguard are read-only, real today.
2. **Current answer:** A quiet, derived availability sentence, not a move: “Today, 10 allowed accounts could help with cover.” No starting account is inferred from balances.
3. **Not usable right now:** Accounts stay in their own class with their switches intact. Reasons use neutral slate text, including the −£35 balance.

```jsx
function CoverRoute({ accounts = ACCOUNTS }) {
  const model = useCover(accounts);
  const available = model.on.filter(a => !a.reason);
  const unavailable = model.on.filter(a => a.reason);

  const stages = [
    {
      kind: "current",
      title: "Current accounts first",
      copy: "Sorted considers your allowed current accounts first."
    },
    {
      kind: "savings",
      title: "Savings only if needed",
      copy: "Savings are considered only if all allowed current accounts " +
            "together cannot cover the amount."
    }
  ];

  return (
    <Frame
      title="Your cover route"
      intro="Choose the accounts. Sorted works out which ones to suggest."
    >
      <div className="px-4">
        <StateNotice accounts={accounts} model={model} />

        {!!accounts.length && (
          <>
            <div className="py-4">
              <h3 className="text-base font-bold">
                {model.on.length} accounts allowed for cover
              </h3>
              {!!available.length && (
                <p className={`mt-1 text-[13px] leading-5 ${secondary}`}>
                  Today, {available.length} allowed accounts could help with cover.
                </p>
              )}
              {!!unavailable.length && (
                <p className={`mt-1 text-xs leading-5 ${secondary}`}>
                  {unavailable.length} allowed accounts cannot help right now.
                  Your choices have not changed.
                </p>
              )}
            </div>

            <ol>
              {stages.map((stage, index) => {
                const group = accounts.filter(a => a.kind === stage.kind);
                const count = group.filter(a => model.allowed.has(a.id)).length;

                return (
                  <li
                    key={stage.kind}
                    className="grid grid-cols-[28px_minmax(0,1fr)] gap-2
                               border-t border-[#f1f5f9] py-4
                               dark:border-[#334155]"
                  >
                    <span aria-hidden="true"
                          className={`text-xl font-semibold ${secondary}`}>
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold">{stage.title}</h3>
                      <p className={`mt-1 text-[13px] leading-5 ${secondary}`}>
                        {stage.copy}
                      </p>
                      <Disclosure
                        title={`${count} allowed · Review ${group.length} accounts`}
                      >
                        <Rows accounts={group} model={model} />
                      </Disclosure>
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-2
                            border-t border-[#f1f5f9] py-4
                            dark:border-[#334155]">
              <ShieldCheck aria-hidden="true" className="size-5" />
              <div>
                <h3 className="text-sm font-semibold">£10 stays in every source</h3>
                <p className={`mt-1 text-[13px] leading-5 ${secondary}`}>
                  Its own bills and set-asides stay protected.
                </p>
                <p className={`mt-2 text-[13px] leading-5 ${secondary}`}>
                  Within each group, accounts with the most money available
                  after protections come first. Sorted prefers using fewer accounts.
                </p>
                <p className={`mt-2 text-xs leading-5 ${secondary}`}>
                  These rules are fixed. Manual accounts follow their own group.
                  You would make any suggested transfer yourself.
                </p>
              </div>
            </div>

            <a href="/upcoming" className={`${link} mb-2`}>
              See today's suggestion on Upcoming
            </a>
          </>
        )}
      </div>
    </Frame>
  );
}
```

**Empty / edge states**
- **Nothing turned off:** The verdict becomes “17 accounts allowed for cover”. Both review sections remain collapsed.
- **Everything turned off:** Show the red risk icon and warning above the two stages. Each review button remains available.
- **Only not-usable accounts allowed:** Replace the availability prediction with the neutral saved-choices notice. Keep all account permissions unchanged.
- **0 accounts:** Hide the route and show **Add an account**. A route without sources would imply more capability than exists.

---

## 3. The permission ledger

**Art direction:** A tool-like account ledger, designed for someone arriving with a specific account in mind. Search and a compact filter rail are always visible. The initial view shows the two user-made exceptions, not fifteen permitted accounts. Full-width rows make long names and money figures easier to scan. This direction feels most at home on a dedicated drill-in page while remaining bounded inline.

1. **Choice:** Searchable allow-list with explicit **Turned off**, **Allowed** and **All** views. Fixed ordering and buffer remain visible above the controls.
2. **Current answer:** No live move and no live availability verdict. Upcoming owns the suggestion; Settings owns permission.
3. **Not usable right now:** A secondary reason on the account row, independent of the permission filter. No separate state bucket and no disabled switch.

```jsx
function PermissionLedger({ accounts = ACCOUNTS }) {
  const model = useCover(accounts);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("off");

  const views = [
    { id: "off", label: "Turned off", accounts: model.off },
    { id: "on", label: "Allowed", accounts: model.on },
    { id: "all", label: "All", accounts }
  ];
  const selected = views.find(view => view.id === filter);
  const results = selected.accounts.filter(a => matches(a, query));
  const visible = results.slice(0, 4);
  const remaining = results.slice(4);

  return (
    <Frame
      title="Accounts for cover"
      intro="Turn off any account you do not want Sorted to suggest using."
    >
      <div className="px-4">
        <StateNotice accounts={accounts} model={model} />

        {!!accounts.length && (
          <>
            <div className="py-4">
              <h3 className="text-base font-bold">
                {model.off.length
                  ? `${model.off.length} accounts turned off`
                  : "All accounts allowed"}
              </h3>
              <p className={`mt-1 text-[13px] leading-5 ${secondary}`}>
                Current accounts first. £10 kept in every source.
              </p>
            </div>

            <Disclosure title="Read the fixed cover rules">
              <Rules />
            </Disclosure>

            <Search value={query} onChange={setQuery} />

            <div aria-label="Filter accounts"
                 className="flex gap-1 border-b border-[#f1f5f9] pb-3
                            dark:border-[#334155]">
              {views.map(view => (
                <button
                  key={view.id}
                  type="button"
                  aria-pressed={filter === view.id}
                  onClick={() => setFilter(view.id)}
                  className={`min-h-11 flex-1 rounded-xl border px-2
                              text-xs font-semibold ${focus}
                    ${filter === view.id
                      ? "border-[#4f46e5] bg-[#4f46e5] text-white"
                      : "border-transparent text-slate-600 dark:text-slate-300"}`}
                >
                  {view.label} {view.accounts.length}
                </button>
              ))}
            </div>

            <p className={`py-3 text-xs leading-5 ${secondary}`}>
              Balances shown are not cover amounts.
              An allowed account may be unable to help today.
            </p>

            <Rows accounts={visible} model={model} />

            {!!remaining.length && (
              <Disclosure
                key={`${filter}-${query}`}
                title={`Show ${remaining.length} more accounts`}
              >
                <Rows accounts={remaining} model={model} />
              </Disclosure>
            )}

            {!results.length && (
              <div role="status" className={`py-4 text-sm leading-5 ${secondary}`}>
                {query.trim()
                  ? "No accounts match. Try another name or provider."
                  : filter === "off"
                    ? "No accounts are turned off. Every account may be considered."
                    : "No accounts are allowed. Open Turned off to choose an account."}
              </div>
            )}

            <div className="border-t border-[#f1f5f9] py-1 dark:border-[#334155]">
              <a href="/upcoming" className={link}>
                See today's suggestion on Upcoming
              </a>
            </div>
          </>
        )}
      </div>
    </Frame>
  );
}
```

**Empty / edge states**
- **Nothing turned off:** “All accounts allowed” leads. The selected Turned off view explains that every account may be considered.
- **Everything turned off:** Show the red risk icon and warning. The initial filter already contains the accounts the user can turn on.
- **Only not-usable accounts allowed:** Show the neutral saved-choices notice above the filters. Do not change the selected filter or switch values.
- **0 accounts:** Hide search and filters. Show **Add an account** rather than an inert account-management interface.

For production, keep a row mounted until focus leaves it when a toggle removes it from the selected filter. Announce, for example, “House deposit allowed for cover.” This prevents keyboard focus disappearing during a change.

---

## Recommendation

Choose **Permission slip** for the default Settings experience. It leads with the saved decision, makes the two exceptions immediately understandable and keeps seventeen accounts behind an intentional action. Use **The permission ledger** if account management gets its own dedicated page. The live move does **not** belong in Settings: it duplicates Home and Upcoming, changes independently of the user’s choice and encourages confusion between permission and current availability. Keep the Upcoming link, show fixed safeguards clearly and explain temporary availability only where the user encounters the affected account.