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

3) Provision a slot
```
mkdir -p slots/slot-1
cp config/slot_config.example.yml slots/slot-1/slot_config.yml
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
- Cloudflare for DNS/SSL

Hub run script (VM or container entrypoint):
```
./scripts/hub_run.sh
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
