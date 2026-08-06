import Constants from "expo-constants";
import { getToken } from "../storage";

const API_BASE =
  (Constants.expoConfig?.extra?.apiUrl as string) ??
  "https://wealth.auriqltd.co.uk/api";

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function get<T>(path: string): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export const onboardingApi = {
  truelayerProviders(): Promise<{ id: string; name: string; logo: string }[]> {
    return get("/auth/truelayer/providers");
  },

  connectLink(provider?: string): Promise<{ auth_url: string }> {
    return get(
      `/auth/truelayer/link${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`
    );
  },

  finexerProviders(): Promise<{ id: string; name: string; logo: string }[]> {
    return get("/auth/finexer/providers");
  },

  finexerConnectLink(
    provider?: string
  ): Promise<{ auth_url: string; connection_id: string }> {
    return get(
      `/auth/finexer/link${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`
    );
  },

  updatePayPeriod(value: object): Promise<void> {
    return patch("/preferences", { pay_period_config: value });
  },
};
