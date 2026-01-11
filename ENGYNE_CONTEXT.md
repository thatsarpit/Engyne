# ENGYNE — Canonical Project Context
Last updated: 2026-01-11 11:20 IST
Maintainer: Core Engineering
Status: ACTIVE BUILD (24h speedrun) — Phase A complete, Phase B first deploy LIVE

====================================================
1. PURPOSE OF THIS FILE (NON-NEGOTIABLE)
====================================================

This file is the SINGLE CONTINUOUS MEMORY of the ENGYNE project.

Rules:
- This file must be read at the start of every coding session.
- This file must be updated after every major architectural, product, or infra decision.
- When there is conflict between:
  - Chat history
  - Human memory
  - Assumptions
  → THIS FILE WINS.

This file exists to:
- prevent context loss
- prevent architectural drift
- allow rapid onboarding of humans or agents
- make 24-hour speedruns survivable

====================================================
2. HIGH-LEVEL PRODUCT DEFINITION
====================================================

ENGYNE is a **B2B pharmaceutical lead acquisition and automation platform**.

Core characteristics:
- Runs 24/7
- Slot-based isolation
- Operator-controlled automation
- Human-in-the-loop for risky actions
- Multi-client, role-based access
- Designed for fragile external UIs (IndiaMART, WhatsApp Web)

ENGYNE is NOT:
- a scraper toy
- a CRM
- a growth-hacking spam bot
- a fully autonomous AI agent

ENGYNE IS:
- a control plane for lead acquisition + first-touch delivery

====================================================
3. CURRENT BUILD PHASE & SEQUENCE
====================================================

We are rebuilding ENGYNE from scratch.

### Build Sequence (STRICT)
PHASE A: Local on MacBook (hub + node)
PHASE B: Google Cloud hub deployment
PHASE C: Mac mini added as Node 2

Phase A MUST be fully working before Phase B/C. Phase A is now functionally complete and validated locally.
 Phase B decisions:
- Region: asia-south1
- API: Cloud Run (containerized)
- DB: Cloud SQL Postgres
- Dashboard: Cloud Storage bucket + CDN

Phase B deployment status (LIVE):
- API: `https://api.engyne.space/healthz` (via global HTTPS LB → Cloud Run `engyne-api`)
- Dashboard: `https://app.engyne.space` (via global HTTPS LB → GCS bucket `app.engyne.space`)
- Managed cert: ACTIVE for `api.engyne.space` + `app.engyne.space`
- Cloud Run secrets: add `engyne-node-shared-secret` and inject as `NODE_SHARED_SECRET` for hub↔node auth

====================================================
4. DOMAINS & ENVIRONMENT
====================================================

Production domains:
- Dashboard: https://app.engyne.space
- API:       https://api.engyne.space

Local development:
- Dashboard: http://localhost:5173
- API:       http://localhost:8001

Cloudflare:
- DNS managed via Cloudflare
- SSL enabled
- OAuth redirects must EXACTLY match production URLs

====================================================
5. AUTHENTICATION & ACCESS CONTROL
====================================================

Primary authentication:
- Google OAuth 2.0 (openid, email, profile)

Auth rules:
- No password login required for v1
- JWT issued after OAuth callback
- JWT contains:
  - user_id
  - email
  - role (admin | client)
  - allowed_slots[]

Allowlisting logic:
1. If GOOGLE_OAUTH_ALLOWED_EMAILS is set → strict email allowlist
2. Else if GOOGLE_OAUTH_ALLOWED_DOMAINS is set → domain allowlist
3. Else → deny all

Admin bootstrap:
- GOOGLE_OAUTH_ADMIN_EMAILS
- Matching emails become role=admin

Auto-provision:
- GOOGLE_OAUTH_AUTO_PROVISION=true
- New allowed users auto-created as role=client

====================================================
6. CORE ARCHITECTURE (IMMUTABLE CONCEPTS)
====================================================

### Slot (CORE ISOLATION UNIT)

A slot is:
- One operational identity
- One browser session
- One client/account

Filesystem structure:
slots/<slot_id>/
- slot_config.yml        # operator policy
- slot_state.json        # runtime truth (heartbeat, metrics, pid)
- leads.jsonl            # append-only event log
- status.json            # last snapshot

Slots are NEVER stored in DB.

