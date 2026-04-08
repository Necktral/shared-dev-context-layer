# MCP Runtime Runbook (VS Code Control Plane)

Runbook para operar el modo `mcp` de la extensión y validar conectividad local/remota con OAuth Auth0, read plane y write plane.

## 1. Scope and guardrails

- Mantener policy mode `delegated_limited`.
- Mantener contrato `all_published` para validación de tools publicadas.
- Operar write con `dry_run|commit`, `idempotency_key` y auditoría.
- Diferenciar validación read-only (`validate_remote_mcp.sh`) y write (`validate_remote_mcp_write.sh`).

## 2. Relacion con runtimeMode de extension

En la extension:

- `runtimeMode=offline_fixture`: no usa red, util para pruebas deterministas.
- `runtimeMode=mcp`: usa endpoint configurado en `wisContextSync.mcpEndpoint`.

Este documento aplica cuando `runtimeMode=mcp`.

## 3. Endpoint contract

Endpoint canonical:

- local: `http://localhost:8002/mcp`
- remoto: `https://<stable-domain>/mcp`

Siempre debe terminar en `/mcp`.

## 4. Preflight local

```bash
docker compose up --build -d
docker compose ps
curl -s http://localhost:8001/health
docker compose logs mcp --tail=60
```

Esperado:

- `postgres`, `backend`, `mcp` en estado `Up`
- health con DB operativa
- MCP levantado en `streamable-http`

## 5. Validación MCP (before ChatGPT)

```bash
./scripts/validate_remote_mcp.sh https://<stable-domain>
```

Con auth header (si aplica):

```bash
MCP_AUTH_TOKEN="<access_token>" \
MCP_AUTH_HEADER_NAME="Authorization" \
MCP_AUTH_SCHEME="Bearer" \
./scripts/validate_remote_mcp.sh https://<stable-domain>
```

La validacion debe confirmar:

- reachability HTTPS + headers MCP
- descubrimiento dinamico de `published_tools` desde `list_tools`
- invocacion de todas las tools publicadas (`all_published`)
- uso de registry canónico de payloads read-only (`scripts/mcp_validation_payloads.json`)
- si una tool publicada falla por parámetros y no tiene entry en registry, el gate falla
- sin cambios en tablas de dominio durante validación `dry_run`
- delta esperado en `publish_audit`: `+N` (donde `N = tools invocadas exitosamente`)

Validación write (`commit`) con token write:

```bash
MCP_AUTH_TOKEN="<access_token_write>" \
MCP_AUTH_HEADER_NAME="Authorization" \
MCP_AUTH_SCHEME="Bearer" \
./scripts/validate_remote_mcp_write.sh https://<stable-domain>/mcp
```

Debe confirmar mutación esperada + auditoría write.

## 6. VS Code usage checklist (runtimeMode=mcp)

1. Setear:
- `wisContextSync.runtimeMode = mcp`
- `wisContextSync.mcpEndpoint = <url>/mcp`

2. Ejecutar comandos:
- `WIS: Load Operational Context`
- `WIS: Prepare Handoff`
- `WIS: Search Context`
- `WIS: Upsert Context Item` / `WIS: Append Context Event` / `WIS: Link Context Entities`
- `WIS: Set Context Labels` / `WIS: Archive Context Item` / `WIS: Apply Sync Batch`

3. Verificar en Output Channel:
- `transport_status`
- `load_state`
- `runtime_mode`
- `issues`
- estado de handoff (`ready|partial|blocked`)

## 7. Troubleshooting matrix (control-plane states)

- **Transport issue** (`transport_error`, `unavailable`)
  - Causa probable: endpoint incorrecto o red caida.
  - Accion: validar URL con `/mcp`, revisar `docker compose logs mcp`.

- **Schema issue** (`schema_error`)
  - Causa probable: payload MCP malformado o drift en shape.
  - Accion: correr validacion remota y revisar normalizacion en gateway.

- **Domain issue** (`no_active_task`, `scope_conflict`, `validation_stale`)
  - Causa probable: estado funcional del dominio, no transporte.
  - Accion: revisar payload tipado e `issues` en envelope, no enmascarar como no-data.

- **Auth issue** (`unauthorized`, `forbidden`)
  - Causa probable: token inválido o scopes insuficientes.
  - Acción: validar claims (`iss/aud/scope/exp`) y scopes requeridos de la tool.

## 8. References

- Root overview: `../../README.md`
- VS Code extension usage: `../../vscode-extension/README.md`
- Canon contract: `../context/WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
- Evidence 3A: `../context/phase3/evidence/slice-3a/README.md`
- Evidence 3B: `../context/phase3/evidence/slice-3b/README.md`
- OAuth Auth0 (ChatGPT Connector): `oauth_auth0_chatgpt_connector.md`

## 9. OAuth connector (Auth0) status

- Implementado a nivel de guía operativa del conector.
- En esta fase v0.2.0, el backend MCP aplica enforcement JWT estricto para runtime conectado.
- Validación recomendada:
  - claims con `scripts/validate_oauth_token_claims.sh`
  - read plane con `scripts/validate_remote_mcp.sh`
  - write plane con `scripts/validate_remote_mcp_write.sh`

## 10. Named tunnel como ruta canónica

Prerequisitos:

- `CF_NAMED_TUNNEL_TOKEN`
- `CF_MCP_PUBLIC_BASE_URL` (`https://<dominio-estable>`)

Secuencia:

```bash
./scripts/stop_cloudflare_tunnel.sh
docker compose up --build -d postgres backend mcp
./scripts/start_named_cloudflare_tunnel.sh
./scripts/check_named_cloudflare_tunnel.sh
./scripts/validate_remote_mcp.sh https://<dominio-estable>
```

Regla operativa:

- named tunnel es la ruta por defecto para cierre y operación estable.
- quick tunnel queda solo como fallback temporal, no endpoint canónico de aceptación.

## 11. Readiness pack (sin credenciales)

Cuando el entorno aún no tiene secretos remotos, preparar primero:

- Contrato de secretos: `REMOTE_SECRETS_CONTRACT.md`
- Plantilla segura: `../../.env.remote.example`
- Preflight local sin red: `../../scripts/check_remote_readiness.sh`
- Runbook remoto ejecutable: `REMOTE_EXECUTION_RUNBOOK.md`

Regla: no marcar cierre remoto/global hasta obtener `READY_FOR_REMOTE_EXECUTION` y ejecutar evidencia remota real.
