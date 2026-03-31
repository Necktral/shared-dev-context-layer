# MCP Recovery Evidence - 02 Container Client

- Fecha/hora (UTC): 2026-03-31T15:48:51Z
- Comando ejecutado:
  - `docker compose exec -T backend python - <<'PY' ... streamablehttp_client('http://mcp:8002/mcp') ...`

## Salida observada

```text
tools: get_active_task,get_context_snapshot,get_recent_errors,get_validation_status,get_approved_decisions
get_active_task status: ok
```

- Resultado: `pass`
- Nota corta: cliente MCP desde contenedor `backend` llega a `http://mcp:8002/mcp` y ejecuta tool read-only.
