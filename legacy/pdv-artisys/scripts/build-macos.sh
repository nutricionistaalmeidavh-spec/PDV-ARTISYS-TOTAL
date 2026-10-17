#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "O pacote .dmg precisa ser gerado em um runner/macOS real." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ARCH="${1:-$(node -p 'process.arch')}"
HOST_ARCH="$(node -p 'process.arch')"
if [[ "$ARCH" != "x64" && "$ARCH" != "arm64" ]]; then
  echo "Arquitetura inválida: $ARCH (use x64 ou arm64)." >&2
  exit 1
fi
if [[ "$ARCH" != "$HOST_ARCH" ]]; then
  echo "Build nativo obrigatório para serialport: runner=$HOST_ARCH, solicitado=$ARCH." >&2
  exit 1
fi

bash scripts/make-macos-icon.sh

# Unsigned output by default: R$ 0, but Gatekeeper approval is required.
# Optional future signed build uses an explicitly configured Developer ID environment.
if [[ "${ARTISYS_MAC_SIGNED:-0}" == "1" ]]; then
  npx --no-install electron-builder --mac dmg zip "--$ARCH" --publish never -c.mac.hardenedRuntime=true
else
  CSC_IDENTITY_AUTO_DISCOVERY=false \
    npx --no-install electron-builder --mac dmg zip "--$ARCH" --publish never \
    -c.mac.identity=null -c.mac.hardenedRuntime=false
fi
