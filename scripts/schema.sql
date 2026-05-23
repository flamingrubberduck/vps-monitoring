-- Auto-applied on every container start (all statements are idempotent).
-- Run by scripts/migrate.mjs before the Next.js server starts.

-- ── Teams ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Team Members ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner','admin','viewer')),
  PRIMARY KEY (team_id, user_id)
);

-- ── Agents ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  agent_id            TEXT PRIMARY KEY,
  team_id             UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  token               TEXT NOT NULL UNIQUE,
  hostname            TEXT NOT NULL DEFAULT 'unknown',
  os                  TEXT NOT NULL DEFAULT 'unknown',
  os_version          TEXT NOT NULL DEFAULT '',
  kernel              TEXT NOT NULL DEFAULT '',
  arch                TEXT NOT NULL DEFAULT '',
  cpu_model           TEXT NOT NULL DEFAULT '',
  cpu_cores           INTEGER NOT NULL DEFAULT 0,
  total_memory_bytes  BIGINT NOT NULL DEFAULT 0,
  total_disk_bytes    BIGINT NOT NULL DEFAULT 0,
  public_ip           TEXT,
  private_ip          TEXT,
  tags                TEXT[] NOT NULL DEFAULT '{}',
  label               TEXT,
  last_seen_at        TIMESTAMPTZ,
  last_alert_at       TIMESTAMPTZ,
  registered_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── App Settings ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  id                        INTEGER PRIMARY KEY DEFAULT 1,
  telegram_bot_token        TEXT NOT NULL DEFAULT '',
  telegram_chat_id          TEXT NOT NULL DEFAULT '',
  smtp_host                 TEXT NOT NULL DEFAULT '',
  smtp_port                 INTEGER NOT NULL DEFAULT 587,
  smtp_user                 TEXT NOT NULL DEFAULT '',
  smtp_password             TEXT NOT NULL DEFAULT '',
  smtp_from                 TEXT NOT NULL DEFAULT '',
  smtp_to                   TEXT NOT NULL DEFAULT '',
  slack_webhook_url         TEXT NOT NULL DEFAULT '',
  discord_webhook_url       TEXT NOT NULL DEFAULT '',
  webhook_url               TEXT NOT NULL DEFAULT '',
  webhook_secret            TEXT NOT NULL DEFAULT '',
  alert_cpu_percent         INTEGER NOT NULL DEFAULT 85,
  alert_ram_percent         INTEGER NOT NULL DEFAULT 85,
  alert_disk_percent        INTEGER NOT NULL DEFAULT 90,
  telegram_cooldown_seconds INTEGER NOT NULL DEFAULT 300,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default settings row (ignored if already exists)
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ── Alert Rules ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  resource     TEXT NOT NULL DEFAULT 'agent' CHECK (resource IN ('agent','container','database','uptime')),
  resource_id  TEXT,
  metric       TEXT NOT NULL,
  operator     TEXT NOT NULL DEFAULT 'gt' CHECK (operator IN ('gt','lt','eq')),
  threshold    REAL NOT NULL,
  duration_s   INTEGER NOT NULL DEFAULT 0,
  channels     TEXT[] NOT NULL DEFAULT '{telegram}',
  cooldown_s   INTEGER NOT NULL DEFAULT 300,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  last_fired_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS alert_rules_team_idx ON alert_rules(team_id);

-- ── Containers (static config) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS containers (
  container_id   TEXT NOT NULL,
  agent_id       TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  image          TEXT NOT NULL,
  image_id       TEXT NOT NULL DEFAULT '',
  command        TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ,
  restart_policy TEXT NOT NULL DEFAULT '',
  network_mode   TEXT NOT NULL DEFAULT '',
  ports          TEXT NOT NULL DEFAULT '[]',
  volumes        TEXT NOT NULL DEFAULT '[]',
  env_vars       TEXT NOT NULL DEFAULT '[]',
  labels         TEXT NOT NULL DEFAULT '{}',
  networks       TEXT NOT NULL DEFAULT '[]',
  config_hash    TEXT NOT NULL DEFAULT '',
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (container_id, agent_id)
);
CREATE INDEX IF NOT EXISTS containers_agent_idx ON containers(agent_id);

