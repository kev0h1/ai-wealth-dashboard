import Constants from "expo-constants";
import { getToken } from "../storage";

const API_BASE: string =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "https://wealth.auriqltd.co.uk/api";

export async function getConnectLink(): Promise<string> {
  const token = await getToken();
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_BASE}/connect/link`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data: { url: string } = await res.json();
  return data.url;
}
