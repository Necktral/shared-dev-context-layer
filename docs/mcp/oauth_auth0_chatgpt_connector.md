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
- audience / resource ID canónico: `https://mcp.wiscontext-sync.org/mcp`
- endpoint MCP estable: `https://mcp.wiscontext-sync.org/mcp`
- public base URL MCP (resource metadata): `https://mcp.wiscontext-sync.org`
- resource id MCP (canónico OAuth): `MCP_RESOURCE_ID=https://mcp.wiscontext-sync.org/mcp`

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
- `Recurso` (audience): `https://mcp.wiscontext-sync.org/mcp`

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
- Definir `MCP_RESOURCE_ID=https://mcp.wiscontext-sync.org/mcp` (identificador canónico OAuth).
- Definir `MCP_AUTH0_AUDIENCE=https://mcp.wiscontext-sync.org/mcp` (debe coincidir con el API identifier en Auth0).
- Hardening DNS-rebinding obligatorio en producción: `MCP_ALLOWED_ORIGINS=https://chatgpt.com,https://chat.openai.com`

## 4. Validación mínima obligatoria

1. Probar autenticación en la UI del conector (debe completar login sin error).
2. Verificar claims del access token:
   - `iss`
   - `aud`
   - `scope` (o `scp`)
   - `exp`
3. Ejecutar llamada MCP desde el conector y confirmar respuesta de tools.
4. Registrar evidencia mínima:
   - endpoint MCP usado
   - scopes concedidos
   - resultado de autenticación
   - resultado de llamada MCP

### Utilidad local para validar claims

Puedes usar:

```bash
./scripts/validate_oauth_token_claims.sh \
  --token "<ACCESS_TOKEN>" \
  --expected-iss "https://necktral.us.auth0.com/" \
  --expected-aud "https://mcp.wiscontext-sync.org/mcp" \
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
