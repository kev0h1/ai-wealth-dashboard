"use client";

// G264 design round: three slim replacements for the pinned 2x2 jump strip.
// Preview-only until Kevin picks; the default strip (SpendJourneyNav) is
// untouched. Every destination is a real link with a full accessible name and
// aria-current on the active section; all three are phone-only (lg:hidden), the
// desktop summary rail keeps its own strip.
import { useEffect, useRef, useState, type RefObject } from "react";
import { Check, ChevronDown } from "lucide-react";
import SpendJourneyNav, { jumpTo, type SpendJourneyDestination } from "@/components/SpendJourneyNav";

export type SpendRailVariant = "a" | "b" | "c";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

function nameFor(d: SpendJourneyDestination) {
  return `${d.label}${d.summary ? `, ${d.summary}` : ""}${d.needsLook ? ", needs a look" : ""}`;
}

/** Last destination whose top has crossed 38% of the viewport; null above the journey. */
function useJourneyPosition(ids: string[]) {
  const [state, setState] = useState<{ active: string | null }>({ active: null });
  const key = ids.join("|");
  useEffect(() => {
    let raf = 0;
    const compute = () => {
      raf = 0;
      const vh = window.innerHeight;
      let active: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= vh * 0.38) active = id;
      }
      if (ids.length && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) active = ids[ids.length - 1];
      setState((prev) => (prev.active === active ? prev : { active }));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // Sections mount late (charts) and heights change; recheck on a slow beat too.
    const t = window.setInterval(compute, 700);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.clearInterval(t);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** True once the element's bottom edge has scrolled above the top of the viewport. */
function useScrolledPast(ref: RefObject<HTMLElement | null>, edge: "top" | "bottom") {
  const [past, setPast] = useState(false);
  useEffect(() => {
    let raf = 0;
    const compute = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPast((edge === "top" ? r.top : r.bottom) <= 0);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, edge]);
  return past;
}

function LookDot() {
  return (
    <>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-amber-400" />
    </>
  );
}

// ── A: the timeline's own markers, as a slim sticky rail ─────────────────────
function RailA({ destinations }: { destinations: SpendJourneyDestination[] }) {
  // The rail only exists once the journey itself is under the reader: above that it would sit on the hero.
  const { active } = useJourneyPosition(destinations.map((d) => d.id));
  const [reveal, setReveal] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const handled = useRef(false);
  const dragged = useRef(false);
  const startY = useRef(0);
  const pressed = useRef(false);

  const started = active !== null;

  function idAt(clientY: number): string | null {
    const items = Array.from(listRef.current?.children ?? []) as HTMLElement[];
    let best: string | null = null;
    let bestDist = Infinity;
    items.forEach((li, i) => {
      const r = li.getBoundingClientRect();
      const dist = Math.abs(clientY - (r.top + r.height / 2));
      if (dist < bestDist) { bestDist = dist; best = destinations[i].id; }
    });
    return best;
  }

  return (
    <nav
      aria-label="Jump through this pay period"
      className={`fixed left-6 top-[38%] z-30 w-11 lg:hidden ${started ? "" : "pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100"}`}
    >
      <ol
        ref={listRef}
        className="touch-none select-none rounded-full border border-slate-200 bg-white/90 py-1 shadow-sm backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/90 dark:shadow-none"
        onPointerDown={(e) => {
          pressed.current = true; handled.current = false; dragged.current = false; startY.current = e.clientY;
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          setReveal(idAt(e.clientY));
        }}
        onPointerMove={(e) => {
          if (!pressed.current) return;
          if (Math.abs(e.clientY - startY.current) > 6) dragged.current = true;
          setReveal(idAt(e.clientY));
        }}
        onPointerUp={(e) => {
          if (!pressed.current) return;
          pressed.current = false;
          const id = idAt(e.clientY);
          setReveal(null);
          handled.current = true;
          // A pointer jump swallows the click that follows it; clear the flag soon after so a
          // later keyboard or VoiceOver activation is never ignored.
          window.setTimeout(() => { handled.current = false; }, 400);
          const d = destinations.find((x) => x.id === id);
          if (d) jumpTo(d);
        }}
        onPointerCancel={() => { pressed.current = false; setReveal(null); }}
      >
        {destinations.map((d) => {
          const isActive = active === d.id;
          return (
            <li key={d.id} className="relative">
              <a
                href={`#${d.id}`}
                aria-label={nameFor(d)}
                aria-current={isActive ? "location" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  if (handled.current) { handled.current = false; return; }
                  jumpTo(d);
                }}
                className={`group relative flex h-11 w-11 items-center justify-center rounded-full ${FOCUS}`}
              >
                <span
                  aria-hidden="true"
                  className={isActive
                    ? "size-3.5 rounded-full bg-indigo-600 ring-4 ring-indigo-600/20 dark:bg-indigo-400 dark:ring-indigo-400/25"
                    : "size-2 rounded-full bg-slate-400 dark:bg-slate-500"}
                />
                {d.needsLook && <span aria-hidden="true" className="absolute right-2 top-2 size-1.5 rounded-full bg-amber-400" />}
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute left-full top-1/2 ml-2 w-max max-w-[220px] -translate-y-1/2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm dark:border-slate-600 dark:bg-slate-800 ${reveal === d.id ? "block" : "hidden group-focus-visible:block"}`}
                >
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-600 dark:text-slate-400">{d.label}</span>
                  {d.summary && <span className="mt-0.5 block font-mono text-[13px] font-bold tabular-nums text-slate-900 dark:text-white">{d.summary}</span>}
                  {d.needsLook && <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-300"><span className="size-1.5 shrink-0 rounded-full bg-amber-400" />Needs a look</span>}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ── B: chips at the top only, a compact mini-map once they have scrolled away ─
function RailB({ destinations }: { destinations: SpendJourneyDestination[] }) {
  const chipsRef = useRef<HTMLDivElement>(null);
  const gone = useScrolledPast(chipsRef, "bottom");
  const { active } = useJourneyPosition(destinations.map((d) => d.id));
  return (
    <>
      <div ref={chipsRef} className="min-w-0 lg:hidden">
        <SpendJourneyNav destinations={destinations} />
      </div>
      {gone && (
        <nav
          aria-label="Jump through this pay period, compact"
          className="fixed inset-x-0 top-0 z-30 bg-[#f0f2f7]/95 pt-[env(safe-area-inset-top,0px)] backdrop-blur-sm dark:bg-[#0f172a]/95 lg:hidden"
        >
          <ol className="mx-auto flex max-w-6xl px-4">
            {destinations.map((d) => {
              const isActive = active === d.id;
              return (
                <li key={d.id} className="min-w-0 flex-1">
                  <a
                    href={`#${d.id}`}
                    aria-label={nameFor(d)}
                    aria-current={isActive ? "location" : undefined}
                    onClick={(e) => { e.preventDefault(); jumpTo(d); }}
                    className={`relative flex h-11 flex-col items-center justify-center gap-1 ${FOCUS}`}
                  >
                    <span className={`flex items-center gap-1 text-[11px] ${isActive ? "font-bold text-slate-950 dark:text-white" : "font-semibold text-slate-600 dark:text-slate-400"}`}>
                      <span className="truncate">{d.label}</span>
                      {d.needsLook && <LookDot />}
                    </span>
                    <span aria-hidden="true" className={`h-0.5 w-8 rounded-full ${isActive ? "bg-indigo-600 dark:bg-indigo-400" : "bg-slate-300 dark:bg-slate-600"}`} />
                  </a>
                </li>
              );
            })}
          </ol>
          <div aria-hidden="true" className="h-px bg-slate-200/80 dark:bg-slate-700/80" />
        </nav>
      )}
    </>
  );
}

