#!/usr/bin/env bash
# ==============================================================================
# VPS Monitor Agent - one-line installer
#
# Usage (on the target VPS):
#   curl -fsSL <DASHBOARD_URL>/api/install | sudo bash
#
# This installer:
#   - Installs deps (curl, jq) if missing
#   - Drops the agent script into /opt/vps-monitor-agent/
#   - Registers with the dashboard (auto-generates agentId + token)
#   - Installs and starts a systemd service that survives reboots
#   - If Docker is detected, also installs a Docker stats collector service
# ==============================================================================
set -euo pipefail

SERVER_URL="__SERVER_URL__"
INTERVAL="__INTERVAL__"
INSTALL_DIR="/opt/vps-monitor-agent"
CONFIG_FILE="$INSTALL_DIR/agent.conf"
AGENT_SCRIPT="$INSTALL_DIR/agent.sh"
DOCKER_AGENT_SCRIPT="$INSTALL_DIR/docker-agent.sh"
UNINSTALL_SCRIPT="$INSTALL_DIR/uninstall.sh"
SERVICE_FILE="/etc/systemd/system/vps-monitor-agent.service"
DOCKER_SERVICE_FILE="/etc/systemd/system/vps-monitor-docker-agent.service"

c_blue=$'\e[1;34m'; c_green=$'\e[1;32m'; c_yellow=$'\e[1;33m'; c_red=$'\e[1;31m'; c_reset=$'\e[0m'
log()  { printf '%s==>%s %s\n' "$c_blue"   "$c_reset" "$*"; }
ok()   { printf '%s✓%s   %s\n' "$c_green"  "$c_reset" "$*"; }
warn() { printf '%s!%s   %s\n' "$c_yellow" "$c_reset" "$*"; }
die()  { printf '%s✗%s   %s\n' "$c_red"    "$c_reset" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Please run as root (or with sudo)."

# ---- Detect package manager and install deps -------------------------------
log "Installing dependencies (curl, jq)…"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y >/dev/null
  apt-get install -y curl jq ca-certificates >/dev/null
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y curl jq ca-certificates >/dev/null
elif command -v yum >/dev/null 2>&1; then
  yum install -y curl jq ca-certificates >/dev/null
elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache curl jq ca-certificates bash procps coreutils >/dev/null
elif command -v pacman >/dev/null 2>&1; then
  pacman -Sy --noconfirm curl jq ca-certificates >/dev/null
else
  warn "No supported package manager found. Assuming curl/jq already installed."
fi
ok "Dependencies ready."

# ---- Collect system info ----------------------------------------------------
log "Detecting system…"

HOSTNAME_VAL="$(hostname 2>/dev/null || echo unknown)"
ARCH="$(uname -m 2>/dev/null || echo unknown)"
KERNEL="$(uname -r 2>/dev/null || echo unknown)"

OS_ID="linux"; OS_VER=""
if [ -r /etc/os-release ]; then
  . /etc/os-release
  OS_ID="${ID:-linux}"
  OS_VER="${VERSION_ID:-}"
fi

CPU_MODEL="$(awk -F: '/model name/{gsub(/^ +/,"",$2); print $2; exit}' /proc/cpuinfo 2>/dev/null || true)"
[ -z "$CPU_MODEL" ] && CPU_MODEL="$(uname -p 2>/dev/null || echo unknown)"
CPU_CORES="$(nproc 2>/dev/null || echo 1)"

MEM_TOTAL_KB="$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 0)"
MEM_TOTAL_BYTES=$(( MEM_TOTAL_KB * 1024 ))

DISK_TOTAL_BYTES="$(df -B1 --output=size / 2>/dev/null | tail -1 | tr -d ' ' || echo 0)"
[ -z "$DISK_TOTAL_BYTES" ] && DISK_TOTAL_BYTES=0

PRIVATE_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
PUBLIC_IP="$(curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || true)"
[ -z "$PUBLIC_IP" ] && PUBLIC_IP="$(curl -fsS --max-time 4 https://ifconfig.me 2>/dev/null || true)"

# ---- Generate or reuse agent id --------------------------------------------
mkdir -p "$INSTALL_DIR"

if [ -f "$CONFIG_FILE" ]; then
  log "Existing config detected — re-registering with same agentId."
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
fi

if [ -z "${AGENT_ID:-}" ]; then
  AGENT_ID="vps_$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi

# ---- Register with dashboard ------------------------------------------------
log "Registering with $SERVER_URL …"

REG_PAYLOAD=$(jq -n \
  --arg agentId "$AGENT_ID" \
  --arg hostname "$HOSTNAME_VAL" \
  --arg os "$OS_ID" \
  --arg osVersion "$OS_VER" \
  --arg kernel "$KERNEL" \
  --arg arch "$ARCH" \
  --arg cpuModel "$CPU_MODEL" \
  --argjson cpuCores "${CPU_CORES:-1}" \
  --argjson totalMemoryBytes "${MEM_TOTAL_BYTES:-0}" \
  --argjson totalDiskBytes "${DISK_TOTAL_BYTES:-0}" \
  --arg publicIp "${PUBLIC_IP:-}" \
  --arg privateIp "${PRIVATE_IP:-}" \
  '{agentId:$agentId, hostname:$hostname, os:$os, osVersion:$osVersion, kernel:$kernel, arch:$arch, cpuModel:$cpuModel, cpuCores:$cpuCores, totalMemoryBytes:$totalMemoryBytes, totalDiskBytes:$totalDiskBytes, publicIp:$publicIp, privateIp:$privateIp}')

REG_RESPONSE="$(curl -fsS -X POST "$SERVER_URL/api/agents/register" \
  -H 'Content-Type: application/json' \
  -d "$REG_PAYLOAD" || true)"

if [ -z "$REG_RESPONSE" ]; then
  die "Failed to contact dashboard at $SERVER_URL. Check connectivity / firewall."
fi

NEW_AGENT_ID=$(echo "$REG_RESPONSE" | jq -r '.agentId // empty')
NEW_TOKEN=$(echo "$REG_RESPONSE" | jq -r '.token // empty')

if [ -z "$NEW_AGENT_ID" ] || [ -z "$NEW_TOKEN" ]; then
  die "Registration failed. Server response: $REG_RESPONSE"
fi

AGENT_ID="$NEW_AGENT_ID"
AGENT_TOKEN="$NEW_TOKEN"
ok "Registered as $AGENT_ID."

# ---- Write config -----------------------------------------------------------
umask 077
cat > "$CONFIG_FILE" <<EOF
SERVER_URL="$SERVER_URL"
AGENT_ID="$AGENT_ID"
AGENT_TOKEN="$AGENT_TOKEN"
INTERVAL="$INTERVAL"
EOF
chmod 600 "$CONFIG_FILE"

# ---- Write agent script -----------------------------------------------------
cat > "$AGENT_SCRIPT" <<'AGENT_EOF'
#!/usr/bin/env bash
# vps-monitor-agent: collects metrics and POSTs to the dashboard.
set -u

CONFIG_FILE="/opt/vps-monitor-agent/agent.conf"
# shellcheck disable=SC1090
. "$CONFIG_FILE"

PREV_RX=0; PREV_TX=0; PREV_TS=0
PREV_CPU_TOTAL=0; PREV_CPU_IDLE=0

read_cpu() {
  read -r _ user nice system idle iowait irq softirq steal _ < /proc/stat
  local idle_all=$((idle + iowait))
  local non_idle=$((user + nice + system + irq + softirq + steal))
  local total=$((idle_all + non_idle))
  echo "$total $idle_all"
}

read_net() {
  local rx=0 tx=0
  while IFS= read -r line; do
    case "$line" in
      *:*)
        local iface="${line%%:*}"
        iface="${iface// /}"
        case "$iface" in
          lo|docker*|veth*|br-*|virbr*|tun*|tap*|wg*|cni*|flannel*|cali*) continue ;;
        esac
        local rest="${line#*:}"
        # shellcheck disable=SC2086
        set -- $rest
        rx=$(( rx + ${1:-0} ))
        tx=$(( tx + ${9:-0} ))
        ;;
    esac
  done < /proc/net/dev
  echo "$rx $tx"
}

