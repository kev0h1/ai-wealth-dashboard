// C43: the Apple App Review demo sign-in. The backend answers 404 / enabled:false
// unless DEMO_LOGIN_ENABLED and DEMO_PASSWORD_HASH are both set, so on every
// other deployment the screen shows nothing extra.
import { API_BASE, gatedFetch } from "./api";
import { setTokenAsync } from "./auth";

export const DEMO_FAILED_MESSAGE = "Those details didn't work.";
export const DEMO_LIMITED_MESSAGE = "Too many attempts. Please wait a minute and try again.";
export const DEMO_UNREACHABLE_MESSAGE = "We couldn't reach Sorted. Please try again.";

export type DemoLoginResult = "ok" | "failed" | "limited" | "unreachable";

export async function fetchDemoEnabled(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await gatedFetch(`${API_BASE}/auth/demo/enabled`, { signal });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.enabled === true;
  } catch {
    return false;
  }
}

export async function demoLogin(email: string, password: string): Promise<DemoLoginResult> {
  try {
    const res = await gatedFetch(`${API_BASE}/auth/demo/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    if (res.status === 429) return "limited";
    if (!res.ok) return res.status >= 500 ? "unreachable" : "failed";
    const data = await res.json();
    if (data?.ok && data.session_token) {
      await setTokenAsync(data.session_token);
      return "ok";
    }
    return "failed";
  } catch {
    return "unreachable";
  }
}
