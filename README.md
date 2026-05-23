# VPS Monitor

<img width="2995" height="1213" alt="screenshot" src="https://github.com/user-attachments/assets/1e0f5d1b-4570-41e7-bde9-2ffec365e74c" />

> Open-source, self-hosted monitoring dashboard for your VPS fleet.  
> Built with **Next.js 14**, **TimescaleDB**, and a tiny **bash agent** that installs in one line.

![License: MIT](https://img.shields.io/badge/License-MIT-green)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TimescaleDB](https://img.shields.io/badge/TimescaleDB-pg16-orange)

---

## Features

- **One-line agent install** on any Linux VPS — Ubuntu, Debian, CentOS, Fedora, Arch, Alpine, and more
- **Auto-registration** — no SSH keys, no manual token copy-paste
- **System metrics** every 15s: CPU, memory, swap, disk (multi-mount), network, load avg, uptime, process count
- **Docker monitoring** — per-container CPU, memory, net/block I/O; full static config (command, ports, volumes, env vars, labels, networks, restart policy) stored on first run and updated only when the container changes
- **Uptime monitoring** — HTTP checks on a configurable interval with down/recover alerts
- **Multi-user teams** — owner / admin / viewer roles, invite teammates
- **Pluggable alerts** — Telegram, Email (SMTP), Slack, Discord, generic webhook; per-rule cooldown
- **TimescaleDB** — automatic time partitioning, 90% compression on old data, configurable retention
- **Zero-config deploy** — schema migrations run automatically on container start

---

## Quick start

```bash
git clone https://github.com/flamingrubberduck/vps-monitoring.git
cd vps-monitoring
cp .env.example .env
```

Edit `.env` — four values are required:

```bash
POSTGRES_PASSWORD=a-strong-db-password
JWT_SECRET=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 16)
NEXT_PUBLIC_APP_URL=https://monitor.yourdomain.com
```

Then:

```bash
docker compose up -d
```

Open `http://localhost:3000`, create your admin account, and you're done.  
The database schema is created automatically on first boot — no manual SQL steps needed.

---

## Adding a server

In the dashboard go to **Servers → Add server**, copy the install command, and run it on any VPS as root:

```bash
curl -fsSL https://monitor.yourdomain.com/api/install | sudo bash
```

The script:

1. Installs `curl` and `jq` if missing (supports apt, dnf, yum, apk, pacman)
2. Collects system info (hostname, OS, CPU, RAM, disk, IPs)
3. Registers the VPS with the dashboard and gets a unique token
4. Drops the agent script to `/opt/vps-monitor-agent/agent.sh`
5. Installs and starts a systemd service `vps-monitor-agent` that survives reboots
6. **If Docker is detected**, installs a second service `vps-monitor-docker-agent` that collects per-container stats and config

That's it — no further steps required.

### Managing the agent

```bash
sudo systemctl status vps-monitor-agent         # check status
sudo journalctl -u vps-monitor-agent -f         # tail logs
sudo systemctl status vps-monitor-docker-agent  # docker agent (if installed)
sudo /opt/vps-monitor-agent/uninstall.sh        # remove everything
```

---

## Docker container details

When the Docker agent runs on a VPS it collects **two kinds of data:**

| Data | Frequency | What's included |
|---|---|---|
| **Stats** | Every heartbeat | CPU %, memory used/limit, net I/O, block I/O, restart count, status |
| **Config** | On change only | Command, ports, volumes, env vars, labels, networks, restart policy, image digest |

Config is hashed on the agent side. Details are only sent to the dashboard when a container is first seen or after it is recreated/reconfigured — so heartbeats stay lightweight on stable systems.

Click any row in the containers table to expand the full config panel.

---

## Uptime monitoring

Add HTTP monitors from the **Uptime** page. Each monitor:

- Checks the URL at the configured interval (default 60s, minimum 30s)
- Records latency and HTTP status code
- Sends an alert (via configured channels) when status changes: up→down or down→up
- Alert channels follow the `uptime` alert rules you configure in **Alerts**, falling back to Telegram + Email if none are set

Checks run in-process on the dashboard server — no external cron needed.

---

## Alerts

Create rules in **Alerts**. Each rule targets a resource type:

| Resource | Available metrics |
|---|---|
| `agent` | `cpu_percent`, `mem_percent`, `disk_percent`, `mem_used`, `disk_used` |
| `uptime` | State-change (down / recovered) |

Channels per rule: **Telegram**, **Email**, **Slack**, **Discord**, **Webhook**.  
Configure channel credentials in **Settings → Alert channels**.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_PASSWORD` | yes | — | Password for the bundled TimescaleDB container |
| `DATABASE_URL` | no | auto-built from above | Override for external Postgres |
| `JWT_SECRET` | yes | dev fallback | Signs session cookies — use `openssl rand -hex 32` |
| `CRON_SECRET` | yes | dev fallback | Protects `/api/uptime/check` — use `openssl rand -hex 16` |
| `NEXT_PUBLIC_APP_URL` | yes | `http://localhost:3000` | Public URL of the dashboard (used in alert messages and install links) |
| `AGENT_OFFLINE_AFTER_SECONDS` | no | `60` | Seconds without a heartbeat before an agent shows as offline |
| `PORT` | no | `3000` | Port the web container listens on |

---

## Architecture

```
 ┌──────────────────────┐         ┌───────────────────────┐        ┌─────────────────────┐
 │  VPS (bash agent)    │─────►   │  Next.js 14           │──────► │  TimescaleDB        │
 │  vps-monitor-agent   │  HTTPS  │  /api/agents/*        │        │  metrics            │
 │  vps-monitor-docker  │         │  /api/uptime/*        │        │  container_metrics  │
 └──────────────────────┘         │  /api/alert-rules/*   │        │  uptime_events      │
                                  │  /api/team/*          │        │  agents, users,     │
                                  └──────────┬────────────┘        │  teams, containers  │
                                             │                     └─────────────────────┘
                                             ▼
                                  ┌───────────────────────┐
                                  │  Next.js Web UI       │ ◄── Browser
                                  │  /dashboard           │
                                  │  /servers/:id         │
                                  │  /uptime              │
                                  │  /alerts              │
                                  │  /settings            │
                                  └───────────────────────┘
```

- **Web + API**: Next.js 14 App Router, all in one process
- **DB**: TimescaleDB (Postgres + time-series extension). Schema applied automatically at boot via `scripts/migrate.mjs`
- **VPS agent**: pure bash, reads `/proc`, `df`, `uptime` — zero compiled binaries, ~5 MB RAM
- **Docker agent**: bash + `docker inspect` + `docker stats`, tracks config hash to avoid redundant payloads
- **Uptime checker**: runs in-process via Next.js instrumentation hook, polls every 30s

---

## Local development

```bash
npm install
cp .env.example .env.local
# Point DATABASE_URL to a running TimescaleDB or plain Postgres instance
npm run dev
```

Apply the schema manually on first run:

```bash
npx drizzle-kit push
```

Then visit `http://localhost:3000`.

---

## API reference

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/install` | public | Rendered bash install script |
| `POST` | `/api/setup` | once only | Create admin account |
| `POST` | `/api/auth/login` | public | Sign in |
| `POST` | `/api/auth/logout` | session | Sign out |
| `POST` | `/api/auth/password` | session | Change password |
| `GET/PATCH` | `/api/team` | session | Get / rename team |
| `GET/POST` | `/api/team/members` | session | List / invite members |
| `PATCH/DELETE` | `/api/team/members/:userId` | owner/admin | Change role / remove |
| `POST` | `/api/agents/register` | public | Agent self-registration |
| `POST` | `/api/agents/heartbeat` | agent token | System metrics |
| `POST` | `/api/agents/heartbeat-docker` | agent token | Container stats + config |
| `GET` | `/api/agents` | session | List agents |
| `GET/PATCH/DELETE` | `/api/agents/:id` | session | Agent detail / update / delete |
| `GET` | `/api/agents/:id/metrics` | session | Time-series metrics |
| `GET` | `/api/agents/:id/containers` | session | Latest container snapshot |
| `GET/POST` | `/api/alert-rules` | session | List / create alert rules |
| `PATCH/DELETE` | `/api/alert-rules/:id` | session | Update / delete rule |
| `GET/POST` | `/api/uptime` | session | List / create monitors |
| `PATCH/DELETE` | `/api/uptime/:id` | session | Update / delete monitor |
| `GET` | `/api/uptime/:id/history` | session | Check history |
| `POST` | `/api/uptime/check` | `X-Cron-Secret` | Run due checks (built-in, no manual call needed) |
| `GET/PUT` | `/api/settings/alerts` | session | Alert channel config |

---

## Security

- No public sign-up — the `/setup` route is disabled after the first account is created
- Each agent uses a unique token; compromising one VPS cannot affect others
- Sessions are HttpOnly cookies signed with HS256 JWT
- Passwords hashed with bcrypt (cost 12)
- Run the dashboard behind HTTPS (Caddy, Nginx, Traefik, Cloudflare Tunnel…)

---

## License

MIT
