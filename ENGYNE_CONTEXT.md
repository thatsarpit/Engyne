# ENGYNE — Canonical Project Context
Last updated: 2026-01-09 00:59 IST
Maintainer: Core Engineering
Status: ACTIVE BUILD (24h speedrun)

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

Phase A MUST be fully working before Phase B/C.

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
- [ ] WAHA deployment model?
- [ ] Cloud Run vs VM?
- [ ] Backup strategy?
- [ ] Log retention policy?

====================================================
19. CURRENT STATUS SNAPSHOT
====================================================

Date: 2026-01-09 00:59
Phase: PHASE A (Local) — Step 4 (Slot manager controls + worker harness + events/queue)
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
  - Slot list UI polling `/slots` every 5s; sign-in/out controls; slot start/stop/restart buttons wired to API
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
Next critical task:
- Step 4 wrap-up: tune WAHA payload format against real WAHA endpoint; validate selectors with real DOM snapshots; add remote login service

====================================================
END OF FILE
====================================================
