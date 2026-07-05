# Configuración Avanzada OAuth (ChatGPT Connector) — Auth0 + MCP

Guía operativa para crear un conector nuevo en ChatGPT con OAuth funcional usando Auth0.

Estado objetivo de esta fase:

- OAuth/OIDC activo en el **conector**.
- MCP aplica enforcement JWT estricto en runtime conectado.
- Runtime del proyecto permanece dual: `offline_fixture` y `mcp`.

## 1. Pre-requisitos

- Tenant de Auth0 activo: `https://<TENANT>.auth0.com`
- Application en Auth0 para el conector (Regular Web Application).
- API (Resource Server) en Auth0 con audience definida.
- Callback URL generada por ChatGPT Connector (la UI la muestra al crear el conector).

Valores operativos actuales del proyecto:
- tenant: `https://necktral.us.auth0.com`
- audience read: `https://wis-context-sync-read-api`
- endpoint MCP estable: `https://mcp.wiscontext-sync.org/mcp`
- public base URL MCP (resource metadata): `https://mcp.wiscontext-sync.org`
- resource id MCP (canónico OAuth): `MCP_RESOURCE_ID` (fallback legacy a `MCP_AUTH0_AUDIENCE`)

## 2. Configuración en ChatGPT Connector (OAuth Avanzado)

### 2.1 Método de registro

- Seleccionar: `Cliente de OAuth definido por el usuario`
- No usar en esta fase: `DCR` ni `CIMD`

### 2.2 Registro de cliente

- `ID de cliente de OAuth`: `<AUTH0_CLIENT_ID>`
- `Secreto de cliente de OAuth`: `<AUTH0_CLIENT_SECRET>`
- `Método de autenticación del token endpoint`: `client_secret_basic`
- `URL de devolución de llamada`: usar exactamente la URL que entrega ChatGPT

### 2.3 OAuth endpoints

- `URL de autorización`: `https://necktral.us.auth0.com/authorize`
- `URL de token`: `https://necktral.us.auth0.com/oauth/token`
- `URL de registro`: dejar vacío (si no se usa DCR)
- `Base del servidor de autorización`: `https://necktral.us.auth0.com/`
- `Recurso` (audience): `https://wis-context-sync-read-api`

Importante:
- `MCP_RESOURCE_ID` es el identificador OAuth canónico del recurso MCP (`resource=`).
- Si `MCP_RESOURCE_ID` no está definido, el backend usa fallback legacy a `MCP_AUTH0_AUDIENCE`.
- Si `MCP_RESOURCE_ID` y `MCP_AUTH0_AUDIENCE` divergen, el backend no falla startup (modo compatibilidad legacy) y lo reporta en logs.
- `MCP_PUBLIC_BASE_URL` es independiente y solo define la base pública para `resource_metadata`.

### 2.4 OpenID Connect (OIDC)

- `OIDC habilitado`: Sí
- `URL configuración OIDC`: `https://necktral.us.auth0.com/.well-known/openid-configuration`
- `OIDC userinfo endpoint`: `https://necktral.us.auth0.com/userinfo`
- `OIDC scopes`: `openid`, `profile`, `email`

### 2.5 Scopes recomendados

#### Conector Read (contrato oficial actual)

```text
openid
profile
email
wis.context.read
wis.context.sync.read
```

#### Alcances legacy opcionales (solo si existen en tu API Auth0)

```text
offline_access
mcp.read
context.read
validation.read
decisions.read
errors.read
handoff.prepare
```

Si esos scopes legacy no están definidos en Auth0 API, no incluirlos para evitar `invalid_scope`.

## 3. Configuración en Auth0 (obligatoria)

En la Application del conector:

- **Allowed Callback URLs**: agregar la callback exacta de ChatGPT.
- **Allowed Web Origins** y **Allowed Logout URLs**: según política interna.
- Grant type habilitado: `Authorization Code`.

En la API (Resource Server):

- Registrar al menos:
  - `wis.context.read`
  - `wis.context.sync.read`
  - `wis.context.write`
  - `wis.context.sync.write`
