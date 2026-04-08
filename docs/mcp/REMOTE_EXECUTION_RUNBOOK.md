# Remote Execution Runbook (Phase 4 Global Closure)

Runbook operativo para ejecutar cierre remoto/global cuando ya existan credenciales reales.

## 1) Precondiciones

- Stack local disponible (`docker`, `docker compose`).
- Archivo local de secretos (`.env.remote`) basado en `.env.remote.example`.
- `.env` del repo contiene `POSTGRES_USER` y `POSTGRES_DB`.
- Estado documental global sigue siendo `NO-GO/BLOCKED` hasta ejecutar evidencias remotas reales.

## 2) Cargar secretos en entorno

```bash
cp .env.remote.example .env.remote
# editar .env.remote con secretos reales (fuera de Git)
set -a
source .env.remote
set +a
```

## 3) Readiness gate (sin network)

```bash
./scripts/check_remote_readiness.sh
```

Interpretacion:

- `READY_FOR_REMOTE_EXECUTION` -> se puede intentar cierre remoto.
- `BLOCKED_MISSING_SECRETS` -> faltan credenciales; no ejecutar remoto.
- `BLOCKED_MISCONFIGURED_ENV` -> corregir entorno y reintentar.

## 4) Secuencia canónica remota (orden fijo)

Definir un `RUN_ID` para evidencia reproducible:

```bash
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE_DIR="docs/context/phase4/evidence"
```

Ejecutar en orden:

```bash
docker compose up --build -d postgres backend mcp \
  2>&1 | tee "$EVIDENCE_DIR/phase2-remote-${RUN_ID}-01-preflight-up.log"

docker compose ps \
  2>&1 | tee "$EVIDENCE_DIR/phase2-remote-${RUN_ID}-02-preflight-ps.log"

./scripts/start_named_cloudflare_tunnel.sh \
  2>&1 | tee "$EVIDENCE_DIR/phase2-remote-${RUN_ID}-03-start-named-cloudflare-tunnel.log"

./scripts/check_named_cloudflare_tunnel.sh \
  2>&1 | tee "$EVIDENCE_DIR/phase2-remote-${RUN_ID}-04-check-named-cloudflare-tunnel.log"

MCP_AUTH_TOKEN="${MCP_AUTH_TOKEN_READ:-${MCP_AUTH_TOKEN:-}}" \
MCP_AUTH_HEADER_NAME="${MCP_AUTH_HEADER_NAME:-Authorization}" \
MCP_AUTH_SCHEME="${MCP_AUTH_SCHEME:-Bearer}" \
./scripts/validate_remote_mcp.sh "$CF_MCP_PUBLIC_BASE_URL" \
  2>&1 | tee "$EVIDENCE_DIR/phase2-remote-${RUN_ID}-05-validate-remote-mcp-read.log"

MCP_AUTH_TOKEN="${MCP_AUTH_TOKEN_WRITE:-${MCP_AUTH_TOKEN:-}}" \
MCP_AUTH_HEADER_NAME="${MCP_AUTH_HEADER_NAME:-Authorization}" \
MCP_AUTH_SCHEME="${MCP_AUTH_SCHEME:-Bearer}" \
./scripts/validate_remote_mcp_write.sh "$CF_MCP_PUBLIC_BASE_URL/mcp" \
  2>&1 | tee "$EVIDENCE_DIR/phase2-remote-${RUN_ID}-06-validate-remote-mcp-write.log"

./scripts/validate_oauth_token_claims.sh \
  --token "${MCP_OAUTH_CLAIMS_TOKEN:-${MCP_AUTH_TOKEN_READ:-${MCP_AUTH_TOKEN:-}}}" \
  --expected-iss "$AUTH0_EXPECTED_ISS" \
  --expected-aud "$AUTH0_EXPECTED_AUD" \
  --require-scopes "$AUTH0_REQUIRED_SCOPES_READ" \
  2>&1 | tee "$EVIDENCE_DIR/phase2-remote-${RUN_ID}-07-validate-oauth-claims-read.log"

./scripts/validate_oauth_token_claims.sh \
  --token "${MCP_AUTH_TOKEN_WRITE:-${MCP_AUTH_TOKEN:-}}" \
  --expected-iss "$AUTH0_EXPECTED_ISS" \
  --expected-aud "$AUTH0_EXPECTED_AUD" \
  --require-scopes "$AUTH0_REQUIRED_SCOPES_WRITE" \
  2>&1 | tee "$EVIDENCE_DIR/phase2-remote-${RUN_ID}-08-validate-oauth-claims-write.log"
```

## 5) Evidencia negativa obligatoria (auth)

Solo con secretos validos:

```bash
MCP_AUTH_TOKEN="invalid-token" \
MCP_AUTH_HEADER_NAME="${MCP_AUTH_HEADER_NAME:-Authorization}" \
MCP_AUTH_SCHEME="${MCP_AUTH_SCHEME:-Bearer}" \
./scripts/validate_remote_mcp.sh "$CF_MCP_PUBLIC_BASE_URL" \
  2>&1 | tee "$EVIDENCE_DIR/phase2-remote-${RUN_ID}-09-evidence-401.log"

MCP_AUTH_TOKEN="${MCP_AUTH_TOKEN_READ:-${MCP_AUTH_TOKEN:-}}" \
MCP_AUTH_HEADER_NAME="${MCP_AUTH_HEADER_NAME:-Authorization}" \
MCP_AUTH_SCHEME="${MCP_AUTH_SCHEME:-Bearer}" \
./scripts/validate_remote_mcp_write.sh "$CF_MCP_PUBLIC_BASE_URL/mcp" \
  2>&1 | tee "$EVIDENCE_DIR/phase2-remote-${RUN_ID}-10-evidence-403-insufficient-scope.log"
```

## 6) Decision formal GO / NO-GO

`GO global` solo si existe evidencia real y en verde de:

- named tunnel activo,
- dominio estable resolviendo,
- endpoint canonico `/mcp` alcanzable con `mcp-session-id`,
- read plane (`published_tools` no vacia + policy `all_published`),
- write plane (`dry_run|commit` + auditoria esperada),
- claims OAuth validos,
- evidencia explicita de `401` y `403 insufficient_scope`.

Si cualquier punto falla o falta evidencia suficiente: `NO-GO/BLOCKED` con una causa residual primaria.

## 7) Actualizacion documental posterior

Actualizar solo con evidencia real:

- `docs/context/phase4/evidence/README.md`
- `docs/context/phase4/evidence/phase2-remote-backlog.md`

No marcar checks en verde sin logs reproducibles.
