# Integración: VS Code + Claude Desktop (MCP local)

Guía para consumir el MCP de este proyecto desde **VS Code** (extensión WIS
Context Sync) y **Claude Desktop** (puente `mcp-remote`), en **modo local sin
auth** (`MCP_AUTH_BYPASS_LOCAL`, sin Auth0 ni túnel).

Endpoint MCP local canónico: `http://localhost:8002/mcp`

## 0. Requisitos

- Docker + Docker Compose
- Node.js 18+ en el `PATH` (para `npx mcp-remote` y la extensión)
- VS Code y Claude Desktop instalados
- `python3` (solo para el script de instalación de la config)

## 1. Levantar el backend MCP local

```bash
cp .env.example .env        # si aún no tienes .env
docker compose up --build -d
docker compose ps
curl -s http://localhost:8001/health
```

Esperado: contenedores `postgres`, `backend` y `mcp` en estado `Up`, y el MCP
sirviendo `streamable-http` en `http://localhost:8002/mcp`.

> El backend debe estar corriendo para que **tanto** VS Code (modo `mcp`) **como**
> Claude Desktop funcionen. Si lo apagas, ambos degradan de forma explícita.

### Atajos con Make

`make up` (docker) · `make health` · `make smoke` (verifica el MCP) · `make down` · `make native` (sin docker).

### Sin Docker (Postgres embebido)

Si no tienes Docker, levanta todo con un Postgres embebido (no requiere root):

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt pgserver
python scripts/dev_native.py        # backend :8001 y MCP :8002 arriba (Ctrl-C para parar)
```

### Verificar que funciona

```bash
python scripts/smoke_mcp.py          # conecta al MCP, lista 17 tools, read + dry_run → SMOKE: PASS
```

Evidencia de una corrida verde en [`VERIFICATION.md`](./VERIFICATION.md).

## 2. VS Code — instalar la extensión

El paquete ya está compilado en:

```
vscode-extension/wis-context-sync-control-plane-0.2.0-internal.vsix
```

Instalar (elige una):

```bash
# Opción CLI
code --install-extension vscode-extension/wis-context-sync-control-plane-0.2.0-internal.vsix
```

- **Opción UI:** VS Code → panel *Extensions* → menú `...` → *Install from VSIX…*
  → selecciona el `.vsix`.

Los settings de workspace ya quedaron preconfigurados en `.vscode/settings.json`:

```json
"wisContextSync.runtimeMode": "mcp",
"wisContextSync.mcpEndpoint": "http://localhost:8002/mcp",
"wisContextSync.authMode": "none"
```

Abre el repo en VS Code y ejecuta desde el *Command Palette*:

1. `WIS: Load Operational Context` (debe cargar en modo `mcp` con el backend arriba)
2. `WIS: Prepare Handoff`
3. `WIS: Search Context` y comandos write (`Upsert / Append / Link / …`) en modo `dry_run` o `commit`

> Para probar sin red: cambia `wisContextSync.runtimeMode` a `offline_fixture`.

## 3. Claude Desktop — conectar el MCP local

Claude Desktop habla MCP por **stdio**, así que usamos `mcp-remote` como puente
hacia el endpoint `streamable-http` local.

**Automático (recomendado):**

```bash
./integration/install-claude-desktop-mcp.sh
```

Hace backup de tu config y añade el server `wis-context`.

**Manual:** copia el bloque de `integration/claude_desktop_config.example.json`
dentro de tu `claude_desktop_config.json`:

- Linux: `~/.config/Claude/claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "wis-context": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:8002/mcp"]
    }
  }
}
```

**Reinicia Claude Desktop por completo** (ciérralo del todo, no solo la ventana).
La primera vez `npx` descargará `mcp-remote` (requiere internet).

## 4. Verificación

- Backend: `curl -s http://localhost:8001/health` → DB operativa.
- VS Code: `WIS: Load Operational Context` retorna `loaded` / `partially_loaded`.
- Claude Desktop: en una conversación nueva, el server `wis-context` aparece
  entre los conectores/tools MCP disponibles.

## Notas

- **Local no usa Auth0.** Para exponer el MCP a internet (túnel Cloudflare + Auth0
  + conector remoto) sigue `docs/mcp/README.md`.
- `mcp-remote` necesita `node`/`npx` accesibles desde el entorno de Claude Desktop.
- Si cambias el puerto MCP en `.env` (`MCP_PORT`), actualiza el endpoint en
  `.vscode/settings.json` y en la config de Claude Desktop.
