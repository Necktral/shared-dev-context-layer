#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TARGETS=(README.md docs vscode-extension/README.md)

echo "[docs-check] Verificando comandos legacy prohibidos..."
if rg -n "WIS: Refresh Context|WIS: Show Scope Details" "${TARGETS[@]}"; then
  echo "ERROR: se detectaron comandos legacy prohibidos en la documentacion." >&2
  exit 1
fi

echo "[docs-check] Verificando marcadores filecite residuales..."
if rg -n "filecite|||" "${TARGETS[@]}"; then
  echo "ERROR: se detectaron marcadores filecite residuales." >&2
  exit 1
fi

echo "[docs-check] Verificando superficie oficial de comandos en docs y package..."
for cmd in "WIS: Load Operational Context" "WIS: Reset Session" "WIS: Prepare Handoff"; do
  if ! rg -q "$cmd" vscode-extension/README.md docs/context/WIS_VSCODE_CONTROL_PLANE_CONTRACT.md; then
    echo "ERROR: comando '$cmd' no esta documentado de forma canonica." >&2
    exit 1
  fi
  if ! rg -q "$cmd" vscode-extension/package.json; then
    echo "ERROR: comando '$cmd' no aparece en package.json." >&2
    exit 1
  fi
done

echo "[docs-check] Verificando contrato runtime dual..."
if ! rg -q '"wisContextSync.runtimeMode"' vscode-extension/package.json; then
  echo "ERROR: runtimeMode no esta declarado en package.json." >&2
  exit 1
fi
if ! rg -q 'offline_fixture' vscode-extension/package.json || ! rg -q '"mcp"' vscode-extension/package.json; then
  echo "ERROR: runtimeMode no expone ambos modos offline_fixture|mcp." >&2
  exit 1
fi
if ! rg -q 'offline_fixture' docs/context/WIS_VSCODE_CONTROL_PLANE_CONTRACT.md || ! rg -q 'mcp' docs/context/WIS_VSCODE_CONTROL_PLANE_CONTRACT.md; then
  echo "ERROR: contrato canonico no documenta runtime dual." >&2
  exit 1
fi

echo "[docs-check] Verificando endpoint /mcp en runbook MCP..."
if ! rg -q '/mcp' docs/mcp/README.md; then
  echo "ERROR: docs/mcp/README.md debe documentar endpoint /mcp." >&2
  exit 1
fi

echo "[docs-check] OK"