### Processes
- API (FastAPI): control plane
- Slot Manager: supervises slots, enforces heartbeat, auto-resume
- Runner: spawns worker, writes pid + run_id
- Worker: IndiaMART automation (Playwright)
- Dispatchers: outbound delivery
- Remote Login Service: VNC bridge

====================================================
7. SLOT LIFECYCLE
====================================================

Provision → Start → Running → (Stop | Crash | Login Required) → Recover → Resume

Heartbeat:
- Worker writes heartbeat ~every 2s
- Slot Manager kills slot if heartbeat stale (>30s)

Auto-resume:
- Enabled by default unless explicitly stopped

====================================================
8. INDIA MART WORKER (CRITICAL PATH)
====================================================

Lead flow:
1. Open Recent Leads page
2. Parse lead rows
3. Apply decision rules
4. Log observed leads
5. Optional click (auto_buy)
6. Verify via Consumed Leads
7. Emit verified event

Worker phases:
- BOOT
- INIT
- PARSE_LEADS
- LOGIN_REQUIRED
- COOLDOWN
- STOPPING
- ERROR

Persistent context:
- browser_profiles/<slot_id>/

====================================================
9. QUALITY SYSTEM (IMPORTANT)
====================================================

Quality is controlled via a single slider: quality_level (0–100)

Mapping (EXACT, DO NOT CHANGE):
- >=90 → min_member_months=24, max_age_hours=24
- >=70 → min_member_months=12, max_age_hours=36
- >=40 → min_member_months=6,  max_age_hours=48
- else → min_member_months=0,  max_age_hours=48

This mapping is used everywhere.

====================================================
10. VERIFIED EVENT PIPELINE
====================================================

When a lead is clicked AND verified:
Worker →
  POST /events/verified
  Header: X-Engyne-Worker-Secret

API fan-out:
- Web push notifications
- Optional webhook
- Append to runtime queues

====================================================
11. DISPATCHERS
====================================================

Channels:
- WhatsApp (WAHA first)
- Telegram
- Email
- Google Sheets

Rules:
- Restart-safe
- Offset-based
- Idempotent
- Rate-limited per slot
- Sent logs maintained

Queues live in runtime/.

====================================================
12. REMOTE LOGIN (HUMAN-IN-LOOP)
====================================================

Purpose:
- Manual login repair for IndiaMART / WhatsApp Web

Mechanism:
- Token-gated VNC session
- Single active session
- TTL enforced
- Slot stopped before login

macOS:
- Uses Screen Sharing VNC

====================================================
13. DASHBOARD PRINCIPLES
====================================================

Dashboard is a CONTROL PLANE, not a CRM.

Must always show:
- Slot status
- Heartbeat freshness
- Phase
- Errors

Clients can:
- Start/stop slots
- Adjust quality + limits
- Configure allowed filters
- Enable/disable channels

Admins can:
- Provision slots
- Edit full config
- Hard-stop slots
- Enable login_mode

### Dashboard IA (v1)

Single app:
- Admin + client share the same dashboard URL/app (`app.engyne.space`), gated by role (RBAC).
- “Slots” is the primary navigation; almost everything is per-slot.

Primary screens:
- Slots list (Local view + Cluster view). Cluster view is read-only until proxy slot ops are implemented.
- Slot detail (per-slot) with sub-tabs:
  - Overview (status/heartbeat/metrics/actions)
  - Leads (table + verified filter + download JSONL)
  - Config (client-safe controls; admin-only advanced editor)
  - WhatsApp (QR connect + session status + test send)
  - Remote Login (start/stop + open portal + TTL)
  - Dispatchers (per-channel toggles + rate + dry-run + queue stats)
  - Logs/Activity (recent slot events, last errors)

Design direction:
- Dark-mode first, green-accent “ENGYNE” branding, smooth interactions, optimistic actions.
- Admin sees additional controls; clients see a simplified, guided version of the same UI.

====================================================
14. DATABASE SCOPE
====================================================

DB stores:
- users
- push subscriptions
- audit logs
- node registry

DB NEVER stores:
- slot runtime state
- leads
- worker metrics

====================================================
15. CLUSTER / NODE MODEL (FUTURE-SAFE)
====================================================

Default mode:
- Single node (NODE_ID=local)

Future:
- Multiple nodes (Mac mini etc.)
- Nodes register with hub
- Hub proxies slot commands

Node endpoints:
- GET /node
- POST /node/slots/snapshot

