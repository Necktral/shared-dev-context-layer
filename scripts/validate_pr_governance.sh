#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[governance-check] iniciando validacion de gobernanza de PR..."

if [[ "${GITHUB_EVENT_NAME:-}" != "pull_request" && "${GITHUB_EVENT_NAME:-}" != "pull_request_target" ]]; then
  echo "[governance-check] evento no-PR (${GITHUB_EVENT_NAME:-unknown}); se omite."
  exit 0
fi

if [[ -z "${GITHUB_EVENT_PATH:-}" || ! -f "${GITHUB_EVENT_PATH}" ]]; then
  echo "ERROR: GITHUB_EVENT_PATH no disponible para validar metadata de PR." >&2
  exit 1
fi

BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

mapfile -t SHAS < <(python3 - "$GITHUB_EVENT_PATH" "$BODY_FILE" <<'PY'
import json
import sys

event_path = sys.argv[1]
body_path = sys.argv[2]

with open(event_path, "r", encoding="utf-8") as fh:
    event = json.load(fh)

pr = event.get("pull_request") or {}
base_sha = ((pr.get("base") or {}).get("sha") or "").strip()
head_sha = ((pr.get("head") or {}).get("sha") or "").strip()
body = pr.get("body") or ""

with open(body_path, "w", encoding="utf-8") as body_fh:
    body_fh.write(body)

print(base_sha)
print(head_sha)
PY
)

BASE_SHA="${SHAS[0]:-}"
HEAD_SHA="${SHAS[1]:-}"

if [[ -z "$BASE_SHA" || -z "$HEAD_SHA" ]]; then
  echo "ERROR: no se pudieron resolver base/head SHA del PR." >&2
  exit 1
fi

if ! git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null; then
  echo "ERROR: base SHA no disponible localmente (${BASE_SHA}); use checkout con fetch-depth: 0." >&2
  exit 1
fi

if ! git cat-file -e "${HEAD_SHA}^{commit}" 2>/dev/null; then
  echo "ERROR: head SHA no disponible localmente (${HEAD_SHA}); use checkout con fetch-depth: 0." >&2
  exit 1
fi

MERGE_BASE="$(git merge-base "$BASE_SHA" "$HEAD_SHA" || true)"
if [[ -z "$MERGE_BASE" ]]; then
  echo "ERROR: no se pudo resolver merge-base entre base/head (${BASE_SHA}..${HEAD_SHA})." >&2
  echo "Asegure historia completa (fetch-depth: 0) y SHAs validos del evento PR." >&2
  exit 1
fi
if ! git cat-file -e "${MERGE_BASE}^{commit}" 2>/dev/null; then
  echo "ERROR: merge-base no disponible localmente (${MERGE_BASE}); use checkout con fetch-depth: 0." >&2
  exit 1
fi

mapfile -t CHANGED_FILES < <(git diff --name-only "${MERGE_BASE}...${HEAD_SHA}" | sed '/^$/d')

