"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PhosphorNavIcon from "@/components/navigation/PhosphorNavIcon";
import PennyMark from "@/components/PennyMark";
import { ICON_GEOMETRY } from "@/lib/category-icons/iconGeometry";
import { HOME, STATES, money, previewState } from "./fixtures";
import { GLYPHS } from "./phosphor";
import styles from "./preview.module.css";

type Variant = "a" | "b";
type Mode = "light" | "dark";
type Glyph = keyof typeof GLYPHS | keyof typeof ICON_GEOMETRY;

function Icon({ name, size = 20 }: { name: Glyph; size?: number }) {
  const paths = name in GLYPHS
    ? GLYPHS[name as keyof typeof GLYPHS]
    : ICON_GEOMETRY[name as keyof typeof ICON_GEOMETRY];
  return <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false" data-phosphor-icon={name} data-phosphor-weight="regular">
    {paths.map((path, index) => <path key={index} d={path.d} />)}
  </svg>;
}

const destinations = [
  { tab: "home", label: "Home", href: "/" },
  { tab: "spend", label: "Spend", href: "/spend?view=period" },
  { tab: "upcoming", label: "Upcoming", href: "/upcoming" },
  { tab: "planning", label: "Planning", href: "/planning" },
] as const;

function Navigation() {
  return <>
    <div className={styles.sidebar} role="complementary" aria-label="Desktop navigation">
      <Link href="/" className={styles.wordmark}>Sorted<span aria-hidden="true">.</span></Link>
      <nav aria-label="Primary">
        {destinations.map(item => <Link key={item.tab} href={item.href} aria-current={item.tab === "home" ? "page" : undefined}>
          <PhosphorNavIcon tab={item.tab} selected={item.tab === "home"} appearance="ink" />
          {item.label}
        </Link>)}
        <Link href="/settings"><Icon name="gear-six" size={24} />Settings</Link>
      </nav>
      <Link href="/penny" className={styles.pennyDesktop}><PennyMark size={26} aria-hidden="true" />Ask Penny</Link>
    </div>
    <nav className={styles.mobileNav} aria-label="Primary">
      {destinations.slice(0, 2).map(item => <Link key={item.tab} href={item.href} aria-current={item.tab === "home" ? "page" : undefined}>
        <PhosphorNavIcon tab={item.tab} selected={item.tab === "home"} appearance="ink" /><span>{item.label}</span>
      </Link>)}
      <Link href="/penny" className={styles.pennyMobile} aria-label="Penny"><PennyMark size={26} aria-hidden="true" /></Link>
      {destinations.slice(2).map(item => <Link key={item.tab} href={item.href}>
        <PhosphorNavIcon tab={item.tab} selected={false} appearance="ink" /><span>{item.label}</span>
      </Link>)}
    </nav>
  </>;
}

function Identity({ initials }: { initials: string | null }) {
  return <span className={styles.identity} aria-hidden="true">
    {initials ? <span>{initials}</span> : <Icon name="user-circle" size={24} />}
    <span className={styles.gear}><Icon name="gear-six" size={12} /></span>
  </span>;
}

function Header({ variant, loading, name, initials }: {
  variant: Variant;
  loading: boolean;
  name: string | null;
  initials: string | null;
}) {
  const greeting = <h1 id="home-greeting" className={styles.greeting}>
    <span>Good morning{loading || name ? "," : ""}</span>
    {loading ? <><span className={styles.namePlaceholder} aria-hidden="true" /><span className={styles.srOnly}>Name loading</span></> : name ? <span className={styles.firstName}>{name}</span> : null}
  </h1>;

  return <header className={`${styles.header} ${variant === "a" ? styles.compactHeader : styles.labelledHeader}`} aria-labelledby="home-greeting" data-header-variant={variant}>
    {greeting}
    <nav aria-label="Home shortcuts" className={variant === "a" ? styles.compactControls : styles.labelledControls}>
      <Link href="/settings" aria-label="Account and settings" className={styles.headerControl}>
        <span className={styles.controlFace}><Identity initials={initials} /></span>
        <span className={styles.controlLabel}>Settings</span>
        {variant === "b" && <Icon name="caret-right" size={14} />}
      </Link>
      <Link href="/accounts" aria-label="Your accounts" className={styles.headerControl}>
        <span className={styles.controlFace}><Icon name="bank" size={24} /></span>
        <span className={styles.controlLabel}>Accounts</span>
        {variant === "b" && <Icon name="caret-right" size={14} />}
      </Link>
    </nav>
  </header>;
}

function Disclosure({ title, amount, children }: { title: string; amount?: string; children: React.ReactNode }) {
  return <details className={styles.disclosure}>
    <summary><span className={styles.disclosureContent}><span>{title}</span>{amount && <span className={styles.money}>{amount}</span>}<Icon name="caret-down" size={16} /></span></summary>
    <div className={styles.disclosureBody}>{children}</div>
  </details>;
}

