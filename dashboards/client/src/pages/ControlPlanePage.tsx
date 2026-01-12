import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as Dialog from "@radix-ui/react-dialog";
import { TableVirtuoso } from "react-virtuoso";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";
import {
  RemoteLoginStartResponse,
  SlotSummary,
  AnalyticsSummary,
  AnalyticsSlotResponse,
  ClientSummary,
  SubscriptionEntry,
  fetchAnalyticsSummary,
  fetchSlotAnalytics,
  fetchClients,
  fetchSubscriptions,
  upsertSubscription,
  fetchSlotDetail,
  fetchSlotLeads,
  fetchVapidPublicKey,
  fetchClusterSlots,
  fetchSlots,
  fetchWhatsappQr,
  provisionSlot,
  inviteUser,
  restartSlot,
  previewSlotConfig,
  subscribePush,
  startSlot,
  startRemoteLogin,
  startWhatsappSession,
  stopSlot,
  unsubscribePush,
  replaceSlotConfig,
  updateSlotConfig,
  ConfigPreviewResponse,
  LeadItem,
  SlotDetail,
  User,
} from "../api";
import { NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { useThemeMode } from "../app/theme";

function Badge({ text, tone }: { text: string; tone?: "green" | "amber" | "red" }) {
  return <span className={`badge ${tone ?? ""}`}>{text}</span>;
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone?: "green" | "amber" | "red";
}) {
  return (
    <span className={`status-pill ${tone ?? ""}`}>
      <span className="status-dot" />
      {label}
    </span>
  );
}

type NavItem = {
  id: string;
  label: string;
  to: string;
  icon: ReactNode;
};

function Sidebar({
  collapsed,
  onToggle,
  selectedSlotId,
  user,
  isMobile,
  isOpen,
  onNavigate,
}: {
  collapsed: boolean;
  onToggle: () => void;
  selectedSlotId: string | null;
  user: User;
  isMobile: boolean;
  isOpen: boolean;
  onNavigate: () => void;
}) {
  const location = useLocation();
  const slotDetailTo = selectedSlotId ? `/slots/${encodeURIComponent(selectedSlotId)}` : "/slots";
  const shouldCollapse = !isMobile && collapsed;
  const navItems: NavItem[] = [
    {
      id: "overview",
      label: "Overview",
      to: "/overview",
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4h7v7H4V4zm0 9h7v7H4v-7zm9-9h7v11h-7V4zm0 13h7v3h-7v-3z" />
        </svg>
      ),
    },
    {
      id: "analytics",
      label: "Analytics",
      to: "/analytics",
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 19h14v2H5v-2zm1-9h3v7H6v-7zm5-4h3v11h-3V6zm5 6h3v5h-3v-5z" />
        </svg>
      ),
    },
    {
      id: "slots",
      label: "Slots",
      to: "/slots",
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6h16v4H4V6zm0 6h16v4H4v-4zm0 6h10v2H4v-2z" />
        </svg>
      ),
    },
    {
      id: "detail",
      label: "Slot Detail",
      to: slotDetailTo,
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 4h14v16H5V4zm2 3h10v2H7V7zm0 4h10v2H7v-2zm0 4h6v2H7v-2z" />
        </svg>
      ),
    },
    {
      id: "alerts",
      label: "Alerts",
      to: "/alerts",
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3a6 6 0 0 1 6 6v4l2 3H4l2-3V9a6 6 0 0 1 6-6zm0 18a2.5 2.5 0 0 0 2.3-1.5h-4.6A2.5 2.5 0 0 0 12 21z" />
        </svg>
      ),
    },
  ];

  if (user.role === "admin") {
    navItems.push({
      id: "clients",
      label: "Clients",
      to: "/clients",
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm8 0a3 3 0 1 1 0-6 3 3 0 0 1 0 6zM3 19a5 5 0 0 1 10 0H3zm8 0a5 5 0 0 1 10 0h-10z" />
        </svg>
      ),
    });
  }

  navItems.push({
    id: "account",
    label: "Account",
    to: "/account",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm-7 9a7 7 0 0 1 14 0H5z" />
      </svg>
    ),
  });

  const pathname = location.pathname;

  return (
    <aside className={`sidebar ${shouldCollapse ? "collapsed" : ""} ${isMobile ? "mobile" : ""} ${isOpen ? "open" : ""}`}>
      <div className="sidebar-header">
        <div className="brand-mini">
          <div className="pill">ENGYNE</div>
          {!shouldCollapse && <span className="brand-label">Control Plane</span>}
        </div>
        <button className="icon-btn" onClick={onToggle} aria-label="Toggle sidebar">
          <span />
          <span />
        </button>
      </div>
      <nav className="sidebar-nav">
        <div className="nav-group">
          <div className="nav-title">Focus</div>
          {navItems.map((item) => {
            const isActive =
              item.id === "slots"
                ? pathname === "/slots"
                : item.id === "detail"
                  ? pathname.startsWith("/slots/")
                : item.id === "analytics"
                  ? pathname === "/analytics"
                  : item.id === "account"
                    ? pathname === "/account"
                    : item.id === "clients"
                      ? pathname === "/clients"
                    : pathname === item.to;
            return (
              <NavLink
                key={item.id}
                to={item.to}
                className={`nav-item ${isActive ? "active" : ""}`}
                onClick={onNavigate}
              >
                <span className="nav-icon">{item.icon}</span>
                {!shouldCollapse && <span className="nav-label">{item.label}</span>}
              </NavLink>
            );
          })}
        </div>
      </nav>
      <div className="sidebar-footer">
        <a className="nav-item" href="mailto:admin@engyne.space" onClick={onNavigate}>
          <span className="nav-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16v12H4V6zm8 6 8-5H4l8 5z" />
            </svg>
          </span>
          {!shouldCollapse && <span className="nav-label">Support</span>}
        </a>
      </div>
    </aside>
  );
}

function TopBar({
  user,
  onSignOut,
  title,
  subtitle,
  onMenuToggle,
  showMenuToggle,
}: {
  user: User;
  onSignOut: () => void;
  title: string;
  subtitle: string;
  onMenuToggle?: () => void;
  showMenuToggle?: boolean;
}) {
  const { mode, cycleMode } = useThemeMode();
  const themeLabel = mode === "auto" ? "Auto" : mode === "dark" ? "Dark" : "Light";

  return (
    <div className="topbar">
      <div className="topbar-left">
        {showMenuToggle && (
          <button className="btn btn-ghost btn-icon" onClick={onMenuToggle} aria-label="Open navigation">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z" />
            </svg>
          </button>
        )}
        <div className="brand">
          <div className="title">{title}</div>
          <div className="subtitle">{subtitle}</div>
        </div>
      </div>
      <div className="flex">
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              className="btn btn-ghost btn-icon"
              onClick={cycleMode}
              aria-label={`Theme: ${themeLabel}. Click to change.`}
              title={`Theme: ${themeLabel}`}
              type="button"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4a1 1 0 0 1 1 1v1.2a1 1 0 0 1-2 0V5a1 1 0 0 1 1-1Zm6.36 2.64a1 1 0 0 1 0 1.41l-.85.85a1 1 0 0 1-1.41-1.41l.85-.85a1 1 0 0 1 1.41 0ZM20 11a1 1 0 0 1 1 1 1 1 0 0 1-1 1h-1.2a1 1 0 0 1 0-2H20Zm-2.64 6.36a1 1 0 0 1-1.41 0l-.85-.85a1 1 0 1 1 1.41-1.41l.85.85a1 1 0 0 1 0 1.41ZM13 17.8a1 1 0 0 1-2 0V19a1 1 0 0 1 2 0v-1.2ZM8.05 16.51a1 1 0 0 1-1.41 1.41l-.85-.85a1 1 0 1 1 1.41-1.41l.85.85ZM5.2 13a1 1 0 0 1 0-2H4a1 1 0 0 1 0 2h1.2Zm2.44-3.09a1 1 0 0 1-1.41 0l-.85-.85a1 1 0 1 1 1.41-1.41l.85.85a1 1 0 0 1 0 1.41ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
              </svg>
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="tooltip-content" sideOffset={6}>
              Theme: {themeLabel} (click to toggle)
              <Tooltip.Arrow className="tooltip-arrow" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <div className="badge">{user.email}</div>
        <div className="badge green">{user.role}</div>
        <button className="btn btn-secondary" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function SlotRow({
  slot,
  showNode,
  onView,
  onStart,
  onStop,
  onRestart,
  onToggleSelect,
  selected,
  selectable,
  busy,
}: {
  slot: SlotSummary;
  showNode: boolean;
  onView: (slot: SlotSummary) => void;
  onStart: (slotId: string) => void;
  onStop: (slotId: string) => void;
  onRestart: (slotId: string) => void;
  onToggleSelect: (slotId: string) => void;
  selected: boolean;
  selectable: boolean;
  busy: boolean;
}) {
  const heartbeat =
    slot.heartbeat_ts && slot.heartbeat_age_seconds != null
      ? `${Math.round(slot.heartbeat_age_seconds)}s ago`
      : "—";
  const heartbeatTone =
    slot.heartbeat_age_seconds == null
      ? "amber"
      : slot.heartbeat_age_seconds > 15
        ? "red"
        : "green";
  const phaseTone =
    slot.phase?.toLowerCase() === "running"
      ? "green"
      : slot.phase?.toLowerCase() === "error"
        ? "red"
        : "amber";
  const pidLabel = slot.pid_alive == null ? "unknown" : slot.pid_alive ? "alive" : "stale";
  const pidTone = slot.pid_alive == null ? "amber" : slot.pid_alive ? "green" : "red";
  return (
    <tr className={selected ? "row-selected" : ""}>
      {selectable && (
        <td>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(slot.slot_id)}
            aria-label={`Select ${slot.slot_id}`}
          />
        </td>
      )}
      {showNode && <td className="mono">{slot.node_id ?? "local"}</td>}
      <td className="mono">{slot.slot_id}</td>
      <td>
        {slot.phase ? (
          <StatusPill label={slot.phase} tone={phaseTone as any} />
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td>{slot.pid ?? "—"}</td>
      <td>
        <StatusPill label={pidLabel} tone={pidTone as any} />
      </td>
      <td>
        <StatusPill label={heartbeat} tone={heartbeatTone as any} />
      </td>
      <td>{slot.leads_count ?? "0"}</td>
      <td>
        <span className="muted">
          cfg:{slot.has_config ? "✓" : "–"} st:{slot.has_state ? "✓" : "–"} snap:{slot.has_status ? "✓" : "–"}
        </span>
      </td>
      <td>
        <div className="table-actions">
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className="btn btn-secondary" onClick={() => onView(slot)} disabled={busy}>
                Open
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="tooltip-content" sideOffset={6}>
                Open slot detail
                <Tooltip.Arrow className="tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className="btn btn-ghost" onClick={() => onStart(slot.slot_id)} disabled={busy}>
                Start
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="tooltip-content" sideOffset={6}>
                Start slot worker
                <Tooltip.Arrow className="tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className="btn btn-ghost" onClick={() => onStop(slot.slot_id)} disabled={busy}>
                Stop
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="tooltip-content" sideOffset={6}>
                Stop slot worker
                <Tooltip.Arrow className="tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className="btn btn-ghost" onClick={() => onRestart(slot.slot_id)} disabled={busy}>
                Restart
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="tooltip-content" sideOffset={6}>
                Restart slot worker
                <Tooltip.Arrow className="tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>
      </td>
    </tr>
  );
}

function SlotCard({
  slot,
  showNode,
  onView,
  onStart,
  onStop,
  onRestart,
  onToggleSelect,
  selected,
  selectable,
  busy,
}: {
  slot: SlotSummary;
  showNode: boolean;
  onView: (slot: SlotSummary) => void;
  onStart: (slotId: string) => void;
  onStop: (slotId: string) => void;
  onRestart: (slotId: string) => void;
  onToggleSelect: (slotId: string) => void;
  selected: boolean;
  selectable: boolean;
  busy: boolean;
}) {
  const heartbeat =
    slot.heartbeat_ts && slot.heartbeat_age_seconds != null
      ? `${Math.round(slot.heartbeat_age_seconds)}s ago`
      : "—";
  const heartbeatTone =
    slot.heartbeat_age_seconds == null
      ? "amber"
      : slot.heartbeat_age_seconds > 15
        ? "red"
        : "green";
  const phaseTone =
    slot.phase?.toLowerCase() === "running"
      ? "green"
      : slot.phase?.toLowerCase() === "error"
        ? "red"
        : "amber";
  const pidLabel = slot.pid_alive == null ? "unknown" : slot.pid_alive ? "alive" : "stale";
  const pidTone = slot.pid_alive == null ? "amber" : slot.pid_alive ? "green" : "red";

  return (
    <div className={`slot-card-mobile ${selected ? "row-selected" : ""}`}>
      <div className="slot-card-header">
        <div className="slot-card-title">
          {selectable && (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(slot.slot_id)}
              aria-label={`Select ${slot.slot_id}`}
            />
          )}
          <span className="mono">{slot.slot_id}</span>
        </div>
        {slot.phase ? (
          <StatusPill label={slot.phase} tone={phaseTone as any} />
        ) : (
          <span className="muted">—</span>
        )}
      </div>

      <div className="slot-card-meta">
        {showNode && (
          <div className="slot-card-meta-item">
            <div className="section-label">Node</div>
            <div className="mono">{slot.node_id ?? "local"}</div>
          </div>
        )}
        <div className="slot-card-meta-item">
          <div className="section-label">Heartbeat</div>
          <StatusPill label={heartbeat} tone={heartbeatTone as any} />
        </div>
        <div className="slot-card-meta-item">
          <div className="section-label">PID</div>
          <StatusPill label={pidLabel} tone={pidTone as any} />
        </div>
        <div className="slot-card-meta-item">
          <div className="section-label">Leads</div>
          <div>{slot.leads_count ?? "0"}</div>
        </div>
      </div>

      <div className="slot-card-actions">
        <button className="btn btn-secondary btn-sm" onClick={() => onView(slot)} disabled={busy}>
          Open
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => onStart(slot.slot_id)} disabled={busy}>
          Start
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => onStop(slot.slot_id)} disabled={busy}>
          Stop
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => onRestart(slot.slot_id)} disabled={busy}>
          Restart
        </button>
      </div>
    </div>
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
  selectable,
  selectedSlotIds,
  onToggleSelect,
  onToggleSelectAll,
  loading,
  sortBy,
  sortDir,
  onSort,
  isAdmin,
  onProvision,
}: {
  slots: SlotSummary[];
  showNode: boolean;
  onView: (slot: SlotSummary) => void;
  onStart: (slotId: string) => void;
  onStop: (slotId: string) => void;
  onRestart: (slotId: string) => void;
  busy: boolean;
  selectable: boolean;
  selectedSlotIds: string[];
  onToggleSelect: (slotId: string) => void;
  onToggleSelectAll: () => void;
  loading: boolean;
  sortBy: SlotSortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SlotSortKey) => void;
  isAdmin: boolean;
  onProvision: () => void;
}) {
  if (!slots.length && !loading) {
    return (
      <div className="card empty-card">
        <div>
          <div className="section-label">Slots</div>
          <div className="section-title">No slots provisioned</div>
          <div className="muted">Create a slot to begin onboarding and capture leads.</div>
        </div>
        <div className="empty-actions">
          {isAdmin ? (
            <button className="btn btn-primary" onClick={onProvision}>
              Create first slot
            </button>
          ) : (
            <div className="muted">Ask an admin to provision a slot for you.</div>
          )}
        </div>
      </div>
    );
  }
  const allSelected = selectable && slots.length > 0 && slots.every((slot) => selectedSlotIds.includes(slot.slot_id));
  return (
    <div className="card table-card">
      <div className="header">
        <div>
          <div className="section-label">Slots</div>
          <div className="section-title">Active slots ({slots.length})</div>
        </div>
      </div>
      <Tooltip.Provider delayDuration={300}>
        <div className="table-wrap table-desktop">
          <table className="table table-modern">
            <thead>
              <tr>
                {selectable && (
                  <th>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={onToggleSelectAll}
                      aria-label="Select all slots"
                    />
                  </th>
                )}
                {showNode && <th>Node</th>}
                <th>
                  <button className="sort-btn" onClick={() => onSort("slot_id")}>
                    Slot ID
                    {sortBy === "slot_id" && (
                      <span className="sort-indicator">{sortDir === "asc" ? "↑" : "↓"}</span>
                    )}
                  </button>
                </th>
                <th>
                  <button className="sort-btn" onClick={() => onSort("phase")}>
                    Phase
                    {sortBy === "phase" && (
                      <span className="sort-indicator">{sortDir === "asc" ? "↑" : "↓"}</span>
                    )}
                  </button>
                </th>
                <th>PID</th>
                <th>PID Status</th>
                <th>
                  <button className="sort-btn" onClick={() => onSort("heartbeat")}>
                    Heartbeat
                    {sortBy === "heartbeat" && (
                      <span className="sort-indicator">{sortDir === "asc" ? "↑" : "↓"}</span>
                    )}
                  </button>
                </th>
                <th>
                  <button className="sort-btn" onClick={() => onSort("leads")}>
                    Leads
                    {sortBy === "leads" && (
                      <span className="sort-indicator">{sortDir === "asc" ? "↑" : "↓"}</span>
                    )}
                  </button>
                </th>
                <th>Files</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 4 }).map((_, index) => (
                    <tr key={`skeleton-${index}`} className="skeleton-row">
                      {selectable && (
                        <td>
                          <div className="skeleton skeleton-checkbox" />
                        </td>
                      )}
                      {showNode && (
                        <td>
                          <div className="skeleton skeleton-text" />
                        </td>
                      )}
                      {Array.from({ length: 7 }).map((__, cellIndex) => (
                        <td key={`cell-${cellIndex}`}>
                          <div className="skeleton skeleton-text" />
                        </td>
                      ))}
                    </tr>
                  ))
                : slots.map((slot) => (
                    <SlotRow
                      key={slot.slot_id}
                      slot={slot}
                      showNode={showNode}
                      onView={onView}
                      onStart={onStart}
                      onStop={onStop}
                      onRestart={onRestart}
                      onToggleSelect={onToggleSelect}
                      selected={selectedSlotIds.includes(slot.slot_id)}
                      selectable={selectable}
                      busy={busy}
                    />
                  ))}
            </tbody>
          </table>
        </div>
        <div className="slot-card-list">
          {slots.map((slot) => (
            <SlotCard
              key={slot.slot_id}
              slot={slot}
              showNode={showNode}
              onView={onView}
              onStart={onStart}
              onStop={onStop}
              onRestart={onRestart}
              onToggleSelect={onToggleSelect}
              selected={selectedSlotIds.includes(slot.slot_id)}
              selectable={selectable}
              busy={busy}
            />
          ))}
        </div>
      </Tooltip.Provider>
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

