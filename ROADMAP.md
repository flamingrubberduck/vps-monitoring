# VPS Monitoring — Extension Roadmap

Goal: extend the current single-server VPS monitor into a full infrastructure monitoring platform
supporting containers, databases, S3/object storage, backups, uptime checks, and multi-user teams.

---

## Current State

| What exists | Tech |
|---|---|
| VPS system metrics (CPU, mem, disk, net) | Bash agent → Next.js → MongoDB |
| Single admin user | JWT + HttpOnly cookie |
| Telegram alerts | Per-server cooldown |
| One-line agent install | `install.sh` via curl |

**Key files:**
- `src/lib/models/Agent.ts` — agent registration + metadata
- `src/lib/models/Metric.ts` — time-series metrics (one doc per heartbeat)
- `src/lib/models/User.ts` — single admin only (`role: 'admin'`)
- `src/app/api/agents/heartbeat/route.ts` — receives metrics, triggers alerts
- `src/app/api/agents/[agentId]/metrics/route.ts` — queries metrics by range

---

## Phase 1 — Foundation (do this before adding features)

### 1A. Replace MongoDB with TimescaleDB + PostgreSQL

MongoDB works now but will degrade as metrics volume grows (15s intervals × N servers × months of history).

**Why TimescaleDB:**
- PostgreSQL with automatic time partitioning (hypertables)
- 90%+ compression on old time-series data
- Fast range queries without manual index tuning
- Single DB handles both relational data (users, agents) and time-series (metrics)

**Migration plan:**

```
PostgreSQL (TimescaleDB extension)
├── agents          — relational, replaces Agent collection
├── users           — relational, replaces User collection
├── app_settings    — relational, replaces AppSettings collection
├── metrics         — hypertable (time-series), replaces Metric collection
├── containers      — NEW: docker/k8s container state
├── db_metrics      — NEW: database monitoring metrics (hypertable)
├── uptime_checks   — NEW: HTTP ping config
├── uptime_results  — NEW: ping results (hypertable)
├── backup_jobs     — NEW: backup job config + last result
└── alert_rules     — NEW: per-resource threshold rules
```

**Schema — metrics hypertable:**
```sql
CREATE TABLE metrics (
  time          TIMESTAMPTZ NOT NULL,
  agent_id      TEXT        NOT NULL,
  cpu_percent   FLOAT,
  load_avg1     FLOAT,
  load_avg5     FLOAT,
  load_avg15    FLOAT,
  mem_used      BIGINT,
  mem_total     BIGINT,
  swap_used     BIGINT,
  swap_total    BIGINT,
  disk_used     BIGINT,
  disk_total    BIGINT,
  net_rx_bytes  BIGINT,
  net_tx_bytes  BIGINT,
  net_rx_bps    FLOAT,
  net_tx_bps    FLOAT,
  uptime_secs   BIGINT,
  process_count INT
);
SELECT create_hypertable('metrics', 'time');
-- auto-compress chunks older than 7 days
SELECT add_compression_policy('metrics', INTERVAL '7 days');
-- auto-drop chunks older than 90 days (configurable)
SELECT add_retention_policy('metrics', INTERVAL '90 days');
```

**DB client:** replace `mongoose` with `postgres` (sql-template-strings) or `drizzle-orm`.
Recommended: **drizzle-orm** — TypeScript-native, works well with Next.js.

**docker-compose change:**
```yaml
# remove:
  mongo:
    image: mongo:7

# add:
  db:
    image: timescale/timescaledb:latest-pg16
    environment:
      POSTGRES_DB: vpsmon
      POSTGRES_USER: vpsmon
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vpsmon"]
      interval: 10s
      retries: 10
```

---

### 1B. Multi-User + Team Support

Current `User` model only supports `role: 'admin'`. Need teams with members and scoped access.

**New schema:**
```sql
CREATE TABLE teams (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE team_members (
  team_id    UUID REFERENCES teams(id),
  user_id    UUID REFERENCES users(id),
  role       TEXT CHECK (role IN ('owner', 'admin', 'viewer')) DEFAULT 'viewer',
  PRIMARY KEY (team_id, user_id)
);

-- agents now belong to a team
ALTER TABLE agents ADD COLUMN team_id UUID REFERENCES teams(id);
```

**Role permissions:**
| Role | Can do |
|---|---|
| owner | Everything, billing, delete team |
| admin | Add/remove agents, edit alerts, invite members |
| viewer | View dashboards only, no settings |

