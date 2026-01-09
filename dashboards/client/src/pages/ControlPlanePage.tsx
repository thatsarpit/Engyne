import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RemoteLoginStartResponse,
  SlotSummary,
  fetchSlotDetail,
  fetchSlotLeads,
  fetchVapidPublicKey,
  fetchClusterSlots,
  fetchSlots,
  fetchWhatsappQr,
  provisionSlot,
  restartSlot,
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
} from "../api";
import { useInterval } from "../hooks";
import { useNavigate, useParams } from "react-router-dom";

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
  busy,
}: {
  slot: SlotSummary;
  showNode: boolean;
  onView: (slot: SlotSummary) => void;
  onStart: (slotId: string) => void;
  onStop: (slotId: string) => void;
  onRestart: (slotId: string) => void;
  busy: boolean;
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
            Open
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
        </div>
      </td>
    </tr>
  );
}

function SlotTable({
  slots,
  showNode,
  onView,
  onStart,
  onStop,
  onRestart,
  busy,
}: {
  slots: SlotSummary[];
  showNode: boolean;
  onView: (slot: SlotSummary) => void;
  onStart: (slotId: string) => void;
  onStop: (slotId: string) => void;
  onRestart: (slotId: string) => void;
  busy: boolean;
}) {
  if (!slots.length) {
    return <div className="muted">No slots provisioned yet.</div>;
  }
  return (
    <div className="card">
      <div className="header">
        <div>
          <div className="section-label">Slots</div>
          <div className="section-title">Active slots ({slots.length})</div>
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
                busy={busy}
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
      <div className="brand">
        <div className="pill">ENGYNE</div>
        <div>
          <div className="title">Control Plane</div>
          <div className="subtitle">Monitor slots and login with Google</div>
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

export default function ControlPlanePage({
  token,
  user,
  onSignOut,
}: {
  token: string;
  user: User;
  onSignOut: () => void;
}) {
  const navigate = useNavigate();
  const { slotId: routeSlotId } = useParams();
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
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(routeSlotId ?? null);
  const [slotTab, setSlotTab] = useState<
    "overview" | "config" | "leads" | "whatsapp" | "remote-login"
  >("overview");
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
  const onboardingSteps = useMemo(() => {
    const hasSlot = slots.length > 0;
    const hasConfig = slots.some((slot) => slot.has_config);
    const hasHeartbeat = slots.some((slot) => (slot.heartbeat_age_seconds ?? 999) < 10);
    return [
      { label: "Provision a slot", done: hasSlot },
      { label: "Review slot config", done: hasConfig },
      { label: "Heartbeat is healthy", done: hasHeartbeat },
    ];
  }, [slots]);
  const onboardingProgress = useMemo(() => {
    if (!onboardingSteps.length) return 0;
    const done = onboardingSteps.filter((step) => step.done).length;
    return Math.round((done / onboardingSteps.length) * 100);
  }, [onboardingSteps]);

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
    Object.values(qrBySlot).forEach((url) => URL.revokeObjectURL(url));
    setQrBySlot({});
    setQrErrorBySlot({});
    setRemoteLoginBySlot({});
    setSlotError(null);
    onSignOut();
    navigate("/");
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

  const loadSlotDetail = useCallback(
    async (slotId: string) => {
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
    },
    [token]
  );

  const loadSlotLeads = useCallback(
    async (slotId: string) => {
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
    },
    [token, slotLeadsVerifiedOnly]
  );

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

  const handleViewSlot = (slot: SlotSummary) => {
    if (viewMode === "cluster" && slot.node_id && slot.node_id !== "local") {
      setSlotError("Slot details are only available on the local node for now.");
      return;
    }
    setSlotError(null);
    navigate(`/slots/${encodeURIComponent(slot.slot_id)}`);
    setSelectedSlotId(slot.slot_id);
  };

  const handleRefreshSelectedSlot = async () => {
    if (!selectedSlotId) return;
    await Promise.all([loadSlotDetail(selectedSlotId), loadSlotLeads(selectedSlotId)]);
  };

  useEffect(() => {
    if (!routeSlotId) {
      setSelectedSlotId(null);
      setSlotDetail(null);
      setSlotLeads([]);
      return;
    }
    setSelectedSlotId(routeSlotId);
    void loadSlotDetail(routeSlotId);
  }, [routeSlotId, loadSlotDetail]);

  useEffect(() => {
    setSlotTab("overview");
  }, [selectedSlotId]);

  useEffect(() => {
    if (!routeSlotId) return;
    void loadSlotLeads(routeSlotId);
  }, [routeSlotId, loadSlotLeads]);

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
      <div className="app-shell">
        <HeaderBar user={user} onSignOut={signOut} />
        <div className="card card-compact">
            <div className="flex">
              <div className="section-label">View</div>
              <div className="segmented">
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
          </div>
          {user.role === "admin" && (
            <div className="card card-compact">
              <div className="header">
                <div>
                  <div className="section-label">Admin</div>
                  <div className="section-title">Provision new slot</div>
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
          {user.role === "admin" ? (
            <div className="card">
              <div className="header">
                <div>
                  <div className="section-label">Onboarding</div>
                  <div className="section-title">Client onboarding checklist</div>
                </div>
                <div className="badge">{onboardingProgress}% complete</div>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                Use this quick checklist to bring new clients online faster.
              </div>
              <div className="onboarding-list">
                {onboardingSteps.map((step) => (
                  <div className="onboarding-item" key={step.label}>
                    <div className={`onboarding-dot ${step.done ? "done" : ""}`} />
                    <div>{step.label}</div>
                    <div className="spacer" />
                    <div className="muted" style={{ fontSize: 12 }}>
                      {step.done ? "Done" : "Pending"}
                    </div>
                  </div>
                ))}
              </div>
              <div className="progress">
                <span style={{ width: `${onboardingProgress}%` }} />
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="header">
                <div>
                  <div className="section-label">Getting started</div>
                  <div className="section-title">Your first lead journey</div>
                </div>
                <div className="badge">{onboardingProgress}% complete</div>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                Complete these steps to start receiving verified leads.
              </div>
              <div className="onboarding-list">
                {onboardingSteps.map((step) => (
                  <div className="onboarding-item" key={step.label}>
                    <div className={`onboarding-dot ${step.done ? "done" : ""}`} />
                    <div>{step.label}</div>
                    <div className="spacer" />
                    <div className="muted" style={{ fontSize: 12 }}>
                      {step.done ? "Done" : "Pending"}
                    </div>
                  </div>
                ))}
              </div>
              <div className="progress">
                <span style={{ width: `${onboardingProgress}%` }} />
              </div>
            </div>
          )}
          {pushSupported ? (
            <div className="card card-compact">
              <div className="header">
                <div>
                  <div className="section-label">Push Alerts</div>
                  <div className="section-title">Browser notifications</div>
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
            <div className="card card-compact">
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
            busy={slotActionBusy}
          />
          <div className="card" style={{ marginTop: 16 }}>
            <div className="header">
              <div>
                <div className="section-label">Slot</div>
                <div className="section-title">{selectedSlotId ?? "Slot Detail"}</div>
              </div>
              <div className="flex" style={{ flexWrap: "wrap" }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => selectedSlotId && handleSlotAction(startSlot, selectedSlotId)}
                  disabled={!selectedSlotId || slotActionBusy}
                >
                  Start
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => selectedSlotId && handleSlotAction(stopSlot, selectedSlotId)}
                  disabled={!selectedSlotId || slotActionBusy}
                >
                  Stop
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => selectedSlotId && handleSlotAction(restartSlot, selectedSlotId)}
                  disabled={!selectedSlotId || slotActionBusy}
                >
                  Restart
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleRefreshSelectedSlot}
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
                <div className="segmented" style={{ marginBottom: 12, flexWrap: "wrap" }}>
                  <button
                    className={`btn ${slotTab === "overview" ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setSlotTab("overview")}
                  >
                    Overview
                  </button>
                  <button
                    className={`btn ${slotTab === "config" ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setSlotTab("config")}
                  >
                    Config
                  </button>
                  <button
                    className={`btn ${slotTab === "leads" ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setSlotTab("leads")}
                  >
                    Leads
                  </button>
                  <button
                    className={`btn ${slotTab === "whatsapp" ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setSlotTab("whatsapp")}
                  >
                    WhatsApp
                  </button>
                  <button
                    className={`btn ${slotTab === "remote-login" ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setSlotTab("remote-login")}
                  >
                    Remote Login
                  </button>
                </div>

                {slotTab === "overview" && (
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
                        State
                      </div>
                      <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(slotDetail.state, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {slotTab === "config" && (
                  <>
                    <div className="card" style={{ marginBottom: 12 }}>
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

                    {user.role === "admin" && (
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
                          <button
                            className="btn btn-secondary"
                            onClick={handleAdminSave}
                            disabled={adminConfigSaving}
                          >
                            {adminConfigSaving ? "Saving..." : "Save Admin Config"}
                          </button>
                          {adminConfigError && <div className="error">{adminConfigError}</div>}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {slotTab === "leads" && (
                  <>
                    <div className="flex" style={{ marginBottom: 12, flexWrap: "wrap" }}>
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

                {slotTab === "whatsapp" && (
                  <div className="card card-compact">
                    <div className="header">
                      <div>
                        <div className="section-label">WhatsApp</div>
                        <div className="section-title">Connect this slot</div>
                      </div>
                      <div className="flex" style={{ flexWrap: "wrap" }}>
                        {qrBySlot[selectedSlotId] ? (
                          <>
                            <button
                              className="btn btn-primary"
                              onClick={() => refreshQr(selectedSlotId)}
                              disabled={Boolean(qrBusyBySlot[selectedSlotId])}
                            >
                              {qrBusyBySlot[selectedSlotId] ? "Refreshing..." : "Refresh QR"}
                            </button>
                            <button
                              className="btn btn-secondary"
                              onClick={() => handleHideQr(selectedSlotId)}
                              disabled={Boolean(qrBusyBySlot[selectedSlotId])}
                            >
                              Hide
                            </button>
                          </>
                        ) : (
                          <button
                            className="btn btn-primary"
                            onClick={() => handleShowQr(selectedSlotId)}
                            disabled={Boolean(qrBusyBySlot[selectedSlotId])}
                          >
                            {qrBusyBySlot[selectedSlotId] ? "Loading..." : "Show QR"}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      Scan in WhatsApp → Linked devices. QR refreshes every 15 seconds while visible.
                    </div>
                    {qrErrorBySlot[selectedSlotId] && (
                      <div className="error" style={{ marginTop: 8 }}>
                        {qrErrorBySlot[selectedSlotId]}
                      </div>
                    )}
                    {qrBySlot[selectedSlotId] && (
                      <div style={{ marginTop: 16 }}>
                        <img
                          src={qrBySlot[selectedSlotId]}
                          alt={`WhatsApp QR for ${selectedSlotId}`}
                          style={{ maxWidth: 320 }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {slotTab === "remote-login" && (
                  <div className="card card-compact">
                    <div className="header">
                      <div>
                        <div className="section-label">Remote Login</div>
                        <div className="section-title">Repair browser session</div>
                      </div>
                      <div className="flex" style={{ flexWrap: "wrap" }}>
                        <button
                          className="btn btn-primary"
                          onClick={() => handleRemoteLogin(selectedSlotId)}
                          disabled={Boolean(remoteLoginBusyBySlot[selectedSlotId])}
                        >
                          {remoteLoginBusyBySlot[selectedSlotId] ? "Starting..." : "Start"}
                        </button>
                      </div>
                    </div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      Starts a token-gated VNC session. The slot is stopped before login.
                    </div>
                    {remoteLoginErrorBySlot[selectedSlotId] && (
                      <div className="error" style={{ marginTop: 8 }}>
                        {remoteLoginErrorBySlot[selectedSlotId]}
                      </div>
                    )}
                    {remoteLoginBySlot[selectedSlotId] && (
                      <div style={{ marginTop: 12 }}>
                        <div className="mono" style={{ marginBottom: 6 }}>
                          Expires: {new Date(remoteLoginBySlot[selectedSlotId].expires_at).toLocaleString()}
                        </div>
                        <div className="mono" style={{ marginBottom: 6 }}>
                          VNC: {remoteLoginBySlot[selectedSlotId].vnc_host}:
                          {remoteLoginBySlot[selectedSlotId].vnc_port}
                        </div>
                        <a
                          className="btn btn-secondary"
                          href={remoteLoginBySlot[selectedSlotId].url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open Remote Login
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
      </div>
    </div>
  );
}