const CONTACT_METHOD_OPTIONS = [
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "whatsapp", label: "WhatsApp" },
];

type ConfigDraft = {
  quality_level: number;
  max_clicks_per_cycle: number;
  max_run_minutes: number;
  allowed_countries: string;
  keywords: string;
  keywords_exclude: string;
  required_contact_methods: string[];
  keyword_fuzzy: boolean;
  keyword_fuzzy_threshold: number;
  dry_run: boolean;
  channels: Record<string, boolean>;
};

type SlotTabKey = "overview" | "config" | "leads" | "whatsapp" | "remote-login";
type SlotSortKey = "slot_id" | "phase" | "heartbeat" | "leads";
type LeadSortKey = "observed_at" | "country" | "verified";

function splitList(value: string): string[] {
  return value
    .split(/[,;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getSlotSortValue(slot: SlotSummary, key: SlotSortKey): string | number {
  switch (key) {
    case "slot_id":
      return slot.slot_id;
    case "phase":
      return slot.phase ?? "";
    case "leads":
      return slot.leads_count ?? 0;
    case "heartbeat":
    default:
      return slot.heartbeat_age_seconds ?? Number.POSITIVE_INFINITY;
  }
}

function getLeadSortValue(lead: LeadItem, key: LeadSortKey): string | number {
  switch (key) {
    case "country":
      return lead.country ?? "";
    case "verified":
      return lead.verified ? 1 : 0;
    case "observed_at":
    default:
      return lead.observed_at ? new Date(lead.observed_at).getTime() : 0;
  }
}

function getLeadKey(lead: LeadItem): string {
  return lead.lead_id || `${lead.title ?? "lead"}-${lead.observed_at ?? "unknown"}`;
}

function arraysEqual<T>(left: T[], right: T[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function configDraftsEqual(left: ConfigDraft | null, right: ConfigDraft | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.quality_level === right.quality_level &&
    left.max_clicks_per_cycle === right.max_clicks_per_cycle &&
    left.max_run_minutes === right.max_run_minutes &&
    left.allowed_countries === right.allowed_countries &&
    left.keywords === right.keywords &&
    left.keywords_exclude === right.keywords_exclude &&
    left.keyword_fuzzy === right.keyword_fuzzy &&
    left.keyword_fuzzy_threshold === right.keyword_fuzzy_threshold &&
    left.dry_run === right.dry_run &&
    arraysEqual(left.required_contact_methods, right.required_contact_methods) &&
    Object.keys(left.channels).every((key) => left.channels[key] === right.channels[key]) &&
    Object.keys(right.channels).every((key) => left.channels[key] === right.channels[key])
  );
}

function formatCount(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString();
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString();
}

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{label}</div>
      <div className="chart-tooltip-list">
        {payload.map((item) => (
          <div className="chart-tooltip-row" key={item.dataKey as string}>
            <span className="chart-dot" style={{ background: item.color }} />
            <span>{item.name}</span>
            <span className="spacer" />
            <span>{formatCount(item.value as number)}</span>
          </div>
        ))}
      </div>
    </div>
  );
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
  const location = useLocation();
  const isOverviewView = location.pathname === "/overview";
  const isAnalyticsView = location.pathname === "/analytics";
  const isAccountView = location.pathname === "/account";
  const isClientsView = location.pathname === "/clients";
  const { slotId: routeSlotId } = useParams();
  const prefersReducedMotion = useReducedMotion();
  const [slotError, setSlotError] = useState<string | null>(null);
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
  const [slotTab, setSlotTab] = useState<SlotTabKey>("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => (typeof window !== "undefined" ? window.innerWidth < 1100 : false)
  );
  const [isMobileNav, setIsMobileNav] = useState(
    () => (typeof window !== "undefined" ? window.innerWidth < 1100 : false)
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pageContentRef = useRef<HTMLDivElement | null>(null);
  const stableSlotsRef = useRef<SlotSummary[]>([]);
  const stableAnalyticsSummaryRef = useRef<AnalyticsSummary | null>(null);
  const stableSubscriptionsRef = useRef<SubscriptionEntry[]>([]);
  const stableClientsRef = useRef<ClientSummary[]>([]);
  const [slotSearch, setSlotSearch] = useState("");
  const [slotPhaseFilter, setSlotPhaseFilter] = useState("all");
  const [slotSort, setSlotSort] = useState<SlotSortKey>("slot_id");
  const [slotSortDir, setSlotSortDir] = useState<"asc" | "desc">("asc");
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const [leadSearch, setLeadSearch] = useState("");
  const [leadSort, setLeadSort] = useState<LeadSortKey>("observed_at");
  const [leadSortDir, setLeadSortDir] = useState<"asc" | "desc">("desc");
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "warning" } | null>(
    null
  );
  
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
  const [configPreview, setConfigPreview] = useState<ConfigPreviewResponse | null>(null);
  const [configPreviewBusy, setConfigPreviewBusy] = useState(false);
  const [configPreviewError, setConfigPreviewError] = useState<string | null>(null);
  const [configPreviewDirty, setConfigPreviewDirty] = useState(false);
  const [adminConfigText, setAdminConfigText] = useState("");
  const [adminConfigSaving, setAdminConfigSaving] = useState(false);
  const [adminConfigError, setAdminConfigError] = useState<string | null>(null);
  const [newSlotId, setNewSlotId] = useState("");
  const [provisionBusy, setProvisionBusy] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSlots, setInviteSlots] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [subscriptionEmail, setSubscriptionEmail] = useState("");
  const [subscriptionSlot, setSubscriptionSlot] = useState("");
  const [subscriptionPlan, setSubscriptionPlan] = useState("yearly");
  const [subscriptionStatus, setSubscriptionStatus] = useState("active");
  const [subscriptionStarts, setSubscriptionStarts] = useState("");
  const [subscriptionEnds, setSubscriptionEnds] = useState("");
  const [subscriptionNotes, setSubscriptionNotes] = useState("");
  const [subscriptionBusy, setSubscriptionBusy] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [subscriptionSuccess, setSubscriptionSuccess] = useState<string | null>(null);

  const canFetch = useMemo(() => Boolean(token && user), [token, user]);
  const queryClient = useQueryClient();
  const slotsQuery = useQuery({
    queryKey: ["slots", viewMode],
    queryFn: () => (viewMode === "cluster" ? fetchClusterSlots(token) : fetchSlots(token)),
    enabled:
      canFetch && (isOverviewView || location.pathname === "/slots" || location.pathname.startsWith("/slots/")),
    refetchInterval: routeSlotId ? 15000 : 10000,
    staleTime: 5000,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous ?? [],
    notifyOnChangeProps: ["data", "isLoading", "isError"],
  });
  const slots = slotsQuery.data ?? stableSlotsRef.current;
  const slotLoading = slotsQuery.isLoading;
  const slotLoadError = slotsQuery.isError ? "Unable to load slots." : null;
  const selectedSlotSummary = useMemo(
    () => slots.find((slot) => slot.slot_id === selectedSlotId) || null,
    [slots, selectedSlotId]
  );
  const slotDetailQuery = useQuery({
    queryKey: ["slot-detail", selectedSlotId],
    queryFn: () => fetchSlotDetail(selectedSlotId as string, token),
    enabled: Boolean(token && selectedSlotId),
    placeholderData: (previous) => previous ?? null,
    staleTime: 8000,
    refetchOnWindowFocus: false,
    notifyOnChangeProps: ["data", "isLoading", "isError"],
  });
  const slotDetail = slotDetailQuery.data ?? null;
  const slotDetailLoading = slotDetailQuery.isLoading;
  const slotDetailFetching = slotDetailQuery.isFetching;
  const slotLeadsQuery = useQuery({
    queryKey: ["slot-leads", selectedSlotId, slotLeadsVerifiedOnly],
    queryFn: () => fetchSlotLeads(selectedSlotId as string, token, 200, slotLeadsVerifiedOnly),
    enabled: Boolean(token && selectedSlotId),
    placeholderData: (previous) => previous ?? [],
    notifyOnChangeProps: ["data", "isLoading", "isError"],
  });
  const slotLeads = slotLeadsQuery.data ?? [];
  const slotLeadsLoading = slotLeadsQuery.isLoading;
  const analyticsSummaryQuery = useQuery({
    queryKey: ["analytics-summary"],
    queryFn: () => fetchAnalyticsSummary(token),
    enabled: canFetch && (isAnalyticsView || isOverviewView),
    refetchInterval: 60000,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous ?? null,
    notifyOnChangeProps: ["data", "isLoading", "isError"],
  });
  const analyticsSummary: AnalyticsSummary | null =
    analyticsSummaryQuery.data ?? stableAnalyticsSummaryRef.current ?? null;
  const analyticsLoading = analyticsSummaryQuery.isLoading;
  const analyticsError = analyticsSummaryQuery.isError ? "Unable to load analytics." : null;
  const analyticsSlotQuery = useQuery({
    queryKey: ["analytics-slot", selectedSlotId],
    queryFn: () => fetchSlotAnalytics(selectedSlotId as string, token),
    enabled: Boolean(token && selectedSlotId && isAnalyticsView),
    staleTime: 30000,
    placeholderData: (previous) => previous ?? null,
    notifyOnChangeProps: ["data", "isLoading", "isError"],
  });
  const analyticsSlot: AnalyticsSlotResponse | null = analyticsSlotQuery.data ?? null;
  const analyticsSlotLoading = analyticsSlotQuery.isLoading;
  const analyticsSlotError = analyticsSlotQuery.isError ? "Unable to load slot analytics." : null;
  const subscriptionsQuery = useQuery({
    queryKey: ["subscriptions"],
    queryFn: () => fetchSubscriptions(token),
    enabled: canFetch && (isAccountView || (isClientsView && user.role === "admin")),
    staleTime: 30000,
    placeholderData: (previous) => previous ?? [],
    notifyOnChangeProps: ["data", "isLoading", "isError"],
  });
  const subscriptions: SubscriptionEntry[] = subscriptionsQuery.data ?? stableSubscriptionsRef.current;
  const subscriptionsLoading = subscriptionsQuery.isLoading;
  const subscriptionsError = subscriptionsQuery.isError ? "Unable to load subscriptions." : null;
  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: () => fetchClients(token),
    enabled: canFetch && isClientsView && user.role === "admin",
    staleTime: 30000,
    placeholderData: (previous) => previous ?? [],
    notifyOnChangeProps: ["data", "isLoading", "isError"],
  });
  const clients: ClientSummary[] = clientsQuery.data ?? stableClientsRef.current;
  const clientsLoading = clientsQuery.isLoading;
  const clientsError = clientsQuery.isError ? "Unable to load clients." : null;
  useEffect(() => {
    if (slotsQuery.data !== undefined && !slotsQuery.isError) {
      stableSlotsRef.current = slotsQuery.data;
    }
  }, [slotsQuery.data, slotsQuery.isError]);

  useEffect(() => {
    if (analyticsSummaryQuery.data !== undefined && !analyticsSummaryQuery.isError) {
      stableAnalyticsSummaryRef.current = analyticsSummaryQuery.data;
    }
  }, [analyticsSummaryQuery.data, analyticsSummaryQuery.isError]);

  useEffect(() => {
    if (subscriptionsQuery.data !== undefined && !subscriptionsQuery.isError) {
      stableSubscriptionsRef.current = subscriptionsQuery.data;
    }
  }, [subscriptionsQuery.data, subscriptionsQuery.isError]);

  useEffect(() => {
    if (clientsQuery.data !== undefined && !clientsQuery.isError) {
      stableClientsRef.current = clientsQuery.data;
    }
  }, [clientsQuery.data, clientsQuery.isError]);
  const slotHealthStats = useMemo(() => {
    const total = slots.length;
    const unhealthy = slots.filter((slot) => (slot.heartbeat_age_seconds ?? 999) > 15).length;
    const active = slots.filter((slot) => (slot.heartbeat_age_seconds ?? 999) <= 15).length;
    return { total, unhealthy, active };
  }, [slots]);
  const slotOnboardingSteps = useMemo(() => {
    if (!selectedSlotSummary) return [];
    const hasConfig = selectedSlotSummary.has_config;
    const hasHeartbeat = (selectedSlotSummary.heartbeat_age_seconds ?? 999) < 10;
    const hasLeads = (selectedSlotSummary.leads_count ?? 0) > 0;
    return [
      { label: "Config saved", done: hasConfig },
      { label: "Heartbeat healthy", done: hasHeartbeat },
      { label: "Leads observed", done: hasLeads },
    ];
  }, [selectedSlotSummary]);
  const slotOnboardingProgress = useMemo(() => {
    if (!slotOnboardingSteps.length) return 0;
    const done = slotOnboardingSteps.filter((step) => step.done).length;
    return Math.round((done / slotOnboardingSteps.length) * 100);
  }, [slotOnboardingSteps]);
  const slotOnboardingComplete = slotOnboardingProgress === 100;
  const slotPhaseOptions = useMemo(() => {
    const phases = new Set<string>();
    slots.forEach((slot) => phases.add((slot.phase || "unknown").toLowerCase()));
    return Array.from(phases).sort();
  }, [slots]);
  const normalizedSearch = slotSearch.trim().toLowerCase();
  const filteredSlots = useMemo(() => {
    return slots.filter((slot) => {
      if (normalizedSearch) {
        const haystack = `${slot.slot_id} ${slot.node_id ?? ""}`.toLowerCase();
        if (!haystack.includes(normalizedSearch)) return false;
      }
      if (slotPhaseFilter !== "all") {
        const phase = (slot.phase || "unknown").toLowerCase();
        if (phase !== slotPhaseFilter) return false;
      }
      return true;
    });
  }, [slots, normalizedSearch, slotPhaseFilter]);
  const sortedSlots = useMemo(() => {
    const data = [...filteredSlots];
    const factor = slotSortDir === "asc" ? 1 : -1;
    data.sort((a, b) => {
      const aVal = getSlotSortValue(a, slotSort);
      const bVal = getSlotSortValue(b, slotSort);
      if (typeof aVal === "number" && typeof bVal === "number") {
        return (aVal - bVal) * factor;
      }
      return String(aVal).localeCompare(String(bVal)) * factor;
    });
    return data;
  }, [filteredSlots, slotSort, slotSortDir]);
  const normalizedLeadSearch = leadSearch.trim().toLowerCase();
  const filteredLeads = useMemo(() => {
    return slotLeads.filter((lead) => {
      if (!normalizedLeadSearch) return true;
      const haystack = `${lead.title ?? ""} ${lead.country ?? ""} ${lead.contact ?? ""} ${lead.email ?? ""} ${lead.phone ?? ""}`.toLowerCase();
      return haystack.includes(normalizedLeadSearch);
    });
  }, [slotLeads, normalizedLeadSearch]);
  const sortedLeads = useMemo(() => {
    const data = [...filteredLeads];
    const factor = leadSortDir === "asc" ? 1 : -1;
    data.sort((a, b) => {
      const aVal = getLeadSortValue(a, leadSort);
      const bVal = getLeadSortValue(b, leadSort);
      if (typeof aVal === "number" && typeof bVal === "number") {
        return (aVal - bVal) * factor;
      }
      return String(aVal).localeCompare(String(bVal)) * factor;
    });
    return data;
  }, [filteredLeads, leadSort, leadSortDir]);
  const leadTableComponents = useMemo(
    () => ({
      Table: (props: React.HTMLAttributes<HTMLTableElement>) => (
        <table {...props} className="table table-modern" />
      ),
      TableHead: (props: React.HTMLAttributes<HTMLTableSectionElement>) => <thead {...props} />,
      TableRow: (props: React.HTMLAttributes<HTMLTableRowElement>) => {
        const index = Number(props["data-index"]);
        const lead = Number.isNaN(index) ? null : sortedLeads[index];
        const selected = lead ? selectedLeadIds.includes(getLeadKey(lead)) : false;
        const className = [props.className, selected ? "row-selected" : ""].filter(Boolean).join(" ");
        return <tr {...props} className={className} />;
      },
    }),
    [sortedLeads, selectedLeadIds]
  );
  const verifiedLeadCount = useMemo(
    () => slotLeads.filter((lead) => lead.verified).length,
    [slotLeads]
  );
  const analyticsTotals = useMemo(
    () =>
      analyticsSummary?.totals ?? {
        observed: 0,
        kept: 0,
        rejected: 0,
        clicked: 0,
        verified: 0,
      },
    [analyticsSummary]
  );
  const analyticsKeepRate = useMemo(() => {
    if (!analyticsTotals.observed) return 0;
    return (analyticsTotals.kept / analyticsTotals.observed) * 100;
  }, [analyticsTotals]);
  const analyticsVerifyRate = useMemo(() => {
    if (!analyticsTotals.observed) return 0;
    return (analyticsTotals.verified / analyticsTotals.observed) * 100;
  }, [analyticsTotals]);
  const analyticsClickRate = useMemo(() => {
    if (!analyticsTotals.observed) return 0;
    return (analyticsTotals.clicked / analyticsTotals.observed) * 100;
  }, [analyticsTotals]);
  const analyticsPerSlot = useMemo(() => {
    if (!analyticsSummary) return [];
    return [...analyticsSummary.per_slot].sort(
      (a, b) => b.metrics.verified - a.metrics.verified || b.metrics.kept - a.metrics.kept
    );
  }, [analyticsSummary]);
  const analyticsSeries = analyticsSlot?.series ?? [];
  const analyticsChartData = useMemo(() => {
    return analyticsSeries.map((entry) => ({
      day: entry.day,
      label: entry.day.slice(5),
      observed: entry.metrics.observed,
      kept: entry.metrics.kept,
      verified: entry.metrics.verified,
      clicked: entry.metrics.clicked,
    }));
  }, [analyticsSeries]);
  const analyticsRangeLabel = useMemo(() => {
    if (!analyticsSummary) return "Last 30 days";
    return `${analyticsSummary.range_start} → ${analyticsSummary.range_end}`;
  }, [analyticsSummary]);
  const subscriptionsByEmail = useMemo(() => {
    const map = new Map<string, SubscriptionEntry[]>();
    subscriptions.forEach((entry) => {
      const key = entry.email || "";
      if (!key) return;
      const list = map.get(key) ?? [];
      list.push(entry);
      map.set(key, list);
    });
    return map;
  }, [subscriptions]);
  const clientStats = useMemo(() => {
    const total = clients.length;
    const admins = clients.filter((client) => client.role === "admin").length;
    const regular = clients.filter((client) => client.role === "client").length;
    return { total, admins, regular };
  }, [clients]);
  const selectable = viewMode === "local";
  const selectedSlots = useMemo(
    () => slots.filter((slot) => selectedSlotIds.includes(slot.slot_id)),
    [slots, selectedSlotIds]
  );
  const bulkDisabledReason = useMemo(() => {
    if (!selectedSlotIds.length) return "Select one or more slots.";
    if (!selectable) return "Bulk actions are available in Local view only.";
    if (selectedSlots.some((slot) => slot.node_id && slot.node_id !== "local")) {
      return "Bulk actions are only available for local slots.";
    }
    return null;
  }, [selectedSlotIds.length, selectable, selectedSlots]);
  const selectedHeartbeat = useMemo(() => {
    if (!selectedSlotSummary) return "—";
    const age = selectedSlotSummary.heartbeat_age_seconds;
    return age != null ? `${Math.round(age)}s ago` : "—";
  }, [selectedSlotSummary]);
  const selectedPidStatus =
    selectedSlotSummary?.pid_alive == null ? "unknown" : selectedSlotSummary.pid_alive ? "alive" : "stale";
  const selectedPhaseTone =
    selectedSlotSummary?.phase?.toLowerCase() === "error"
      ? "red"
      : selectedSlotSummary?.phase?.toLowerCase() === "running"
        ? "green"
        : "amber";

  const activeView: "overview" | "slots" | "detail" | "alerts" | "analytics" | "account" | "clients" = useMemo(() => {
    if (location.pathname === "/overview") return "overview";
    if (isAnalyticsView) return "analytics";
    if (isAccountView) return "account";
    if (isClientsView) return "clients";
    if (location.pathname === "/alerts") return "alerts";
    if (location.pathname.startsWith("/slots/")) return "detail";
    return "slots";
  }, [isAnalyticsView, isAccountView, isClientsView, location.pathname]);

  const topbarTitle = useMemo(() => {
    switch (activeView) {
      case "overview":
        return "Overview";
      case "alerts":
        return "Alerts";
      case "detail":
        return "Slot detail";
      case "analytics":
        return "Analytics";
      case "account":
        return "Account";
      case "clients":
        return "Clients";
      case "slots":
      default:
        return "Slots";
    }
  }, [activeView]);

  const topbarSubtitle = useMemo(() => {
    switch (activeView) {
      case "overview":
        return "High-level health, provisioning, and access.";
      case "alerts":
        return "Notifications and delivery status for this device.";
      case "detail":
        return "Config, leads, and login tools for a slot.";
      case "analytics":
        return "Lead volume, conversion, and slot performance trends.";
      case "account":
        return user.role === "admin"
          ? "Manage client access, subscriptions, and billing basics."
          : "Subscription details and account access.";
      case "clients":
        return "Active customers, slot access, and subscription status.";
      case "slots":
      default:
        return "Track slot health, actions, and delivery.";
    }
  }, [activeView]);

  const showToast = useCallback((message: string, tone: "success" | "error" | "warning" = "success") => {
    setToast({ message, tone });
  }, []);

  const handleSlotAction = async (
    fn: (slotId: string, token: string) => Promise<any>,
    slotId: string,
    label: string
  ) => {
    if (!token) return;
    setSlotActionBusy(true);
    try {
      await fn(slotId, token);
      await queryClient.invalidateQueries({ queryKey: ["slots"] });
      if (selectedSlotId === slotId) {
        await queryClient.invalidateQueries({ queryKey: ["slot-detail", slotId] });
      }
      showToast(`${label} sent to ${slotId}.`, "success");
    } catch (err) {
      console.error(err);
      setSlotError("Slot action failed.");
      showToast("Slot action failed.", "error");
    } finally {
      setSlotActionBusy(false);
    }
  };

  const handleBulkAction = async (
    fn: (slotId: string, token: string) => Promise<any>,
    label: string
  ) => {
    if (!token || bulkDisabledReason) {
      showToast(bulkDisabledReason || "Select slots first.", "warning");
      return;
    }
    setSlotActionBusy(true);
    try {
      await Promise.all(selectedSlotIds.map((slotId) => fn(slotId, token)));
      await queryClient.invalidateQueries({ queryKey: ["slots"] });
      showToast(`${label} sent to ${selectedSlotIds.length} slots.`, "success");
      setSelectedSlotIds([]);
    } catch (err) {
      console.error(err);
      setSlotError("Bulk action failed.");
      showToast("Bulk action failed.", "error");
    } finally {
      setSlotActionBusy(false);
    }
  };

  const toggleSelectSlot = (slotId: string) => {
    setSelectedSlotIds((prev) =>
      prev.includes(slotId) ? prev.filter((id) => id !== slotId) : [...prev, slotId]
    );
  };

  const toggleSelectAll = () => {
    if (!selectable) return;
    const allSelected = sortedSlots.length > 0 && sortedSlots.every((slot) => selectedSlotIds.includes(slot.slot_id));
    setSelectedSlotIds(allSelected ? [] : sortedSlots.map((slot) => slot.slot_id));
  };

  const handleSlotSort = (key: SlotSortKey) => {
    if (slotSort === key) {
      setSlotSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSlotSort(key);
    setSlotSortDir(key === "leads" ? "desc" : "asc");
  };

  const handleLeadSort = (key: LeadSortKey) => {
    if (leadSort === key) {
      setLeadSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setLeadSort(key);
    setLeadSortDir(key === "observed_at" ? "desc" : "asc");
  };

  const toggleLeadSelect = (leadId: string) => {
    setSelectedLeadIds((prev) =>
      prev.includes(leadId) ? prev.filter((id) => id !== leadId) : [...prev, leadId]
    );
  };

  const toggleLeadSelectAll = () => {
    const allSelected = sortedLeads.length > 0 && sortedLeads.every((lead) => selectedLeadIds.includes(getLeadKey(lead)));
    setSelectedLeadIds(allSelected ? [] : sortedLeads.map((lead) => getLeadKey(lead)));
  };

  const downloadSelectedLeads = () => {
    if (!selectedLeadIds.length) {
      showToast("Select leads to download.", "warning");
      return;
    }
    const selected = sortedLeads.filter((lead) => selectedLeadIds.includes(getLeadKey(lead)));
    const payload = selected.map((lead) => JSON.stringify(lead)).join("\n");
    const blob = new Blob([payload], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedSlotId || "slot"}-leads.jsonl`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${selected.length} leads.`, "success");
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
      showToast("Unable to load WhatsApp QR.", "error");
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
      showToast("Unable to load WhatsApp QR.", "error");
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
      showToast("Remote login session started.", "success");
    } catch (err) {
      console.error(err);
      setRemoteLoginErrorBySlot((prev) => ({ ...prev, [slotId]: "Unable to start remote login" }));
      showToast("Unable to start remote login.", "error");
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
      await queryClient.invalidateQueries({ queryKey: ["slots"] });
      showToast(`Slot ${trimmed} provisioned.`, "success");
    } catch (err) {
      console.error(err);
      setProvisionError("Unable to provision slot.");
      showToast("Unable to provision slot.", "error");
    } finally {
      setProvisionBusy(false);
    }
  };

  const handleInviteUser = async () => {
    if (!token) return;
    const email = inviteEmail.trim();
    if (!email) {
      setInviteError("Enter a Gmail address.");
      return;
    }
    const parsedSlots = splitList(inviteSlots);
    const slotIds = parsedSlots.length ? parsedSlots : selectedSlotId ? [selectedSlotId] : [];
    if (!slotIds.length) {
      setInviteError("Assign at least one slot.");
      return;
    }
    setInviteBusy(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      const response = await inviteUser(email, slotIds, token);
      setInviteEmail("");
      setInviteSlots("");
      setInviteSuccess(
        `${response.email} invited. ${response.allowed_slots.length} slot${response.allowed_slots.length === 1 ? "" : "s"} assigned.`
      );
      showToast("Invite created.", "success");
    } catch (err) {
      console.error(err);
      setInviteError("Unable to invite user.");
      showToast("Invite failed.", "error");
    } finally {
      setInviteBusy(false);
    }
  };

  const handleUpsertSubscription = async () => {
    if (!token || user.role !== "admin") return;
    setSubscriptionError(null);
    setSubscriptionSuccess(null);
    const email = subscriptionEmail.trim();
    const slotId = subscriptionSlot.trim();
    if (!email || !slotId) {
      setSubscriptionError("Provide client email and slot id.");
      return;
    }
    setSubscriptionBusy(true);
    try {
      const payload = {
        email,
        slot_id: slotId,
        plan: subscriptionPlan,
        status: subscriptionStatus,
        starts_at: subscriptionStarts ? new Date(subscriptionStarts).toISOString() : undefined,
        ends_at: subscriptionEnds ? new Date(subscriptionEnds).toISOString() : undefined,
        notes: subscriptionNotes.trim() || undefined,
      };
      await upsertSubscription(token, payload);
      await subscriptionsQuery.refetch();
      setSubscriptionSuccess("Subscription saved.");
      showToast("Subscription saved.", "success");
    } catch (err) {
      console.error(err);
      setSubscriptionError("Unable to save subscription.");
      showToast("Subscription save failed.", "error");
    } finally {
      setSubscriptionBusy(false);
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
        keywords_exclude: splitList(configDraft.keywords_exclude),
        required_contact_methods: configDraft.required_contact_methods,
        keyword_fuzzy: configDraft.keyword_fuzzy,
        keyword_fuzzy_threshold: configDraft.keyword_fuzzy_threshold,
        channels: configDraft.channels,
      };
      const updated = await updateSlotConfig(selectedSlotId, token, patch);
      queryClient.setQueryData(["slot-detail", selectedSlotId], updated);
      setConfigSaved("Saved.");
      showToast("Config saved.", "success");
    } catch (err) {
      console.error(err);
      setConfigError("Unable to save slot config.");
      showToast("Unable to save config.", "error");
    } finally {
      setConfigSaving(false);
    }
  };

  const buildPreviewConfig = (draft: ConfigDraft) => {
    return {
      quality_level: draft.quality_level,
      allowed_countries: splitList(draft.allowed_countries),
      keywords: splitList(draft.keywords),
      keywords_exclude: splitList(draft.keywords_exclude),
      required_contact_methods: draft.required_contact_methods,
      keyword_fuzzy: draft.keyword_fuzzy,
      keyword_fuzzy_threshold: draft.keyword_fuzzy_threshold,
    };
  };

  const handleRunPreview = async () => {
    if (!token || !selectedSlotId || !configDraft) return;
    setConfigPreviewBusy(true);
    setConfigPreviewError(null);
    try {
      const payload = buildPreviewConfig(configDraft);
      const result = await previewSlotConfig(selectedSlotId, token, payload, 50);
      setConfigPreview(result);
      setConfigPreviewDirty(false);
    } catch (err) {
      console.error(err);
      setConfigPreviewError("Unable to preview config.");
    } finally {
      setConfigPreviewBusy(false);
    }
  };

  const handleAdminSave = async () => {
    if (!token || !selectedSlotId) return;
    setAdminConfigSaving(true);
    setAdminConfigError(null);
    try {
      const parsed = JSON.parse(adminConfigText || "{}");
      const updated = await replaceSlotConfig(selectedSlotId, token, parsed);
      queryClient.setQueryData(["slot-detail", selectedSlotId], updated);
      setConfigSaved("Admin config saved.");
      showToast("Admin config saved.", "success");
    } catch (err) {
      console.error(err);
      setAdminConfigError("Invalid JSON or unable to save config.");
      showToast("Admin config save failed.", "error");
    } finally {
      setAdminConfigSaving(false);
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
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["slot-detail", selectedSlotId] }),
      queryClient.invalidateQueries({ queryKey: ["slot-leads", selectedSlotId] }),
    ]);
  };

  useEffect(() => {
    if (routeSlotId) {
      const next = routeSlotId ?? null;
      setSelectedSlotId((prev) => (prev === next ? prev : next));
      return;
    }
    if (activeView === "analytics" || activeView === "account" || activeView === "clients") {
      return;
    }
    setSelectedSlotId((prev) => (prev === null ? prev : null));
  }, [routeSlotId, activeView]);

  useEffect(() => {
    setSlotTab("overview");
  }, [selectedSlotId]);

  useEffect(() => {
    const handleResize = () => {
      const next = window.innerWidth < 1100;
      setIsMobileNav(next);
      if (!next) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (isMobileNav) {
      setSidebarOpen(false);
    }
  }, [activeView, isMobileNav]);

  useEffect(() => {
    if (pageContentRef.current) {
      pageContentRef.current.scrollTop = 0;
    }
  }, [activeView, selectedSlotId]);

  useEffect(() => {
    if (!selectable) {
      setSelectedSlotIds((prev) => (prev.length ? [] : prev));
      return;
    }
    setSelectedSlotIds((prev) => {
      const next = prev.filter((id) => sortedSlots.some((slot) => slot.slot_id === id));
      return arraysEqual(prev, next) ? prev : next;
    });
  }, [selectable, sortedSlots]);

  useEffect(() => {
    setSelectedLeadIds([]);
    setLeadSearch("");
  }, [selectedSlotId]);

  useEffect(() => {
    setConfigPreview(null);
    setConfigPreviewError(null);
    setConfigPreviewDirty(false);
  }, [selectedSlotId]);

  useEffect(() => {
    setSelectedLeadIds((prev) => {
      const next = prev.filter((id) => sortedLeads.some((lead) => getLeadKey(lead) === id));
      return arraysEqual(prev, next) ? prev : next;
    });
  }, [sortedLeads]);

  useEffect(() => {
    if (!toast) return;
    const handle = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(handle);
  }, [toast]);

  useEffect(() => {
    if (user && token) {
      refreshPushStatus();
    }
  }, [user, token]);

  useEffect(() => {
    if (!slotDetail) {
      setConfigDraft((prev) => (prev ? null : prev));
      setAdminConfigText((prev) => (prev ? "" : prev));
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
    const nextDraft: ConfigDraft = {
      quality_level: Number(cfg.quality_level ?? 70),
      max_clicks_per_cycle: Number(cfg.max_clicks_per_cycle ?? 1),
      max_run_minutes: Number(cfg.max_run_minutes ?? 0),
      allowed_countries: Array.isArray(cfg.allowed_countries) ? cfg.allowed_countries.join(", ") : "",
      keywords: Array.isArray(cfg.keywords) ? cfg.keywords.join(", ") : "",
      keywords_exclude: Array.isArray(cfg.keywords_exclude) ? cfg.keywords_exclude.join(", ") : "",
      required_contact_methods: Array.isArray(cfg.required_contact_methods) ? cfg.required_contact_methods : [],
      keyword_fuzzy: Boolean(cfg.keyword_fuzzy ?? false),
      keyword_fuzzy_threshold: Number(cfg.keyword_fuzzy_threshold ?? 0.88),
      dry_run: Boolean(cfg.dry_run ?? true),
      channels: nextChannels,
    };
    setConfigDraft((prev) => (configDraftsEqual(prev, nextDraft) ? prev : nextDraft));
    const nextAdminText = JSON.stringify(cfg, null, 2);
    setAdminConfigText((prev) => (prev === nextAdminText ? prev : nextAdminText));
  }, [slotDetail]);

  useEffect(() => {
    if (!configDraft) return;
    setConfigPreviewDirty((prev) => (prev ? prev : true));
  }, [configDraft]);

  const SlotFiltersSection = () => (
    <section className="card filters-card">
      <div className="header">
        <div>
          <div className="section-label">Filters</div>
          <div className="section-title">Find slots quickly</div>
        </div>
        <div className="badge">{sortedSlots.length} visible</div>
      </div>
      <div className="filters-grid">
        <div className="field">
          <div className="label">Search</div>
          <input
            className="input"
            placeholder="Search by slot or node"
            value={slotSearch}
            onChange={(e) => setSlotSearch(e.target.value)}
          />
        </div>
        <div className="field">
          <div className="label">Phase</div>
          <select
            className="select"
            value={slotPhaseFilter}
            onChange={(e) => setSlotPhaseFilter(e.target.value)}
          >
            <option value="all">All phases</option>
            {slotPhaseOptions.map((phase) => (
              <option key={phase} value={phase}>
                {phase}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );

  const InviteClientSection = () => {
    if (user.role !== "admin") return null;
    return (
      <section className="card">
        <div className="header">
          <div>
            <div className="section-label">Access</div>
            <div className="section-title">Invite client</div>
          </div>
          <div className="action-group">
            <div className="badge">Admin only</div>
            <Dialog.Root
              open={inviteOpen}
              onOpenChange={(open) => {
                setInviteOpen(open);
                if (!open) {
                  setInviteError(null);
                  setInviteSuccess(null);
                }
              }}
            >
              <Dialog.Trigger asChild>
                <button className="btn btn-primary">Invite client</button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="dialog-overlay" />
                <Dialog.Content className="dialog-content">
                  <Dialog.Title className="dialog-title">Invite client</Dialog.Title>
                  <Dialog.Description className="dialog-description">
                    Assign slots and grant access to a client Gmail account.
                  </Dialog.Description>
                  <div className="form-grid">
                    <div className="field">
                      <div className="label">Client Gmail</div>
                      <input
                        className="input"
                        placeholder="client@gmail.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <div className="label">Assigned slots</div>
                      <input
                        className="input"
                        placeholder={selectedSlotId ? `e.g. ${selectedSlotId}` : "slot-1, slot-2"}
                        value={inviteSlots}
                        onChange={(e) => setInviteSlots(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="action-group" style={{ marginTop: 12 }}>
                    <button className="btn btn-primary" onClick={handleInviteUser} disabled={inviteBusy}>
                      {inviteBusy ? "Inviting..." : "Invite"}
                    </button>
                    {selectedSlotId && (
                      <button
                        className="btn btn-secondary"
                        onClick={() => setInviteSlots(selectedSlotId)}
                        disabled={inviteBusy}
                      >
                        Use selected slot
                      </button>
                    )}
                    <Dialog.Close asChild>
                      <button className="btn btn-secondary" disabled={inviteBusy}>
                        Close
                      </button>
                    </Dialog.Close>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                    Ensure the email is allowlisted via `GOOGLE_OAUTH_ALLOWED_EMAILS` or domain allowlist.
                  </div>
                  {inviteError && <div className="error">{inviteError}</div>}
                  {inviteSuccess && <div className="muted">{inviteSuccess}</div>}
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
        </div>
        <div className="muted">Invite clients with slot-scoped access and keep permissions tight.</div>
      </section>
    );
  };

  const BulkActionsBar = () => {
    if (!selectedSlotIds.length) return null;
    return (
      <div className={`bulk-bar ${bulkDisabledReason ? "disabled" : ""}`}>
        <div>
          <div className="section-label">Bulk actions</div>
          <div className="section-title">{selectedSlotIds.length} slots selected</div>
          {bulkDisabledReason && <div className="muted">{bulkDisabledReason}</div>}
        </div>
        <div className="action-group">
          <button
            className="btn btn-secondary"
            onClick={() => handleBulkAction(startSlot, "Start")}
            disabled={Boolean(bulkDisabledReason) || slotActionBusy}
          >
            Start
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => handleBulkAction(stopSlot, "Stop")}
            disabled={Boolean(bulkDisabledReason) || slotActionBusy}
          >
            Stop
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => handleBulkAction(restartSlot, "Restart")}
            disabled={Boolean(bulkDisabledReason) || slotActionBusy}
          >
            Restart
          </button>
          <button className="btn btn-ghost" onClick={() => setSelectedSlotIds([])}>
            Clear
          </button>
        </div>
      </div>
    );
  };

  const SlotStatusMessages = () => (
    <>
      {slotError && <div className="error">{slotError}</div>}
      {slotLoadError && <div className="error">{slotLoadError}</div>}
    </>
  );

  const QuickLinksCard = () => (
    <section className="card quick-links-card">
      <div className="header">
        <div>
          <div className="section-label">Quick links</div>
          <div className="section-title">Jump back in</div>
          <div className="muted">Shortcuts to the most-used areas.</div>
        </div>
      </div>
      <div className="quick-links">
        <NavLink className="quick-link" to="/slots">
          Manage slots
        </NavLink>
        <NavLink className="quick-link" to="/analytics">
          View analytics
        </NavLink>
        <NavLink className="quick-link" to="/alerts">
          Alerts & notifications
        </NavLink>
        <NavLink className="quick-link" to="/account">
          Account & billing
        </NavLink>
      </div>
    </section>
  );

  const OverviewView = () => (
    <div className="overview-grid">
      <div className="overview-stack">
        <section className="card page-header">
          <div className="page-header-top">
            <div>
              <div className="section-label">Control plane</div>
              <div className="page-title">Slot Operations</div>
              <div className="muted">Monitor slot health, actions, and delivery on this node.</div>
            </div>
            <div className="page-actions">
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
              {user.role === "admin" && (
                <div className="action-group">
                  <input
                    className="input"
                    placeholder="slot-2"
                    value={newSlotId}
                    onChange={(e) => setNewSlotId(e.target.value)}
                  />
                  <button className="btn btn-primary" onClick={handleProvisionSlot} disabled={provisionBusy}>
                    {provisionBusy ? "Provisioning..." : "Create Slot"}
                  </button>
                </div>
              )}
            </div>
          </div>
          {provisionError && user.role === "admin" && <div className="error">{provisionError}</div>}
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-label">Active slots</div>
              <div className="metric-value">{slotHealthStats.active}</div>
              <div className="metric-sub">Heartbeat under 15s</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Needs attention</div>
              <div className="metric-value">{slotHealthStats.unhealthy}</div>
              <div className="metric-sub">Heartbeat stale</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Total slots</div>
              <div className="metric-value">{slotHealthStats.total}</div>
              <div className="metric-sub">{viewMode === "cluster" ? "Across cluster" : "Local node"}</div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="header">
            <div>
              <div className="section-label">Analytics</div>
              <div className="section-title">Lead performance snapshot</div>
              <div className="muted">Recent lead volume and conversion across slots.</div>
            </div>
            <NavLink className="btn btn-secondary" to="/analytics">
              Open analytics
            </NavLink>
          </div>
          {analyticsError && <div className="error">{analyticsError}</div>}
          {!analyticsSummary && !analyticsLoading && (
            <div className="empty-state">No analytics data yet. Start a slot to roll up metrics.</div>
          )}
          {(analyticsSummary || analyticsLoading) && (
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-label">Observed</div>
                <div className="metric-value">{formatCount(analyticsTotals.observed)}</div>
                <div className="metric-sub">Total leads seen</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Kept</div>
                <div className="metric-value">{formatCount(analyticsTotals.kept)}</div>
                <div className="metric-sub">{formatPercent(analyticsKeepRate)} keep rate</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Verified</div>
                <div className="metric-value">{formatCount(analyticsTotals.verified)}</div>
                <div className="metric-sub">{formatPercent(analyticsVerifyRate)} verify rate</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Clicked</div>
                <div className="metric-value">{formatCount(analyticsTotals.clicked)}</div>
                <div className="metric-sub">{formatPercent(analyticsClickRate)} click rate</div>
              </div>
            </div>
          )}
        </section>
      </div>
      <div className="overview-stack">
        <InviteClientSection />
        <QuickLinksCard />
      </div>
    </div>
  );

  const AnalyticsView = () => (
    <>
      <section className="card analytics-header">
        <div className="header">
          <div>
            <div className="section-label">Analytics</div>
            <div className="section-title">Lead performance</div>
            <div className="muted">Conversion and activity over time.</div>
          </div>
          <div className="badge">{analyticsRangeLabel}</div>
        </div>
        {analyticsError && <div className="error">{analyticsError}</div>}
        {!analyticsSummary && !analyticsLoading && (
          <div className="empty-state">No analytics data yet. Start a slot to roll up metrics.</div>
        )}
        {(analyticsSummary || analyticsLoading) && (
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-label">Observed</div>
              <div className="metric-value">{formatCount(analyticsTotals.observed)}</div>
              <div className="metric-sub">Total leads seen</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Kept</div>
              <div className="metric-value">{formatCount(analyticsTotals.kept)}</div>
              <div className="metric-sub">{formatPercent(analyticsKeepRate)} keep rate</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Verified</div>
              <div className="metric-value">{formatCount(analyticsTotals.verified)}</div>
              <div className="metric-sub">{formatPercent(analyticsVerifyRate)} verify rate</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Clicked</div>
              <div className="metric-value">{formatCount(analyticsTotals.clicked)}</div>
              <div className="metric-sub">{formatPercent(analyticsClickRate)} click rate</div>
            </div>
          </div>
        )}
      </section>

      <div className="analytics-grid">
        <section className="card">
          <div className="header">
            <div>
              <div className="section-label">Slots</div>
              <div className="section-title">Per-slot totals</div>
            </div>
            <div className="muted">{analyticsPerSlot.length} slots tracked</div>
          </div>
          {analyticsLoading && <div className="muted">Loading slot totals...</div>}
          {!analyticsPerSlot.length && !analyticsLoading && (
            <div className="empty-state">No analytics data yet. Run slots to start rollups.</div>
          )}
          {analyticsPerSlot.length > 0 && (
            <div className="table-wrap">
              <table className="table table-modern">
                <thead>
                  <tr>
                    <th>Slot</th>
                    <th>Observed</th>
                    <th>Kept</th>
                    <th>Verified</th>
                    <th>Clicked</th>
                    <th>Keep rate</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {analyticsPerSlot.map((slot) => {
                    const rate = slot.metrics.observed ? (slot.metrics.kept / slot.metrics.observed) * 100 : 0;
                    return (
                      <tr key={slot.slot_id}>
                        <td>{slot.slot_id}</td>
                        <td>{formatCount(slot.metrics.observed)}</td>
                        <td>{formatCount(slot.metrics.kept)}</td>
                        <td>{formatCount(slot.metrics.verified)}</td>
                        <td>{formatCount(slot.metrics.clicked)}</td>
                        <td>{formatPercent(rate)}</td>
                        <td>
                          <button className="btn btn-ghost" onClick={() => setSelectedSlotId(slot.slot_id)}>
                            Focus
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card analytics-detail">
          <div className="header">
            <div>
              <div className="section-label">Slot trend</div>
              <div className="section-title">{selectedSlotId ? `Slot ${selectedSlotId}` : "Select a slot"}</div>
            </div>
            {selectedSlotId && <div className="muted">{analyticsRangeLabel}</div>}
          </div>
          {!selectedSlotId && <div className="empty-state">Pick a slot from the table to see daily trends.</div>}
          {selectedSlotId && analyticsSlotError && <div className="error">{analyticsSlotError}</div>}
          {selectedSlotId && analyticsSlotLoading && <div className="muted">Loading slot trend...</div>}
          {selectedSlotId && analyticsSlot && (
            <>
              <div className="chart-card">
                <div className="chart-header">
                  <div>
                    <div className="section-label">Trend</div>
                    <div className="section-title">Observed vs verified</div>
                  </div>
                  <div className="muted">Daily totals</div>
                </div>
                <div className="chart-body">
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={analyticsChartData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-soft)" }} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--text-soft)" }} />
                      <RechartsTooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-soft)" }} />
                      <Line
                        type="monotone"
                        dataKey="observed"
                        name="Observed"
                        stroke="rgba(87, 214, 255, 0.9)"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="kept"
                        name="Kept"
                        stroke="rgba(255, 201, 109, 0.9)"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="verified"
                        name="Verified"
                        stroke="rgba(36, 208, 124, 0.95)"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="table-wrap">
                <table className="table table-modern">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Observed</th>
                      <th>Kept</th>
                      <th>Verified</th>
                      <th>Clicked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyticsSlot.series.map((entry) => (
                      <tr key={entry.day}>
                        <td>{entry.day}</td>
                        <td>{formatCount(entry.metrics.observed)}</td>
                        <td>{formatCount(entry.metrics.kept)}</td>
                        <td>{formatCount(entry.metrics.verified)}</td>
                        <td>{formatCount(entry.metrics.clicked)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );

  const AccountView = () => (
    <section className="card">
      <div className="header">
        <div>
          <div className="section-label">Account</div>
          <div className="section-title">Subscriptions</div>
          <div className="muted">
            {user.role === "admin"
              ? "Manage yearly slot plans for each client."
              : "Your active slot subscriptions and renewal dates."}
          </div>
        </div>
        <div className="badge">{subscriptions.length} subscriptions</div>
      </div>
      {subscriptionsError && <div className="error">{subscriptionsError}</div>}
      {user.role === "admin" && (
        <div className="panel">
          <div className="section-label">Admin</div>
          <div className="section-title">Add or update subscription</div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div className="field">
              <div className="label">Client email</div>
              <input
                className="input"
                placeholder="client@gmail.com"
                value={subscriptionEmail}
                onChange={(e) => setSubscriptionEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <div className="label">Slot ID</div>
              <input
                className="input"
                placeholder="slot-1"
                value={subscriptionSlot}
                onChange={(e) => setSubscriptionSlot(e.target.value)}
              />
            </div>
            <div className="field">
              <div className="label">Plan</div>
              <select className="select" value={subscriptionPlan} onChange={(e) => setSubscriptionPlan(e.target.value)}>
                <option value="yearly">Yearly</option>
                <option value="trial">Trial</option>
                <option value="paused">Paused</option>
              </select>
            </div>
            <div className="field">
              <div className="label">Status</div>
              <select className="select" value={subscriptionStatus} onChange={(e) => setSubscriptionStatus(e.target.value)}>
                <option value="active">Active</option>
                <option value="trial">Trial</option>
                <option value="paused">Paused</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="field">
              <div className="label">Start date</div>
              <input
                className="input"
                type="date"
                value={subscriptionStarts}
                onChange={(e) => setSubscriptionStarts(e.target.value)}
              />
            </div>
            <div className="field">
              <div className="label">End date</div>
              <input
                className="input"
                type="date"
                value={subscriptionEnds}
                onChange={(e) => setSubscriptionEnds(e.target.value)}
              />
            </div>
            <div className="field">
              <div className="label">Notes</div>
              <input
                className="input"
                placeholder="Optional note"
                value={subscriptionNotes}
                onChange={(e) => setSubscriptionNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="action-group" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={handleUpsertSubscription} disabled={subscriptionBusy}>
              {subscriptionBusy ? "Saving..." : "Save subscription"}
            </button>
            {subscriptionError && <span className="error">{subscriptionError}</span>}
            {subscriptionSuccess && <span className="muted">{subscriptionSuccess}</span>}
          </div>
        </div>
      )}
      {subscriptionsLoading && <div className="muted">Loading subscriptions...</div>}
      {!subscriptionsLoading && subscriptions.length === 0 && <div className="empty-state">No subscriptions found.</div>}
      {subscriptions.length > 0 && (
        <div className="table-wrap">
          <table className="table table-modern">
            <thead>
              <tr>
                {user.role === "admin" && <th>Client</th>}
                <th>Slot</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Starts</th>
                <th>Ends</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((sub) => (
                <tr key={`${sub.slot_id}-${sub.user_id}`}>
                  {user.role === "admin" && <td>{sub.email}</td>}
                  <td>{sub.slot_id}</td>
                  <td>{sub.plan}</td>
                  <td>{sub.status}</td>
                  <td>{formatDate(sub.starts_at)}</td>
                  <td>{formatDate(sub.ends_at)}</td>
                  <td>{formatDate(sub.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const ClientsView = () => (
    <section className="card">
      <div className="header">
        <div>
          <div className="section-label">Clients</div>
          <div className="section-title">Access roster</div>
          <div className="muted">Track slot access and subscription status.</div>
        </div>
        <div className="badge">{clientStats.total} total</div>
      </div>
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Clients</div>
          <div className="metric-value">{clientStats.regular}</div>
          <div className="metric-sub">Active customer accounts</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Admins</div>
          <div className="metric-value">{clientStats.admins}</div>
          <div className="metric-sub">Internal operators</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Subscriptions</div>
          <div className="metric-value">{subscriptions.length}</div>
          <div className="metric-sub">Yearly slot plans</div>
        </div>
      </div>
      {clientsError && <div className="error">{clientsError}</div>}
      {clientsLoading && <div className="muted">Loading clients...</div>}
      {!clientsLoading && clients.length === 0 && <div className="empty-state">No client records yet.</div>}
      {clients.length > 0 && (
        <div className="table-wrap">
          <table className="table table-modern">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Slots</th>
                <th>Subscriptions</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => {
                const subs = subscriptionsByEmail.get(client.email) ?? [];
                const activeSubs = subs.filter((sub) => sub.status === "active").length;
                return (
                  <tr key={client.id}>
                    <td>{client.email}</td>
                    <td>{client.role}</td>
                    <td>{client.allowed_slots?.length ?? 0}</td>
                    <td>
                      {activeSubs}/{subs.length}
                    </td>
                    <td>{formatDate(client.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted" style={{ marginTop: 10 }}>
        Use “Invite client” on the Overview tab to add access.
      </div>
    </section>
  );

  const SlotsView = () => (
    <>
      <SlotFiltersSection />
      <BulkActionsBar />
      <SlotStatusMessages />
      <SlotTable
        slots={sortedSlots}
        showNode={viewMode === "cluster" || slots.some((s) => Boolean(s.node_id))}
        onView={handleViewSlot}
        onStart={(id) => handleSlotAction(startSlot, id, "Start")}
        onStop={(id) => handleSlotAction(stopSlot, id, "Stop")}
        onRestart={(id) => handleSlotAction(restartSlot, id, "Restart")}
        busy={slotActionBusy}
        selectable={selectable}
        selectedSlotIds={selectedSlotIds}
        onToggleSelect={toggleSelectSlot}
        onToggleSelectAll={toggleSelectAll}
        loading={slotLoading}
        sortBy={slotSort}
        sortDir={slotSortDir}
        onSort={handleSlotSort}
        isAdmin={user.role === "admin"}
        onProvision={handleProvisionSlot}
      />
    </>
  );

  const SlotDetailView = () => (
    <>
      <SlotFiltersSection />
      <BulkActionsBar />
      <SlotStatusMessages />
      <div className="split">
        <section>
          <SlotTable
            slots={sortedSlots}
            showNode={viewMode === "cluster" || slots.some((s) => Boolean(s.node_id))}
            onView={handleViewSlot}
            onStart={(id) => handleSlotAction(startSlot, id, "Start")}
            onStop={(id) => handleSlotAction(stopSlot, id, "Stop")}
            onRestart={(id) => handleSlotAction(restartSlot, id, "Restart")}
            busy={slotActionBusy}
            selectable={selectable}
            selectedSlotIds={selectedSlotIds}
            onToggleSelect={toggleSelectSlot}
            onToggleSelectAll={toggleSelectAll}
            loading={slotLoading}
            sortBy={slotSort}
            sortDir={slotSortDir}
            onSort={handleSlotSort}
            isAdmin={user.role === "admin"}
            onProvision={handleProvisionSlot}
          />
        </section>

        <section className="card slot-detail-card">
          <div className="detail-header">
            <div>
              <div className="section-label">Slot detail</div>
              <div className="section-title">{selectedSlotId ? `Slot ${selectedSlotId}` : "Select a slot"}</div>
              {selectedSlotSummary && (
                <div className="detail-meta">
                  <StatusPill label={selectedSlotSummary.phase ?? "Unknown"} tone={selectedPhaseTone as any} />
                  <StatusPill label={`Heartbeat ${selectedHeartbeat}`} />
                  <StatusPill label={`PID ${selectedPidStatus}`} />
                </div>
              )}
            </div>
            {selectedSlotId && (
              <div className="action-group">
                <button
                  className="btn btn-secondary"
                  onClick={() => handleSlotAction(startSlot, selectedSlotId, "Start")}
                  disabled={slotActionBusy}
                >
                  Start
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => handleSlotAction(stopSlot, selectedSlotId, "Stop")}
                  disabled={slotActionBusy}
                >
                  Stop
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => handleSlotAction(restartSlot, selectedSlotId, "Restart")}
                  disabled={slotActionBusy}
                >
                  Restart
                </button>
                <button className="btn btn-secondary" onClick={handleRefreshSelectedSlot} disabled={slotDetailFetching}>
                  Refresh
                </button>
              </div>
            )}
          </div>
          {!selectedSlotId && (
            <div className="empty-state">Select a slot from the table to view config, leads, and login tools.</div>
          )}
          {selectedSlotId && selectedSlotSummary && (
            <div className="detail-stats">
              <div className="detail-stat">
                <div className="label">Leads</div>
                <div className="value">{selectedSlotSummary.leads_count ?? 0}</div>
                <div className="muted">Observed</div>
              </div>
              <div className="detail-stat">
                <div className="label">Files</div>
                <div className="value">
                  cfg:{selectedSlotSummary.has_config ? "✓" : "–"} · st:{selectedSlotSummary.has_state ? "✓" : "–"} ·
                  snap:{selectedSlotSummary.has_status ? "✓" : "–"}
                </div>
                <div className="muted">Config + state</div>
              </div>
              <div className="detail-stat">
                <div className="label">Node</div>
                <div className="value">{selectedSlotSummary.node_id ?? "local"}</div>
                <div className="muted">Current host</div>
              </div>
            </div>
          )}
          {selectedSlotId && (
            <Tabs.Root value={slotTab} onValueChange={(value) => setSlotTab(value as SlotTabKey)} className="tabs-root">
              <Tabs.List className="tab-list tab-bar" aria-label="Slot detail tabs">
                <Tabs.Trigger className="tab" value="overview">
                  Overview
                </Tabs.Trigger>
                <Tabs.Trigger className="tab" value="config">
                  Config
                </Tabs.Trigger>
                <Tabs.Trigger className="tab" value="leads">
                  Leads
                </Tabs.Trigger>
                <Tabs.Trigger className="tab" value="whatsapp">
                  WhatsApp
                </Tabs.Trigger>
                <Tabs.Trigger className="tab" value="remote-login">
                  Remote Login
                </Tabs.Trigger>
              </Tabs.List>

              {slotDetailLoading && (
                <div className="detail-skeleton-grid">
                  <div className="detail-skeleton" />
                  <div className="detail-skeleton" />
                  <div className="detail-skeleton" />
                </div>
              )}

              <Tabs.Content value="overview">
                <div className="tab-layout">
                  <div className="tab-main">
                    {slotOnboardingSteps.length > 0 && (
                      <div className={`callout ${slotOnboardingComplete ? "callout-success" : ""}`}>
                        <div className="callout-header">
                          <div>
                            <div className="section-label">Onboarding</div>
                            <div className="section-title">
                              {slotOnboardingComplete ? "Slot ready for production" : "Complete setup checklist"}
                            </div>
                            <div className="muted">
                              {slotOnboardingComplete
                                ? "This slot is healthy and ready to capture verified leads."
                                : "Finish the essentials to keep this slot running cleanly."}
                            </div>
                          </div>
                          <div className="callout-badge">{slotOnboardingComplete ? "Ready" : `${slotOnboardingProgress}%`}</div>
                        </div>
                        <div className="callout-steps">
                          {slotOnboardingSteps.map((step) => (
                            <div className="callout-step" key={step.label}>
                              <div className={`onboarding-dot ${step.done ? "done" : ""}`} />
                              <div>{step.label}</div>
                              <div className="spacer" />
                              <div className="muted" style={{ fontSize: 12 }}>
                                {step.done ? "Done" : "Next"}
                              </div>
                            </div>
                          ))}
                        </div>
                        {!slotOnboardingComplete && (
                          <div className="callout-actions">
                            <button className="btn btn-secondary" onClick={() => setSlotTab("config")}>
                              Open Config
                            </button>
                            <button className="btn btn-secondary" onClick={() => setSlotTab("whatsapp")}>
                              WhatsApp QR
                            </button>
                            <button className="btn btn-secondary" onClick={() => setSlotTab("remote-login")}>
                              Remote Login
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="metrics-grid detail-metrics">
                      <div className="metric-card">
                        <div className="metric-label">Phase</div>
                        <div className="metric-value">
                          {selectedSlotSummary?.phase ? (
                            <Badge text={selectedSlotSummary.phase} tone={selectedPhaseTone as any} />
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </div>
                        <div className="metric-sub">Heartbeat {selectedHeartbeat}</div>
                      </div>
                      <div className="metric-card">
                        <div className="metric-label">Leads</div>
                        <div className="metric-value">{selectedSlotSummary?.leads_count ?? 0}</div>
                        <div className="metric-sub">Observed leads</div>
                      </div>
                      <div className="metric-card">
                        <div className="metric-label">Process</div>
                        <div className="metric-value">{selectedSlotSummary?.pid ?? "—"}</div>
                        <div className="metric-sub">PID {selectedPidStatus}</div>
                      </div>
                      <div className="metric-card">
                        <div className="metric-label">Node</div>
                        <div className="metric-value">{selectedSlotSummary?.node_id ?? "local"}</div>
                        <div className="metric-sub">{selectedSlotSummary?.has_config ? "Config ready" : "Config missing"}</div>
                      </div>
                    </div>

                    <div className="panel-grid">
                      <div className="panel panel-soft">
                        <div className="section-label">Status snapshot</div>
                        {slotDetail?.status ? (
                          <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>
                            {JSON.stringify(slotDetail.status, null, 2)}
                          </pre>
                        ) : (
                          <div className="muted">No status data yet.</div>
                        )}
                      </div>
                      <div className="panel panel-soft">
                        <div className="section-label">State snapshot</div>
                        {slotDetail?.state ? (
                          <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>
                            {JSON.stringify(slotDetail.state, null, 2)}
                          </pre>
                        ) : (
                          <div className="muted">No state data yet.</div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="tab-aside">
                    <div className="panel panel-soft" id="alerts">
                      <div className="panel-header">
                        <div>
                          <div className="section-label">Alerts</div>
                          <div className="section-title">Browser notifications</div>
                        </div>
                        {pushSupported ? (
                          <div className={`badge ${pushEnabled ? "green" : ""}`}>{pushEnabled ? "Enabled" : "Disabled"}</div>
                        ) : (
                          <div className="badge">Unavailable</div>
                        )}
                      </div>
                      {pushSupported ? (
                        <>
                          <div className="muted" style={{ fontSize: 13 }}>
                            Receive verified lead alerts on this device.
                          </div>
                          <div className="action-group" style={{ marginTop: 10 }}>
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
                        </>
                      ) : (
                        <div className="muted">Push notifications are not supported in this browser.</div>
                      )}
                    </div>
                    <div className="panel panel-soft">
                      <div className="section-label">Health</div>
                      <div className="section-title">Slot status</div>
                      <div className="stats-stack">
                        <div className="stats-row">
                          <span className="muted">Phase</span>
                          <span>{selectedSlotSummary?.phase ?? "—"}</span>
                        </div>
                        <div className="stats-row">
                          <span className="muted">Heartbeat</span>
                          <span>{selectedHeartbeat}</span>
                        </div>
                        <div className="stats-row">
                          <span className="muted">PID</span>
                          <span>{selectedSlotSummary?.pid ?? "—"}</span>
                        </div>
                        <div className="stats-row">
                          <span className="muted">Leads</span>
                          <span>{selectedSlotSummary?.leads_count ?? 0}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </Tabs.Content>

              <Tabs.Content value="config">
                <div className="tab-layout">
                  <div className="tab-main">
                    <div className="panel">
                      <div className="panel-header">
                        <div>
                          <div className="section-label">Config</div>
                          <div className="section-title">Client controls</div>
                        </div>
                        <div className="badge">Safe defaults</div>
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
                                  setConfigDraft((prev) => (prev ? { ...prev, allowed_countries: e.target.value } : prev))
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
                            <div className="field">
                              <div className="label">Exclude keywords</div>
                              <input
                                className="input"
                                placeholder="retail, india only"
                                value={configDraft.keywords_exclude}
                                onChange={(e) =>
                                  setConfigDraft((prev) =>
                                    prev ? { ...prev, keywords_exclude: e.target.value } : prev
                                  )
                                }
                              />
                            </div>
                            <div className="field">
                              <div className="label">Fuzzy matching</div>
                              <label className="checkbox" style={{ marginTop: 6 }}>
                                <input
                                  type="checkbox"
                                  checked={configDraft.keyword_fuzzy}
                                  onChange={(e) =>
                                    setConfigDraft((prev) => (prev ? { ...prev, keyword_fuzzy: e.target.checked } : prev))
                                  }
                                />
                                Enable fuzzy keyword matching
                              </label>
                              <input
                                className="input"
                                type="range"
                                min={0.7}
                                max={0.95}
                                step={0.01}
                                value={configDraft.keyword_fuzzy_threshold}
                                disabled={!configDraft.keyword_fuzzy}
                                onChange={(e) =>
                                  setConfigDraft((prev) =>
                                    prev ? { ...prev, keyword_fuzzy_threshold: Number(e.target.value) } : prev
                                  )
                                }
                              />
                              <div className="muted" style={{ fontSize: 12 }}>
                                Threshold {configDraft.keyword_fuzzy_threshold.toFixed(2)}
                              </div>
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
                            <div className="label">Required contact methods</div>
                            <div className="channel-grid">
                              {CONTACT_METHOD_OPTIONS.map((method) => (
                                <label key={method.key} className="checkbox">
                                  <input
                                    type="checkbox"
                                    checked={configDraft.required_contact_methods.includes(method.key)}
                                    onChange={(e) =>
                                      setConfigDraft((prev) => {
                                        if (!prev) return prev;
                                        const next = new Set(prev.required_contact_methods);
                                        if (e.target.checked) {
                                          next.add(method.key);
                                        } else {
                                          next.delete(method.key);
                                        }
                                        return { ...prev, required_contact_methods: Array.from(next) };
                                      })
                                    }
                                  />
                                  {method.label}
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
                          <div className="action-group" style={{ marginTop: 12 }}>
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

                    <div className="panel panel-soft">
                      <div className="panel-header">
                        <div>
                          <div className="section-label">Preview</div>
                          <div className="section-title">Explain why</div>
                        </div>
                        <div className="action-group">
                          {configPreviewDirty && <span className="badge">Out of date</span>}
                          <button
                            className="btn btn-secondary"
                            onClick={handleRunPreview}
                            disabled={configPreviewBusy || !configDraft}
                          >
                            {configPreviewBusy ? "Running..." : "Run preview"}
                          </button>
                        </div>
                      </div>
                      {!configPreview && !configPreviewBusy && !configPreviewError && (
                        <div className="muted">Run a preview to score recent leads against the current config.</div>
                      )}
                      {configPreviewError && <div className="error">{configPreviewError}</div>}
                      {configPreview && (
                        <>
                          <div className="preview-summary">
                            <div className="stat">
                              <div className="stat-label">Kept</div>
                              <div className="stat-value">
                                {configPreview.summary.kept}/{configPreview.summary.total}
                              </div>
                            </div>
                            <div className="stat">
                              <div className="stat-label">Rejected</div>
                              <div className="stat-value">{configPreview.summary.rejected}</div>
                            </div>
                            <div className="stat">
                              <div className="stat-label">Top reasons</div>
                              <div className="stat-value muted">
                                {Object.entries(configPreview.summary.reject_reasons)
                                  .slice(0, 3)
                                  .map(([key, value]) => `${key} (${value})`)
                                  .join(" · ") || "—"}
                              </div>
                            </div>
                          </div>
                          <div className="preview-list">
                            {configPreview.leads.slice(0, 8).map((lead) => (
                              <div key={lead.lead_id ?? lead.observed_at ?? Math.random()} className="preview-item">
                                <div className="preview-main">
                                  <div className="preview-title">{lead.title || "Untitled lead"}</div>
                                  <div className="preview-meta">
                                    {lead.country || "—"} · {lead.category_text || "—"}
                                  </div>
                                </div>
                                <div className="preview-decision">
                                  {lead.decision.keep ? (
                                    <Badge text="Keep" tone="green" />
                                  ) : (
                                    <Badge text={lead.decision.reject_reason || "Rejected"} tone="amber" />
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {user.role === "admin" && (
                      <div className="panel">
                        <div className="panel-header">
                          <div>
                            <div className="section-label">Admin</div>
                            <div className="section-title">Full config JSON</div>
                          </div>
                        </div>
                        <textarea
                          className="textarea"
                          rows={10}
                          value={adminConfigText}
                          onChange={(e) => setAdminConfigText(e.target.value)}
                        />
                        <div className="action-group" style={{ marginTop: 12 }}>
                          <button className="btn btn-secondary" onClick={handleAdminSave} disabled={adminConfigSaving}>
                            {adminConfigSaving ? "Saving..." : "Save Admin Config"}
                          </button>
                          {adminConfigError && <div className="error">{adminConfigError}</div>}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="tab-aside">
                    <div className="panel panel-soft">
                      <div className="section-label">Guidance</div>
                      <div className="section-title">Quality mapping</div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        90+ → 24 months · 24h, 70+ → 12 months · 36h, 40+ → 6 months · 48h.
                      </div>
                      <div className="divider" />
                      <div className="section-label">Tip</div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        Keep dry‑run on while tuning keywords and countries to avoid wasted clicks.
                      </div>
                    </div>
                  </div>
                </div>
              </Tabs.Content>

              <Tabs.Content value="leads">
                <div className="tab-layout">
                  <div className="tab-main">
                    <div className="panel">
                      <div className="panel-header">
                        <div>
                          <div className="section-label">Leads</div>
                          <div className="section-title">{slotLeadsVerifiedOnly ? "Verified leads" : "All leads"}</div>
                        </div>
                        <div className="action-group">
                          <div className="segmented">
                            <button
                              className={`btn ${!slotLeadsVerifiedOnly ? "btn-primary" : "btn-secondary"}`}
                              onClick={() => setSlotLeadsVerifiedOnly(false)}
                            >
                              All
                            </button>
                            <button
                              className={`btn ${slotLeadsVerifiedOnly ? "btn-primary" : "btn-secondary"}`}
                              onClick={() => setSlotLeadsVerifiedOnly(true)}
                            >
                              Verified
                            </button>
                          </div>
                          <button
                            className="btn btn-secondary"
                            onClick={downloadSelectedLeads}
                            disabled={!selectedLeadIds.length}
                          >
                            Download selected
                          </button>
                          <a
                            className="btn btn-secondary"
                            href={`${
                              import.meta.env.VITE_API_BASE_URL || "http://localhost:8001"
                            }/slots/${encodeURIComponent(selectedSlotId)}/leads.jsonl`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Download JSONL
                          </a>
                        </div>
                      </div>
                      <div className="filters-grid">
                        <div className="field">
                          <div className="label">Search leads</div>
                          <input
                            className="input"
                            placeholder="Search by title, country, contact"
                            value={leadSearch}
                            onChange={(e) => setLeadSearch(e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <div className="label">Selected</div>
                          <div className="muted">
                            {selectedLeadIds.length} / {sortedLeads.length}
                          </div>
                        </div>
                      </div>
                    </div>

                    {verifiedLeadCount > 0 && (
                      <div className="callout callout-success">
                        <div className="callout-header">
                          <div>
                            <div className="section-label">Success</div>
                            <div className="section-title">Verified leads detected</div>
                            <div className="muted">
                              {verifiedLeadCount} lead{verifiedLeadCount === 1 ? "" : "s"} verified for this slot.
                            </div>
                          </div>
                          {!slotLeadsVerifiedOnly && (
                            <button className="btn btn-secondary" onClick={() => setSlotLeadsVerifiedOnly(true)}>
                              View verified
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {slotLeadsLoading && <div className="muted">Loading leads...</div>}
                    {!slotLeadsLoading && !sortedLeads.length && <div className="empty-state">No leads yet.</div>}
                    {!slotLeadsLoading && sortedLeads.length > 0 && (
                      <div className="leads-virtuoso">
                        <TableVirtuoso
                          data={sortedLeads}
                          components={leadTableComponents}
                          fixedHeaderContent={() => (
                            <tr>
                              <th>
                                <input
                                  type="checkbox"
                                  checked={
                                    sortedLeads.length > 0 &&
                                    sortedLeads.every((lead) => selectedLeadIds.includes(getLeadKey(lead)))
                                  }
                                  onChange={toggleLeadSelectAll}
                                  aria-label="Select all leads"
                                />
                              </th>
                              <th>
                                <button className="sort-btn" onClick={() => handleLeadSort("observed_at")}>
                                  Observed
                                  {leadSort === "observed_at" && (
                                    <span className="sort-indicator">{leadSortDir === "asc" ? "↑" : "↓"}</span>
                                  )}
                                </button>
                              </th>
                              <th>Title</th>
                              <th>
                                <button className="sort-btn" onClick={() => handleLeadSort("country")}>
                                  Country
                                  {leadSort === "country" && (
                                    <span className="sort-indicator">{leadSortDir === "asc" ? "↑" : "↓"}</span>
                                  )}
                                </button>
                              </th>
                              <th>Contact</th>
                              <th>
                                <button className="sort-btn" onClick={() => handleLeadSort("verified")}>
                                  Verified
                                  {leadSort === "verified" && (
                                    <span className="sort-indicator">{leadSortDir === "asc" ? "↑" : "↓"}</span>
                                  )}
                                </button>
                              </th>
                              <th>Source</th>
                            </tr>
                          )}
                          itemContent={(_, lead) => {
                            const leadKey = getLeadKey(lead);
                            return (
                              <>
                                <td>
                                  <input
                                    type="checkbox"
                                    checked={selectedLeadIds.includes(leadKey)}
                                    onChange={() => toggleLeadSelect(leadKey)}
                                    aria-label={`Select lead ${leadKey}`}
                                  />
                                </td>
                                <td className="mono">
                                  {lead.observed_at ? new Date(lead.observed_at).toLocaleString() : "—"}
                                </td>
                                <td>{lead.title ?? "—"}</td>
                                <td>{lead.country ?? "—"}</td>
                                <td>{lead.contact || lead.email || lead.phone || "—"}</td>
                                <td>{lead.verified ? <Badge text="Verified" tone="green" /> : "—"}</td>
                                <td>{lead.verification_source ?? "—"}</td>
                              </>
                            );
                          }}
                          overscan={6}
                        />
                      </div>
                    )}
                  </div>

                  <div className="tab-aside">
                    <div className="panel panel-soft">
                      <div className="section-label">Insights</div>
                      <div className="section-title">Lead funnel</div>
                      <div className="stats-stack">
                        <div className="stats-row">
                          <span className="muted">Total leads</span>
                          <span>{slotLeads.length}</span>
                        </div>
                        <div className="stats-row">
                          <span className="muted">Verified</span>
                          <span>{verifiedLeadCount}</span>
                        </div>
                        <div className="stats-row">
                          <span className="muted">Selected</span>
                          <span>{selectedLeadIds.length}</span>
                        </div>
                      </div>
                      <div className="divider" />
                      <div className="section-label">Tip</div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        Use the verified filter to export only high‑signal leads for outreach.
                      </div>
                    </div>
                  </div>
                </div>
              </Tabs.Content>

              <Tabs.Content value="whatsapp">
                <div className="tab-layout">
                  <div className="tab-main">
                    <div className="panel">
                      <div className="panel-header">
                        <div>
                          <div className="section-label">WhatsApp</div>
                          <div className="section-title">Connect this slot</div>
                        </div>
                        <div className="action-group">
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
                      {!qrErrorBySlot[selectedSlotId] && qrBySlot[selectedSlotId] && (
                        <div className="callout callout-success">
                          <div className="callout-header">
                            <div>
                              <div className="section-label">Ready</div>
                              <div className="section-title">QR loaded</div>
                              <div className="muted">Scan within 30 seconds to link the device.</div>
                            </div>
                          </div>
                        </div>
                      )}
                      {qrBySlot[selectedSlotId] && (
                        <div className="qr-frame">
                          <img src={qrBySlot[selectedSlotId]} alt={`WhatsApp QR for ${selectedSlotId}`} />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="tab-aside">
                    <div className="panel panel-soft">
                      <div className="section-label">Status</div>
                      <div className="section-title">Session health</div>
                      <div className="stats-stack">
                        <div className="stats-row">
                          <span className="muted">QR visible</span>
                          <span>{qrBySlot[selectedSlotId] ? "Yes" : "No"}</span>
                        </div>
                        <div className="stats-row">
                          <span className="muted">Refresh interval</span>
                          <span>15s</span>
                        </div>
                      </div>
                      <div className="divider" />
                      <div className="section-label">Tip</div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        Use a dedicated WhatsApp device per slot for traceability.
                      </div>
                    </div>
                  </div>
                </div>
              </Tabs.Content>

              <Tabs.Content value="remote-login">
                <div className="tab-layout">
                  <div className="tab-main">
                    <div className="panel">
                      <div className="panel-header">
                        <div>
                          <div className="section-label">Remote Login</div>
                          <div className="section-title">Repair browser session</div>
                        </div>
                        <div className="action-group">
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
                        <div className="callout callout-success">
                          <div className="callout-header">
                            <div>
                              <div className="section-label">Session active</div>
                              <div className="section-title">Remote login is live</div>
                              <div className="muted">
                                Expires {new Date(remoteLoginBySlot[selectedSlotId].expires_at).toLocaleTimeString()}.
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {remoteLoginBySlot[selectedSlotId] && (
                        <div className="panel sub-panel">
                          <div className="stats-stack">
                            <div className="stats-row">
                              <span className="muted">Expires</span>
                              <span>{new Date(remoteLoginBySlot[selectedSlotId].expires_at).toLocaleString()}</span>
                            </div>
                            <div className="stats-row">
                              <span className="muted">VNC</span>
                              <span className="mono">
                                {remoteLoginBySlot[selectedSlotId].vnc_host}:{remoteLoginBySlot[selectedSlotId].vnc_port}
                              </span>
                            </div>
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
                  </div>
                  <div className="tab-aside">
                    <div className="panel panel-soft">
                      <div className="section-label">Security</div>
                      <div className="section-title">Session rules</div>
                      <div className="stats-stack">
                        <div className="stats-row">
                          <span className="muted">TTL</span>
                          <span>15 minutes</span>
                        </div>
                        <div className="stats-row">
                          <span className="muted">Max sessions</span>
                          <span>1 active</span>
                        </div>
                      </div>
                      <div className="divider" />
                      <div className="section-label">Tip</div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        Always complete login before restarting the slot to avoid lockouts.
                      </div>
                    </div>
                  </div>
                </div>
              </Tabs.Content>
            </Tabs.Root>
          )}
        </section>
      </div>
    </>
  );

  const AlertsView = () => (
    <section className="card">
      <div className="header">
        <div>
          <div className="section-label">Alerts</div>
          <div className="section-title">Browser notifications</div>
          <div className="muted" style={{ marginTop: 6 }}>
            Receive verified lead alerts on this device.
          </div>
        </div>
        {pushSupported ? (
          <div className={`badge ${pushEnabled ? "green" : ""}`}>{pushEnabled ? "Enabled" : "Disabled"}</div>
        ) : (
          <div className="badge">Unavailable</div>
        )}
      </div>
      {pushSupported ? (
        <>
          <div className="action-group" style={{ marginTop: 12 }}>
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
          {pushPermission === "denied" && (
            <div className="error" style={{ marginTop: 12 }}>
              Notifications are blocked in your browser settings.
            </div>
          )}
          {pushError && (
            <div className="error" style={{ marginTop: 12 }}>
              {pushError}
            </div>
          )}
        </>
      ) : (
        <div className="muted">Push notifications are not supported in this browser.</div>
      )}
    </section>
  );

  const renderView = () => {
    switch (activeView) {
      case "overview":
        return <OverviewView />;
      case "analytics":
        return <AnalyticsView />;
      case "account":
        return <AccountView />;
      case "clients":
        return <ClientsView />;
      case "detail":
        return <SlotDetailView />;
      case "alerts":
        return <AlertsView />;
      case "slots":
      default:
        return <SlotsView />;
    }
  };

  return (
    <div className="layout">
      {isMobileNav && sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => {
          if (isMobileNav) {
            setSidebarOpen((prev) => !prev);
          } else {
            setSidebarCollapsed((prev) => !prev);
          }
        }}
        selectedSlotId={selectedSlotId}
        user={user}
        isMobile={isMobileNav}
        isOpen={sidebarOpen}
        onNavigate={() => {
          if (isMobileNav) setSidebarOpen(false);
        }}
      />
      <main className="main">
        <TopBar
          user={user}
          onSignOut={signOut}
          title={topbarTitle}
          subtitle={topbarSubtitle}
          onMenuToggle={() => setSidebarOpen((prev) => !prev)}
          showMenuToggle={isMobileNav}
        />
        <AnimatePresence mode="wait">
          <motion.div
            key={activeView}
            className="page-content"
            ref={pageContentRef}
            initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {renderView()}
          </motion.div>
        </AnimatePresence>
        {toast && <div className={`toast ${toast.tone}`}>{toast.message}</div>}
      </main>
    </div>
  );
}