**Auth changes:**
- Add email/password signup
- JWT payload includes `teamId` + `role`
- All API routes filter by `team_id` from JWT

---

### 1C. Alert Engine Overhaul

Current alerts are Telegram-only and hardcoded to CPU/RAM/disk thresholds in `AppSettings`.

**New alert_rules table:**
```sql
CREATE TABLE alert_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      UUID REFERENCES teams(id),
  resource     TEXT NOT NULL,  -- 'agent', 'container', 'database', 'uptime'
  resource_id  TEXT,           -- null = applies to all
  metric       TEXT NOT NULL,  -- 'cpu_percent', 'mem_percent', 'disk_percent', etc.
  operator     TEXT NOT NULL,  -- 'gt', 'lt', 'eq'
  threshold    FLOAT NOT NULL,
  duration_s   INT DEFAULT 0,  -- must breach for this many seconds
  channels     TEXT[],         -- ['telegram', 'email', 'slack']
  cooldown_s   INT DEFAULT 300,
  enabled      BOOLEAN DEFAULT true
);
```

**Alert channels to support:**
- Telegram (existing)
- Email (SMTP)
- Slack (webhook)
- Discord (webhook)
- PagerDuty (events API)
- Webhook (generic POST)

---

## Phase 2 — Container Monitoring

### Docker Agent (new — written in Go)

The bash agent can't easily talk to the Docker socket. A Go binary handles this.

**What it collects:**
```
Per container:
- name, image, status, health status
- CPU percent, memory used/limit
- network rx/tx bytes
- restart count
- exit code (if stopped)

Docker Swarm (if enabled):
- service name, replicas desired vs running
- task failure count
- node health
```

**Install:**
```bash
curl -sSL https://yourapp.com/install-docker.sh | bash
```

**New tables:**
```sql
CREATE TABLE containers (
  time         TIMESTAMPTZ NOT NULL,
  agent_id     TEXT NOT NULL,
  container_id TEXT NOT NULL,
  name         TEXT,
  image        TEXT,
  status       TEXT,    -- running, exited, paused
  health       TEXT,    -- healthy, unhealthy, starting, none
  cpu_percent  FLOAT,
  mem_used     BIGINT,
  mem_limit    BIGINT,
  net_rx       BIGINT,
  net_tx       BIGINT,
  restart_count INT
);
SELECT create_hypertable('containers', 'time');
```

**Dashboard additions:**
- Container list per server (status badges: green/red/yellow)
- Per-container CPU + memory sparkline
- Docker Swarm view: services + replica health
- Alert: container unhealthy, restart count > N, service replicas < desired

---

## Phase 3 — Database Monitoring

### DB Agent (Go, connects to target databases)

Runs alongside the target database. Connects via standard DB drivers and collects performance metrics.

**Supported databases:**
- PostgreSQL
- MySQL / MariaDB
- MongoDB
- Redis

**PostgreSQL metrics:**
```
- active connections / max connections
- slow queries (queries > Xms)
- replication lag (if replica)
- cache hit ratio
- transaction rate
- bloat estimate
- lock waits
```

**Redis metrics:**
```
- memory used / max memory
- hit rate / miss rate
- connected clients
- evicted keys
- ops/sec
```

**Install:**
```bash
curl -sSL https://yourapp.com/install-db.sh | bash
# prompts for DB type + connection string
```

**New table:**
```sql
CREATE TABLE db_metrics (
  time           TIMESTAMPTZ NOT NULL,
  agent_id       TEXT NOT NULL,
  db_type        TEXT NOT NULL,  -- postgres, mysql, redis, mongo
  connections    INT,
  slow_queries   INT,
  cache_hit_rate FLOAT,
  repl_lag_bytes BIGINT,
  ops_per_sec    FLOAT,
  mem_used       BIGINT,
  mem_total      BIGINT
);
SELECT create_hypertable('db_metrics', 'time');
```

---

## Phase 4 — Uptime / HTTP Monitoring

### What it does
Ping URLs from your server every minute. Alert if down, slow, or SSL expiring.

**Config:**
```sql
CREATE TABLE uptime_checks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id        UUID REFERENCES teams(id),
  name           TEXT,
  url            TEXT NOT NULL,
  method         TEXT DEFAULT 'GET',
  interval_s     INT DEFAULT 60,
  timeout_ms     INT DEFAULT 10000,
  assert_status  INT DEFAULT 200,
  enabled        BOOLEAN DEFAULT true
);

CREATE TABLE uptime_results (
  time          TIMESTAMPTZ NOT NULL,
  check_id      UUID REFERENCES uptime_checks(id),
  status_code   INT,
  latency_ms    INT,
  up            BOOLEAN,
  ssl_expiry_days INT
);
SELECT create_hypertable('uptime_results', 'time');
```

