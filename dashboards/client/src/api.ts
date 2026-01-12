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
  node_id?: string;
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

export type SlotDetail = SlotSummary & {
  config: Record<string, unknown> | null;
  state: Record<string, unknown> | null;
  status: Record<string, unknown> | null;
};

export type LeadItem = {
  lead_id: string | null;
  observed_at: string | null;
  title: string | null;
  country: string | null;
  contact: string | null;
  email: string | null;
  phone: string | null;
  verified: boolean | null;
  clicked: boolean | null;
  verification_source: string | null;
};

export type ConfigPreviewDecision = {
  keep: boolean;
  reject_reason: string | null;
  country_match?: boolean | null;
  missing_contact_methods: string[];
};

export type ConfigPreviewLead = {
  lead_id: string | null;
  observed_at: string | null;
  title: string | null;
  country: string | null;
  category_text: string | null;
  time_text: string | null;
  age_hours: number | null;
  member_months: number | null;
  member_since_text: string | null;
  availability: string[] | null;
  quantity_text: string | null;
  strength_text: string | null;
  packaging_text: string | null;
  intent_text: string | null;
  buys_text: string | null;
  retail_hint: boolean | null;
  engagement_requirements: number | null;
  engagement_calls: number | null;
  engagement_replies: number | null;
  decision: ConfigPreviewDecision;
};

export type ConfigPreviewSummary = {
  total: number;
  kept: number;
  rejected: number;
  reject_reasons: Record<string, number>;
};

export type ConfigPreviewResponse = {
  slot_id: string;
  limit: number;
  evaluated: number;
  summary: ConfigPreviewSummary;
  leads: ConfigPreviewLead[];
};

export type AnalyticsMetrics = {
  observed: number;
  kept: number;
  rejected: number;
  clicked: number;
  verified: number;
};

export type AnalyticsSlotSummary = {
  slot_id: string;
  metrics: AnalyticsMetrics;
};

export type AnalyticsSummary = {
  range_start: string;
  range_end: string;
  totals: AnalyticsMetrics;
  per_slot: AnalyticsSlotSummary[];
};

export type AnalyticsSlotDaily = {
  day: string;
  metrics: AnalyticsMetrics;
  reject_reasons?: Record<string, number>;
};

export type AnalyticsSlotResponse = {
  slot_id: string;
  range_start: string;
  range_end: string;
  totals: AnalyticsMetrics;
  series: AnalyticsSlotDaily[];
};

export type RemoteLoginStartResponse = {
  token: string;
  url: string;
  web_url?: string | null;
  slot_id: string;
  expires_at: string;
  vnc_host: string;
  vnc_port: number;
};

export type InviteResponse = {
  email: string;
  role: string;
  allowed_slots: string[];
  created: boolean;
};

export type ClientSummary = {
  id: string;
  email: string;
  role: string;
  allowed_slots: string[];
  created_at: string;
  updated_at: string;
};

