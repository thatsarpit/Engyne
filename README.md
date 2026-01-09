# ENGYNE

ENGYNE is a slot-based control plane for lead acquisition, dispatching, and human-in-the-loop recovery.

## Quickstart (Local)

1) Pre-flight cleanup
```
./scripts/kill_all.sh
```

2) Create env file
```
cp .env.example .env
```

Required values in `.env`:
- `JWT_SECRET`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_ALLOWED_EMAILS`
- `GOOGLE_OAUTH_ADMIN_EMAILS`
- `ENGYNE_WORKER_SECRET`
Optional (for push alerts):
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

3) Provision a slot
```
mkdir -p slots/slot-1
cp config/slot_config.example.yml slots/slot-1/slot_config.yml
```
Or (admin only) via API:
```
curl -X POST http://localhost:8001/slots/provision \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"slot_id":"slot-1"}'
```

4) Start API
```
./scripts/dev_run_local.sh
```

5) Start dashboard
```
cd dashboards/client
npm install
npm run dev
```

Dashboard: http://127.0.0.1:5173  
API: http://127.0.0.1:8001

6) (Optional) Run dispatchers
```
./scripts/dispatchers_run.sh
```

## WhatsApp (WAHA)

WAHA runs locally and handles WhatsApp Web sessions. For Phase A we use the default WAHA session.

Required `.env` values:
- `WAHA_BASE_URL`
- `WAHA_TOKEN`
- `WAHA_SESSION=default`
- `WAHA_AUTH_HEADER=X-Api-Key`
- `WAHA_SCREENSHOT_PATH=/api/{session}/auth/qr`

In the dashboard:
- Click **WhatsApp QR** for the slot and scan using WhatsApp → Linked Devices.
- The QR auto-refreshes every 15 seconds; scan promptly.

## Dispatcher Test (Verified Event)

Emit a test verified event (adds to queues):
```
./scripts/emit_verified_event.py --slot-id slot-1 --whatsapp +916262812849 --message "hi arpit"
```

Run dispatchers (real send):
```
DISPATCHER_DRY_RUN=false ./scripts/dispatchers_run.sh
```

## Google OAuth

Create a Google OAuth client (Web) and set:
Authorized JavaScript origins:
- http://localhost:5173
- http://127.0.0.1:5173
- https://app.engyne.space

Authorized redirect URIs:
- http://localhost:8001/auth/google/callback
- http://127.0.0.1:8001/auth/google/callback
- https://api.engyne.space/auth/google/callback

Scopes:
- https://www.googleapis.com/auth/userinfo.email
- https://www.googleapis.com/auth/userinfo.profile

## IndiaMART DOM Probe (Selectors)

```
source .venv/bin/activate
python3 scripts/indiamart_dom_probe.py --profile-path "/Users/<you>/Library/Application Support/Google/Chrome/Profile 1"
```

Outputs:
- `runtime/indiamart_dom_recent.json`
- `runtime/indiamart_dom_consumed.json`

## Remote Login (macOS)

Enable Screen Sharing:
System Settings → General → Sharing → Screen Sharing ON

From dashboard, click **Remote Login** for a slot.  
VNC URL is shown on the token page.

## Push Notifications

Enable push in a slot config (`channels.push: true`) and set VAPID keys in `.env`.
Dashboard → Push Alerts → Enable.

## Database

Local (default):
```
DATABASE_URL=sqlite:///./runtime/engyne.db
```

Cloud SQL Postgres (recommended for hub):
```
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/engyne
```

## Cluster / Nodes

Hub reads node registry from `config/nodes.yml`.
Copy the template:
```
cp config/nodes.example.yml config/nodes.yml
```

Set a shared secret on hub + nodes:
```
NODE_SHARED_SECRET=CHANGE_ME
```

Hub aggregate endpoint:
```
GET /cluster/slots
```

Node endpoints:
```
GET /node
POST /node/slots/snapshot
```

## Deploy Hub (GCP)

Recommended:
- Cloud Run for API
- Cloud SQL Postgres for DB
- Cloud Storage + CDN for dashboard
- Cloudflare for DNS/SSL

Hub run script (VM or container entrypoint):
```
./scripts/hub_run.sh
```

### Phase B Bootstrap + Deploy

1) Authenticate + set project
```
gcloud auth login
export GCP_PROJECT_ID=engyne-483718
export GCP_REGION=asia-south1
```

2) Enable APIs + create Artifact Registry
```
./scripts/gcp_bootstrap.sh
```

3) Create Cloud SQL Postgres (manual via console) and store secrets in Secret Manager:
- `DATABASE_URL`
- `JWT_SECRET`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `ENGYNE_WORKER_SECRET`
- `WAHA_TOKEN`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

Reference env template:
```
deploy/env.prod.example
```

4) Deploy API to Cloud Run
```
export PUBLIC_API_BASE_URL=https://api.engyne.space
export PUBLIC_DASHBOARD_BASE_URL=https://app.engyne.space
./scripts/gcp_deploy_api.sh
```

5) Deploy dashboard to Cloud Storage
```
export GCP_DASHBOARD_BUCKET=app.engyne.space
export VITE_API_BASE_URL=https://api.engyne.space
./scripts/gcp_deploy_dashboard.sh
```

### Secrets & Cloud SQL

- Store secrets in GCP Secret Manager and inject via Cloud Run env vars.
- Use Cloud SQL Auth Proxy or direct Cloud Run integration for Postgres.

## Observability

Sentry (optional):
```
SENTRY_DSN=
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
```

OpenTelemetry (optional):
```
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318/v1/traces
OTEL_SERVICE_NAME=engyne-api
OTEL_TRACES_SAMPLE_RATE=0.1
```

## Add Mac mini as Node

On the Mac mini:
```
NODE_ID=node-2 ./scripts/node_run.sh
```

On the hub, add the node base URL to `config/nodes.yml`.

## Safe Shutdown

```
./scripts/kill_all.sh
```
