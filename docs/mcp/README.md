# MCP Runtime Runbook (VS Code Control Plane)

Runbook para operar el modo `mcp` de la extension y validar conectividad local/remota sin romper postura read-only.

## 1. Scope and guardrails

- No cambiar modelos de dominio.
- No cambiar tools MCP.
- No agregar write actions.
- Mantener policy mode `delegated_limited`.

Este runbook valida transporte y consumo read-only.

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

## 5. Validacion MCP (before ChatGPT)

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
- invocacion de las 5 tools
- sin cambios en tablas de dominio por consumo read-only
- delta esperado en `publish_audit`

## 6. VS Code usage checklist (runtimeMode=mcp)

1. Setear:
- `wisContextSync.runtimeMode = mcp`
- `wisContextSync.mcpEndpoint = <url>/mcp`

2. Ejecutar comandos:
- `WIS: Load Operational Context`
- `WIS: Prepare Handoff`

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

## 8. References

- Root overview: `../../README.md`
- VS Code extension usage: `../../vscode-extension/README.md`
- Canon contract: `../context/WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
- Evidence 3A: `../context/phase3/evidence/slice-3a/README.md`
- Evidence 3B: `../context/phase3/evidence/slice-3b/README.md`
- OAuth Auth0 (ChatGPT Connector): `oauth_auth0_chatgpt_connector.md`

## 9. OAuth connector (Auth0) status

- Implementado a nivel de guía operativa del conector.
- En esta fase, la autenticación se cierra en el conector; el backend MCP todavía no aplica enforcement JWT estricto.
- Validación recomendada:
  - claims con `scripts/validate_oauth_token_claims.sh`
  - reachability/tools con `scripts/validate_remote_mcp.sh`
