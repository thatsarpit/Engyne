import { useEffect, useMemo, useRef, useState } from "react";
import {
  RemoteLoginStartResponse,
  SlotSummary,
  clearToken,
  extractTokenFromHash,
  fetchSlotDetail,
  fetchSlotLeads,
  fetchMe,
  fetchVapidPublicKey,
  fetchClusterSlots,
  fetchSlots,
  fetchWhatsappQr,
  getLoginUrl,
  loadToken,
  provisionSlot,
  restartSlot,
  saveToken,
  subscribePush,
  startSlot,
  startRemoteLogin,
  startWhatsappSession,
  stopSlot,
  unsubscribePush,
  replaceSlotConfig,
  updateSlotConfig,
  LeadItem,
  SlotDetail,
  User,
} from "./api";
import { useInterval } from "./hooks";

function useAuth() {
  const [token, setToken] = useState<string | null>(() => loadToken());
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hashToken = extractTokenFromHash();
    if (hashToken) {
      saveToken(hashToken);
      setToken(hashToken);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setUser(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetchMe(token)
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setError("Authentication failed. Please sign in again.");
          clearToken();
          setUser(null);
          setToken(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return { token, user, loading, error, setToken, setUser };
}

function Badge({ text, tone }: { text: string; tone?: "green" | "amber" | "red" }) {
  return <span className={`badge ${tone ?? ""}`}>{text}</span>;
}

function SlotRow({
  slot,
  showNode,
  onView,
  onStart,
  onStop,
  onRestart,
  onShowQr,
  onRemoteLogin,
  busy,
  qrUrl,
  qrBusy,
  qrError,
  remoteLogin,
  remoteLoginBusy,
  remoteLoginError,
}: {
  slot: SlotSummary;
  showNode: boolean;
  onView: (slot: SlotSummary) => void;
  onStart: (slotId: string) => void;
  onStop: (slotId: string) => void;
  onRestart: (slotId: string) => void;
  onShowQr: (slotId: string) => void;
  onHideQr: (slotId: string) => void;
  onRemoteLogin: (slotId: string) => void;
  busy: boolean;
  qrUrl?: string;
  qrBusy: boolean;
  qrError?: string | null;
  remoteLogin?: RemoteLoginStartResponse;
  remoteLoginBusy: boolean;
  remoteLoginError?: string | null;
}) {
  const heartbeat =
    slot.heartbeat_ts && slot.heartbeat_age_seconds != null
      ? `${Math.round(slot.heartbeat_age_seconds)}s ago`
      : "—";
  const phaseTone =
    slot.phase?.toLowerCase() === "running"
      ? "green"
      : slot.phase?.toLowerCase() === "error"
        ? "red"
        : "amber";
  return (
    <>
      <tr>
        {showNode && <td className="mono">{slot.node_id ?? "local"}</td>}
        <td className="mono">{slot.slot_id}</td>
        <td>
          {slot.phase ? <Badge text={slot.phase} tone={phaseTone as any} /> : <span className="muted">—</span>}
        </td>
        <td>{slot.pid ?? "—"}</td>
        <td>{slot.pid_alive === null ? "?" : slot.pid_alive ? "alive" : "stale"}</td>
        <td>{heartbeat}</td>
        <td>{slot.leads_count ?? "0"}</td>
        <td>
          <span className="muted">
            cfg:{slot.has_config ? "✓" : "–"} st:{slot.has_state ? "✓" : "–"} snap:{slot.has_status ? "✓" : "–"}
          </span>
        </td>
        <td>
          <div className="flex" style={{ gap: 6, flexWrap: "wrap" }}>
            <button className="btn btn-secondary" onClick={() => onView(slot)} disabled={busy}>
              Details
            </button>
            <button className="btn btn-secondary" onClick={() => onStart(slot.slot_id)} disabled={busy}>
              Start
            </button>
            <button className="btn btn-secondary" onClick={() => onStop(slot.slot_id)} disabled={busy}>
              Stop
            </button>
            <button className="btn btn-secondary" onClick={() => onRestart(slot.slot_id)} disabled={busy}>
              Restart
            </button>
            {qrUrl ? (
              <>
                <button className="btn btn-primary" onClick={() => onShowQr(slot.slot_id)} disabled={qrBusy}>
                  {qrBusy ? "Refreshing WA QR..." : "Refresh WA QR"}
                </button>
                <button className="btn btn-secondary" onClick={() => onHideQr(slot.slot_id)} disabled={qrBusy}>
                  Hide QR
                </button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={() => onShowQr(slot.slot_id)} disabled={qrBusy}>
                {qrBusy ? "Loading WA QR..." : "WhatsApp QR"}
              </button>
            )}
            <button
              className="btn btn-secondary"
              onClick={() => onRemoteLogin(slot.slot_id)}
              disabled={remoteLoginBusy}
            >
              {remoteLoginBusy ? "Starting login..." : "Remote Login"}
            </button>
          </div>
          {qrError && (
            <div className="error" style={{ marginTop: 6 }}>
              {qrError}
            </div>
          )}
          {remoteLoginError && (
            <div className="error" style={{ marginTop: 6 }}>
              {remoteLoginError}
            </div>
          )}
        </td>
      </tr>
      {qrUrl && (
        <tr>
          <td colSpan={8}>
            <div className="card" style={{ marginTop: 8 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                Scan the WhatsApp QR with the device for slot {slot.slot_id}. QR refreshes every 15s.
              </div>
              <img src={qrUrl} alt={`WhatsApp QR for ${slot.slot_id}`} style={{ maxWidth: 260 }} />
            </div>
          </td>
        </tr>
      )}
      {remoteLogin && (
        <tr>
          <td colSpan={8}>
            <div className="card" style={{ marginTop: 8 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                Remote login active for slot {slot.slot_id}
              </div>
              <div className="mono" style={{ marginBottom: 6 }}>
                Expires: {new Date(remoteLogin.expires_at).toLocaleString()}
              </div>
              <div className="mono" style={{ marginBottom: 6 }}>
                VNC: {remoteLogin.vnc_host}:{remoteLogin.vnc_port}
              </div>
              <a className="btn btn-primary" href={remoteLogin.url} target="_blank" rel="noreferrer">
                Open Remote Login
              </a>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function SlotTable({
  slots,
  showNode,
  onView,
  onStart,
  onStop,
  onRestart,
  onShowQr,
  onHideQr,
  onRemoteLogin,
  busy,
  qrBySlot,
  qrBusyBySlot,
  qrErrorBySlot,
  remoteLoginBySlot,
  remoteLoginBusyBySlot,
  remoteLoginErrorBySlot,
}: {
  slots: SlotSummary[];
  showNode: boolean;
  onView: (slot: SlotSummary) => void;
  onStart: (slotId: string) => void;
  onStop: (slotId: string) => void;
  onRestart: (slotId: string) => void;
  onShowQr: (slotId: string) => void;
  onHideQr: (slotId: string) => void;
  onRemoteLogin: (slotId: string) => void;
  busy: boolean;
  qrBySlot: Record<string, string | undefined>;
  qrBusyBySlot: Record<string, boolean | undefined>;
  qrErrorBySlot: Record<string, string | null | undefined>;
  remoteLoginBySlot: Record<string, RemoteLoginStartResponse | undefined>;
  remoteLoginBusyBySlot: Record<string, boolean | undefined>;
  remoteLoginErrorBySlot: Record<string, string | null | undefined>;
}) {
  if (!slots.length) {
    return <div className="muted">No slots provisioned yet.</div>;
  }
  return (
    <div className="card">
      <div className="header">
        <div>
          <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 }}>
            Slots
          </div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Active slots ({slots.length})</div>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              {showNode && <th>Node</th>}
              <th>Slot ID</th>
              <th>Phase</th>
              <th>PID</th>
              <th>PID Status</th>
              <th>Heartbeat</th>
              <th>Leads</th>
              <th>Files</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <SlotRow
                key={slot.slot_id}
                slot={slot}
                showNode={showNode}
                onView={onView}
                onStart={onStart}
                onStop={onStop}
                onRestart={onRestart}
                onShowQr={onShowQr}
                onHideQr={onHideQr}
                onRemoteLogin={onRemoteLogin}
                busy={busy}
                qrUrl={qrBySlot[slot.slot_id]}
                qrBusy={Boolean(qrBusyBySlot[slot.slot_id])}
                qrError={qrErrorBySlot[slot.slot_id] ?? null}
                remoteLogin={remoteLoginBySlot[slot.slot_id]}
                remoteLoginBusy={Boolean(remoteLoginBusyBySlot[slot.slot_id])}
                remoteLoginError={remoteLoginErrorBySlot[slot.slot_id] ?? null}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HeaderBar({ user, onSignOut }: { user: User | null; onSignOut: () => void }) {
  return (
    <div className="header">
      <div className="flex">
        <div className="pill">ENGYNE</div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20 }}>Control Plane</div>
          <div className="muted" style={{ fontSize: 13 }}>
            Monitor slots and login with Google
          </div>
        </div>
      </div>
      <div className="flex">
        {user ? (
          <>
            <div className="badge">{user.email}</div>
            <div className="badge green">{user.role}</div>
            <button className="btn btn-secondary" onClick={onSignOut}>
              Sign out
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function ensurePushRegistration() {
  await navigator.serviceWorker.register("/sw.js");
  return await navigator.serviceWorker.ready;
}

const CHANNEL_OPTIONS = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "telegram", label: "Telegram" },
  { key: "email", label: "Email" },
  { key: "sheets", label: "Google Sheets" },
  { key: "push", label: "Push" },
  { key: "slack", label: "Slack" },
];

type ConfigDraft = {
  quality_level: number;
  max_clicks_per_cycle: number;
  max_run_minutes: number;
  allowed_countries: string;
  keywords: string;
  dry_run: boolean;
  channels: Record<string, boolean>;
};

function splitList(value: string): string[] {
  return value
    .split(/[,;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export default function App() {
  const { token, user, loading, error, setToken, setUser } = useAuth();
  const [slots, setSlots] = useState<SlotSummary[]>([]);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [slotLoading, setSlotLoading] = useState(false);
  const [slotActionBusy, setSlotActionBusy] = useState(false);
  const [qrBySlot, setQrBySlot] = useState<Record<string, string>>({});
  const [qrBusyBySlot, setQrBusyBySlot] = useState<Record<string, boolean>>({});
  const [qrErrorBySlot, setQrErrorBySlot] = useState<Record<string, string | null>>({});
  const qrRefreshTimers = useRef<Record<string, number>>({});
  const [remoteLoginBySlot, setRemoteLoginBySlot] = useState<
    Record<string, RemoteLoginStartResponse>
  >({});
  const [remoteLoginBusyBySlot, setRemoteLoginBusyBySlot] = useState<Record<string, boolean>>({});
  const [remoteLoginErrorBySlot, setRemoteLoginErrorBySlot] = useState<
    Record<string, string | null>
  >({});
  const [viewMode, setViewMode] = useState<"local" | "cluster">("local");
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [slotDetail, setSlotDetail] = useState<SlotDetail | null>(null);
  const [slotDetailLoading, setSlotDetailLoading] = useState(false);
  const [slotLeads, setSlotLeads] = useState<LeadItem[]>([]);
  const [slotLeadsLoading, setSlotLeadsLoading] = useState(false);
  const [slotLeadsVerifiedOnly, setSlotLeadsVerifiedOnly] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | null>(null);
  const [configDraft, setConfigDraft] = useState<ConfigDraft | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSaved, setConfigSaved] = useState<string | null>(null);
  const [adminConfigText, setAdminConfigText] = useState("");
  const [adminConfigSaving, setAdminConfigSaving] = useState(false);
  const [adminConfigError, setAdminConfigError] = useState<string | null>(null);
  const [newSlotId, setNewSlotId] = useState("");
  const [provisionBusy, setProvisionBusy] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  const canFetch = useMemo(() => Boolean(token && user), [token, user]);

  const signIn = () => {
    window.location.href = getLoginUrl();
  };

  const handleSlotAction = async (fn: (slotId: string, token: string) => Promise<any>, slotId: string) => {
    if (!token) return;
    setSlotActionBusy(true);
    try {
      await fn(slotId, token);
      await loadSlots();
    } catch (err) {
      console.error(err);
      setSlotError("Slot action failed");
    } finally {
      setSlotActionBusy(false);
    }
  };

  const clearQrTimer = (slotId: string) => {
    const handle = qrRefreshTimers.current[slotId];
    if (handle) {
      window.clearTimeout(handle);
      delete qrRefreshTimers.current[slotId];
    }
  };

  const setQrUrl = (slotId: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    setQrBySlot((prev) => {
      const next = { ...prev };
      if (next[slotId]) {
        URL.revokeObjectURL(next[slotId]);
      }
      next[slotId] = url;
      return next;
    });
  };

  const scheduleQrRefresh = (slotId: string) => {
    clearQrTimer(slotId);
    qrRefreshTimers.current[slotId] = window.setTimeout(() => {
      refreshQr(slotId);
    }, 15000);
  };

  const refreshQr = async (slotId: string) => {
    if (!token) return;
    setQrBusyBySlot((prev) => ({ ...prev, [slotId]: true }));
    setQrErrorBySlot((prev) => ({ ...prev, [slotId]: null }));
    try {
      const blob = await fetchWhatsappQr(slotId, token);
      setQrUrl(slotId, blob);
      scheduleQrRefresh(slotId);
    } catch (err) {
      console.error(err);
      setQrErrorBySlot((prev) => ({ ...prev, [slotId]: "Unable to load WhatsApp QR" }));
    } finally {
      setQrBusyBySlot((prev) => ({ ...prev, [slotId]: false }));
    }
  };

  const handleShowQr = async (slotId: string) => {
    if (!token) return;
    try {
      await startWhatsappSession(slotId, token);
      await refreshQr(slotId);
    } catch (err) {
      console.error(err);
      setQrErrorBySlot((prev) => ({ ...prev, [slotId]: "Unable to load WhatsApp QR" }));
    }
  };

  const handleHideQr = (slotId: string) => {
    clearQrTimer(slotId);
    setQrBySlot((prev) => {
      const next = { ...prev };
      if (next[slotId]) {
        URL.revokeObjectURL(next[slotId]);
      }
      delete next[slotId];
      return next;
    });
    setQrErrorBySlot((prev) => ({ ...prev, [slotId]: null }));
  };

  const handleRemoteLogin = async (slotId: string) => {
    if (!token) return;
    setRemoteLoginBusyBySlot((prev) => ({ ...prev, [slotId]: true }));
    setRemoteLoginErrorBySlot((prev) => ({ ...prev, [slotId]: null }));
    try {
      const data = await startRemoteLogin(slotId, token);
      setRemoteLoginBySlot((prev) => ({ ...prev, [slotId]: data }));
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error(err);
      setRemoteLoginErrorBySlot((prev) => ({ ...prev, [slotId]: "Unable to start remote login" }));
    } finally {
      setRemoteLoginBusyBySlot((prev) => ({ ...prev, [slotId]: false }));
    }
  };

  const handleProvisionSlot = async () => {
    if (!token) return;
    const trimmed = newSlotId.trim();
    if (!trimmed) {
      setProvisionError("Enter a slot id.");
      return;
    }
    setProvisionBusy(true);
    setProvisionError(null);
    try {
      await provisionSlot(trimmed, token);
      setNewSlotId("");
      await loadSlots();
    } catch (err) {
      console.error(err);
      setProvisionError("Unable to provision slot.");
    } finally {
      setProvisionBusy(false);
    }
  };

  const signOut = () => {
    Object.values(qrRefreshTimers.current).forEach((handle) => window.clearTimeout(handle));
    qrRefreshTimers.current = {};
    clearToken();
    setToken(null);
    setUser(null);
    setSlots([]);
    setSelectedSlotId(null);
    setSlotDetail(null);
    setSlotLeads([]);
    setQrBySlot({});
    setQrErrorBySlot({});
  };

  useEffect(() => {
    return () => {
      Object.values(qrRefreshTimers.current).forEach((handle) => window.clearTimeout(handle));
      qrRefreshTimers.current = {};
    };
  }, []);

  const refreshPushStatus = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPushSupported(false);
      return;
    }
    setPushSupported(true);
    setPushPermission(Notification.permission);
    try {
      const reg = await ensurePushRegistration();
      const sub = await reg.pushManager.getSubscription();
      setPushEnabled(Boolean(sub));
    } catch (err) {
      console.error(err);
      setPushEnabled(false);
    }
  };

  const handleEnablePush = async () => {
    if (!token) return;
    setPushBusy(true);
    setPushError(null);
    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission);
      if (permission !== "granted") {
        setPushError("Notification permission denied.");
        return;
      }
      const reg = await ensurePushRegistration();
      const publicKey = await fetchVapidPublicKey(token);
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await subscribePush(subscription, token);
      setPushEnabled(true);
    } catch (err) {
      console.error(err);
      setPushError("Unable to enable push notifications.");
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    if (!token) return;
    setPushBusy(true);
    setPushError(null);
    try {
      const reg = await ensurePushRegistration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush(sub.endpoint, token);
        await sub.unsubscribe();
      }
      setPushEnabled(false);
    } catch (err) {
      console.error(err);
      setPushError("Unable to disable push notifications.");
    } finally {
      setPushBusy(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!token || !selectedSlotId || !configDraft) return;
    setConfigSaving(true);
    setConfigError(null);
    setConfigSaved(null);
    try {
      const patch = {
        quality_level: configDraft.quality_level,
        dry_run: configDraft.dry_run,
        max_clicks_per_cycle: configDraft.max_clicks_per_cycle,
        max_run_minutes: configDraft.max_run_minutes > 0 ? configDraft.max_run_minutes : null,
        allowed_countries: splitList(configDraft.allowed_countries),
        keywords: splitList(configDraft.keywords),
        channels: configDraft.channels,
      };
      const updated = await updateSlotConfig(selectedSlotId, token, patch);
      setSlotDetail(updated);
      setConfigSaved("Saved.");
    } catch (err) {
      console.error(err);
      setConfigError("Unable to save slot config.");
    } finally {
      setConfigSaving(false);
    }
  };

  const handleAdminSave = async () => {
    if (!token || !selectedSlotId) return;
    setAdminConfigSaving(true);
    setAdminConfigError(null);
    try {
      const parsed = JSON.parse(adminConfigText || "{}");
      const updated = await replaceSlotConfig(selectedSlotId, token, parsed);
      setSlotDetail(updated);
      setConfigSaved("Admin config saved.");
    } catch (err) {
      console.error(err);
      setAdminConfigError("Invalid JSON or unable to save config.");
    } finally {
      setAdminConfigSaving(false);
    }
  };

  const loadSlotDetail = async (slotId: string) => {
    if (!token) return;
    setSlotDetailLoading(true);
    try {
      const data = await fetchSlotDetail(slotId, token);
      setSlotDetail(data);
    } catch (err) {
      console.error(err);
      setSlotDetail(null);
    } finally {
      setSlotDetailLoading(false);
    }
  };

  const loadSlotLeads = async (slotId: string) => {
    if (!token) return;
    setSlotLeadsLoading(true);
    try {
      const data = await fetchSlotLeads(slotId, token, 200, slotLeadsVerifiedOnly);
      setSlotLeads(data);
    } catch (err) {
      console.error(err);
      setSlotLeads([]);
    } finally {
      setSlotLeadsLoading(false);
    }
  };

  const loadSlots = async () => {
    if (!token) return;
    setSlotLoading(true);
    setSlotError(null);
    try {
      const data =
        viewMode === "cluster" ? await fetchClusterSlots(token) : await fetchSlots(token);
      setSlots(data);
    } catch (err) {
      console.error(err);
      setSlotError("Unable to load slots");
    } finally {
      setSlotLoading(false);
    }
  };

  const handleViewSlot = async (slot: SlotSummary) => {
    if (viewMode === "cluster" && slot.node_id && slot.node_id !== "local") {
      setSlotError("Slot details are only available on the local node for now.");
      return;
    }
    setSelectedSlotId(slot.slot_id);
    await Promise.all([loadSlotDetail(slot.slot_id), loadSlotLeads(slot.slot_id)]);
  };

  useInterval(() => {
    if (canFetch) {
      loadSlots();
    }
  }, 5000, canFetch);

  useEffect(() => {
    if (canFetch) {
      loadSlots();
    }
  }, [canFetch, viewMode]);

  useEffect(() => {
    if (selectedSlotId) {
      loadSlotLeads(selectedSlotId);
    }
  }, [slotLeadsVerifiedOnly]);

  useEffect(() => {
    if (user && token) {
      refreshPushStatus();
    }
  }, [user, token]);

  useEffect(() => {
    if (!slotDetail) {
      setConfigDraft(null);
      setAdminConfigText("");
      return;
    }
    const cfg = (slotDetail.config || {}) as Record<string, unknown>;
    const channels = (cfg.channels && typeof cfg.channels === "object" ? cfg.channels : {}) as Record<
      string,
      boolean
    >;
    const nextChannels: Record<string, boolean> = {};
    CHANNEL_OPTIONS.forEach((option) => {
      nextChannels[option.key] = Boolean(channels[option.key]);
    });
    setConfigDraft({
      quality_level: Number(cfg.quality_level ?? 70),
      max_clicks_per_cycle: Number(cfg.max_clicks_per_cycle ?? 1),
      max_run_minutes: Number(cfg.max_run_minutes ?? 0),
      allowed_countries: Array.isArray(cfg.allowed_countries) ? cfg.allowed_countries.join(", ") : "",
      keywords: Array.isArray(cfg.keywords) ? cfg.keywords.join(", ") : "",
      dry_run: Boolean(cfg.dry_run ?? true),
      channels: nextChannels,
    });
    setAdminConfigText(JSON.stringify(cfg, null, 2));
  }, [slotDetail]);

  return (
    <div className="page">
      <HeaderBar user={user} onSignOut={signOut} />
      {!user && (
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Sign in with Google</div>
          <div className="muted" style={{ marginBottom: 16 }}>
            You’ll be redirected to Google and back with a secure token.
          </div>
          <button className="btn btn-primary" onClick={signIn} disabled={loading}>
            {loading ? "Checking session..." : "Continue with Google"}
          </button>
          {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
      )}

      {user && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="flex">
              <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 }}>
                View
              </div>
              <button
                className={`btn ${viewMode === "local" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setViewMode("local")}
              >
                Local
              </button>
              <button
                className={`btn ${viewMode === "cluster" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setViewMode("cluster")}
              >
                Cluster
              </button>
            </div>
          </div>
          {user.role === "admin" && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="header">
                <div>
                  <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 }}>
                    Admin
                  </div>
                  <div style={{ fontWeight: 800 }}>Provision new slot</div>
                </div>
                <div className="flex">
                  <input
                    className="input"
                    style={{ minWidth: 200 }}
                    placeholder="slot-2"
                    value={newSlotId}
                    onChange={(e) => setNewSlotId(e.target.value)}
                  />
                  <button className="btn btn-primary" onClick={handleProvisionSlot} disabled={provisionBusy}>
                    {provisionBusy ? "Provisioning..." : "Create Slot"}
                  </button>
                </div>
              </div>
              {provisionError && <div className="error">{provisionError}</div>}
            </div>
          )}
          {pushSupported ? (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="header">
                <div>
                  <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 }}>
                    Push Alerts
                  </div>
                  <div style={{ fontWeight: 800 }}>Browser notifications</div>
                </div>
                <div className="flex">
                  <button
                    className={`btn ${pushEnabled ? "btn-secondary" : "btn-primary"}`}
                    onClick={handleEnablePush}
                    disabled={pushBusy || pushEnabled || pushPermission === "denied"}
                  >
                    {pushEnabled ? "Enabled" : pushBusy ? "Enabling..." : "Enable"}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={handleDisablePush}
                    disabled={pushBusy || !pushEnabled}
                  >
                    {pushBusy && pushEnabled ? "Disabling..." : "Disable"}
                  </button>
                </div>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                Receive verified lead alerts on this device.
              </div>
              {pushPermission === "denied" && (
                <div className="error" style={{ marginTop: 8 }}>
                  Notifications are blocked in your browser settings.
                </div>
              )}
              {pushError && (
                <div className="error" style={{ marginTop: 8 }}>
                  {pushError}
                </div>
              )}
            </div>
          ) : (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="muted">Push notifications are not supported in this browser.</div>
            </div>
          )}
          {slotError && <div className="error">{slotError}</div>}
          {slotLoading && <div className="muted">Refreshing slots…</div>}
          <SlotTable
            slots={slots}
            showNode={viewMode === "cluster" || slots.some((s) => Boolean(s.node_id))}
            onView={handleViewSlot}
            onStart={(id) => handleSlotAction(startSlot, id)}
            onStop={(id) => handleSlotAction(stopSlot, id)}
            onRestart={(id) => handleSlotAction(restartSlot, id)}
            onShowQr={handleShowQr}
            onRemoteLogin={handleRemoteLogin}
            busy={slotActionBusy}
            qrBySlot={qrBySlot}
            qrBusyBySlot={qrBusyBySlot}
            qrErrorBySlot={qrErrorBySlot}
            remoteLoginBySlot={remoteLoginBySlot}
            remoteLoginBusyBySlot={remoteLoginBusyBySlot}
            remoteLoginErrorBySlot={remoteLoginErrorBySlot}
          />
          <div className="card" style={{ marginTop: 16 }}>
            <div className="header">
              <div style={{ fontWeight: 800, fontSize: 16 }}>Slot Detail</div>
              <div className="flex">
                <button
                  className="btn btn-secondary"
                  onClick={() => selectedSlotId && handleViewSlot({ slot_id: selectedSlotId } as SlotSummary)}
                  disabled={!selectedSlotId || slotDetailLoading}
                >
                  Refresh
                </button>
              </div>
            </div>
            {!selectedSlotId && <div className="muted">Select a slot to view details.</div>}
            {selectedSlotId && slotDetailLoading && <div className="muted">Loading details…</div>}
            {selectedSlotId && slotDetail && (
              <>
                <div className="grid" style={{ marginBottom: 12 }}>
                  <div className="card">
                    <div className="muted" style={{ fontSize: 12, textTransform: "uppercase" }}>
                      Status
                    </div>
                    <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>
                      {JSON.stringify(slotDetail.status, null, 2)}
                    </pre>
                  </div>
                  <div className="card">
                    <div className="muted" style={{ fontSize: 12, textTransform: "uppercase" }}>
                      Client Config
                    </div>
                    {!configDraft ? (
                      <div className="muted">No config loaded.</div>
                    ) : (
                      <>
                        <div className="form-grid">
                          <div className="field">
                            <div className="label">Quality</div>
                            <input
                              className="input"
                              type="range"
                              min={0}
                              max={100}
                              step={5}
                              value={configDraft.quality_level}
                              onChange={(e) =>
                                setConfigDraft((prev) =>
                                  prev ? { ...prev, quality_level: Number(e.target.value) } : prev
                                )
                              }
                            />
                            <div className="muted" style={{ fontSize: 12 }}>
                              {configDraft.quality_level}
                            </div>
                          </div>
                          <div className="field">
                            <div className="label">Max clicks / run</div>
                            <input
                              className="input"
                              type="number"
                              min={0}
                              value={configDraft.max_clicks_per_cycle}
                              onChange={(e) =>
                                setConfigDraft((prev) =>
                                  prev ? { ...prev, max_clicks_per_cycle: Number(e.target.value) } : prev
                                )
                              }
                            />
                          </div>
                          <div className="field">
                            <div className="label">Max run minutes</div>
                            <input
                              className="input"
                              type="number"
                              min={0}
                              value={configDraft.max_run_minutes}
                              onChange={(e) =>
                                setConfigDraft((prev) =>
                                  prev ? { ...prev, max_run_minutes: Number(e.target.value) } : prev
                                )
                              }
                            />
                          </div>
                          <div className="field">
                            <div className="label">Allowed countries</div>
                            <input
                              className="input"
                              placeholder="india, usa"
                              value={configDraft.allowed_countries}
                              onChange={(e) =>
                                setConfigDraft((prev) =>
                                  prev ? { ...prev, allowed_countries: e.target.value } : prev
                                )
                              }
                            />
                          </div>
                          <div className="field">
                            <div className="label">Keywords</div>
                            <input
                              className="input"
                              placeholder="testosterone, clomiphene"
                              value={configDraft.keywords}
                              onChange={(e) =>
                                setConfigDraft((prev) => (prev ? { ...prev, keywords: e.target.value } : prev))
                              }
                            />
                          </div>
                        </div>
                        <div className="field" style={{ marginTop: 12 }}>
                          <div className="label">Channels</div>
                          <div className="channel-grid">
                            {CHANNEL_OPTIONS.map((channel) => (
                              <label key={channel.key} className="checkbox">
                                <input
                                  type="checkbox"
                                  checked={Boolean(configDraft.channels[channel.key])}
                                  onChange={(e) =>
                                    setConfigDraft((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            channels: { ...prev.channels, [channel.key]: e.target.checked },
                                          }
                                        : prev
                                    )
                                  }
                                />
                                {channel.label}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="field" style={{ marginTop: 12 }}>
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              checked={configDraft.dry_run}
                              onChange={(e) =>
                                setConfigDraft((prev) => (prev ? { ...prev, dry_run: e.target.checked } : prev))
                              }
                            />
                            Dry run (no clicks)
                          </label>
                        </div>
                        <div className="flex" style={{ marginTop: 12 }}>
                          <button className="btn btn-primary" onClick={handleSaveConfig} disabled={configSaving}>
                            {configSaving ? "Saving..." : "Save Config"}
                          </button>
                          {configSaved && <div className="muted">{configSaved}</div>}
                        </div>
                        {configError && (
                          <div className="error" style={{ marginTop: 8 }}>
                            {configError}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {user?.role === "admin" && (
                  <div className="card" style={{ marginBottom: 12 }}>
                    <div className="muted" style={{ fontSize: 12, textTransform: "uppercase" }}>
                      Admin Config (JSON)
                    </div>
                    <textarea
                      className="textarea"
                      rows={10}
                      value={adminConfigText}
                      onChange={(e) => setAdminConfigText(e.target.value)}
                    />
                    <div className="flex" style={{ marginTop: 12 }}>
                      <button className="btn btn-secondary" onClick={handleAdminSave} disabled={adminConfigSaving}>
                        {adminConfigSaving ? "Saving..." : "Save Admin Config"}
                      </button>
                      {adminConfigError && <div className="error">{adminConfigError}</div>}
                    </div>
                  </div>
                )}
                <div className="flex" style={{ marginBottom: 12 }}>
                  <button
                    className={`btn ${slotLeadsVerifiedOnly ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setSlotLeadsVerifiedOnly((prev) => !prev)}
                  >
                    {slotLeadsVerifiedOnly ? "Verified Only" : "All Leads"}
                  </button>
                  <a
                    className="btn btn-secondary"
                    href={`${import.meta.env.VITE_API_BASE_URL || "http://localhost:8001"}/slots/${encodeURIComponent(
                      selectedSlotId
                    )}/leads.jsonl`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download JSONL
                  </a>
                </div>
                {slotLeadsLoading && <div className="muted">Loading leads…</div>}
                {!slotLeadsLoading && !slotLeads.length && <div className="muted">No leads yet.</div>}
                {!slotLeadsLoading && slotLeads.length > 0 && (
                  <div style={{ overflowX: "auto" }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Observed</th>
                          <th>Title</th>
                          <th>Country</th>
                          <th>Contact</th>
                          <th>Verified</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {slotLeads.map((lead) => (
                          <tr key={lead.lead_id || `${lead.title}-${lead.observed_at}`}>
                            <td className="mono">
                              {lead.observed_at ? new Date(lead.observed_at).toLocaleString() : "—"}
                            </td>
                            <td>{lead.title ?? "—"}</td>
                            <td>{lead.country ?? "—"}</td>
                            <td>{lead.contact || lead.email || lead.phone || "—"}</td>
                            <td>{lead.verified ? "yes" : "no"}</td>
                            <td>{lead.verification_source ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