extract_field() {
  local wanted="${1,,}"
  awk -v wanted="$wanted" '
    {
      line=$0
      sub(/^[[:space:]-]*/, "", line)
      low=tolower(line)
      if (index(low, wanted ":") == 1) {
        sub(/^[^:]*:[[:space:]]*/, "", line)
        gsub(/`/, "", line)
        print line
        exit
      }
    }
  ' "$BODY_FILE"
}

normalize() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

in_set() {
  local value="$1"
  shift
  for candidate in "$@"; do
    if [[ "$value" == "$candidate" ]]; then
      return 0
    fi
  done
  return 1
}

changed_has_regex() {
  local regex="$1"
  if ((${#CHANGED_FILES[@]} == 0)); then
    return 1
  fi
  printf '%s\n' "${CHANGED_FILES[@]}" | grep -Eq "$regex"
}

CONTRACT_CLASS="$(normalize "$(extract_field "contract_class")")"
LOCAL_PRIVATE_LEVEL="$(normalize "$(extract_field "local_private_level")")"
COMPOSITION_IMPACT="$(normalize "$(extract_field "composition_impact")")"
DECOMPOSITION_REQUIRED="$(normalize "$(extract_field "decomposition_required")")"

if ! in_set "$CONTRACT_CLASS" "internal_only" "persisted_contract" "integration_contract" "ui_facing_contract" "n/a"; then
  echo "ERROR: contract_class invalido o ausente. Valores permitidos: internal_only|persisted_contract|integration_contract|ui_facing_contract|n/a" >&2
  exit 1
fi

if ! in_set "$LOCAL_PRIVATE_LEVEL" "green" "yellow" "red" "n/a"; then
  echo "ERROR: local_private_level invalido o ausente. Valores permitidos: green|yellow|red|n/a" >&2
  exit 1
fi

LOCAL_PRIVATE_IMPACT=false
if changed_has_regex '^vscode-extension/src/local/' || \
   changed_has_regex '^vscode-extension/migrations/local_private/' || \
   changed_has_regex '^docs/context/local_private/'; then
  LOCAL_PRIVATE_IMPACT=true
fi

CONTRACT_IMPACT=false
if changed_has_regex '^vscode-extension/src/local/types\.ts$' || \
   changed_has_regex '^vscode-extension/src/local/ports\.ts$' || \
   changed_has_regex '^vscode-extension/src/local/localCommandService\.ts$' || \
   changed_has_regex '^vscode-extension/src/local/postRunReviewer\.ts$' || \
   changed_has_regex '^vscode-extension/src/local/persistence/postgresPersistenceAdapter\.ts$' || \
   changed_has_regex '^vscode-extension/src/presentation/renderers/localRuntimeOutputRenderer\.ts$' || \
   changed_has_regex '^vscode-extension/src/presentation/local/localRuntimePanelProvider\.ts$' || \
   changed_has_regex '^vscode-extension/src/platform/doctor/localDoctorService\.ts$' || \
   changed_has_regex '^vscode-extension/migrations/local_private/' || \
   changed_has_regex '^docs/context/CONTRACT-GOVERNANCE\.md$'; then
  CONTRACT_IMPACT=true
fi

if [[ "$CONTRACT_CLASS" != "n/a" ]]; then
  CONTRACT_IMPACT=true
fi

INVENTORY_CHANGED=false
if changed_has_regex '^docs/context/CONTRACT-INVENTORY\.md$'; then
  INVENTORY_CHANGED=true
fi

if [[ "$LOCAL_PRIVATE_IMPACT" == true && "$LOCAL_PRIVATE_LEVEL" == "n/a" ]]; then
  echo "ERROR: PR con impacto local_private debe declarar local_private_level=green|yellow|red (no n/a)." >&2
  exit 1
fi

if [[ "$CONTRACT_IMPACT" == true && "$CONTRACT_CLASS" == "n/a" ]]; then
  echo "ERROR: PR con impacto contractual debe declarar contract_class explicito (no n/a)." >&2
  exit 1
fi

if [[ "$CONTRACT_IMPACT" == true && "$INVENTORY_CHANGED" != true ]]; then
  echo "ERROR: PR con impacto contractual debe actualizar docs/context/CONTRACT-INVENTORY.md." >&2
  exit 1
fi

EXTENSION_CHANGED=false
if changed_has_regex '^vscode-extension/src/extension\.ts$'; then
  EXTENSION_CHANGED=true
fi

if [[ "$EXTENSION_CHANGED" == true ]]; then
  EXTENSION_LOC="$(wc -l < vscode-extension/src/extension.ts | tr -d '[:space:]')"

  if ((EXTENSION_LOC >= 700)); then
    if [[ -z "$COMPOSITION_IMPACT" || "$COMPOSITION_IMPACT" == "n/a" ]]; then
      echo "ERROR: extension.ts >=700 LOC y fue tocado; requiere composition_impact en cuerpo de PR." >&2
      exit 1
    fi
  fi

  if ((EXTENSION_LOC >= 760)); then
    if [[ -z "$DECOMPOSITION_REQUIRED" || "$DECOMPOSITION_REQUIRED" == "n/a" ]]; then
      echo "ERROR: extension.ts >=760 LOC y fue tocado; requiere decomposition_required." >&2
      exit 1
    fi

    if [[ "$DECOMPOSITION_REQUIRED" != "in_pr" ]] && \
       [[ ! "$DECOMPOSITION_REQUIRED" =~ ^followup_pr:(#[0-9]+|https?://github\.com/.+/pull/[0-9]+)$ ]]; then
      echo "ERROR: decomposition_required debe ser 'in_pr' o 'followup_pr:#<numero>' (o URL de PR)." >&2
      exit 1
    fi
  fi
fi

echo "[governance-check] OK"