get_disk() {
  df -B1 --output=used,size / 2>/dev/null | tail -1
}

get_extra_disks_json() {
  # Returns a JSON array of {mount, usedBytes, totalBytes} for all real non-root mounts
  local json="[]"
  while IFS= read -r line; do
    local used size mount
    used=$(echo "$line" | awk '{print $1}')
    size=$(echo "$line" | awk '{print $2}')
    mount=$(echo "$line" | awk '{print $3}')
    [ -z "$mount" ] || [ "$mount" = "/" ] && continue
    entry=$(jq -n --arg m "$mount" --argjson u "${used:-0}" --argjson t "${size:-0}" \
      '{mount:$m, usedBytes:$u, totalBytes:$t}')
    json=$(echo "$json" | jq --argjson e "$entry" '. + [$e]')
  done < <(df -B1 --output=used,size,target 2>/dev/null | tail -n +2 | grep -v '^[[:space:]]*0 ' | awk '$3 ~ /^\/(data|mnt|home|var|boot|opt|srv|storage)/' )
  echo "$json"
}

# Prime CPU + net counters once
read PREV_CPU_TOTAL PREV_CPU_IDLE <<<"$(read_cpu)"
read PREV_RX PREV_TX <<<"$(read_net)"
PREV_TS=$(date +%s)
sleep 1