**Dashboard additions:**
- Status page (public, shareable link)
- Uptime % over last 30/90 days
- Response time chart
- SSL expiry countdown

---

## Phase 5 — S3 / Object Storage Monitoring

**Supports:** AWS S3, Cloudflare R2, MinIO, Backblaze B2

**What it tracks:**
```
- bucket size (bytes) over time
- object count
- GET/PUT/DELETE request counts
- egress bytes (cost driver)
- failed requests
```

**How:** lightweight poller that uses cloud provider APIs (S3 ListBuckets + CloudWatch, R2 Analytics API, MinIO admin API).

**New table:**
```sql
CREATE TABLE storage_metrics (
  time           TIMESTAMPTZ NOT NULL,
  team_id        UUID REFERENCES teams(id),
  provider       TEXT,   -- s3, r2, minio, b2
  bucket         TEXT,
  size_bytes     BIGINT,
  object_count   BIGINT,
  requests_get   BIGINT,
  requests_put   BIGINT,
  egress_bytes   BIGINT
);
SELECT create_hypertable('storage_metrics', 'time');
```

---

## Phase 6 — Backup Monitoring

**What it tracks:**
- Last backup time
- Backup size
- Success / failure status
- Whether backup is stale (hasn't run in X hours)

**How:** agent-side hook — wrap your backup command with the monitor reporter:

```bash
# install.sh installs this wrapper
vpsmon-backup-report --job "postgres-daily" -- pg_dump mydb > backup.sql.gz
# reports: start time, end time, exit code, output size
```

**New table:**
```sql
CREATE TABLE backup_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      UUID REFERENCES teams(id),
  agent_id     TEXT,
  name         TEXT NOT NULL,
  last_run_at  TIMESTAMPTZ,
  last_status  TEXT,  -- success, failed, running
  last_size    BIGINT,
  max_age_s    INT DEFAULT 86400,  -- alert if older than this
  created_at   TIMESTAMPTZ DEFAULT now()
);
```

**Alerts:**
- Backup failed
- Backup not run in X hours
- Backup size dropped > 50% (possible data loss)

---

## Phase 7 — Kubernetes Monitoring

**What it tracks:**
```
Nodes:     CPU/mem usage, conditions (Ready, MemoryPressure, DiskPressure)
Pods:      status, restart count, OOMKilled events
Deployments: desired vs available replicas, rollout status
PVCs:      capacity, used, status
```

**How:** in-cluster agent using the official Go k8s client. Deployed as a DaemonSet or single Deployment.

```yaml
# install via helm
helm repo add vpsmon https://charts.yourapp.com
helm install vpsmon-agent vpsmon/agent \
  --set apiUrl=https://yourapp.com \
  --set token=tok_xxx
```

---

## Build Order Summary

```
Phase 1A — TimescaleDB + drizzle migration      ✅ DONE
Phase 1B — Multi-user + teams                   ✅ DONE
Phase 1C — Alert engine overhaul                ✅ DONE
Phase 2  — Docker + Swarm agent (Go)            (most requested container feature)
Phase 3  — Database monitoring agent (Go)       (high value for backend teams)
Phase 4  — Uptime / HTTP monitoring             (simple, high visibility)
Phase 5  — S3 / object storage                  (cost-conscious users)
Phase 6  — Backup monitoring                    (compliance, peace of mind)
Phase 7  — Kubernetes                           (larger teams, do last)
```

---

## Tech Stack Changes

| Layer | Current | Target |
|---|---|---|
| Database | MongoDB + Mongoose | TimescaleDB + drizzle-orm |
| Agents | Bash only | Bash (VPS) + Go (Docker, DB, K8s) |
| Auth | Single admin JWT | Multi-user JWT with team + role |
| Alerts | Telegram only | Pluggable channels (Telegram, Slack, email, webhook) |
| Frontend | Next.js 14 | Next.js 14 (keep, extend) |
| Deploy | Docker Compose | Docker Compose (keep, add more services) |

---

## What NOT to Change

- One-line install UX — this is a competitive advantage, keep it
- Next.js fullstack approach — no need for a separate backend
- Dark-themed dashboard — keep the aesthetic
- JWT + HttpOnly cookies — solid auth pattern
