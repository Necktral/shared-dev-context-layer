# mcp-server

Standalone MCP (Model Context Protocol) server for the Shared Dev Context Layer.

This is a lightweight server that can run independently of the full backend, useful
for development, testing, and quick integrations.

## Tools

| Tool | Description |
|------|-------------|
| `ping` | Check server liveness — returns `ok` and a UTC timestamp |
| `server_info` | Return basic server information and runtime metadata |
| `echo` | Echo the provided message back to the caller |

## Usage

### STDIO (default, for MCP clients that speak STDIO)

```bash
pip install -r requirements.txt
python server.py
```

### HTTP (streamable-http, for HTTP-based MCP clients)

```bash
python server.py --transport streamable-http --port 8003
```

The MCP endpoint will be available at `http://localhost:8003/mcp`.

### Docker (via docker-compose)

```bash
docker compose up mcp-standalone
```

## Configuration

| Argument | Default | Description |
|----------|---------|-------------|
| `--transport` | `stdio` | Transport mode: `stdio` or `streamable-http` |
| `--host` | `0.0.0.0` | Bind host (HTTP mode only) |
| `--port` | `8003` | Bind port (HTTP mode only) |

## Relation to the full backend MCP server

The full backend MCP server (`backend/app/mcp/server.py`) requires PostgreSQL and
provides read/write tools for the operational context domain with OAuth enforcement.

This standalone server is a minimal alternative that requires no database and no
authentication, intended for:

- Local development and testing of MCP client integrations
- Demonstrating MCP protocol basics
- Quick diagnostics without spinning up the full stack
