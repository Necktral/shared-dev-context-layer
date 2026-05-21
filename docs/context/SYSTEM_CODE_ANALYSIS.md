# System Code Analysis

> Generated analysis of the WIS Context Sync codebase structure and implementation status.

## Repository Structure

```
shared-dev-context-layer/
├── backend/               # Python FastAPI + MCP server
│   ├── app/
│   │   ├── api/           # REST/HTTP route handlers
│   │   ├── audit/         # Audit logging subsystem
│   │   ├── auth/          # Auth0 JWT validation (JWKS, iss/aud/exp)
│   │   ├── core/          # Configuration and shared utilities
│   │   ├── db/            # SQLAlchemy base, session management
│   │   ├── mcp/           # MCP server (Streamable HTTP on /mcp)
│   │   ├── models/        # SQLAlchemy ORM models
│   │   ├── policies/      # Authorization policies / scope enforcement
│   │   ├── schemas/       # Pydantic request/response schemas
│   │   └── services/      # Business logic (context items, sync, events)
│   ├── alembic/           # Database migrations (PostgreSQL)
│   ├── tests/             # Backend test suite
│   ├── Dockerfile
│   └── requirements.txt
├── vscode-extension/      # VS Code extension (TypeScript)
├── docs/                  # Documentation root
│   ├── context/           # Canon documentation (phases, contracts, ADRs)
│   └── mcp/              # MCP operational runbooks
├── infra/                 # Infrastructure definitions
├── scripts/               # Validation and utility scripts
└── docker-compose.yml
```

## Core Implementation Details

### MCP Server

- **Transport**: Streamable HTTP at `/mcp` endpoint
- **Tools**: Read tools (search, get, list_windows, resolve_related, get_sync_status) and write tools (upsert, append_labels, archive, link_entities, create_sync_batch)
- **Scopes**: Per-tool scope enforcement via JWT claims
- **Guardrails**: `dry_run` | `commit` mode on all write operations
- **Idempotency**: Sync batches keyed by `idempotency_key` per workspace

### Authentication & Authorization

- **Provider**: Auth0 (tenant: `necktral.us.auth0.com`)
- **Validation**: JWT via JWKS endpoint, checks `iss`, `aud`, `exp`
- **Audience**: `wis-context-sync-read-api`
- **Flow**: Authorization Code + PKCE for interactive clients (ChatGPT, VS Code)

### Data Model (PostgreSQL / Alembic)

- `workspaces` — Multi-tenant root
- `context_items` — Primary context entities with `labels_json` (denormalized) and `content_json`
- `context_item_labels` — Normalized label table (workspace_id + item_id + label unique)
- `context_item_links` — Directed relationships between context items
- `context_snapshots` — Point-in-time snapshots
- `context_sync_batches` — Idempotent batch tracking
- `events` — Audit/event log

### Key Service Functions (`context_item_service.py`)

| Function | Purpose |
|----------|---------|
| `upsert_context_item` | Create or update a context item with label sync |
| `append_context_labels` | Add labels to existing item (merge semantics) |
| `archive_context_item` | Soft-delete via status change |
| `link_context_entities` | Create/update directed links between items |
| `search_context_items` | Full-text search with filters |
| `list_context_windows` | Time-windowed activity view |
| `resolve_related_items` | Graph traversal of linked items |
| `get_sync_status` | List sync batch history |
| `create_or_reuse_sync_batch` | Idempotent batch creation |

### Label Consistency

Labels are stored in two places:
1. **Denormalized**: `context_items.labels_json` (fast reads, returned in API)
2. **Normalized**: `context_item_labels` table (queryable, indexed)

The `_sync_labels_table` helper ensures both representations stay consistent during any label mutation (upsert, append).

### VS Code Extension

- Dual-mode operation: `offline_fixture` (local deterministic) and `mcp` (remote Streamable HTTP)
- No silent fallback between modes
- Communicates with backend via MCP protocol over HTTP

## Operational Notes

- All write operations support `dry_run` for preview without side effects
- Optimistic concurrency via `expected_version` on upsert
- Audit trail through events table
- Database migrations managed by Alembic