function HomeContext({ hidden, onHiddenChange }: { hidden: boolean; onHiddenChange: () => void }) {
  const amount = (value: number, exact = false) => money(value, hidden, exact);
  return <div className={styles.homeGrid}>
    <div className={styles.column}>
      <section className={styles.hero} aria-labelledby="estimate-label">
        <div className={styles.heroTop}>
          <h2 id="estimate-label" className={styles.eyebrow}>Estimated left to spend</h2>
          <span className={styles.status}><Icon name="check" size={13} />Looks on track</span>
        </div>
        <p className={`${styles.money} ${styles.heroAmount}`}>{amount(HOME.estimate)}</p>
        <p className={styles.body}>Until payday on {HOME.payday}, after known bills, plans and your buffer.</p>
        <p className={styles.caption}>Based on your connected current accounts and the bills Sorted knows about.</p>
        <div className={styles.spendFrom}>
          <h3 className={styles.smallTitle}>Spend from</h3>
          {HOME.accounts.map(account => <div className={styles.spendRow} key={account.name}>
            <span className={styles.bankBadge} aria-hidden="true"><Icon name="bank" size={16} /></span>
            <span>{account.name}</span>
            <span className={styles.money}>{amount(account.available, true)}</span>
          </div>)}
        </div>
      </section>
      <div className={styles.disclosures}>
        <Disclosure title="What this estimate counts">
          <p>It doesn’t include other accounts, payments still pending, or bills Sorted hasn’t spotted yet.</p>
          <p>An estimate from your bank data. It can be wrong, so check your bank for your latest balance. Not financial advice.</p>
        </Disclosure>
        <Disclosure title="How we got this" amount={amount(HOME.estimate)}>
          <dl className={styles.ledger}>
            <div><dt>Cash available now</dt><dd className={styles.money}>{amount(HOME.cash)}</dd></div>
            <div><dt>Known payments before payday</dt><dd className={styles.money}>{amount(-HOME.bills)}</dd></div>
            <div><dt>Plans and set-asides</dt><dd className={styles.money}>{amount(-HOME.plans)}</dd></div>
            <div><dt>Spending buffer</dt><dd className={styles.money}>{amount(-HOME.buffer)}</dd></div>
            <div className={styles.ledgerTotal}><dt>Estimated left to spend</dt><dd className={styles.money}>{amount(HOME.estimate)}</dd></div>
          </dl>
        </Disclosure>
        <Disclosure title="Card spending this pay period" amount={amount(186)}>
          <p>Known card repayments due before payday are included in your estimate. Card purchases aren’t deducted again.</p>
          <Link className={styles.textLink} href="/accounts?filter=credit">See your cards<Icon name="caret-right" size={14} /></Link>
        </Disclosure>
      </div>
      <section className={styles.section} aria-labelledby="money-label">
        <h2 id="money-label" className={styles.sectionLabel}>Your money</h2>
        <article className={styles.card}>
          <p className={styles.smallTitle}><Icon name="credit-card" size={16} />Your cards</p>
          <h3 className={styles.cardHeading}>You owe more on your cards than 3 months ago. None of it has interest right now.</h3>
          <p className={`${styles.money} ${styles.cardAmount}`}>{amount(420)}</p>
          <p className={styles.caption}>more than 3 months ago</p>
          <p className={styles.body}>There’s <span className={styles.money}>{amount(3720)}</span> on 2 cards. None of it has interest right now.</p>
          <Link href="/planning#cards" className={styles.secondaryAction}>See the route<Icon name="caret-right" size={16} /></Link>
        </article>
      </section>
    </div>
    <div className={styles.column}>
      <section className={styles.section} aria-labelledby="estate-label">
        <h2 id="estate-label" className={styles.sectionLabel}>Your accounts</h2>
        <div className={styles.accountCard}>
          {HOME.accounts.map(account => <Link href="/accounts" className={styles.accountRow} key={account.name}>
            <span className={styles.bankBadge} aria-hidden="true"><Icon name="bank" size={22} /></span>
            <span className={styles.accountIdentity}><span className={styles.smallTitle}>{account.name}</span><span className={styles.caption}>{account.provider} · Current</span></span>
            <span className={styles.accountFigures}><span className={styles.money}>{amount(account.balance)}</span><span className={styles.caption}>Available: <span className={styles.money}>{amount(account.available)}</span></span></span>
          </Link>)}
          <Link href="/accounts" className={styles.cardFooter}>All 2 accounts<Icon name="caret-right" size={14} /></Link>
        </div>
      </section>
      <section className={styles.section} aria-labelledby="transactions-label">
        <h2 id="transactions-label" className={styles.sectionLabel}>Recent transactions</h2>
        <div className={styles.accountCard}>
          {HOME.transactions.map(transaction => <Link href="/transactions" className={styles.transactionRow} key={transaction.name}>
            <span className={styles.categoryIcon} data-category={transaction.category} aria-hidden="true"><Icon name={transaction.icon} size={18} /></span>
            <span className={styles.accountIdentity}><span className={styles.smallTitle}>{transaction.name}</span><span className={styles.caption}>{transaction.category} · {transaction.date}</span></span>
            <span className={styles.money}>{amount(transaction.amount, true)}</span>
          </Link>)}
          <Link href="/transactions" className={styles.cardFooter}>All transactions<Icon name="caret-right" size={14} /></Link>
        </div>
      </section>
      <div className={styles.privacyRow}>
        <button type="button" onClick={onHiddenChange} aria-pressed={hidden}>
          <Icon name={hidden ? "eye-slash" : "eye"} size={18} />{hidden ? "Show balances" : "Hide balances"}
        </button>
        <span className={styles.caption} role="status">{hidden ? "Balances hidden" : "Updated just now"}</span>
      </div>
    </div>
  </div>;
}

