#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/mercadolivressj-blip/poker-replay-coach-v4.git"
BRANCH="cash-pro-lab-v1"
INSTALL_DIR="${CASH_PRO_LAB_DIR:-$HOME/poker-replay-coach-v4}"

log(){ printf '\n[cash-pro-lab] %s\n' "$*"; }
need_sudo(){ [[ "$(id -u)" -ne 0 ]]; }
APT="apt-get"
if need_sudo; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "sudo_missing_and_not_root" >&2
    exit 2
  fi
  APT="sudo apt-get"
fi

log "Installing Ubuntu build dependencies"
$APT update
DEBIAN_FRONTEND=noninteractive $APT install -y \
  ca-certificates curl git build-essential pkg-config libssl-dev jq

node_major=0
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
fi
if [[ "$node_major" -lt 22 ]]; then
  log "Installing Node.js 22.x"
  curl -fsSL https://deb.nodesource.com/setup_22.x | ${SUDO:-} bash -
  DEBIAN_FRONTEND=noninteractive $APT install -y nodejs
fi

if ! command -v cargo >/dev/null 2>&1; then
  log "Installing Rust stable via rustup"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
fi
export PATH="$HOME/.cargo/bin:$PATH"

log "Tool versions"
node --version
npm --version
git --version
cargo --version
rustc --version

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  log "Cloning Cash Pro Lab branch"
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$INSTALL_DIR"
else
  log "Refreshing existing checkout"
  git -C "$INSTALL_DIR" fetch origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
fi

cd "$INSTALL_DIR"
log "Installing project dependencies"
npm install

log "Running cloud preflight"
npm run cash-lab:pc:preflight

cat <<'EOF'

[cash-pro-lab] Bootstrap finished.
No production solve has started.
Next guarded stages are:
  npm run cash-lab:pc:prepare
  npm run cash-lab:pc:pilot
Only after the production pilot validates successfully should the 240-root campaign be unlocked.
EOF