export type SubscriptionEntry = {
  slot_id: string;
  user_id: string;
  email: string;
  plan: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
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

async function apiFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
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

export async function fetchClusterSlots(token: string): Promise<SlotSummary[]> {
  return apiFetch<SlotSummary[]>("/cluster/slots", token);
}

export async function fetchSlotDetail(slotId: string, token: string): Promise<SlotDetail> {
  return apiFetch<SlotDetail>(`/slots/${encodeURIComponent(slotId)}`, token);
}

export async function fetchSlotLeads(
  slotId: string,
  token: string,
  limit = 200,
  verifiedOnly = false
): Promise<LeadItem[]> {
  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  if (verifiedOnly) qs.set("verified_only", "true");
  return apiFetch<LeadItem[]>(`/slots/${encodeURIComponent(slotId)}/leads?${qs.toString()}`, token);
}

export async function fetchAnalyticsSummary(
  token: string,
  startDate?: string,
  endDate?: string
): Promise<AnalyticsSummary> {
  const qs = new URLSearchParams();
  if (startDate) qs.set("start_date", startDate);
  if (endDate) qs.set("end_date", endDate);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<AnalyticsSummary>(`/analytics/summary${suffix}`, token);
}

export async function fetchSlotAnalytics(
  slotId: string,
  token: string,
  startDate?: string,
  endDate?: string
): Promise<AnalyticsSlotResponse> {
  const qs = new URLSearchParams();
  if (startDate) qs.set("start_date", startDate);
  if (endDate) qs.set("end_date", endDate);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<AnalyticsSlotResponse>(`/analytics/slots/${encodeURIComponent(slotId)}${suffix}`, token);
}

export async function fetchSubscriptions(
  token: string,
  email?: string,
  slotId?: string
): Promise<SubscriptionEntry[]> {
  const qs = new URLSearchParams();
  if (email) qs.set("email", email);
  if (slotId) qs.set("slot_id", slotId);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<SubscriptionEntry[]>(`/subscriptions${suffix}`, token);
}

export async function upsertSubscription(
  token: string,
  payload: {
    email: string;
    slot_id: string;
    plan: string;
    status: string;
    starts_at?: string;
    ends_at?: string;
    notes?: string;
  }
): Promise<SubscriptionEntry> {
  return apiFetch<SubscriptionEntry>("/subscriptions", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchVapidPublicKey(token: string): Promise<string> {
  const data = await apiFetch<{ publicKey: string }>("/push/vapid-public-key", token);
  return data.publicKey;
}

export async function subscribePush(subscription: PushSubscription, token: string) {
  const payload = subscription.toJSON();
  return apiFetch("/push/subscribe", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function unsubscribePush(endpoint: string, token: string) {
  return apiFetch("/push/unsubscribe", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
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
  return apiFetch(`/slots/${encodeURIComponent(slotId)}/start`, token, { method: "POST" });
}

export async function stopSlot(slotId: string, token: string) {
  return apiFetch(`/slots/${encodeURIComponent(slotId)}/stop`, token, { method: "POST" });
}

export async function restartSlot(slotId: string, token: string) {
  return apiFetch(`/slots/${encodeURIComponent(slotId)}/restart`, token, { method: "POST" });
}

export async function provisionSlot(slotId: string, token: string): Promise<SlotDetail> {
  return apiFetch<SlotDetail>("/slots/provision", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slot_id: slotId }),
  });
}

export async function inviteUser(email: string, slots: string[], token: string): Promise<InviteResponse> {
  return apiFetch<InviteResponse>("/admin/invite", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, slots }),
  });
}

export async function fetchClients(token: string): Promise<ClientSummary[]> {
  return apiFetch<ClientSummary[]>("/admin/clients", token);
}

export async function startWhatsappSession(slotId: string, token: string) {
  return apiFetch(`/whatsapp/${encodeURIComponent(slotId)}/session/start`, token, { method: "POST" });
}

export async function startRemoteLogin(slotId: string, token: string): Promise<RemoteLoginStartResponse> {
  return apiFetch(`/slots/${encodeURIComponent(slotId)}/remote-login/start`, token, { method: "POST" });
}

export async function updateSlotConfig(
  slotId: string,
  token: string,
  patch: Record<string, unknown>
): Promise<SlotDetail> {
  return apiFetch<SlotDetail>(`/slots/${encodeURIComponent(slotId)}/config`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function replaceSlotConfig(
  slotId: string,
  token: string,
  config: Record<string, unknown>
): Promise<SlotDetail> {
  return apiFetch<SlotDetail>(`/slots/${encodeURIComponent(slotId)}/config`, token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
}

export async function previewSlotConfig(
  slotId: string,
  token: string,
  config: Record<string, unknown>,
  limit = 50
): Promise<ConfigPreviewResponse> {
  return apiFetch<ConfigPreviewResponse>(`/slots/${encodeURIComponent(slotId)}/config/preview`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config, limit }),
  });
}

export async function fetchWhatsappQr(slotId: string, token: string): Promise<Blob> {
  const url = `${API_BASE_URL}/whatsapp/${encodeURIComponent(slotId)}/qr`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  if (resp.status === 401) {
    clearToken();
  }
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API ${resp.status}: ${text || resp.statusText}`);
  }
  return await resp.blob();
}
