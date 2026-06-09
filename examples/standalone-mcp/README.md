# examples/standalone-mcp

> ⚠️ **DEMO/LAB ONLY — Not the official MCP server of this project.**
>
> El servidor MCP oficial del proyecto está en `backend/app/mcp/server.py` e incluye
> autenticación Auth0/OAuth, scopes, auditoría, PostgreSQL y compatibilidad con el
> ChatGPT Custom Connector. **Este ejemplo no tiene nada de eso.**

---

Servidor MCP mínimo basado en `FastMCP`, sin base de datos, sin OAuth y sin auditoría.
Útil exclusivamente para:

- aprender la API de `FastMCP`;
- probar clientes MCP en aislamiento;
- diagnóstico rápido del protocolo sin levantar el stack completo.

**No forma parte del `docker-compose.yml` principal ni del flujo de validación
ChatGPT → Auth0 → MCP remoto.**

## Herramientas

| Tool | Descripción |
|------|-------------|
| `ping` | Liveness check — retorna `ok` + timestamp UTC |
| `server_info` | Metadata de runtime (versión, Python, plataforma) |
| `echo` | Refleja el mensaje recibido |

## Uso

```bash
pip install -r requirements.txt

# STDIO (para clientes que hablan STDIO)
python server.py

# HTTP
python server.py --transport streamable-http --port 8003
```

## Diferencias con el MCP oficial

| Característica | Este ejemplo | `backend/app/mcp/server.py` |
|---|---|---|
| Auth0 / OAuth | ✗ | ✓ |
| Scopes | ✗ | ✓ |
| Auditoría | ✗ | ✓ |
| PostgreSQL | ✗ | ✓ |
| ChatGPT Connector | ✗ | ✓ |
| Herramientas de dominio | ✗ | ✓ |
| En `docker-compose.yml` | ✗ | ✓ |