- Scopes legacy (`mcp.read`, `context.read`, etc.) solo si realmente están soportados y versionados en esa API.
- Confirmar audience igual al valor usado en “Recurso”.

En runtime MCP (backend):

- Definir `MCP_PUBLIC_BASE_URL=https://mcp.wiscontext-sync.org`
- No usar path operativo (`/mcp`) en esta variable.
- Este valor controla el `resource_metadata` que el servidor anuncia en `WWW-Authenticate`.
- Definir `MCP_RESOURCE_ID=https://wis-context-sync-read-api` (recomendado para conservar compatibilidad actual).
- `MCP_AUTH0_AUDIENCE` se mantiene para validación JWT.
- Obligatorio en producción: `MCP_ALLOWED_ORIGINS=https://chatgpt.com`
- Si hay dominio/túnel adicional autorizado: `MCP_ALLOWED_ORIGINS=https://chatgpt.com,https://<tu-tunnel>`
- No dejar `MCP_ALLOWED_ORIGINS` vacío en producción. Vacío significa modo permisivo y debe limitarse a desarrollo controlado.

## 4. Validación mínima obligatoria

1. Validar servidor local con token real Auth0 usando `tests/test_e2e_mcp_preflight.py`.
2. Validar endpoint HTTPS remoto con el mismo preflight.
3. Probar autenticación en la UI del conector (debe completar login sin error).
4. Verificar claims del access token:
   - `iss`
   - `aud`
   - `scope` (o `scp`)
   - `exp`
5. Ejecutar llamada MCP desde el conector y confirmar respuesta de tools.
6. Registrar evidencia mínima:
   - endpoint MCP usado
   - scopes concedidos
   - resultado de autenticación
   - resultado de llamada MCP

### Preflight P1-P4 con token real

Local:

```bash
cd backend
MCP_E2E_BASE_URL="http://localhost:8002" \
MCP_E2E_TOKEN="<ACCESS_TOKEN_AUTH0_REAL>" \
python -m pytest tests/test_e2e_mcp_preflight.py -v
```

Remoto HTTPS:

```bash
cd backend
MCP_E2E_BASE_URL="https://mcp.wiscontext-sync.org" \
MCP_E2E_TOKEN="<ACCESS_TOKEN_AUTH0_REAL>" \
python -m pytest tests/test_e2e_mcp_preflight.py -v
```

El P4 no exige necesariamente `200`, pero sí debe descartar rechazo de autorización: no debe devolver `401` ni `403`. Si `MCP_E2E_TOKEN` no existe, P4 se omite para que CI no requiera secretos.

### Utilidad local para validar claims

Puedes usar:

```bash
./scripts/validate_oauth_token_claims.sh \
  --token "<ACCESS_TOKEN>" \
  --expected-iss "https://necktral.us.auth0.com/" \
  --expected-aud "https://wis-context-sync-read-api" \
  --require-scopes "wis.context.read,wis.context.sync.read"
```

Smoke test MCP read-plane con header de auth:

```bash
MCP_AUTH_TOKEN="<ACCESS_TOKEN>" \
MCP_AUTH_HEADER_NAME="Authorization" \
MCP_AUTH_SCHEME="Bearer" \
./scripts/validate_remote_mcp_read.sh https://mcp.wiscontext-sync.org
```

Nota:
- `validate_remote_mcp.sh` evalúa contrato global `all_published`.
- para conector Read usar `validate_remote_mcp_read.sh` (`read_plane`).
- `validate_oauth_token_claims.sh` debe ejecutarse con token real emitido por Auth0 (no solo JWT sintético).
- después de cambiar tools publicadas o metadata auth (`securitySchemes`, `readOnlyHint`, auth settings), refrescar el conector en ChatGPT para forzar relectura de definición.

## 5. Notas de seguridad y alcance de fase

- Esta guía asume enforcement JWT activo en backend MCP (`iss/aud/exp/scope`).
- El control plane conserva modo dual (`offline_fixture | mcp`) y en `mcp` requiere bearer válido.
- OAuth protege el flujo del conector y habilita autorización por scopes en tools read/write.
