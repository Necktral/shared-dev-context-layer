# MCP Recovery Evidence - 04 ChatGPT Tools

- Fecha/hora (UTC): 2026-03-31T15:48:51Z
- Acción requerida (manual):
  - Configurar app ChatGPT Developer Mode con URL: `https://<stable-domain>/mcp`
  - Refresh tools
  - Invocar una vez:
    - `get_active_task`
    - `get_context_snapshot`
    - `get_recent_errors`
    - `get_validation_status`
    - `get_approved_decisions`

## Salida observada

```text
Pendiente de ejecución manual en ChatGPT (no disponible desde este runtime CLI).
```

- Resultado: `fail`
- Nota corta: gate ChatGPT no puede marcarse `pass` hasta validar invocación real desde la UI de ChatGPT.