while true; do
  NOW=$(date +%s)
  ELAPSED=$((NOW - PREV_TS))
  [ "$ELAPSED" -le 0 ] && ELAPSED=1

  # CPU
  read CPU_TOTAL CPU_IDLE <<<"$(read_cpu)"
  DT=$((CPU_TOTAL - PREV_CPU_TOTAL))
  DI=$((CPU_IDLE - PREV_CPU_IDLE))
  if [ "$DT" -gt 0 ]; then
    CPU_PERCENT=$(awk -v d="$DT" -v i="$DI" 'BEGIN { printf "%.2f", (1 - i/d) * 100 }')
  else
    CPU_PERCENT="0"
  fi
  PREV_CPU_TOTAL=$CPU_TOTAL
  PREV_CPU_IDLE=$CPU_IDLE

  # Load
  read L1 L5 L15 _ < /proc/loadavg

  # Memory
  MEM_TOTAL_KB=$(awk '/MemTotal/{print $2}' /proc/meminfo)
  MEM_AVAIL_KB=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
  SWAP_TOTAL_KB=$(awk '/SwapTotal/{print $2}' /proc/meminfo)
  SWAP_FREE_KB=$(awk '/SwapFree/{print $2}' /proc/meminfo)
  MEM_TOTAL=$(( MEM_TOTAL_KB * 1024 ))
  MEM_USED=$(( (MEM_TOTAL_KB - MEM_AVAIL_KB) * 1024 ))
  SWAP_TOTAL=$(( SWAP_TOTAL_KB * 1024 ))
  SWAP_USED=$(( (SWAP_TOTAL_KB - SWAP_FREE_KB) * 1024 ))

  # Disk on /
  read DISK_USED DISK_TOTAL <<<"$(get_disk)"

  # Extra mount points
  EXTRA_DISKS_JSON="$(get_extra_disks_json)"

  # Network
  read RX TX <<<"$(read_net)"
  RX_DELTA=$(( RX - PREV_RX ))
  TX_DELTA=$(( TX - PREV_TX ))
  [ "$RX_DELTA" -lt 0 ] && RX_DELTA=0
  [ "$TX_DELTA" -lt 0 ] && TX_DELTA=0
  RX_BPS=$(( RX_DELTA / ELAPSED ))
  TX_BPS=$(( TX_DELTA / ELAPSED ))
  PREV_RX=$RX; PREV_TX=$TX; PREV_TS=$NOW

  # Uptime
  UPTIME=$(awk '{print int($1)}' /proc/uptime)

  # Process count
  PROC_COUNT=$(ls -1 /proc 2>/dev/null | grep -c '^[0-9][0-9]*$')

  PAYLOAD=$(jq -n \
    --arg agentId "$AGENT_ID" \
    --arg token   "$AGENT_TOKEN" \
    --argjson cpuPercent "$CPU_PERCENT" \
    --argjson loadAvg1   "$L1" \
    --argjson loadAvg5   "$L5" \
    --argjson loadAvg15  "$L15" \
    --argjson memUsedBytes   "$MEM_USED" \
    --argjson memTotalBytes  "$MEM_TOTAL" \
    --argjson swapUsedBytes  "$SWAP_USED" \
    --argjson swapTotalBytes "$SWAP_TOTAL" \
    --argjson diskUsedBytes  "$DISK_USED" \
    --argjson diskTotalBytes "$DISK_TOTAL" \
    --argjson extraDisks     "$EXTRA_DISKS_JSON" \
    --argjson netRxBytes "$RX" \
    --argjson netTxBytes "$TX" \
    --argjson netRxBps   "$RX_BPS" \
    --argjson netTxBps   "$TX_BPS" \
    --argjson uptimeSeconds "$UPTIME" \
    --argjson processCount  "$PROC_COUNT" \
    '{agentId:$agentId, token:$token, cpuPercent:$cpuPercent, loadAvg1:$loadAvg1, loadAvg5:$loadAvg5, loadAvg15:$loadAvg15, memUsedBytes:$memUsedBytes, memTotalBytes:$memTotalBytes, swapUsedBytes:$swapUsedBytes, swapTotalBytes:$swapTotalBytes, diskUsedBytes:$diskUsedBytes, diskTotalBytes:$diskTotalBytes, extraDisks:$extraDisks, netRxBytes:$netRxBytes, netTxBytes:$netTxBytes, netRxBps:$netRxBps, netTxBps:$netTxBps, uptimeSeconds:$uptimeSeconds, processCount:$processCount}')

  curl -fsS --max-time 10 -X POST "$SERVER_URL/api/agents/heartbeat" \
    -H 'Content-Type: application/json' \
    -d "$PAYLOAD" >/dev/null 2>&1 || true

  sleep "$INTERVAL"
