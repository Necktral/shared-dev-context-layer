#!/usr/bin/env bash
#
# install-claude-desktop-mcp.sh
# Registra (o actualiza) el servidor MCP "wis-context" en la configuracion de
# Claude Desktop, usando un puente local via mcp-remote hacia el MCP de este
# proyecto (modo local sin auth: MCP_AUTH_BYPASS_LOCAL).
#
# Uso:
#   ./integration/install-claude-desktop-mcp.sh
#   MCP_URL="http://localhost:8002/mcp" ./integration/install-claude-desktop-mcp.sh
#
# Requiere: python3. Crea un backup antes de tocar la config.

set -euo pipefail

SERVER_NAME="${SERVER_NAME:-wis-context}"
MCP_URL="${MCP_URL:-http://localhost:8002/mcp}"

# Resolver ruta de config de Claude Desktop segun el sistema operativo.
case "$(uname -s)" in
  Darwin) CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json" ;;
  Linux)  CFG="$HOME/.config/Claude/claude_desktop_config.json" ;;
  MINGW*|MSYS*|CYGWIN*) CFG="$APPDATA/Claude/claude_desktop_config.json" ;;
  *)      CFG="$HOME/.config/Claude/claude_desktop_config.json" ;;
esac

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: se requiere python3 para hacer el merge seguro del JSON." >&2
  echo "Alternativa: edita manualmente $CFG con el contenido de" >&2
  echo "integration/claude_desktop_config.example.json" >&2
  exit 1
fi

mkdir -p "$(dirname "$CFG")"
[ -f "$CFG" ] || echo '{}' > "$CFG"

BACKUP="${CFG}.bak.$(date +%Y%m%d%H%M%S)"
cp "$CFG" "$BACKUP"
echo "Backup creado: $BACKUP"

python3 - "$CFG" "$SERVER_NAME" "$MCP_URL" <<'PY'
import json, sys

cfg_path, name, url = sys.argv[1], sys.argv[2], sys.argv[3]

try:
    with open(cfg_path) as f:
        data = json.load(f)
except Exception:
    data = {}

if not isinstance(data, dict):
    data = {}

servers = data.setdefault("mcpServers", {})
servers[name] = {
    "command": "npx",
    "args": ["-y", "mcp-remote", url],
}

with open(cfg_path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")

print(f"Servidor MCP '{name}' -> {url}")
print(f"Escrito en: {cfg_path}")
PY

echo "Listo. Reinicia Claude Desktop por completo para cargar el servidor MCP."