====================================================
16. NON-NEGOTIABLE SAFETY RULES
====================================================

- auto_buy is capped
- outbound channels OFF by default
- dry-run supported everywhere
- irreversible actions guarded
- no silent failures

====================================================
17. GIT & WORKFLOW RULES
====================================================

- Work incrementally
- Commit after each major step
- Each commit must:
  - be buildable
  - not break running system
- Commit messages must be descriptive
- No large unreviewable commits

====================================================
18. OPEN QUESTIONS / DECISIONS LOG
====================================================

(Agents MUST update this section)

- [x] Pre-flight cleanup script added (`scripts/kill_all.sh`)
- [x] Git initialized + baseline `.gitignore`
- [x] Phase A DB choice: SQLite via SQLAlchemy (`DATABASE_URL=sqlite:///./runtime/engyne.db`) for local-first simplicity; Postgres later via `DATABASE_URL` swap
- [x] Step 1 complete: Google OAuth2 + JWT + `/auth/me` + env-driven CORS
- [x] Step 2 complete: Slot filesystem contracts + list/status endpoints (`GET /slots`, `GET /slots/{slot_id}`)
- [x] Step 3 complete: Dashboard scaffold (Vite/React TS) with Google login + slot list
- [x] Step 4 in progress: Slot Manager + Worker (stub + Playwright harness; Playwright gated by WORKER_MODE)
- [ ] WAHA deployment model for hub (local WAHA per node confirmed for Phase A).
- [x] Cloud Run vs VM? → Cloud Run for hub API.
- [x] Dashboard app model → single dashboard app with role-gated admin/client experiences; slot-centric IA (dark-mode, green accent).
- [ ] Backup strategy?
- [ ] Log retention policy?

====================================================
19. CURRENT STATUS SNAPSHOT
====================================================

Date: 2026-01-09 15:38
Phase: PHASE B (GCP) — Cloud Run API + Cloud SQL deployed, dashboard bucket live, HTTPS LB created (DNS + cert pending)
What works:
- `scripts/kill_all.sh` stops ENGYNE-related processes, frees ports `8001` and `5173`, checks VNC range `5900-5999`, removes `runtime/*.pid`
- FastAPI API scaffold in `api/` with pinned deps in `api/requirements.txt`
- Auth endpoints:
  - `GET /auth/google/start` (PKCE + state cookie + validated `return_to`)
  - `GET /auth/google/callback` (exchanges code, verifies Google ID token, enforces allowlist, provisions user, issues JWT)
  - `GET /auth/me` (Bearer JWT → user payload)
- CORS configured via `CORS_ALLOW_ORIGIN_REGEX` (no hardcoded URLs in code)
- Local DB: `users` table (email, role, allowed_slots[]) stored in SQLite (NOT slot state)
- Slot filesystem contract helpers in `core/slot_fs.py` (slot root default `slots/`; files: `slot_config.yml`, `slot_state.json`, `status.json`, `leads.jsonl`)
- Slot endpoints:
  - `GET /slots` → summaries (phase, pid, heartbeat, config/state/status presence, leads line count)
  - `GET /slots/{slot_id}` → full snapshot (config/state/status) with validation of slot_id and safe path resolution
- Slot start/stop/restart endpoints (auto-resume unless manually stopped):
  - `POST /slots/{slot_id}/start`
  - `POST /slots/{slot_id}/stop` (disables auto-restart)
  - `POST /slots/{slot_id}/restart`
- Slot Manager (stub, background thread):
  - Scans `slots/`, starts worker stub per slot, restarts on stale heartbeat >30s unless manually stopped
  - Worker stub (`core/worker_indiamart_stub.py`) cycles phases (BOOT → INIT → PARSE_LEADS heartbeat) every ~2s, appends synthetic leads to `leads.jsonl`, emits `/events/verified` per lead
  - Runner metadata: per-run run_id recorded to `run_meta.json`; `slot_state.pid` file maintained
  - Uses psutil to report `pid_alive`