-- ── Metrics (TimescaleDB hypertable) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metrics (
  time             TIMESTAMPTZ NOT NULL,
  agent_id         TEXT NOT NULL,
  cpu_percent      REAL NOT NULL DEFAULT 0,
  load_avg1        REAL NOT NULL DEFAULT 0,
  load_avg5        REAL NOT NULL DEFAULT 0,
  load_avg15       REAL NOT NULL DEFAULT 0,
  mem_used_bytes   BIGINT NOT NULL DEFAULT 0,
  mem_total_bytes  BIGINT NOT NULL DEFAULT 0,
  swap_used_bytes  BIGINT NOT NULL DEFAULT 0,
  swap_total_bytes BIGINT NOT NULL DEFAULT 0,
  disk_used_bytes  BIGINT NOT NULL DEFAULT 0,
  disk_total_bytes BIGINT NOT NULL DEFAULT 0,
  extra_disks      TEXT,
  net_rx_bytes     BIGINT NOT NULL DEFAULT 0,
  net_tx_bytes     BIGINT NOT NULL DEFAULT 0,
  net_rx_bps       REAL NOT NULL DEFAULT 0,
  net_tx_bps       REAL NOT NULL DEFAULT 0,
  uptime_seconds   BIGINT NOT NULL DEFAULT 0,
  process_count    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS metrics_agent_time_idx ON metrics(agent_id, time);

-- ── Container Metrics (TimescaleDB hypertable) ────────────────────────────────
CREATE TABLE IF NOT EXISTS container_metrics (
  time              TIMESTAMPTZ NOT NULL,
  agent_id          TEXT NOT NULL,
  container_id      TEXT NOT NULL,
  name              TEXT NOT NULL,
  image             TEXT NOT NULL,
  status            TEXT NOT NULL,
  cpu_percent       REAL NOT NULL DEFAULT 0,
  mem_used_bytes    BIGINT NOT NULL DEFAULT 0,
  mem_limit_bytes   BIGINT NOT NULL DEFAULT 0,
  net_rx_bytes      BIGINT NOT NULL DEFAULT 0,
  net_tx_bytes      BIGINT NOT NULL DEFAULT 0,
  block_read_bytes  BIGINT NOT NULL DEFAULT 0,
  block_write_bytes BIGINT NOT NULL DEFAULT 0,
  restart_count     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS container_metrics_agent_time_idx     ON container_metrics(agent_id, time);
CREATE INDEX IF NOT EXISTS container_metrics_container_time_idx ON container_metrics(container_id, time);

-- ── Uptime Monitors ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS uptime_monitors (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  url              TEXT NOT NULL,
  interval_s       INTEGER NOT NULL DEFAULT 60,
  timeout_s        INTEGER NOT NULL DEFAULT 10,
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  status           TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('up','down','unknown')),
  last_checked_at  TIMESTAMPTZ,
  last_down_at     TIMESTAMPTZ,
  last_status_code INTEGER,
  last_latency_ms  INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS uptime_monitors_team_idx ON uptime_monitors(team_id);

-- ── Uptime Events (TimescaleDB hypertable) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS uptime_events (
  time        TIMESTAMPTZ NOT NULL,
  monitor_id  UUID NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('up','down')),
  latency_ms  INTEGER,
  status_code INTEGER,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS uptime_events_monitor_time_idx ON uptime_events(monitor_id, time);

-- ── TimescaleDB hypertables + policies ────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

SELECT create_hypertable('metrics', 'time',
  chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
ALTER TABLE metrics SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'time DESC',
  timescaledb.compress_segmentby = 'agent_id'
);
SELECT add_compression_policy('metrics', INTERVAL '7 days',  if_not_exists => TRUE);
SELECT add_retention_policy('metrics',   INTERVAL '90 days', if_not_exists => TRUE);

SELECT create_hypertable('container_metrics', 'time',
  chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
ALTER TABLE container_metrics SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'time DESC',
  timescaledb.compress_segmentby = 'agent_id'
);
SELECT add_compression_policy('container_metrics', INTERVAL '7 days',  if_not_exists => TRUE);
SELECT add_retention_policy('container_metrics',   INTERVAL '30 days', if_not_exists => TRUE);

SELECT create_hypertable('uptime_events', 'time',
  chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
SELECT add_retention_policy('uptime_events', INTERVAL '90 days', if_not_exists => TRUE);