// ── C: one slim row, current section plus a disclosure of every section ──────
function RailC({ destinations }: { destinations: SpendJourneyDestination[] }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const stuck = useScrolledPast(slotRef, "top");
  const { active } = useJourneyPosition(destinations.map((d) => d.id));
  const [open, setOpen] = useState(false);
  const current = destinations.find((d) => d.id === active) ?? null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [open]);

  return (
    <div ref={slotRef} className="h-11 min-w-0 lg:hidden">
      <div className={stuck ? "fixed inset-x-0 top-0 z-30 bg-[#f0f2f7]/95 pt-[env(safe-area-inset-top,0px)] backdrop-blur-sm dark:bg-[#0f172a]/95" : "relative"}>
        <div className={`relative mx-auto max-w-6xl ${stuck ? "px-4 py-1" : ""}`}>
          <button
            ref={buttonRef}
            type="button"
            aria-expanded={open}
            aria-controls={open ? "spend-rail-c-panel" : undefined}
            onClick={() => setOpen((v) => !v)}
            className={`flex h-11 w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none ${FOCUS}`}
          >
            <span className="min-w-0 flex-1 truncate">
              {current ? (
                <>
                  <span className="text-[13px] font-bold text-indigo-700 dark:text-indigo-300">{current.label}</span>
                  {current.summary && <span className="ml-2 font-mono text-[12px] font-bold tabular-nums text-slate-900 dark:text-white">{current.summary}</span>}
                </>
              ) : (
                <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Jump to a section</span>
              )}
            </span>
            <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-slate-600 transition-transform motion-reduce:transition-none dark:text-slate-400 ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <div
              ref={panelRef}
              id="spend-rail-c-panel"
              className={`absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:shadow-none ${stuck ? "mx-4" : ""}`}
            >
              <nav aria-label="Jump through this pay period">
                <ul>
                  {destinations.map((d) => {
                    const isActive = active === d.id;
                    return (
                      <li key={d.id}>
                        <a
                          href={`#${d.id}`}
                          aria-current={isActive ? "location" : undefined}
                          onClick={(e) => { e.preventDefault(); setOpen(false); jumpTo(d); }}
                          className={`flex min-h-12 items-center gap-2 rounded-xl px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 ${FOCUS}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className={`flex items-center gap-1.5 text-[13px] ${isActive ? "font-bold text-indigo-700 dark:text-indigo-300" : "font-semibold text-slate-900 dark:text-white"}`}>
                              {d.label}
                              {d.needsLook && <><LookDot /><span className="sr-only">, needs a look</span></>}
                            </span>
                            {d.summary && <span className="block font-mono text-[12px] tabular-nums text-slate-600 dark:text-slate-400">{d.summary}</span>}
                          </span>
                          {isActive && <Check size={16} aria-hidden="true" className="shrink-0 text-indigo-700 dark:text-indigo-300" />}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Phone rail for the Spend journey. Pass the same destinations the strip gets. */
export default function SpendJourneyRail({ variant, destinations }: { variant: SpendRailVariant; destinations: SpendJourneyDestination[] }) {
  if (destinations.length === 0) return null;
  if (variant === "a") return <RailA destinations={destinations} />;
  if (variant === "b") return <RailB destinations={destinations} />;
  return <RailC destinations={destinations} />;
}
