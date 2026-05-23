import {
  pgTable,
  text,
  integer,
  bigint,
  real,
  boolean,
  timestamp,
  primaryKey,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

// ─── Teams ────────────────────────────────────────────────────────────────────

export const teams = pgTable('teams', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Team    = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id:           uuid('id').primaryKey().defaultRandom(),
  username:     text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User    = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ─── Team Members ─────────────────────────────────────────────────────────────

export const teamMembers = pgTable('team_members', {
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:   text('role', { enum: ['owner', 'admin', 'viewer'] }).notNull().default('viewer'),
}, (t) => ({
  pk: primaryKey({ columns: [t.teamId, t.userId] }),
}));

export type TeamMember    = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;

// ─── Agents ───────────────────────────────────────────────────────────────────

export const agents = pgTable('agents', {
  agentId:            text('agent_id').primaryKey(),
  teamId:             uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  token:              text('token').notNull().unique(),
  hostname:           text('hostname').notNull().default('unknown'),
  os:                 text('os').notNull().default('unknown'),
  osVersion:          text('os_version').notNull().default(''),
  kernel:             text('kernel').notNull().default(''),
  arch:               text('arch').notNull().default(''),
  cpuModel:           text('cpu_model').notNull().default(''),
  cpuCores:           integer('cpu_cores').notNull().default(0),
  totalMemoryBytes:   bigint('total_memory_bytes', { mode: 'number' }).notNull().default(0),
  totalDiskBytes:     bigint('total_disk_bytes', { mode: 'number' }).notNull().default(0),
  publicIp:           text('public_ip'),
  privateIp:          text('private_ip'),
  tags:               text('tags').array().notNull().default([]),
  label:              text('label'),
  lastSeenAt:         timestamp('last_seen_at', { withTimezone: true }),
  lastAlertAt:        timestamp('last_alert_at', { withTimezone: true }),
  registeredAt:       timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Agent    = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

// ─── Metrics (TimescaleDB hypertable) ─────────────────────────────────────────
// After running migrations, convert with:
//   SELECT create_hypertable('metrics', 'time');
//   SELECT add_compression_policy('metrics', INTERVAL '7 days');
//   SELECT add_retention_policy('metrics', INTERVAL '90 days');

export const metrics = pgTable('metrics', {
  time:          timestamp('time', { withTimezone: true }).notNull(),
  agentId:       text('agent_id').notNull(),
  cpuPercent:    real('cpu_percent').notNull().default(0),
  loadAvg1:      real('load_avg1').notNull().default(0),
  loadAvg5:      real('load_avg5').notNull().default(0),
  loadAvg15:     real('load_avg15').notNull().default(0),
  memUsedBytes:  bigint('mem_used_bytes', { mode: 'number' }).notNull().default(0),
  memTotalBytes: bigint('mem_total_bytes', { mode: 'number' }).notNull().default(0),
  swapUsedBytes: bigint('swap_used_bytes', { mode: 'number' }).notNull().default(0),
  swapTotalBytes:bigint('swap_total_bytes', { mode: 'number' }).notNull().default(0),
  diskUsedBytes: bigint('disk_used_bytes', { mode: 'number' }).notNull().default(0),
  diskTotalBytes:bigint('disk_total_bytes', { mode: 'number' }).notNull().default(0),
  // Extra mounts beyond / — JSON array of {mount, usedBytes, totalBytes}
  extraDisks:    text('extra_disks'),
  netRxBytes:    bigint('net_rx_bytes', { mode: 'number' }).notNull().default(0),
  netTxBytes:    bigint('net_tx_bytes', { mode: 'number' }).notNull().default(0),
  netRxBps:      real('net_rx_bps').notNull().default(0),
  netTxBps:      real('net_tx_bps').notNull().default(0),
  uptimeSeconds: bigint('uptime_seconds', { mode: 'number' }).notNull().default(0),
  processCount:  integer('process_count').notNull().default(0),
}, (t) => ({
  agentTimeIdx: index('metrics_agent_time_idx').on(t.agentId, t.time),
}));

export type Metric    = typeof metrics.$inferSelect;
export type NewMetric = typeof metrics.$inferInsert;

// ─── App Settings ─────────────────────────────────────────────────────────────

export const appSettings = pgTable('app_settings', {
  id:                     integer('id').primaryKey().default(1),
  // Telegram
  telegramBotToken:       text('telegram_bot_token').notNull().default(''),
  telegramChatId:         text('telegram_chat_id').notNull().default(''),
  // Email (SMTP)
  smtpHost:               text('smtp_host').notNull().default(''),
  smtpPort:               integer('smtp_port').notNull().default(587),
  smtpUser:               text('smtp_user').notNull().default(''),
  smtpPassword:           text('smtp_password').notNull().default(''),
  smtpFrom:               text('smtp_from').notNull().default(''),
  smtpTo:                 text('smtp_to').notNull().default(''),
  // Slack
  slackWebhookUrl:        text('slack_webhook_url').notNull().default(''),
  // Discord
  discordWebhookUrl:      text('discord_webhook_url').notNull().default(''),
  // Generic webhook
  webhookUrl:             text('webhook_url').notNull().default(''),
  webhookSecret:          text('webhook_secret').notNull().default(''),
  // Legacy per-resource thresholds (kept for default alert_rules seed)
  alertCpuPercent:        integer('alert_cpu_percent').notNull().default(85),
  alertRamPercent:        integer('alert_ram_percent').notNull().default(85),
  alertDiskPercent:       integer('alert_disk_percent').notNull().default(90),
  telegramCooldownSeconds:integer('telegram_cooldown_seconds').notNull().default(300),
  createdAt:              timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:              timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AppSettings    = typeof appSettings.$inferSelect;
export type NewAppSettings = typeof appSettings.$inferInsert;

// ─── Alert Rules ──────────────────────────────────────────────────────────────

export const alertRules = pgTable('alert_rules', {
  id:         uuid('id').primaryKey().defaultRandom(),
  teamId:     uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name:       text('name').notNull(),
  resource:   text('resource', { enum: ['agent', 'container', 'database', 'uptime'] }).notNull().default('agent'),
  resourceId: text('resource_id'),                        // null = applies to all resources in team
  metric:     text('metric').notNull(),                   // cpu_percent, mem_percent, disk_percent, …
  operator:   text('operator', { enum: ['gt', 'lt', 'eq'] }).notNull().default('gt'),
  threshold:  real('threshold').notNull(),
  durationS:  integer('duration_s').notNull().default(0), // must breach for N seconds
  channels:   text('channels').array().notNull().default(['telegram']), // telegram, email, slack, discord, webhook
  cooldownS:  integer('cooldown_s').notNull().default(300),
  enabled:    boolean('enabled').notNull().default(true),
  lastFiredAt:timestamp('last_fired_at', { withTimezone: true }),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  teamIdx: index('alert_rules_team_idx').on(t.teamId),
}));

export type AlertRule    = typeof alertRules.$inferSelect;
export type NewAlertRule = typeof alertRules.$inferInsert;

// ─── Container Config (static details, upserted on change) ───────────────────

export const containers = pgTable('containers', {
  containerId:   text('container_id').notNull(),
  agentId:       text('agent_id').notNull().references(() => agents.agentId, { onDelete: 'cascade' }),
  name:          text('name').notNull(),
  image:         text('image').notNull(),
  imageId:       text('image_id').notNull().default(''),      // full image digest
  command:       text('command').notNull().default(''),       // entrypoint + cmd joined
  createdAt:     timestamp('created_at', { withTimezone: true }),  // when container was created
  restartPolicy: text('restart_policy').notNull().default(''), // no / always / unless-stopped / on-failure
  networkMode:   text('network_mode').notNull().default(''),
  // JSON columns — stored as text to avoid pg jsonb migration complexity
  ports:         text('ports').notNull().default('[]'),       // [{hostIp,hostPort,containerPort,protocol}]
  volumes:       text('volumes').notNull().default('[]'),     // [{source,destination,mode}]
  envVars:       text('env_vars').notNull().default('[]'),    // ["KEY=value", ...]
  labels:        text('labels').notNull().default('{}'),      // {key:value}
  networks:      text('networks').notNull().default('[]'),    // [{name,ipAddress}]
  configHash:    text('config_hash').notNull().default(''),   // sha256 of static fields, for change detection
  firstSeenAt:   timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk:          primaryKey({ columns: [t.containerId, t.agentId] }),
  agentIdx:    index('containers_agent_idx').on(t.agentId),
}));

export type Container    = typeof containers.$inferSelect;
export type NewContainer = typeof containers.$inferInsert;

// ─── Container Metrics (TimescaleDB hypertable) ────────────────────────────────
// After running migrations, convert with:
//   SELECT create_hypertable('container_metrics', 'time');
//   SELECT add_compression_policy('container_metrics', INTERVAL '7 days');
//   SELECT add_retention_policy('container_metrics', INTERVAL '30 days');

export const containerMetrics = pgTable('container_metrics', {
  time:          timestamp('time', { withTimezone: true }).notNull(),
  agentId:       text('agent_id').notNull(),
  containerId:   text('container_id').notNull(),   // Docker short ID (12 hex chars)
  name:          text('name').notNull(),            // container name (no leading /)
  image:         text('image').notNull(),
  status:        text('status').notNull(),          // running | exited | paused | ...
  cpuPercent:    real('cpu_percent').notNull().default(0),
  memUsedBytes:  bigint('mem_used_bytes', { mode: 'number' }).notNull().default(0),
  memLimitBytes: bigint('mem_limit_bytes', { mode: 'number' }).notNull().default(0),
  netRxBytes:    bigint('net_rx_bytes', { mode: 'number' }).notNull().default(0),
  netTxBytes:    bigint('net_tx_bytes', { mode: 'number' }).notNull().default(0),
  blockReadBytes: bigint('block_read_bytes', { mode: 'number' }).notNull().default(0),
  blockWriteBytes:bigint('block_write_bytes', { mode: 'number' }).notNull().default(0),
  restartCount:  integer('restart_count').notNull().default(0),
}, (t) => ({
  agentTimeIdx: index('container_metrics_agent_time_idx').on(t.agentId, t.time),
  containerTimeIdx: index('container_metrics_container_time_idx').on(t.containerId, t.time),
}));

export type ContainerMetric    = typeof containerMetrics.$inferSelect;
export type NewContainerMetric = typeof containerMetrics.$inferInsert;

// ─── Uptime Monitors ──────────────────────────────────────────────────────────

export const uptimeMonitors = pgTable('uptime_monitors', {
  id:           uuid('id').primaryKey().defaultRandom(),
  teamId:       uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name:         text('name').notNull(),
  url:          text('url').notNull(),
  intervalS:    integer('interval_s').notNull().default(60),   // check frequency
  timeoutS:     integer('timeout_s').notNull().default(10),
  enabled:      boolean('enabled').notNull().default(true),
  // current state
  status:       text('status', { enum: ['up', 'down', 'unknown'] }).notNull().default('unknown'),
  lastCheckedAt:timestamp('last_checked_at', { withTimezone: true }),
  lastDownAt:   timestamp('last_down_at', { withTimezone: true }),
  lastStatusCode:integer('last_status_code'),
  lastLatencyMs: integer('last_latency_ms'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  teamIdx: index('uptime_monitors_team_idx').on(t.teamId),
}));

export type UptimeMonitor    = typeof uptimeMonitors.$inferSelect;
export type NewUptimeMonitor = typeof uptimeMonitors.$inferInsert;

// ─── Uptime Events (TimescaleDB hypertable) ───────────────────────────────────
// SELECT create_hypertable('uptime_events', 'time');
// SELECT add_retention_policy('uptime_events', INTERVAL '90 days');

export const uptimeEvents = pgTable('uptime_events', {
  time:       timestamp('time', { withTimezone: true }).notNull(),
  monitorId:  uuid('monitor_id').notNull(),
  status:     text('status', { enum: ['up', 'down'] }).notNull(),
  latencyMs:  integer('latency_ms'),
  statusCode: integer('status_code'),
  error:      text('error'),
}, (t) => ({
  monitorTimeIdx: index('uptime_events_monitor_time_idx').on(t.monitorId, t.time),
}));

export type UptimeEvent    = typeof uptimeEvents.$inferSelect;
export type NewUptimeEvent = typeof uptimeEvents.$inferInsert;
