# ADR — Cierre de perímetro de Fase 0 (loopback-first + auth runtime en exposición)

- **Estado:** Proposed
- **Fecha:** 2026-07-04
- **Tipo:** Architecture Decision Record
- **Down-revision base:** `0006_deliberative_columns` (head actual; los enforcement de datos aterrizan en `0007_write_plane_fixes`)
- **Directiva fuente:** [`docs/blueprint/REVISION-DIRECTIVE.md`](../../blueprint/REVISION-DIRECTIVE.md) §D1 (resuelve F06, F07, F08 acceso, F10, F21, F22, F23, F40, F41, F42)
- **Principio rector:** *Loopback-first; exposición ⇒ auth runtime; ratificación ⇒ operator-token; remotos = read-only.*
- **Alcance:** transporte MCP (`app/mcp/server.py`), API `/internal/*` (`app/api/internal.py`), scripts de túnel (`scripts/start_cloudflare_tunnel.sh`, `scripts/start_named_cloudflare_tunnel.sh`), bootstrap dev (`dev_native.py`, `make up`), CI (`phase3-ci.yml`), higiene del índice local (`vscode-extension/src/constants.ts`).

> **NOTA DE ESQUELETO.** Este ADR se crea en WP-R0 como andamiaje del flujo non_additive; su **contenido completo se redacta al ejecutar WP-0.5 y WP-0.2** (secciones de modelo de datos, diffs verificados `fichero:línea`, plan de tests con evidencia y consecuencias medidas). Ampara los cambios **non_additive de WP-0.5(b)** (`X-Internal-Token` en `/internal/*`) **y de WP-0.2** (default `dry_run=true` de `propose_change` + operator-token de ratificación): satisface el **paso 1** del flujo de 5 pasos de `CONTRACT-GOVERNANCE §3` para todos ellos.

---

## 1. Contexto y hallazgo (verificado en el código, no de memoria)

Bajo la configuración de fábrica (`.env.example:26-27`: `MCP_AUTH_ENABLED=false`, `MCP_AUTH_BYPASS_LOCAL=true`) el bus queda **abierto**, y la garantía central *"ellas deliberan, yo decido"* es hoy ficticia:

| Superficie | Estado de fábrica | Evidencia |
|---|---|---|
| Bind del transporte MCP | escucha en `0.0.0.0` ⇒ alcanzable desde la LAN | `server.py:187` |
| Bypass local | `_scope_guard` concede **TODOS** los scopes (incluido `wis.context.ratify`) a cualquier llamante | `MCP_AUTH_BYPASS_LOCAL=true` |
| Túnel público | tunela el bus a una URL pública **sin preflight** de auth | `scripts/start_cloudflare_tunnel.sh` |
| Salvaguarda planeada | RuntimeError si bypass + `MCP_PUBLIC_BASE_URL` **nunca dispara** por esa vía | — |
| Endpoints `/internal/*` | sin token; el token HTTP planeado no cubre el write plane MCP | `app/api/internal.py` |

**Conclusión (confirmada):** con la config por defecto no existe perímetro real; el mero hecho de poseer un scope de escritura (o el bypass) permite escribir y ratificar canon. Este ADR reintroduce un perímetro efectivo sin matar la ergonomía del prototipo local.

---

## 2. Decisión

Adoptar el modelo **loopback-first** de D1, con cuatro planos de perímetro distinto:

