# Configuración Avanzada OAuth (ChatGPT Connector) — Auth0 + MCP

Guía operativa para crear un conector nuevo en ChatGPT con OAuth funcional usando Auth0.

Estado objetivo de esta fase:

- OAuth/OIDC activo en el **conector**.
- MCP sigue en postura operativa actual (sin enforcement JWT estricto en backend).
- Runtime del proyecto permanece dual: `offline_fixture` y `mcp`.

## 1. Pre-requisitos

- Tenant de Auth0 activo: `https://<TENANT>.auth0.com`
- Application en Auth0 para el conector (Regular Web Application).
- API (Resource Server) en Auth0 con audience definida.
- Callback URL generada por ChatGPT Connector (la UI la muestra al crear el conector).

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

- `URL de autorización`: `https://<TENANT>.auth0.com/authorize`
- `URL de token`: `https://<TENANT>.auth0.com/oauth/token`
- `URL de registro`: dejar vacío (si no se usa DCR)
- `Base del servidor de autorización`: `https://<TENANT>.auth0.com/`
- `Recurso` (audience): `https://<TU_API_AUDIENCE>`

### 2.4 OpenID Connect (OIDC)

- `OIDC habilitado`: Sí
- `URL configuración OIDC`: `https://<TENANT>.auth0.com/.well-known/openid-configuration`
- `OIDC userinfo endpoint`: `https://<TENANT>.auth0.com/userinfo`
- `OIDC scopes`: `openid`, `profile`, `email`

### 2.5 Scopes recomendados

#### Alcances base (siempre)

```text
openid
profile
email
```

#### Alcances predeterminados (estrategia amplia)

```text
offline_access
mcp.read
context.read
validation.read
decisions.read
errors.read
handoff.prepare
mcp.write
```

`mcp.write` solo si ya existe formalmente en tu API y lo necesitas desde ya.

## 3. Configuración en Auth0 (obligatoria)

En la Application del conector:

- **Allowed Callback URLs**: agregar la callback exacta de ChatGPT.
- **Allowed Web Origins** y **Allowed Logout URLs**: según política interna.
- Grant type habilitado: `Authorization Code`.

En la API (Resource Server):

- Registrar scopes usados en el conector (`mcp.read`, `context.read`, etc.).
- Confirmar audience igual al valor usado en “Recurso”.

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
  --expected-iss "https://<TENANT>.auth0.com/" \
  --expected-aud "https://<TU_API_AUDIENCE>" \
  --require-scopes "openid,profile,email,mcp.read,context.read"
```

Smoke test MCP con header de auth:

```bash
MCP_AUTH_TOKEN="<ACCESS_TOKEN>" \
MCP_AUTH_HEADER_NAME="Authorization" \
MCP_AUTH_SCHEME="Bearer" \
./scripts/validate_remote_mcp.sh https://<stable-domain>/mcp
```

## 5. Notas de seguridad y alcance de fase

- Esta guía no habilita todavía enforcement JWT estricto en backend MCP.
- No se modifica el contrato read-only del control plane en esta fase.
- OAuth aquí protege el flujo de autenticación/autorización del conector; el hardening end-to-end se aborda en fase posterior.