- Playwright harness (new):
  - `WORKER_MODE` env controls stub vs real worker (`stub` default; `playwright` uses `core/worker_indiamart.py`)
  - Optional `INDIAMART_PROFILE_PATH` env points to existing Chrome profile (currently: `/Users/thatsarpit/Library/Application Support/Google/Chrome/Profile 1`, Savvy Meds/Panchsheel Medi…)
  - Slot Manager resolves profile path per slot (defaults to `browser_profiles/<slot_id>` when no override)
  - Playwright worker now opens Recent Leads with the persistent profile, detects login-required redirects, scrapes lead cards using DOM selectors (`div.bl_grid.PrD_Enq`), parses age/member-month heuristics, extracts email/phone heuristics from card text (and post-click body), detects availability icons (email/phone/whatsapp), filters by `allowed_countries`, `blocked_countries`, `keywords`, `keywords_exclude`, and `required_contact_methods` in `slot_config.yml`, appends observations to `leads.jsonl`, and heartbeats with counts. Safe auto-click/verify path is available when `auto_buy=true` AND `dry_run=false`, limited by `max_clicks_per_cycle`; verification attempts inline signals first, then checks the Consumed Leads page for lead_id/title. Verified events emitted only on heuristic success with contact fields when available. Defaults remain observe-only (`dry_run` true).
  - Both stub and Playwright workers now write `status.json` snapshots with metrics (leads_found, leads_kept, clicks_sent, verified, last_error).
- Dashboard (dashboards/client):
  - Env-driven API base (`VITE_API_BASE_URL`, default `http://localhost:8001`)
  - Captures JWT from hash fragment after OAuth callback, stores locally, calls `/auth/me`
  - Router-enabled single app (admin/client) with slot-centric navigation:
    - `/slots` list + `/slots/:slotId` deep-link
    - Slot detail has tabs: Overview / Config / Leads / WhatsApp / Remote Login
  - Green-accent dark theme; WhatsApp QR + Remote Login moved into per-slot detail
- Events:
  - `/events/verified` accepts POST with `X-Engyne-Worker-Secret` (env `ENGYNE_WORKER_SECRET`); fan-outs to channel queues (`runtime/{whatsapp,telegram,email,sheets,push}_queue.jsonl`) plus `verified_queue.jsonl`; optional webhook via `VERIFIED_WEBHOOK_URL` + `VERIFIED_WEBHOOK_SECRET`.
  - Quality mapping enforced in worker stub (`core/quality.py`)
- Dispatchers (framework):
  - `core/dispatcher_worker.py` processes per-channel queues with offset tracking, per-slot rate limit, contact-state persistence, and proofs logs.
  - `scripts/dispatchers_run.sh` runs all dispatchers and writes `runtime/dispatcher_<channel>.pid`.
  - Default `DISPATCHER_DRY_RUN=true` holds items (unless `DISPATCHER_DRY_RUN_ADVANCE=true`), preventing accidental sends.
  - WhatsApp uses WAHA first when `WAHA_BASE_URL` is set (session name = `WAHA_SESSION_PREFIX + slot_id`, or `WAHA_SESSION` override), configurable auth headers/path. Falls back to webhook (`WHATSAPP_WEBHOOK_URL`) if WAHA is not configured.
  - Delivery uses per-channel webhook envs (`WHATSAPP_WEBHOOK_URL`, `TELEGRAM_WEBHOOK_URL`, etc.) and will block if contact data is missing.
  - Optional Ollama integration for message writing via `OLLAMA_*` env vars (per-node LLM).
- WhatsApp QR in dashboard:
  - API endpoints: `POST /whatsapp/{slot_id}/session/start` + `GET /whatsapp/{slot_id}/qr` proxy WAHA and return QR images.
  - Dashboard renders a per-slot QR for quick scan (one WhatsApp per slot, session name defaults to `WAHA_SESSION_PREFIX + slot_id`).
Notes:
- Found and terminated a stale listener on port `8001` (SSH port-forward) and an old local agent (`~/.engyne/agent/agent.py`)
- Git repo initialized on branch `main`; added `.gitignore` for local/runtime artifacts
- IndiaMART Chrome profile (logged-in): `/Users/thatsarpit/Library/Application Support/Google/Chrome/Profile 1` (label: Savvy Meds / Panchsheel Medi…); use for Playwright persistent context when wiring real worker
- Example slot configuration added at `config/slot_config.example.yml` (filters + safety flags).
- Selector probe tool: `scripts/indiamart_dom_probe.py` dumps DOM samples for Recent Leads + Consumed Leads into `runtime/` for tuning, pauses for manual login if required, and now uses Playwright text locators to grab the nearest card HTML for “Contact Buyer”/“Consumed on” plus fallback captures.
- Local auth redirect origins confirmed in `.env`; API + dashboard dev servers started via `nohup` with logs at `runtime/api.log` and `runtime/dashboard.log`.
- Google OAuth client ID/secret configured locally in `.env`; API restarted on port `8001`.
- Admin login verified via Google OAuth on dashboard (`thatsarpitg@gmail.com`).
- Remote Login (initial):
  - API endpoints: `POST /slots/{slot_id}/remote-login/start`, `GET /remote-login/{token}`, `WS /remote-login/ws/{token}`, `POST /remote-login/{token}/stop`
  - Single active session stored in `runtime/remote_login.json` with TTL; start stops slot before login
  - Token-gated HTML page provides VNC URL and session countdown
  - Dashboard action added per slot to start remote login and open the token URL
