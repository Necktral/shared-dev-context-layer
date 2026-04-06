# Semantic Framework Approval (local_private)

Este archivo controla aprobaciones explicitas para introducir frameworks semanticos
en manifests del repo (`vscode-extension/package.json`, `backend/requirements.txt`).

Si `scripts/validate_docs_consistency.sh` detecta `langchain` o `semantic-kernel`
sin aprobacion en este archivo, el gate falla.

APPROVED_SEMANTIC_FRAMEWORKS:

# Estado actual: sin aprobaciones activas.
