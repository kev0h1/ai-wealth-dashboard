const TOKEN_KEY = "wealth_session_token";
let _memoryToken: string | null = null;

export function getToken(): string | null {
  if (_memoryToken) return _memoryToken;
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token: string) {
  _memoryToken = token;
  try { localStorage.setItem(TOKEN_KEY, token); } catch {}
}

export function clearToken() {
  _memoryToken = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}