- Dashboard API calls for slot actions/remote login now use `POST` (fixes 405 errors).
- Fixed remote login token page JS template interpolation causing 500s; API restarted.
- Remote login start is now idempotent per slot (returns active session instead of 409).
- Remote login flow verified end-to-end; token page renders and shows VNC URL + expiry countdown.
- IndiaMART consumed leads verification improved: parses `.ConLead_cont` cards, matches by title, extracts email/phone for verified events.
- Consumed lead matching now returns contact details (person/company/country/consumed_on) and includes them in verified payloads.
- Slack dispatcher added (optional webhook channel) for verified lead delivery.
- README quickstart added with OAuth, DB, cluster, and deployment notes.
- Added hub/node run scripts and Postgres driver (Cloud SQL ready).
- Dashboard now supports local vs cluster view (uses `/cluster/slots` with node column).
- Slot detail view added to dashboard, with lead list + verified filter + JSONL download endpoint.
- Slack alerting for slot restarts added (heartbeat stale / worker down) via `ALERTS_SLACK_WEBHOOK_URL`.
- Cluster plumbing (initial):
  - Node endpoints: `GET /node`, `POST /node/slots/snapshot` (optional shared secret `NODE_SHARED_SECRET`)
  - Hub endpoint: `GET /cluster/slots` aggregates local + configured nodes from `config/nodes.yml`
  - Config example at `config/nodes.example.yml`; envs `NODES_CONFIG_PATH`, `CLUSTER_REQUEST_TIMEOUT_SECONDS`
- Web push notifications added:
  - VAPID settings wired in API; `pywebpush` dependency added.
  - Push subscription table in DB + API routes (`GET /push/vapid-public-key`, `POST /push/subscribe`, `POST /push/unsubscribe`).
  - `/events/verified` now sends web push (only when slot config `channels.push=true`).
  - Dashboard registers `public/sw.js` and provides Enable/Disable push controls.
- Slot config update flow added:
  - `PATCH /slots/{slot_id}/config` for client-safe fields (quality/dry_run/max_clicks/max_run_minutes/allowed_countries/keywords/channels).
  - `PUT /slots/{slot_id}/config` for admin full JSON editor.
  - Slot/cluster endpoints now enforce RBAC via JWT and `allowed_slots`.
  - Dispatchers honor per-slot `channels` toggles; channels are OFF by default in `config/slot_config.example.yml`.
  - Slot Manager enforces `max_run_minutes` by auto-stopping (disables auto-restart) and emits Slack alert.
  - `.gitignore` now ignores `slots/` runtime directories.
- Admin slot provisioning added (`POST /slots/provision`) plus dashboard UI for admins.
- Audit logs and node registry added to DB; node endpoints update `node_registry` on access.
- Observability hooks added (optional Sentry + OpenTelemetry) controlled by env vars.
- WAHA local instance started via Docker (`devlikeapro/waha:arm`), running on `http://localhost:3000`.
  - WAHA uses `X-Api-Key` header; API key set in `.env` as `WAHA_TOKEN`.
- Dashboard UX overhaul (in progress):
  - TanStack Query caching for slots/slot detail/leads, with invalidation on actions.
  - Radix UI Tabs/Dialog/Tooltip adoption; leads table virtualized via `react-virtuoso`.
  - Login page redesign with hero + auth card and placeholder alternate sign-in methods (disabled).
  - Login styling refined for premium dark/light presentation (glass panel, accent glow, feature list rails).
  - Login layout de-cluttered with tighter spacing, lighter feature cards, and aligned hero/card tops.
  - Login copy and structure simplified: removed redundant badges/labels, replaced feature cards with a short value list, moved “Need access?” outside the card.