1. **Bind/publicación loopback por defecto.** Nuevo setting `MCP_BIND_HOST`, **default `127.0.0.1`** (el literal `"0.0.0.0"` de `server.py:187` desaparece). En docker-compose el proceso bindea `0.0.0.0` dentro del contenedor, pero el perímetro real es la **publicación de puertos loopback**: `127.0.0.1:8001:8001` y `127.0.0.1:8002:8002`. Nada del bus es alcanzable desde la LAN por defecto.
2. **`X-Internal-Token` en `/internal/*` — non_additive.** Los endpoints internos (y sus alias) exigen `X-Internal-Token`; fail-closed 503 si el token no está en runtime. Compatibilidad = **autogeneración de `INTERNAL_API_TOKEN` en el bootstrap dev** (`dev_native.py` y `make up` escriben `.env` si falta) + inventario y parcheo de consumidores actuales en el mismo PR. Se documenta que este token HTTP **NO cubre el write plane MCP** (F23).
3. **Guard bypass + public_url en el arranque del transporte.** El RuntimeError (bypass + `MCP_PUBLIC_BASE_URL`) se ubica en el **arranque del transporte streamable-http**, NO en un validator de `Settings` (para no romper pytest, F10). El job backend de `phase3-ci.yml` se corrige en el MISMO PR quitando `MCP_PUBLIC_BASE_URL`.
4. **Preflight de túneles que aborta sin auth runtime.** Ambos scripts leen el env efectivo del contenedor `mcp` vía `docker inspect` y **ABORTAN** salvo que `MCP_AUTH_ENABLED=true` **y** `MCP_AUTH_BYPASS_LOCAL=false` (F06).
5. **`OPERATOR_RATIFY_TOKEN` verificado SIEMPRE.** `ratify_proposal`/`reject_proposal` ganan `operator_token`, verificado contra el nuevo setting **incluso bajo `MCP_AUTH_BYPASS_LOCAL=true`**. Sin token válido ⇒ no ratifica (fail-closed; si el setting no está definido, responde que la ratificación no está configurada). Autogenerado en bootstrap dev; **nunca persistido** (excluido del `before_payload`, cubierto por `SENSITIVE_KEYS`) ni presente en respuestas. Orden en la tool: scope guard → operator-token → lookup de proposal.

Complementan la decisión: `consumer` documentado como **atribución NO autenticada** (F07), Origin guard como **anti-CSRF de navegador** only (F40), `GET /mcp/info` sin `auth_enabled` (F42), y remotos **read-only** por política de grants Auth0 (F03 de D1: nunca `write`/`sync.write`/`ratify`/`code.read`).

---

## 3. Cambios al modelo de datos

> A completar en WP-0.5/WP-0.2. Los enforcement de datos de Fase 0 viven en `0007_write_plane_fixes` (§3.1 de la directiva); este ADR no introduce migración propia (los cambios son de settings, transporte y scripts).

---

## 4. Plan de tests (gate de aceptación)

> A completar en WP-0.5/WP-0.2. Cobertura mínima prevista:
> - puertos publicados solo en loopback (no alcanzable desde LAN);
> - `start_cloudflare_tunnel.sh`/`start_named_cloudflare_tunnel.sh` abortan con bypass activo;
> - `/internal/*` sin `X-Internal-Token` ⇒ 503 fail-closed;
> - ratify sin `operator_token` ⇒ rechazado **incluso con bypass activo**; con token válido ⇒ ok; doble ratify de la misma proposal ⇒ replay;
> - `phase3-ci.yml` sin `MCP_PUBLIC_BASE_URL` en el job backend; `test_mcp_public_base_url_config.py` revisado.

---

## 5. No-goals / anti-patrones

- ❌ "Asegurar todo con OAuth ya" (mata la ergonomía del prototipo local).
- ❌ "Es personal, da igual" (la ratificación perdería todo valor probatorio).
- ❌ Tratar el Origin guard como autenticación de acceso (no autentica nada).
- ❌ Persistir o exponer el `OPERATOR_RATIFY_TOKEN`.
- ❌ Conceder scopes de escritura/ratificación a clientes remotos en v1.

---

## 6. Consecuencias

- **Positivas:** el perímetro pasa de convención a invariante enforced; el bus deja de ser alcanzable desde la LAN por defecto; la ratificación exige un token que el bypass NO satisface; los túneles no pueden exponer un bus sin auth.
- **Costos:** dos cambios **non_additive** (WP-0.5b y WP-0.2) con su flujo de 5 pasos; nuevos settings (`MCP_BIND_HOST`, `INTERNAL_API_TOKEN`, `OPERATOR_RATIFY_TOKEN`) y su autogeneración en bootstrap dev; parcheo de consumidores de `/internal/*` y del job de CI.
- **Reversibilidad:** loopback por defecto, guard, preflight y operator-token son configuración y arranque (reversibles); el `X-Internal-Token` obligatorio es el corte de comportamiento (mitigado por autogeneración dev).

---

## 7. Criterio de revisión

Revisar este ADR solo ante: cambio del modelo de exposición (p. ej. habilitar bind no-loopback por defecto), cambio de la política de grants remotos (dejar de ser read-only), o cambio del modelo de identidad de ratificación.

> **Contenido completo al ejecutar WP-0.5 y WP-0.2.**