done
AGENT_EOF

chmod +x "$AGENT_SCRIPT"

# ---- systemd service --------------------------------------------------------
log "Installing systemd service…"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=VPS Monitor Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/env bash $AGENT_SCRIPT
Restart=always
RestartSec=5
User=root
StandardOutput=journal
StandardError=journal
KillMode=control-group

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable vps-monitor-agent >/dev/null 2>&1
systemctl restart vps-monitor-agent

sleep 2
if systemctl is-active --quiet vps-monitor-agent; then
  ok "Agent is running."
else
  warn "Agent service is not active. Run: journalctl -u vps-monitor-agent -n 50"
fi

# ---- Docker stats agent (optional, only if Docker is available) ---------------
DOCKER_ENABLED=false
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  log "Docker detected — installing Docker stats collector…"
  DOCKER_ENABLED=true

  cat > "$DOCKER_AGENT_SCRIPT" <<'DOCKER_EOF'
#!/usr/bin/env bash
# vps-monitor-docker-agent: collects Docker container stats + static config.
set -u

CONFIG_FILE="/opt/vps-monitor-agent/agent.conf"
# shellcheck disable=SC1090
. "$CONFIG_FILE"

HASH_CACHE_FILE="/opt/vps-monitor-agent/docker-hashes.conf"
touch "$HASH_CACHE_FILE"

# Load hash cache: containerId=hash pairs, one per line
load_hash() { grep "^${1}=" "$HASH_CACHE_FILE" 2>/dev/null | cut -d= -f2-; }
save_hash()  {
  local cid="$1" hash="$2"
  # Remove old entry and append new one (handles first write and updates)
  local tmp
  tmp=$(grep -v "^${cid}=" "$HASH_CACHE_FILE" 2>/dev/null || true)
  printf '%s\n%s=%s\n' "$tmp" "$cid" "$hash" > "$HASH_CACHE_FILE"
}