- Dashboard navigation refactor (app-like):
    - Sidebar switched from `#hash` anchors to route-based screens: `/overview`, `/slots`, `/slots/:slotId`, `/alerts` (prevents scroll-jumps on navigation).
    - Document scroll locked; app scroll contained in `.main` with overscroll containment to prevent rubber-band “blank space”.
    - Background animation reduced for authenticated screens; zoom gestures/shortcuts blocked to keep a native-app feel (tradeoff: accessibility).
  - Fixed React “maximum update depth” loop in Control Plane by only updating selected slot/lead state when the filtered lists actually change.
  - Control Plane config draft updates now guard against redundant state writes to prevent render loops; Overview now includes an analytics KPI snapshot with a link to the full Analytics view.
  - WAHA Core supports only `default` session; `WAHA_SESSION=default` set (all slots share the same WhatsApp in Phase A).
  - QR path uses `WAHA_SCREENSHOT_PATH=/api/{session}/auth/qr`.
- WAHA session start now tolerates 409/422 responses from `/api/sessions/{session}/start` (treated as already-started) so QR fetch no longer fails on duplicate starts.
- Dashboard QR UI now auto-refreshes the WhatsApp QR every 15s and disables caching; includes Hide/Refresh controls to avoid stale QR scans.
- WhatsApp device successfully linked via QR (local WAHA default session).
- Added dispatcher test helper `scripts/emit_verified_event.py` and documented WAHA/dispatcher setup in README; `.env.example` updated for WAHA core defaults.
- Dispatchers support per-event custom message override via `payload.message` (used by the verified-event test helper).
- Dispatcher queue now advances past `blocked` records (missing_contact/missing_webhook) so later events are not stalled.
- WhatsApp dispatcher validated end-to-end via WAHA; test message sent successfully through WAHA.
- IndiaMART worker selector updated to handle `div.bl_grid.Prd_Enq`; observed leads now logged even when filtered, with `kept` and `reject_reason` fields. Smoke run shows leads_found > 0.
- Phase B deploy scripts added: `scripts/gcp_bootstrap.sh`, `scripts/gcp_deploy_api.sh`, `scripts/gcp_deploy_dashboard.sh`, plus `Dockerfile.api` and `.dockerignore`.
- Production env template added at `deploy/env.prod.example` for Cloud Run/Cloud SQL setup.
- GCP bootstrap completed (APIs enabled, Artifact Registry created).
- Cloud SQL instance created: `engyne-postgres` (asia-south1) with database `engyne`, user `engyne_app`; Secret Manager populated for DB URL + app secrets.
- Cloud Run API deployed: `https://engyne-api-993136835136.asia-south1.run.app` (Cloud SQL unix socket + Secret Manager injection).
- Dashboard deployed to `gs://engyne-dashboard-prod` and `gs://app.engyne.space`; latest build targets `VITE_API_BASE_URL=https://api.engyne.space`.
- Domain ownership for `engyne.space` verified in Google Search Console.
- Cloud Run domain mapping is not supported in `asia-south1`; created global HTTPS load balancer with host routing:
  - `api.engyne.space` → Cloud Run (serverless NEG)
  - `app.engyne.space` → GCS backend bucket
  - Global IP reserved: `34.54.143.58`
- Phase C prep added:
  - `deploy/env.node.example` for Mac mini node config
  - `scripts/node_bootstrap.sh` and `scripts/node_install_launchd.sh`
  - Launchd templates in `config/launchd/` for API + dispatchers
