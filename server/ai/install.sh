#!/usr/bin/env bash
# Installs the self-hosted Study Doubts model on the college server
# (HPE DL360 Gen11: 2 × Xeon Silver 4510, 24 cores, 125 GB RAM, no GPU).
# Run from this folder:   sudo bash install.sh
# Safe to run again (it just updates the settings and rebuilds the model).
#
# Overrides (all optional):
#   BASE_MODEL   default qwen2.5:7b   (same weights as Hugging Face Qwen/Qwen2.5-7B-Instruct, Q4_K_M)
#   NUMA_NODE    default 0            CPU socket the model is pinned to
#   THREADS      default = cores on that socket
#   MEM_MAX      default 16G          RAM cap for Ollama
#   PARALLEL     default 2            answers generated at the same time (per instance)
#   INSTANCES    default 1            2 = also run a second copy on the other CPU socket
#                                     (port 11435) for more students at once. Only if the
#                                     lab server's other users can spare that socket.
set -euo pipefail
cd "$(dirname "$0")"

BASE_MODEL="${BASE_MODEL:-qwen2.5:7b}"
MODEL_NAME="${MODEL_NAME:-jnn-study}"
NUMA_NODE="${NUMA_NODE:-0}"
MEM_MAX="${MEM_MAX:-16G}"
PARALLEL="${PARALLEL:-2}"
INSTANCES="${INSTANCES:-1}"

if [[ $EUID -ne 0 ]]; then echo "Run with sudo: sudo bash install.sh"; exit 1; fi

# CPUs on one socket. Keeping the model on one socket avoids slow cross-CPU
# memory access and leaves the other socket free for the lab's other users.
CPUS=$(lscpu -p=CPU,NODE | awk -F, -v n="$NUMA_NODE" '!/^#/ && $2==n {print $1}' | paste -sd' ')
if [[ -z "$CPUS" ]]; then CPUS=$(seq -s' ' 0 $(( $(nproc) - 1 ))); fi
CPU_COUNT=$(wc -w <<<"$CPUS")
THREADS="${THREADS:-$CPU_COUNT}"
echo "Pinning Ollama to NUMA node $NUMA_NODE: $CPU_COUNT CPUs, $THREADS threads, RAM cap $MEM_MAX, $PARALLEL parallel answers"

echo "==> 1/5 Installing Ollama (official installer)"
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
else
  echo "    Ollama already installed: $(ollama --version)"
fi

echo "==> 2/5 Locking Ollama down: localhost only, one model, pinned CPUs, RAM cap"
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/jnn.conf <<EOF
[Service]
# Only this machine can reach the model — never the network or the internet.
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_ORIGINS="
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_NUM_PARALLEL=$PARALLEL"
Environment="OLLAMA_MAX_QUEUE=20"
Environment="OLLAMA_KEEP_ALIVE=1h"
# One socket only; lower priority than interactive lab work.
CPUAffinity=$CPUS
NUMAPolicy=bind
NUMAMask=$NUMA_NODE
MemoryMax=$MEM_MAX
Nice=5
EOF
systemctl daemon-reload
systemctl enable ollama >/dev/null
systemctl restart ollama

# Belt-and-braces: block the port from outside even if the binding ever changes.
# (Also make sure the Sophos firewall does NOT forward 11434.)
if command -v ufw >/dev/null 2>&1; then ufw deny 11434/tcp >/dev/null || true; fi

echo "==> 3/5 Waiting for Ollama"
for _ in $(seq 1 30); do curl -sf http://127.0.0.1:11434/api/tags >/dev/null && break; sleep 1; done

echo "==> 4/5 Downloading base model $BASE_MODEL (once)"
ollama pull "$BASE_MODEL"

echo "==> 5/5 Building restricted model '$MODEL_NAME' from Modelfile"
TMP_MF=$(mktemp)
sed "s|^FROM .*|FROM $BASE_MODEL|" Modelfile > "$TMP_MF"
echo "PARAMETER num_thread $THREADS" >> "$TMP_MF"
ollama create "$MODEL_NAME" -f "$TMP_MF"
rm -f "$TMP_MF"

URLS="http://127.0.0.1:11434"
if [[ "$INSTANCES" == "2" ]]; then
  OTHER_NODE=$(( NUMA_NODE == 0 ? 1 : 0 ))
  CPUS2=$(lscpu -p=CPU,NODE | awk -F, -v n="$OTHER_NODE" '!/^#/ && $2==n {print $1}' | paste -sd' ')
  if [[ -z "$CPUS2" ]]; then
    echo "!! No second NUMA node found — skipping the second instance."
  else
    echo "==> Extra: second instance on NUMA node $OTHER_NODE, port 11435"
    OLLAMA_BIN=$(command -v ollama)
    cat > /etc/systemd/system/ollama-node$OTHER_NODE.service <<EOF
[Unit]
Description=Ollama (AI Doubts, second instance, CPU socket $OTHER_NODE)
After=network-online.target

[Service]
ExecStart=$OLLAMA_BIN serve
User=ollama
Group=ollama
Restart=always
RestartSec=3
Environment="HOME=/usr/share/ollama"
Environment="OLLAMA_HOST=127.0.0.1:11435"
Environment="OLLAMA_ORIGINS="
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_NUM_PARALLEL=$PARALLEL"
Environment="OLLAMA_MAX_QUEUE=20"
Environment="OLLAMA_KEEP_ALIVE=1h"
CPUAffinity=$CPUS2
NUMAPolicy=bind
NUMAMask=$OTHER_NODE
MemoryMax=$MEM_MAX
Nice=5

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now ollama-node$OTHER_NODE >/dev/null
    if command -v ufw >/dev/null 2>&1; then ufw deny 11435/tcp >/dev/null || true; fi
    for _ in $(seq 1 30); do curl -sf http://127.0.0.1:11435/api/tags >/dev/null && break; sleep 1; done
    URLS="$URLS,http://127.0.0.1:11435"
  fi
fi

echo
echo "Listening on (should be 127.0.0.1 only):"
ss -ltnp | grep -E '1143[45]' || true
echo
echo "Quick test (first answer is slower while the model loads):"
time curl -s http://127.0.0.1:11434/api/chat -d "{\"model\":\"$MODEL_NAME\",\"stream\":false,\"messages\":[{\"role\":\"user\",\"content\":\"In two lines, what is the OSI network layer?\"}]}" \
  | sed -n 's/.*"content":"\([^"]*\)".*/\1/p'
echo
echo "Done. Add to server/.env:"
echo "  LOCAL_AI_ENABLED=true"
echo "  LOCAL_AI_MODEL=$MODEL_NAME"
echo "  LOCAL_AI_MAX_CONCURRENT=$PARALLEL"
echo "  LOCAL_AI_URLS=$URLS"
