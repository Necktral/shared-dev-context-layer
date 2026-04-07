#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[phase1-local] validando cierre local-first..."

./scripts/validate_docs_consistency.sh
./scripts/run_contract_closure.sh docs
./scripts/run_contract_closure.sh extension
./scripts/run_contract_closure.sh local-db

PROJECT_NAME="${PROJECT_NAME:-shared-dev-context-layer}" \
BACKEND_PORT="${BACKEND_PORT:-8001}" \
MCP_PORT="${MCP_PORT:-8002}" \
SYSTEM_MODE="${SYSTEM_MODE:-delegated_limited}" \
DATABASE_URL="${DATABASE_URL:-postgresql://wis_admin:wis_strong_password_change_this@localhost:5432/wis_context}" \
  ./scripts/run_contract_closure.sh backend

(
  cd vscode-extension
  npm run compile
  npm test
  npm run test:local-db
)

echo "[phase1-local] OK"