- Node bootstrap notes: Mac mini needs Python 3.11+ (launchd PATH updated for Homebrew), Xcode Command Line Tools, and Docker for WAHA; updated psycopg binary pin to 3.2.13 for Python 3.13 compatibility.
- Hub configured `config/nodes.yml` with `node-2` (http://192.168.1.101:8001) using `NODE_SHARED_SECRET` from hub `.env`.
- Mac mini node API is healthy (`/healthz` returns `node-2`). WAHA container started on the node (port 3000).
- Dashboard UI refresh: control-plane layout rebuilt with persistent sidebar + top bar, slot metrics header, slot filters + bulk actions, per-slot detail tabs, lead selection + sorting, and per-slot onboarding/push panels (dark-mode, green accent).
- Admin can now invite clients and assign slots (new `/admin/invite` route); clients may start Remote Login for their assigned slots (RBAC still enforced).
- Slot config template updated with the current pharma keyword list for fast provisioning; local slots can be pre-seeded from this template.
- VAPID keys generated and stored in `.env`; push alerts ready when `channels.push=true`.
- Local IndiaMART worker set to `WORKER_MODE=playwright` with `INDIAMART_PROFILE_PATH` pointing to Chrome Profile 1.
- IndiaMART country filtering now matches only the parsed `lead.country` value (plus aliases for us/usa/uk/aus) to avoid false positives from substring matches in card text; requires worker restart for slot-1/slot-2 to take effect.
- Outbound messaging disabled for slot-1 by setting all `channels` flags to false; this stops WhatsApp/other dispatcher sends while still allowing "Contact Buyer" clicks and lead verification.
- Added optional fuzzy keyword matching in worker (`keyword_fuzzy`, `keyword_fuzzy_threshold`) and enabled it on slot-1/slot-2 to reduce misses from minor variants.
- Added brand keywords `austro` and `iverheal` to `config/slot_config.example.yml` and slot-1/slot-2 configs.
- Added full brand keyword list (from user) into `config/slot_config.example.yml` and slot-1/slot-2 configs for better lead capture.
- Imported key behaviors from LeadForgeV0: optional IndiaMART recent API intake (`prefer_api` + `recent_api_url`) and API+DOM merge for faster/accurate lead capture; enabled `prefer_api` for slot-1/slot-2.
- Slot-4 and slot-5 configs synced to slot-1 run settings after manual login capture.
- Dashboard theming now supports time-based light/dark mode (light 07:00–19:00, dark otherwise) with new design tokens; Slots list + Slot detail now render in a two-column split layout on wide screens.
- Slots table now uses enterprise status pills (phase, PID, heartbeat) with modernized table styling and action grouping.
- Dashboard visual system refreshed (Supermemory-inspired): new surface tokens, refined cards/tables, button polish, focus states, and light/dark color tuning for a more serious enterprise feel; leads table now uses the modern table style.
- Slot detail now includes a quick stats strip, loading skeletons, and sticky detail column on large screens; tables/actions tuned for denser, enterprise interaction.
- Slot-level empty state added for first-time provisioning, plus guided onboarding callout with completion status and quick actions (config/WhatsApp/remote login).
- Slot detail tabs now use a two-column tab layout with a main panel and contextual insights sidebar; WhatsApp/Remote Login views have dedicated status/insight panels and QR framing.
- Overview tab refactored into the two-column layout with a health sidebar; leads tab now surfaces verified lead success callouts and updated funnel stats; WhatsApp/Remote Login show success callouts when QR/session is active.
- Visual refresh pass tuned the light theme: reduced green cast, softened shadows, flattened cards/tables, simplified sidebar and button styling for a more professional enterprise look.
- Dashboard now uses TanStack Query for data fetching (slots, slot detail, leads) with cache + background refresh for faster, more reliable UI updates.
- Radix UI primitives introduced (Tabs, Dialog, Tooltip) and leads table virtualized with `react-virtuoso` for better UX and performance at scale.
- Login page redesigned with Engyne branding, hero copy, feature list, and a polished Google sign-in card.
- All local slots set to `dry_run: true`, `auto_buy: false`, and `max_clicks_per_cycle: 0` to prevent any clicks during redesign; workers manually stopped.
- Slot-2 re-enabled for live buying: `dry_run: false`, `auto_buy: true`, `max_clicks_per_cycle: 1` (hot-reload via slot_config.yml).
- Local `.env` `WORKER_MODE` set to `playwright` for headful slot runs when needed.
- Slot detail layout upgraded with status pills, a structured header, and panel grids for overview content.
- Supermemory integration scaffolding added (API client + scripts) and new env vars `SUPERMEMORY_API_KEY`, `SUPERMEMORY_BASE_URL`; scripts `scripts/supermemory_push_context.py` and `scripts/supermemory_search.py`.
- Supermemory API key shared in chat; user chose not to rotate. Key must NOT be committed or echoed in logs. Store only in local `.env` as `SUPERMEMORY_API_KEY`.
- Lead corpus analysis:
  - Total `leads.jsonl` lines: 13,356 across slots; only 486 are real Playwright-observed leads with rich fields (the rest are older stub entries with only `{lead_id, observed_at, meta}`).
  - Observed lead fields currently captured reliably: `title`, `country`, `category_text`, `member_since_text`/`member_months`, and `availability` icons; `age_hours`/`time_text` are missing in ~75% due to parsing gaps.
  - Real lead stats so far: slot-1 kept/clicked/verified = 21/13/13; slot-2 = 23/21/21; slot-4 = 8/8/7; slot-5 = 11/8/8.
  - Global reject reasons (real leads): `allowed_country` dominates; then `min_member_months`, then `keywords`.
  - Machine summary written to `runtime/leads_schema_summary.json` (PII-safe).
- Lead preview work (in progress):
  - Shared lead rules extracted into `core/lead_rules.py` (keyword/country matching, time/member parsing).
  - Worker now captures structured card fields (quantity/strength/packaging/intent/buys/engagement/retail hint) and stores them in `leads.jsonl`.
  - New endpoint draft: `POST /slots/{slot_id}/config/preview` evaluates recent leads against a config override and returns keep/reject reasons plus parsed fields for UI preview.
  - Dashboard Config tab now includes a Preview panel (Run preview → shows keep/reject stats and sample leads) with fuzzy matching + required contact method controls.
- Analytics + subscriptions (new):
  - Daily analytics rollup service now stores aggregated counts in DB from `leads.jsonl` (no raw lead storage) with tables `slot_metrics_daily` + `slot_metrics_cursors`.
  - New analytics endpoints: `GET /analytics/summary` (global + per-slot totals) and `GET /analytics/slots/{slot_id}` (daily series).
  - Subscription tracking added: `slot_subscriptions` table, `POST /subscriptions` (admin upsert), `GET /subscriptions` (admin/client list).
  - Env knobs: `ANALYTICS_ENABLED`, `ANALYTICS_ROLLUP_SECONDS` (added to `.env.example`, `deploy/env.prod.example`, `deploy/env.node.example`).
  - Dashboard analytics view added (`/analytics`): KPI cards, per-slot totals table, and per-slot daily trend bars/table.
  - Dashboard account view added (`/account`) with subscription list for clients and admin upsert form.
  - Analytics charting upgraded with Recharts (daily observed/kept/verified line chart + styled tooltip).
- Motion upgrade: added Framer Motion for lightweight page transitions between dashboard views.
- Admin clients view added (`/clients`) with `/admin/clients` API to list users + slot access, plus subscription rollups.
- ControlPlanePage now renders via `renderView()` (no duplicate JSX blocks), fixing tab navigation not updating and avoiding compile/runtime errors.
- App shell updated so only `.page-content` scrolls (topbar fixed), reducing full-page scroll/white gaps and improving app-like feel.
- Dashboard refresh flicker reduced: slot/analytics loading now use `isLoading` for skeletons and separate `isFetching` indicators, avoiding table/card resets on background polling.
- Added stable data buffers for slots + analytics summary and disabled window-focus refetch to prevent transient blank states during polling.
- Added per-slot `headless` config support (defaults true; forced false when `login_mode: true`). All local slots set to `headless: true`, `login_mode: false`, `auto_buy: false`, `dry_run: true` and stopped (safe idle).
- App card reveal animation disabled for `body[data-surface="app"]` to reduce perceived flicker on frequent re-renders.
- Design reference (UI/UX):
  - Local prototype folder: `/Users/thatsarpit/engyne d` (NOT in git).
  - Stack: Vite + React + Tailwind + Lucide + Framer Motion.
  - Useful patterns to port into `dashboards/client` (without copying wholesale):
    - AppShell with fixed sidebar + mobile drawer overlay + sticky header; main content is the only scroll container.
    - Table → mobile card list pattern for dense data, plus horizontal “snap” tab strip (`overflow-x-auto` + `no-scrollbar`) for slot detail.
    - Theme engine that supports `system` and toggles `html` class `dark/light` (we will keep time-based light/dark as default but can add manual override later).
    - Landing page implementation (`src/landingpage.jsx`) to reuse later for `www.engyne.space` (separate from dashboard).
Next critical task:
- Wait for managed cert to become ACTIVE for `api.engyne.space` + `app.engyne.space`, then confirm HTTPS. After that, bootstrap Mac mini node using `scripts/node_bootstrap.sh` and LaunchAgents.

====================================================
END OF FILE
====================================================
