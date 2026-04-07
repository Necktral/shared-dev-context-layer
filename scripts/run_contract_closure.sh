#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SCOPE="${1:-all}"

run_docs() {
  ./scripts/validate_docs_consistency.sh
}

run_extension() {
  (
    cd vscode-extension
    npm ci
    npm run compile
    npm test
  )
}

run_local_db() {
  (
    cd vscode-extension
    npm ci
    npm run test:local-db
  )
}

run_backend() {
  python -m pip install --upgrade pip
  pip install -r backend/requirements.txt
  (
    cd backend
    alembic upgrade head
    pytest -q
  )
}

case "$SCOPE" in
  docs)
    run_docs
    ;;
  extension)
    run_extension
    ;;
  local-db)
    run_local_db
    ;;
  backend)
    run_backend
    ;;
  all)
    run_docs
    run_extension
    run_local_db
    run_backend
    ;;
  *)
    echo "Uso: $0 [docs|extension|local-db|backend|all]" >&2
    exit 1
    ;;
esac

echo "[contract-closure] OK ($SCOPE)"
