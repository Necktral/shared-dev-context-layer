#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[docs-tiering] validando tiering y precedencia documental..."

required_files=(
  "docs/README.md"
  "docs/context/README.md"
  "docs/context/REPOSITORY-OPERATIONAL-HARDENING.md"
  "docs/context/WIS_PHASE_1_LOCAL_FIRST_ACCEPTANCE_GATE.md"
  "docs/context/CONTRACT-GOVERNANCE.md"
  "docs/context/LOCAL_PRIVATE-EVOLUTION-POLICY.md"
  "docs/context/PR-AND-BRANCH-CHECKLIST.md"
  "docs/context/BRANCH-GOVERNANCE-AND-RECONCILIATION.md"
  "docs/context/BRANCH-CLOSURE-TECHNICAL-VERDICT.md"
  "docs/context/TECHNICAL-DEBT-REGISTER.md"
  "docs/context/CONTRACT-INVENTORY.md"
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "ERROR: falta artefacto obligatorio de tiering: $file" >&2
    exit 1
  fi
done

for marker in \
  "## Tiering documental" \
  "- Active canon:" \
  "- Policy:" \
  "- Campaign:" \
  "- Debt register:"; do
  if ! rg -q --fixed-strings -- "$marker" docs/README.md; then
    echo "ERROR: docs/README.md no contiene marcador requerido: $marker" >&2
    exit 1
  fi
done
if ! rg -qi 'regla:.*campaign.*debt register.*no sustituyen contrato activo' docs/README.md; then
  echo "ERROR: docs/README.md debe declarar la regla de precedencia campaign/debt register." >&2
  exit 1
fi

for marker in \
  "## Tiering documental activo" \
  "### active_canon" \
  "### policy" \
  "### campaign" \
  "### runbook" \
  "### debt_register"; do
  if ! rg -q "$marker" docs/context/README.md; then
    echo "ERROR: docs/context/README.md no contiene marcador requerido: $marker" >&2
    exit 1
  fi
done
if ! rg -qi 'campaign.*debt_register.*no definen contrato activo' docs/context/README.md; then
  echo "ERROR: docs/context/README.md debe declarar la regla de no-contractualidad para campaign/debt_register." >&2
  exit 1
fi

ROOT_ACTIVE_SECTION="$(awk '/- Active canon:/{flag=1;next}/- Policy:/{flag=0}flag{print}' docs/README.md)"
if [[ -z "$ROOT_ACTIVE_SECTION" ]]; then
  echo "ERROR: no se pudo extraer seccion Active canon de docs/README.md." >&2
  exit 1
fi
if grep -Eq 'BRANCH-|TECHNICAL-DEBT-REGISTER|phase3/evidence|phase4/evidence|RUNBOOK' <<< "$ROOT_ACTIVE_SECTION"; then
  echo "ERROR: se detectaron documentos no-canónicos dentro de Active canon en docs/README.md." >&2
  exit 1
fi

CONTEXT_ACTIVE_SECTION="$(awk '/### active_canon/{flag=1;next}/### policy/{flag=0}flag{print}' docs/context/README.md)"
if [[ -z "$CONTEXT_ACTIVE_SECTION" ]]; then
  echo "ERROR: no se pudo extraer seccion active_canon de docs/context/README.md." >&2
  exit 1
fi
if grep -Eq 'BRANCH-|TECHNICAL-DEBT-REGISTER|RUNBOOK|phase3/evidence|phase4/evidence' <<< "$CONTEXT_ACTIVE_SECTION"; then
  echo "ERROR: se detectaron documentos no-canónicos dentro de active_canon en docs/context/README.md." >&2
  exit 1
fi

if ! rg -qi '(hist[oó]ric|consumad|no.normativ)' docs/context/BRANCH-GOVERNANCE-AND-RECONCILIATION.md; then
  echo "ERROR: BRANCH-GOVERNANCE-AND-RECONCILIATION.md debe declararse histórico/no-normativo." >&2
  exit 1
fi

if ! rg -qi '(tres planos|cierre por planos|estado final)' docs/context/BRANCH-CLOSURE-TECHNICAL-VERDICT.md; then
  echo "ERROR: BRANCH-CLOSURE-TECHNICAL-VERDICT.md debe mantener semántica de cierre por planos." >&2
  exit 1
fi

if ! rg -q 'WIS_PHASE_1_LOCAL_FIRST_ACCEPTANCE_GATE\.md' docs/context/README.md docs/README.md; then
  echo "ERROR: docs index debe referenciar gate local-first de Fase 1." >&2
  exit 1
fi

if ! rg -qi 'GO local|GO global' docs/context/WIS_PHASE_1_LOCAL_FIRST_ACCEPTANCE_GATE.md; then
  echo "ERROR: gate local-first debe explicitar relacion GO local vs GO global." >&2
  exit 1
fi

echo "[docs-tiering] OK"
