-- Run AFTER drizzle-kit push/migrate creates the base tables.
-- Converts the metrics table into a TimescaleDB hypertable with
-- compression and retention policies.

-- Requires TimescaleDB extension (included in timescale/timescaledb Docker image)
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- Convert metrics to hypertable partitioned by time (1-day chunks)
SELECT create_hypertable('metrics', 'time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);

-- Compress chunks older than 7 days (saves ~90% storage)
ALTER TABLE metrics SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'time DESC',
  timescaledb.compress_segmentby = 'agent_id'
);
SELECT add_compression_policy('metrics', INTERVAL '7 days', if_not_exists => TRUE);

-- Drop chunks older than 90 days (configurable via env in future)
SELECT add_retention_policy('metrics', INTERVAL '90 days', if_not_exists => TRUE);