export default function HomeHeaderControls({ variant, mode, state: requestedState, chrome }: {
  variant: Variant;
  mode: Mode;
  state: string;
  chrome: boolean;
}) {
  const state = previewState(requestedState);
  const [hiddenOverride, setHiddenOverride] = useState<boolean | null>(null);
  const hidden = hiddenOverride ?? state === "hidden";
  const loading = state === "loading";
  const name = state === "unnamed" ? null : state === "long" ? HOME.longName : HOME.firstName;
  const href = (next: { variant?: Variant; mode?: Mode; state?: string }) => `?${new URLSearchParams({ variant, mode, state, ...next })}`;

  useEffect(() => {
    const root = document.documentElement;
    const previousScheme = root.style.colorScheme;
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousColour = themeMeta?.content;
    root.style.colorScheme = mode;
    if (themeMeta) themeMeta.content = mode === "dark" ? "#0f172a" : "#f0f2f7";
    return () => {
      root.style.colorScheme = previousScheme;
      if (themeMeta && previousColour !== undefined) themeMeta.content = previousColour;
    };
  }, [mode]);

  return <div className={styles.preview} data-theme={mode} style={{ colorScheme: mode }} lang="en-GB">
    <a href="#home-preview" className={styles.skipLink}>Skip to Home preview</a>
    {chrome && <section className={styles.reviewBar} aria-label="Design review controls">
      <Link href="/design" className={styles.backLink}>All previews</Link>
      <details className={styles.reviewControls}>
        <summary>Home header · {variant.toUpperCase()} · {mode === "light" ? "Light" : "Dark"}<Icon name="caret-down" size={16} /></summary>
        <div className={styles.reviewBody}>
          <h2>Home header controls</h2>
          <p>Fictional data. The same Home page with two header options.</p>
          <nav aria-label="Header option" className={styles.reviewOptions}>
            <Link href={href({ variant: "a" })} aria-current={variant === "a" ? "page" : undefined}>A · Compact pair</Link>
            <Link href={href({ variant: "b" })} aria-current={variant === "b" ? "page" : undefined}>B · Labelled row</Link>
          </nav>
          <p>{variant === "a" ? "Two matching shortcuts beside a greeting on two lines. Both destinations have visible labels." : "A full-width greeting above two equal, labelled shortcuts. More space for names, with a taller header."}</p>
          <nav aria-label="Theme" className={styles.reviewOptions}>
            <Link href={href({ mode: "light" })} aria-current={mode === "light" ? "page" : undefined}>Light</Link>
            <Link href={href({ mode: "dark" })} aria-current={mode === "dark" ? "page" : undefined}>Dark</Link>
          </nav>
          <nav aria-label="Example state" className={styles.reviewOptions}>
            {STATES.map(example => <Link key={example.value} href={href({ state: example.value })} aria-current={state === example.value ? "page" : undefined}>{example.label}</Link>)}
          </nav>
          <p>Settings opens Account and settings. Accounts opens Your accounts. Preview balance controls only change this example.</p>
        </div>
      </details>
    </section>}
    <Navigation />
    <main id="home-preview" className={styles.home} tabIndex={-1}>
      <Header variant={variant} loading={loading} name={name} initials={loading || state === "unnamed" ? null : HOME.initials} />
      <p className={styles.pennyLine}><PennyMark size={16} aria-hidden="true" /><span>Your payments look covered before payday.</span></p>
      <HomeContext hidden={hidden} onHiddenChange={() => setHiddenOverride(!hidden)} />
    </main>
  </div>;
}
