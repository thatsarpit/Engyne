const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "") || "http://localhost:8001";

const TOKEN_KEY = "engyne_token";

export type User = {
  user_id: string;
  email: string;
  role: "admin" | "client" | string;
  allowed_slots: string[];
};

export type SlotSummary = {
  slot_id: string;
  phase: string | null;
  pid: number | null;
  pid_alive: boolean | null;
  heartbeat_ts: string | null;
  heartbeat_age_seconds: number | null;
  has_config: boolean;
  has_state: boolean;
  has_status: boolean;
  leads_count: number | null;
};

export function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function loadToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function apiFetch<T>(path: string, token: string): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (resp.status === 401) {
    clearToken();
  }
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API ${resp.status}: ${text || resp.statusText}`);
  }
  return (await resp.json()) as T;
}

export async function fetchMe(token: string): Promise<User> {
  return apiFetch<User>("/auth/me", token);
}

export async function fetchSlots(token: string): Promise<SlotSummary[]> {
  return apiFetch<SlotSummary[]>("/slots", token);
}

export function getLoginUrl(returnTo?: string) {
  const target = returnTo || window.location.href.split("#")[0];
  const encoded = encodeURIComponent(target);
  return `${API_BASE_URL}/auth/google/start?return_to=${encoded}`;
}

export function extractTokenFromHash(): string | null {
  const hash = window.location.hash || "";
  if (!hash.startsWith("#")) return null;
  const params = new URLSearchParams(hash.slice(1));
  const token = params.get("token");
  const type = params.get("token_type");
  if (token && (!type || type.toLowerCase() === "bearer")) {
    return token;
  }
  return null;
}

export async function startSlot(slotId: string, token: string) {
  return apiFetch(`/slots/${encodeURIComponent(slotId)}/start`, token);
}

export async function stopSlot(slotId: string, token: string) {
  return apiFetch(`/slots/${encodeURIComponent(slotId)}/stop`, token);
}

export async function restartSlot(slotId: string, token: string) {
  return apiFetch(`/slots/${encodeURIComponent(slotId)}/restart`, token);
}
