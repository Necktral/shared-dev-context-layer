# MCP Recovery Evidence - 01 Local Host

- Fecha/hora (UTC): 2026-03-31T15:48:51Z
- Comando ejecutado:
  - `curl -i -H 'Accept: text/event-stream' http://localhost:8002/mcp`

## Salida observada

```text
HTTP/1.1 400 Bad Request
...
mcp-session-id: 0142c58adb3b45db82875b66a01485a1
...
{"jsonrpc":"2.0","id":"server-error","error":{"code":-32600,"message":"Bad Request: Missing session ID"}}
```

- Resultado: `pass`
- Nota corta: el endpoint local responde y expone `mcp-session-id`, cumpliendo el gate de reachability MCP en host.
