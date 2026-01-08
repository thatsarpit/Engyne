import { useEffect, useMemo, useState } from "react";
import {
  SlotSummary,
  clearToken,
  extractTokenFromHash,
  fetchMe,
  fetchSlots,
  getLoginUrl,
  loadToken,
  restartSlot,
  saveToken,
  startSlot,
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
  busy,
}: {
  slot: SlotSummary;
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
        <div className="flex" style={{ gap: 6 }}>
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
  onStart,
  onStop,
  onRestart,
  busy,
}: {
  slots: SlotSummary[];
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
            busy={slotActionBusy}
          />
        </>
      )}
    </div>
  );
}
