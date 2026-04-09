#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SCRIPT_NAME="mcp_read_preflight"
SERVICE_NAME="mcp"
CONTAINER_NAME="wis_context_mcp"
REQUIRED_AUTH0_VARS=(
  "MCP_AUTH0_ISSUER"
  "MCP_AUTH0_AUDIENCE"
  "MCP_AUTH0_JWKS_URL"
)
MISSING_AUTH0_ERROR="MCP auth is enabled but MCP_AUTH0_ISSUER/MCP_AUTH0_AUDIENCE/MCP_AUTH0_JWKS_URL are not fully configured."

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "[$SCRIPT_NAME] ERROR: .env no existe en la raiz del repo: $ROOT_DIR/.env" >&2
  exit 1
fi

# shellcheck source=/dev/null
set -a
source "$ROOT_DIR/.env"
set +a

missing_vars=()
for var_name in "${REQUIRED_AUTH0_VARS[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    missing_vars+=("$var_name")
  fi
done

if (( ${#missing_vars[@]} > 0 )); then
  echo "[$SCRIPT_NAME] ERROR: faltan variables Auth0 obligatorias en .env para arrancar MCP con auth activa." >&2
  printf '[%s] Missing: %s\n' "$SCRIPT_NAME" "${missing_vars[*]}" >&2
  echo "[$SCRIPT_NAME] Accion: define esas variables en .env y vuelve a ejecutar." >&2
  exit 1
fi

echo "[$SCRIPT_NAME] Iniciando preflight read (pasos 2-4)."
echo "[$SCRIPT_NAME] Step 2/4: docker compose up --build -d $SERVICE_NAME"
docker compose up --build -d "$SERVICE_NAME"

echo
echo "========== [${SCRIPT_NAME}] docker compose ps =========="
ps_output="$(docker compose ps)"
printf '%s\n' "$ps_output"
echo "========== [/${SCRIPT_NAME}] docker compose ps =========="

echo
echo "========== [${SCRIPT_NAME}] docker compose logs ${SERVICE_NAME} --tail=60 =========="
logs_output="$(docker compose logs "$SERVICE_NAME" --tail=60)"
printf '%s\n' "$logs_output"
echo "========== [/${SCRIPT_NAME}] docker compose logs ${SERVICE_NAME} --tail=60 =========="

status_ok=true

if ! docker compose ps "$SERVICE_NAME" --status running --services | grep -qx "$SERVICE_NAME"; then
  echo "[$SCRIPT_NAME] ERROR: el servicio '$SERVICE_NAME' no está en estado running." >&2
  status_ok=false
fi

if docker compose ps "$SERVICE_NAME" | grep -qi "Restarting"; then
  echo "[$SCRIPT_NAME] ERROR: se detectó restart loop en '$SERVICE_NAME'." >&2
  status_ok=false
fi

if [[ "$logs_output" == *"$MISSING_AUTH0_ERROR"* ]]; then
  echo "[$SCRIPT_NAME] ERROR: logs reportan configuración Auth0 incompleta." >&2
  status_ok=false
fi

if ! grep -q "^${CONTAINER_NAME}[[:space:]]" <<<"$ps_output"; then
  echo "[$SCRIPT_NAME] WARN: no se encontró la fila de '$CONTAINER_NAME' en docker compose ps." >&2
fi

if [[ "$status_ok" == true ]]; then
  echo "[$SCRIPT_NAME] SUCCESS: preflight read OK. '$CONTAINER_NAME' en Up y sin restart loop."
  exit 0
fi

echo "[$SCRIPT_NAME] FAILURE: preflight read NO OK. Revisa las salidas de ps/logs impresas arriba." >&2
exit 1
