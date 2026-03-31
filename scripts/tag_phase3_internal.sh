#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TAG_NAME="${1:-v0.1.0-phase3-internal}"

if git rev-parse --verify "$TAG_NAME" >/dev/null 2>&1; then
  echo "ERROR: el tag '$TAG_NAME' ya existe localmente." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: el working tree no esta limpio. Commit/push antes de crear tag." >&2
  exit 1
fi

echo "[release] Ejecutando validaciones previas..."
./scripts/validate_docs_consistency.sh
(
  cd vscode-extension
  npm ci
  npm test
)

echo "[release] Creando tag anotado: $TAG_NAME"
git tag -a "$TAG_NAME" -m "Phase 3 internal stable release"

echo "Tag creado localmente: $TAG_NAME"
echo "Para publicar: git push origin $TAG_NAME"
