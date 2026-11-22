import { useEffect, useState } from "react";

/** G488: the Home greeting. Never "there": a signed-in user is greeted by name,
 * by a placeholder while the name is still on its way, or by the bare
 * time-of-day line when the profile has genuinely no first name. */
export interface Greeting {
  /** Text for the heading, with a trailing comma when a name (or the
   * placeholder for one) follows. */
  text: string;
  /** True while the first name is still loading: render a skeleton pill after the text. */
  namePending: boolean;
}

/** `hour` is null on the server and first client render (hydration guard);
 * buildGreeting then renders no prefix at all, so the words never change. */
export function greetingPrefix(hour: number): string {
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export function buildGreeting(hour: number | null, firstName: string | null | undefined, nameResolved: boolean): Greeting {
  // Hour unknown (server render, first client render): only the pill, so the
  // text does not visibly change from a neutral word to "Good morning,".
  if (hour === null) return { text: "", namePending: true };
  const prefix = greetingPrefix(hour);
  const name = (firstName ?? "").trim();
  if (name) return { text: `${prefix}, ${name}`, namePending: false };
  if (!nameResolved) return { text: `${prefix},`, namePending: true };
  return { text: prefix, namePending: false };
}

/** The viewer's local hour, null until after mount so the server render and the
 * hydrating render agree. */
export function useClockHour(): number | null {
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => { setHour(new Date().getHours()); }, []);
  return hour;
}
