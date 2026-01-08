import { useEffect, useMemo, useState } from "react";
import {
  RemoteLoginStartResponse,
  SlotSummary,
  clearToken,
  extractTokenFromHash,
  fetchMe,
  fetchSlots,
  fetchWhatsappQr,
  getLoginUrl,
  loadToken,
  restartSlot,
  saveToken,
  startSlot,
  startRemoteLogin,
  startWhatsappSession,
  stopSlot,
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
  onStart: (slotId: string) => void;
  onStop: (slotId: string) => void;
  onRestart: (slotId: string) => void;
  onShowQr: (slotId: string) => void;
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
            <button className="btn btn-secondary" onClick={() => onStart(slot.slot_id)} disabled={busy}>
              Start
            </button>
            <button className="btn btn-secondary" onClick={() => onStop(slot.slot_id)} disabled={busy}>
              Stop
            </button>
            <button className="btn btn-secondary" onClick={() => onRestart(slot.slot_id)} disabled={busy}>
              Restart
            </button>
            <button className="btn btn-primary" onClick={() => onShowQr(slot.slot_id)} disabled={qrBusy}>
              {qrBusy ? "Loading WA QR..." : "WhatsApp QR"}
            </button>
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
                Scan the WhatsApp QR with the device for slot {slot.slot_id}
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
  onStart,
  onStop,
  onRestart,
  onShowQr,
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
  onStart: (slotId: string) => void;
  onStop: (slotId: string) => void;
  onRestart: (slotId: string) => void;
  onShowQr: (slotId: string) => void;
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
                onStart={onStart}
                onStop={onStop}
                onRestart={onRestart}
                onShowQr={onShowQr}
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

export default function App() {
  const { token, user, loading, error, setToken, setUser } = useAuth();
  const [slots, setSlots] = useState<SlotSummary[]>([]);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [slotLoading, setSlotLoading] = useState(false);
  const [slotActionBusy, setSlotActionBusy] = useState(false);
  const [qrBySlot, setQrBySlot] = useState<Record<string, string>>({});
  const [qrBusyBySlot, setQrBusyBySlot] = useState<Record<string, boolean>>({});
  const [qrErrorBySlot, setQrErrorBySlot] = useState<Record<string, string | null>>({});
  const [remoteLoginBySlot, setRemoteLoginBySlot] = useState<
    Record<string, RemoteLoginStartResponse>
  >({});
  const [remoteLoginBusyBySlot, setRemoteLoginBusyBySlot] = useState<Record<string, boolean>>({});
  const [remoteLoginErrorBySlot, setRemoteLoginErrorBySlot] = useState<
    Record<string, string | null>
  >({});

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

  const handleShowQr = async (slotId: string) => {
    if (!token) return;
    setQrBusyBySlot((prev) => ({ ...prev, [slotId]: true }));
    setQrErrorBySlot((prev) => ({ ...prev, [slotId]: null }));
    try {
      await startWhatsappSession(slotId, token);
      const blob = await fetchWhatsappQr(slotId, token);
      const url = URL.createObjectURL(blob);
      setQrBySlot((prev) => {
        const next = { ...prev };
        if (next[slotId]) {
          URL.revokeObjectURL(next[slotId]);
        }
        next[slotId] = url;
        return next;
      });
    } catch (err) {
      console.error(err);
      setQrErrorBySlot((prev) => ({ ...prev, [slotId]: "Unable to load WhatsApp QR" }));
    } finally {
      setQrBusyBySlot((prev) => ({ ...prev, [slotId]: false }));
    }
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

  const signOut = () => {
    clearToken();
    setToken(null);
    setUser(null);
    setSlots([]);
  };

  const loadSlots = async () => {
    if (!token) return;
    setSlotLoading(true);
    setSlotError(null);
    try {
      const data = await fetchSlots(token);
      setSlots(data);
    } catch (err) {
      console.error(err);
      setSlotError("Unable to load slots");
    } finally {
      setSlotLoading(false);
    }
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
  }, [canFetch]);

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
          {slotError && <div className="error">{slotError}</div>}
          {slotLoading && <div className="muted">Refreshing slots…</div>}
          <SlotTable
            slots={slots}
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
        </>
      )}
    </div>
  );
}
