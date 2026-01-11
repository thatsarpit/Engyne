import { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { User, clearToken, extractTokenFromHash, fetchMe, getLoginUrl, loadToken, saveToken } from "../api";
import ControlPlanePage from "../pages/ControlPlanePage";

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
      .then((me) => {
        if (!cancelled) setUser(me);
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

  const signOut = () => {
    clearToken();
    setUser(null);
    setToken(null);
  };

  return { token, user, loading, error, signOut };
}

function LoginPage({
  loading,
  error,
}: {
  loading: boolean;
  error: string | null;
}) {
  useEffect(() => {
    document.body.dataset.surface = "auth";
  }, []);

  const signIn = () => {
    window.location.href = getLoginUrl();
  };

  return (
    <div className="auth-shell auth-shell--login">
      <div className="auth-grid auth-grid--login">
        <div className="auth-hero">
          <div className="auth-brand">
            <div className="pill">ENGYNE</div>
            <div className="auth-kicker">Control plane</div>
          </div>
          <h1 className="auth-title">Lead ops, orchestrated.</h1>
          <p className="auth-subtitle">
            Secure, slot-based automation to capture verified leads, keep compliance tight, and
            act fast when opportunity hits.
          </p>
          <ul className="auth-points">
            <li>
              <div className="auth-point-title">Slot isolation</div>
              <div className="auth-point-text">Each slot runs as a sealed identity with its own state.</div>
            </li>
            <li>
              <div className="auth-point-title">Real-time oversight</div>
              <div className="auth-point-text">Heartbeat, logs, and actions stay visible at all times.</div>
            </li>
          </ul>
        </div>
        <div className="auth-side">
          <div className="card auth-panel auth-panel--login">
            <div className="auth-card-header">
              <div>
                <div className="section-label">Welcome back</div>
                <div className="auth-card-title">Sign in to Engyne</div>
                <div className="auth-card-subtitle">Use your authorized Google account to continue.</div>
              </div>
            </div>
            <div className="auth-card-body">
              <button className="btn btn-primary auth-google-btn" onClick={signIn} disabled={loading}>
                <span className="auth-google-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M21.8 12.2c0-.7-.1-1.3-.2-1.9H12v3.7h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.3c1.9-1.7 3-4.3 3-7.5Z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 22c2.7 0 5-1 6.7-2.6l-3.3-2.6c-.9.6-2.1 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H2.9v2.6A9.9 9.9 0 0 0 12 22Z"
                    />
                    <path
                      fill="currentColor"
                      d="M6.4 13.7A5.9 5.9 0 0 1 6.1 12c0-.6.1-1.2.3-1.7V7.7H2.9A9.9 9.9 0 0 0 2 12c0 1.6.4 3.1 1 4.3l3.4-2.6Z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 6.5c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.2 9.2 0 0 0 12 2a9.9 9.9 0 0 0-9.1 5.7l3.4 2.6C7.2 8.1 9.4 6.5 12 6.5Z"
                    />
                  </svg>
                </span>
                {loading ? "Checking session..." : "Continue with Google"}
              </button>
              <div className="auth-footnote">You will be redirected to Google and returned with a secure token.</div>
              {error && <div className="error">{error}</div>}
            </div>
            <div className="auth-divider" />
            <div className="auth-alt-inline">
              <div className="label">More options</div>
              <div className="auth-soon-inline">Demo, email, and SSO sign-in are coming soon.</div>
            </div>
          </div>
          <div className="auth-help">
            <span className="muted">Need access?</span>{" "}
            <a className="auth-link" href="mailto:admin@engyne.space">
              Contact admin@engyne.space
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthedApp({ token, user, onSignOut }: { token: string; user: User; onSignOut: () => void }) {
  const theme = useMemo(() => {
    const hour = new Date().getHours();
    return hour >= 7 && hour < 19 ? "light" : "dark";
  }, []);

  useEffect(() => {
    document.body.dataset.surface = "app";

    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.role = user.role ?? "client";
    const interval = window.setInterval(() => {
      const hour = new Date().getHours();
      const nextTheme = hour >= 7 && hour < 19 ? "light" : "dark";
      if (root.dataset.theme !== nextTheme) {
        root.dataset.theme = nextTheme;
      }
    }, 60_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [theme, user.role]);

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) event.preventDefault();
    };

    const handleKeydown = (event: KeyboardEvent) => {
      const isZoomKey = event.key === "+" || event.key === "-" || event.key === "=" || event.key === "0";
      if ((event.ctrlKey || event.metaKey) && isZoomKey) {
        event.preventDefault();
      }
    };

    const handleGesture = (event: Event) => {
      event.preventDefault();
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeydown);
    document.addEventListener("gesturestart", handleGesture, { passive: false } as AddEventListenerOptions);
    document.addEventListener("gesturechange", handleGesture, { passive: false } as AddEventListenerOptions);

    return () => {
      window.removeEventListener("wheel", handleWheel as EventListener);
      window.removeEventListener("keydown", handleKeydown as EventListener);
      document.removeEventListener("gesturestart", handleGesture as EventListener);
      document.removeEventListener("gesturechange", handleGesture as EventListener);
    };
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route path="/overview" element={<ControlPlanePage token={token} user={user} onSignOut={onSignOut} />} />
      <Route path="/analytics" element={<ControlPlanePage token={token} user={user} onSignOut={onSignOut} />} />
      <Route path="/account" element={<ControlPlanePage token={token} user={user} onSignOut={onSignOut} />} />
      <Route path="/clients" element={<ControlPlanePage token={token} user={user} onSignOut={onSignOut} />} />
      <Route path="/slots" element={<ControlPlanePage token={token} user={user} onSignOut={onSignOut} />} />
      <Route path="/slots/:slotId" element={<ControlPlanePage token={token} user={user} onSignOut={onSignOut} />} />
      <Route path="/alerts" element={<ControlPlanePage token={token} user={user} onSignOut={onSignOut} />} />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}

export default function App() {
  const { token, user, loading, error, signOut } = useAuth();

  useEffect(() => {
    const root = document.documentElement;
    const hour = new Date().getHours();
    root.dataset.theme = hour >= 7 && hour < 19 ? "light" : "dark";
    const interval = window.setInterval(() => {
      const nextHour = new Date().getHours();
      const nextTheme = nextHour >= 7 && nextHour < 19 ? "light" : "dark";
      if (root.dataset.theme !== nextTheme) {
        root.dataset.theme = nextTheme;
      }
    }, 60_000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return (
    <BrowserRouter>
      {!token || !user ? (
        <LoginPage loading={loading} error={error} />
      ) : (
        <AuthedApp token={token} user={user} onSignOut={signOut} />
      )}
    </BrowserRouter>
  );
}