parse_bytes() {
  local raw="${1:-0}"
  local num unit
  num=$(echo "$raw" | grep -oE '[0-9]+(\.[0-9]+)?')
  unit=$(echo "$raw" | grep -oE '[kKmMgGtT]?i?[bB]$' || echo "B")
  awk -v n="${num:-0}" -v u="$unit" 'BEGIN{
    if(u~/[Gg]/) print int(n*1073741824)
    else if(u~/[Mm]/) print int(n*1048576)
    else if(u~/[Kk]/) print int(n*1024)
    else print int(n)
  }'
}

while true; do
  STATS_ENTRIES="[]"
  DETAIL_ENTRIES="[]"

  mapfile -t CONTAINER_IDS < <(docker ps -aq 2>/dev/null || true)

  if [ "${#CONTAINER_IDS[@]}" -gt 0 ]; then
    for CID in "${CONTAINER_IDS[@]}"; do

      # ── Full inspect (single call per container) ────────────────────────────
      INSP_JSON=$(docker inspect "$CID" 2>/dev/null) || continue
      [ "$INSP_JSON" = "null" ] || [ -z "$INSP_JSON" ] && continue

      SHORT_ID=$(echo "$INSP_JSON" | jq -r '.[0].Id[:12]')
      NAME=$(echo "$INSP_JSON"     | jq -r '.[0].Name | ltrimstr("/")')
      IMAGE=$(echo "$INSP_JSON"    | jq -r '.[0].Config.Image')
      IMAGE_ID=$(echo "$INSP_JSON" | jq -r '.[0].Image[:12]')
      STATUS=$(echo "$INSP_JSON"   | jq -r '.[0].State.Status')
      RESTART_COUNT=$(echo "$INSP_JSON" | jq -r '.[0].RestartCount')
      CREATED_AT=$(echo "$INSP_JSON"    | jq -r '.[0].Created')

      # Entrypoint + Cmd joined into a readable command string
      COMMAND=$(echo "$INSP_JSON" | jq -r '
        (.[0].Config.Entrypoint // [] | join(" ")) as $ep |
        (.[0].Config.Cmd // [] | join(" ")) as $cmd |
        if $ep != "" and $cmd != "" then "\($ep) \($cmd)"
        elif $ep != "" then $ep
        else $cmd end')

      RESTART_POLICY=$(echo "$INSP_JSON" | jq -r '.[0].HostConfig.RestartPolicy.Name // ""')
      NETWORK_MODE=$(echo "$INSP_JSON"   | jq -r '.[0].HostConfig.NetworkMode // ""')

      # Ports: [{hostIp, hostPort, containerPort, protocol}]
      PORTS=$(echo "$INSP_JSON" | jq -c '
        [ .[0].NetworkSettings.Ports // {} |
          to_entries[] |
          select(.value != null) |
          .key as $k |
          ($k | split("/")) as $parts |
          .value[] |
          { hostIp: (.HostIp // ""),
            hostPort: (.HostPort // ""),
            containerPort: $parts[0],
            protocol: ($parts[1] // "tcp") }
        ]')

      # Volumes: [{source, destination, mode}]
      VOLUMES=$(echo "$INSP_JSON" | jq -c '
        [ .[0].Mounts // [] |
          .[] |
          { source: (.Source // ""),
            destination: (.Destination // ""),
            mode: (.Mode // "") }
        ]')

      # Env vars: ["KEY=value", ...]
      ENV_VARS=$(echo "$INSP_JSON" | jq -c '.[0].Config.Env // []')

      # Labels: {key: value}
      LABELS=$(echo "$INSP_JSON" | jq -c '.[0].Config.Labels // {}')

      # Networks: [{name, ipAddress}]
      NETWORKS=$(echo "$INSP_JSON" | jq -c '
        [ .[0].NetworkSettings.Networks // {} |
          to_entries[] |
          { name: .key,
            ipAddress: (.value.IPAddress // "") }
        ]')

      # ── Config hash for change detection ───────────────────────────────────
      # Hash covers all static fields (anything that changes on recreate/update)
      HASH_INPUT="${IMAGE}|${IMAGE_ID}|${COMMAND}|${RESTART_POLICY}|${NETWORK_MODE}|${PORTS}|${VOLUMES}|${ENV_VARS}|${LABELS}|${NETWORKS}"
      NEW_HASH=$(printf '%s' "$HASH_INPUT" | sha256sum | awk '{print $1}')
      OLD_HASH=$(load_hash "$SHORT_ID")

      if [ "$NEW_HASH" != "$OLD_HASH" ]; then
        DETAIL=$(jq -n \
          --arg  containerId   "$SHORT_ID" \
          --arg  name          "$NAME" \
          --arg  image         "$IMAGE" \
          --arg  imageId       "$IMAGE_ID" \
          --arg  command       "$COMMAND" \
          --arg  createdAt     "$CREATED_AT" \
          --arg  restartPolicy "$RESTART_POLICY" \
          --arg  networkMode   "$NETWORK_MODE" \
          --argjson ports      "$PORTS" \
          --argjson volumes    "$VOLUMES" \
          --argjson envVars    "$ENV_VARS" \
          --argjson labels     "$LABELS" \
          --argjson networks   "$NETWORKS" \
          --arg  configHash    "$NEW_HASH" \
          '{containerId:$containerId, name:$name, image:$image, imageId:$imageId,
            command:$command, createdAt:$createdAt, restartPolicy:$restartPolicy,
            networkMode:$networkMode, ports:$ports, volumes:$volumes, envVars:$envVars,
            labels:$labels, networks:$networks, configHash:$configHash}')
        DETAIL_ENTRIES=$(echo "$DETAIL_ENTRIES" | jq --argjson d "$DETAIL" '. + [$d]')
        save_hash "$SHORT_ID" "$NEW_HASH"
      fi

      # ── Runtime stats (running containers only) ─────────────────────────────
      if [ "$STATUS" = "running" ]; then
        STATS=$(docker stats --no-stream --format \
          '{"cpuPct":"{{.CPUPerc}}","memUsage":"{{.MemUsage}}","netIO":"{{.NetIO}}","blockIO":"{{.BlockIO}}"}' \
          "$CID" 2>/dev/null) || STATS='{}'

        CPU_PCT=$(echo "$STATS" | jq -r '.cpuPct // "0%"' | tr -d '%')
        [ -z "$CPU_PCT" ] || [ "$CPU_PCT" = "null" ] && CPU_PCT=0

        MEM_USED=$(parse_bytes "$(echo "$STATS" | jq -r '.memUsage // "0B / 0B"' | awk -F' / ' '{print $1}')")
        MEM_LIM=$(parse_bytes  "$(echo "$STATS" | jq -r '.memUsage // "0B / 0B"' | awk -F' / ' '{print $2}')")
        NET_RX=$(parse_bytes   "$(echo "$STATS" | jq -r '.netIO    // "0B / 0B"' | awk -F' / ' '{print $1}')")
        NET_TX=$(parse_bytes   "$(echo "$STATS" | jq -r '.netIO    // "0B / 0B"' | awk -F' / ' '{print $2}')")
        BLK_R=$(parse_bytes    "$(echo "$STATS" | jq -r '.blockIO  // "0B / 0B"' | awk -F' / ' '{print $1}')")
        BLK_W=$(parse_bytes    "$(echo "$STATS" | jq -r '.blockIO  // "0B / 0B"' | awk -F' / ' '{print $2}')")
      else
        CPU_PCT=0; MEM_USED=0; MEM_LIM=0
        NET_RX=0; NET_TX=0; BLK_R=0; BLK_W=0
      fi

      STAT_ENTRY=$(jq -n \
        --arg  containerId     "$SHORT_ID" \
        --arg  name            "$NAME" \
        --arg  image           "$IMAGE" \
        --arg  status          "$STATUS" \
        --argjson cpuPercent      "$CPU_PCT" \
        --argjson memUsedBytes    "$MEM_USED" \
        --argjson memLimitBytes   "$MEM_LIM" \
        --argjson netRxBytes      "$NET_RX" \
        --argjson netTxBytes      "$NET_TX" \
        --argjson blockReadBytes  "$BLK_R" \
        --argjson blockWriteBytes "$BLK_W" \
        --argjson restartCount    "$RESTART_COUNT" \
        '{containerId:$containerId, name:$name, image:$image, status:$status,
          cpuPercent:$cpuPercent, memUsedBytes:$memUsedBytes, memLimitBytes:$memLimitBytes,
          netRxBytes:$netRxBytes, netTxBytes:$netTxBytes,
          blockReadBytes:$blockReadBytes, blockWriteBytes:$blockWriteBytes,
          restartCount:$restartCount}')

      STATS_ENTRIES=$(echo "$STATS_ENTRIES" | jq --argjson e "$STAT_ENTRY" '. + [$e]')
    done
  fi

  # Only include details key when there are changed containers
  if [ "$(echo "$DETAIL_ENTRIES" | jq 'length')" -gt 0 ]; then
    PAYLOAD=$(jq -n \
      --arg  agentId    "$AGENT_ID" \
      --arg  token      "$AGENT_TOKEN" \
      --argjson containers "$STATS_ENTRIES" \
      --argjson details    "$DETAIL_ENTRIES" \
      '{agentId:$agentId, token:$token, containers:$containers, details:$details}')
  else
    PAYLOAD=$(jq -n \
      --arg  agentId    "$AGENT_ID" \
      --arg  token      "$AGENT_TOKEN" \
      --argjson containers "$STATS_ENTRIES" \
      '{agentId:$agentId, token:$token, containers:$containers}')
  fi

  curl -fsS --max-time 15 -X POST "$SERVER_URL/api/agents/heartbeat-docker" \
    -H 'Content-Type: application/json' \
    -d "$PAYLOAD" >/dev/null 2>&1 || true

  sleep "$INTERVAL"
done
DOCKER_EOF

  chmod +x "$DOCKER_AGENT_SCRIPT"

  cat > "$DOCKER_SERVICE_FILE" <<EOF
[Unit]
Description=VPS Monitor Docker Stats Agent
After=docker.service vps-monitor-agent.service
Wants=docker.service

[Service]
Type=simple
ExecStart=/usr/bin/env bash $DOCKER_AGENT_SCRIPT
Restart=always
RestartSec=10
User=root
StandardOutput=journal
StandardError=journal
KillMode=control-group

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable vps-monitor-docker-agent >/dev/null 2>&1
  systemctl restart vps-monitor-docker-agent

  sleep 2
  if systemctl is-active --quiet vps-monitor-docker-agent; then
    ok "Docker agent is running."
  else
    warn "Docker agent service is not active. Run: journalctl -u vps-monitor-docker-agent -n 50"
  fi
fi

# ---- Update uninstall script to also remove Docker agent ---------------------
cat > "$UNINSTALL_SCRIPT" <<'UNI_EOF'
#!/usr/bin/env bash
set -e
[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
for svc in vps-monitor-docker-agent vps-monitor-agent; do
  systemctl stop "$svc" 2>/dev/null || true
  systemctl disable "$svc" 2>/dev/null || true
done
rm -f /etc/systemd/system/vps-monitor-agent.service
rm -f /etc/systemd/system/vps-monitor-docker-agent.service
systemctl daemon-reload || true
rm -rf /opt/vps-monitor-agent
echo "vps-monitor-agent removed."
UNI_EOF
chmod +x "$UNINSTALL_SCRIPT"

echo
echo "${c_green}✔ Installation complete!${c_reset}"
echo "  Agent ID:      $AGENT_ID"
echo "  Dashboard:     $SERVER_URL"
echo "  Status:        sudo systemctl status vps-monitor-agent"
echo "  Logs:          sudo journalctl -u vps-monitor-agent -f"
if [ "$DOCKER_ENABLED" = "true" ]; then
  echo "  Docker stats:  sudo systemctl status vps-monitor-docker-agent"
fi
echo "  Uninstall:     sudo $UNINSTALL_SCRIPT"
echo
