import { useEffect, useState } from "react";
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
  const signIn = () => {
    window.location.href = getLoginUrl();
  };

  return (
    <div className="page">
      <div className="app-shell">
        <div className="card hero-card">
          <div className="hero-title">Sign in with Google</div>
          <div className="hero-subtitle">You’ll be redirected to Google and back with a secure token.</div>
          <button className="btn btn-primary" onClick={signIn} disabled={loading}>
            {loading ? "Checking session..." : "Continue with Google"}
          </button>
          {error && (
            <div className="error" style={{ marginTop: 12 }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AuthedApp({ token, user, onSignOut }: { token: string; user: User; onSignOut: () => void }) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = "dark";
    root.dataset.role = user.role ?? "client";
  }, [user.role]);

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/slots" replace />} />
      <Route path="/slots" element={<ControlPlanePage token={token} user={user} onSignOut={onSignOut} />} />
      <Route
        path="/slots/:slotId"
        element={<ControlPlanePage token={token} user={user} onSignOut={onSignOut} />}
      />
      <Route path="*" element={<Navigate to="/slots" replace />} />
    </Routes>
  );
}

export default function App() {
  const { token, user, loading, error, signOut } = useAuth();

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
