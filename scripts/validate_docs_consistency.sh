#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TARGETS=(README.md docs vscode-extension/README.md)
LOCAL_PRIVATE_CANON="docs/context/local_private/README.md"
SEMANTIC_APPROVAL_FILE="docs/context/local_private/SEMANTIC_FRAMEWORK_APPROVAL.md"

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
for cmd in \
  "WIS: Load Operational Context" \
  "WIS: Reset Session" \
  "WIS: Prepare Handoff" \
  "WIS: Search Context" \
  "WIS: Upsert Context Item" \
  "WIS: Append Context Event" \
  "WIS: Link Context Entities" \
  "WIS: Set Context Labels" \
  "WIS: Archive Context Item" \
  "WIS: Apply Sync Batch"; do
  if ! rg -q "$cmd" vscode-extension/README.md docs/context/WIS_VSCODE_CONTROL_PLANE_CONTRACT.md; then
    echo "ERROR: comando '$cmd' no esta documentado de forma canonica." >&2
    exit 1
  fi
  if ! rg -q "$cmd" vscode-extension/package.json; then
    echo "ERROR: comando '$cmd' no aparece en package.json." >&2
    exit 1
  fi
done

echo "[docs-check] Verificando canon local_private..."
if [[ ! -f "$LOCAL_PRIVATE_CANON" ]]; then
  echo "ERROR: falta canon local_private en $LOCAL_PRIVATE_CANON." >&2
  exit 1
fi
if ! rg -q 'complementario' "$LOCAL_PRIVATE_CANON"; then
  echo "ERROR: canon local_private debe declarar su caracter complementario." >&2
  exit 1
fi

echo "[docs-check] Verificando comandos WIS: Local * en docs y package..."
for cmd in \
  "WIS: Local Index" \
  "WIS: Local Prepare Task" \
  "WIS: Local Run Codex" \
  "WIS: Local Refresh" \
  "WIS: Local Configure DB Password"; do
  if ! rg -q "$cmd" "$LOCAL_PRIVATE_CANON" vscode-extension/README.md; then
    echo "ERROR: comando local '$cmd' no esta documentado en canon/README de extension." >&2
    exit 1
  fi
  if ! rg -q "$cmd" vscode-extension/package.json; then
    echo "ERROR: comando local '$cmd' no aparece en package.json." >&2
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

echo "[docs-check] Verificando guia OAuth Auth0 del conector..."
if [[ ! -f docs/mcp/oauth_auth0_chatgpt_connector.md ]]; then
  echo "ERROR: falta docs/mcp/oauth_auth0_chatgpt_connector.md." >&2
  exit 1
fi
if ! rg -q 'Cliente de OAuth definido por el usuario' docs/mcp/oauth_auth0_chatgpt_connector.md; then
  echo "ERROR: guia OAuth no documenta el metodo de registro esperado." >&2
  exit 1
fi
if ! rg -q 'openid' docs/mcp/oauth_auth0_chatgpt_connector.md; then
  echo "ERROR: guia OAuth no documenta scopes OIDC base." >&2
  exit 1
fi

echo "[docs-check] Verificando que docs canonicas no fijen conteo de tools MCP..."
if rg -n "5 tools|cinco tools|5/5 tools|exactamente 5 tools" \
  docs/mcp/README.md \
  docs/mcp/vscode_read_model_contract.md \
  docs/context/WIS_VSCODE_CONTROL_PLANE_CONTRACT.md \
  docs/context/WIS_PHASE_3_SPEC.md \
  docs/context/WIS_PHASE_3_ACCEPTANCE_GATE.md; then
  echo "ERROR: se detecto conteo fijo legacy de tools MCP en docs canonicas objetivo." >&2
  exit 1
fi

echo "[docs-check] Verificando terminos canónicos all_published/published_tools/delta +N..."
CANON_DOCS=(
  docs/mcp/README.md
  docs/mcp/vscode_read_model_contract.md
  docs/context/WIS_VSCODE_CONTROL_PLANE_CONTRACT.md
  docs/context/WIS_PHASE_3_SPEC.md
  docs/context/WIS_PHASE_3_ACCEPTANCE_GATE.md
)
for doc in "${CANON_DOCS[@]}"; do
  if ! rg -q 'all_published' "$doc"; then
    echo "ERROR: falta término canónico 'all_published' en $doc." >&2
    exit 1
  fi
  if ! rg -q 'published_tools' "$doc"; then
    echo "ERROR: falta término canónico 'published_tools' en $doc." >&2
    exit 1
  fi
  if ! rg -q 'delta \+N|invocadas exitosamente' "$doc"; then
    echo "ERROR: falta semántica canónica de auditoría dinámica (delta +N) en $doc." >&2
    exit 1
  fi
done

echo "[docs-check] Verificando drift de frameworks semanticos en manifests..."
MANIFESTS=(
  "vscode-extension/package.json"
  "backend/requirements.txt"
)
SEMANTIC_DRIFT_MATCHES="$(rg -n -i 'langchain|semantic-kernel|semantic_kernel' "${MANIFESTS[@]}" || true)"
if [[ -n "$SEMANTIC_DRIFT_MATCHES" ]]; then
  if [[ ! -f "$SEMANTIC_APPROVAL_FILE" ]]; then
    echo "ERROR: se detecto drift semantico sin archivo de aprobacion: $SEMANTIC_APPROVAL_FILE" >&2
    echo "$SEMANTIC_DRIFT_MATCHES" >&2
    exit 1
  fi

  if ! rg -q '^APPROVED_SEMANTIC_FRAMEWORKS:$' "$SEMANTIC_APPROVAL_FILE"; then
    echo "ERROR: archivo de aprobacion semantica invalido; falta encabezado APPROVED_SEMANTIC_FRAMEWORKS:." >&2
    exit 1
  fi

  if rg -q -i 'langchain' <<< "$SEMANTIC_DRIFT_MATCHES" && ! rg -q '^- langchain$' "$SEMANTIC_APPROVAL_FILE"; then
    echo "ERROR: langchain detectado en manifests sin aprobacion explicita." >&2
    echo "$SEMANTIC_DRIFT_MATCHES" >&2
    exit 1
  fi
  if rg -q -i 'semantic-kernel|semantic_kernel' <<< "$SEMANTIC_DRIFT_MATCHES" && ! rg -q '^- semantic-kernel$' "$SEMANTIC_APPROVAL_FILE"; then
    echo "ERROR: semantic-kernel detectado en manifests sin aprobacion explicita." >&2
    echo "$SEMANTIC_DRIFT_MATCHES" >&2
    exit 1
  fi
fi

echo "[docs-check] OK"
