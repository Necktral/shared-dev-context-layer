# Orientaciones para Codex — Gestión de GitHub (shared-dev-context-layer v2)

> **Autor:** Opus 4.8 (constructor) · **Destinatario:** Codex (responsable de GitHub) · **Fecha:** 2026-07-04
> **Propósito:** Opus construye el código (los WP del `BUILD-PLAN.md`); **tú, Codex, te encargas de GitHub**: repo, ramas, commits, PRs y del gate de gobernanza. Este documento es tu contrato de trabajo. Fable es el arquitecto (decisiones de diseño). No reabras diseño; gestiona git/GitHub.

---

## 0. Reparto de roles (no lo cruces)

| Rol | Quién | Responsabilidad |
|---|---|---|
| Arquitecto | Fable 5 | Decisiones de diseño; `REVISION-DIRECTIVE.md` es normativa |
| Constructor | Opus 4.8 | Produce los cambios de código de cada WP en el working tree |
| **GitHub** | **Codex (tú)** | Ramas, commits, PRs, cuerpo de PR, CONTRACT-INVENTORY, verde de CI |

Si un PR falla el gate por **gobernanza/metadata**, lo arreglas tú. Si falla por **código/tests**, lo escalas a Opus — no toques la lógica.

## 1. Repo y ubicación

- **Código local:** `/media/wis/086880D36880C0C4/desarrollos/shared-dev-context-layer` (partición NTFS montada por UUID; la ruta es estable aunque el disco se re-enumere).
- **⚠️ NTFS y el file mode:** esta partición hace que git vea cambios de permisos espurios (`100644 → 100755`) en cientos de ficheros (fue lo que ensució una copia vieja del repo). **Lo primero:** `git config core.fileMode false` en el repo local, para que esos flips de modo no aparezcan como diffs. Verifícalo con `git status` (debe salir limpio salvo el trabajo real).
- **⚠️ La partición se desmonta sola** de forma intermitente (rompe el working tree a media faena). Si `git`/`ls` fallan con "No existe el archivo", remóntala: `udisksctl mount -b /dev/disk/by-uuid/086880D36880C0C4` (vuelve al mismo path). Considera con el usuario mover el repo a un disco ext4 estable.
- **Repo nuevo:** el usuario lo crea en GitHub. Tú: añades el remoto (`git remote add origin <url>`), decides con el usuario la rama por defecto (sugerido `main`), y haces el primer push del estado actual como base.
- Rama base de trabajo actual: `local-personal` (contiene hasta el commit `0133208` + el trabajo v2 sin commitear). Reconcilia con el usuario si el repo nuevo arranca de `main` limpio o hereda `local-personal`.

## 2. Disciplina: **un WP = una rama = un PR**

- **Naming de rama:** `wp/<id>-<slug-corto>` — p.ej. `wp/r0-apply-directive`, `wp/0.1-idempotency-dry-run`, `wp/0.4-atomicidad`.
- **Orden de los WP** (de `BUILD-PLAN.md` §0 y grafo): Fase 0 es **secuencial**: `0.1 → 0.4 → 0.8 → 0.2 → 0.3 → 0.6 → 0.7` (con `0.5` en paralelo desde 0.1). Luego F1∥F2 → F3 → F4/F5 → F6.
- **Regla 1-bis (crítica para migraciones):** los WP que crean migraciones Alembic (**0.1, 1.1, 2.1, 3.1**) se **serializan entre sí**; `alembic heads` debe devolver **exactamente 1 head** en todo momento. Si dos ramas con migración divergen, el segundo PR **rebasa** su `down_revision` al head nuevo antes de mergear. Un `alembic upgrade head` que falle por doble head es el enforcement.

## 3. Formato de commit

Conventional Commits, referenciando el WP:
```
feat(wp-0.1): idempotencia dry_run sin quemar keys + migración 0007
fix(wp-0.4): commit único en el pipeline de escritura
docs(wp-r0): aplicar REVISION-DIRECTIVE a los planos
```
Trailer de procedencia (para trazabilidad del flujo multi-agente):
```
Built-by: Opus 4.8 (constructor) · Reviewed-by: Fable 5 (arquitecto)
```
Commits atómicos por WP; no mezcles WPs en un commit.

## 4. Cuerpo de PR OBLIGATORIO (lo valida `scripts/validate_pr_governance.sh`)

Todo PR incluye este bloque; los **4 primeros campos son machine-readable** (el gate los extrae de las líneas 115-129 del script):

```
## Gobernanza
contract_class: <internal_only|persisted_contract|integration_contract|ui_facing_contract|n/a>
local_private_level: <green|yellow|red|n/a>
composition_impact: <none|low|medium|high>
decomposition_required: <yes|no>

- Tipo de cambio: <additive|non_additive>
- ADR/addendum: <ruta o n/a>
- CONTRACT-INVENTORY actualizado: <sí|n/a — solo válido si contract_class = n/a>
- Mini-suite ejecutada: <comandos y resultado>
```

### Valores por WP (cópialos literal al PR — de `BUILD-PLAN.md` §0)

| WP | contract_class | local_private_level | non_additive / ADR |
|---|---|---|---|
| R0 | n/a | n/a | no — docs |
| 0.1 | integration_contract + persisted_contract | n/a | additive |
| 0.4 | internal_only | n/a | additive (inventario igualmente) |
| 0.8 | internal_only | n/a | additive (inventario igualmente) |
| 0.2 | integration_contract | n/a | **non_additive** → ADR deliberativo (addendum) + ADR-phase0-perimeter-closure |
| 0.3 | integration_contract | n/a | additive |
| 0.6 | persisted_contract + integration_contract | n/a | (b) nullable |
| 0.5 | integration_contract | **yellow** | **non_additive** (b) → ADR-phase0-perimeter-closure |
| 0.7 | n/a | n/a | no — docs |
| 1.1 | persisted_contract | n/a | **non_additive** → ADR-multi-project-scopes |
| 1.2 / 1.3 | internal_only | n/a | additive (inventario) |
| 2.1 | persisted_contract | **yellow** | additive; addendum ADR-B2 |
| 2.2 | internal_only | n/a | additive (inventario) |
| 2.3 | integration_contract | n/a | additive |
| 2.4 | integration_contract + ui_facing_contract | **yellow + addendum ADR** | additive |
| 3.1 | persisted_contract + integration_contract | n/a | **non_additive** → addendum ADR deliberativo |
| 3.2 / 3.3 | integration_contract | n/a | additive |
| 3.4 | ui_facing_contract | **yellow** | additive |
| 3.5 | integration_contract | n/a | additive |
| 4.1 / 4.3 / 5.2 | n/a | n/a | no — docs |
| 4.2 | persisted_contract | **yellow** | additive (seed + rename consumer) |
| 5.1 | integration_contract | n/a | additive |
| 6.1 | n/a (o internal_only) | n/a | arnés e2e |

## 5. Reglas de gobernanza que NO puedes saltarte

1. **`contract_class != n/a` ⇒ actualizar `docs/context/CONTRACT-INVENTORY.md` en el MISMO PR**, también cuando sea `internal_only` (el gate lo exige). Afecta a 0.4, 0.8, 1.2, 1.3, 2.2 (que de otro modo se lo saltarían).
2. **WP non_additive** (0.2, 0.5b, 1.1, 3.1): el PR referencia el ADR correspondiente (ya existen esqueletos en `docs/context/adr/`: `ADR-phase0-perimeter-closure.md`, `ADR-multi-project-scopes.md`; el deliberativo recibe addenda). Sin ADR, no mergea.
3. **WP con superficie MCP**: el PR también actualiza `TOOL_SCOPES`, allowlists de `delegated_limited`, `scripts/mcp_validation_payloads.json`, `scripts/smoke_mcp.py`, `docs/mcp/README.md` (regla 4 de `BUILD-PLAN` §0). Esto lo produce Opus en el código; tú verificas que el PR los incluya.
4. **`local_private_level ≥ yellow`** para todo PR que toque `vscode-extension/src/local/**` o `vscode-extension/migrations/local_private/`; los que tocan `ports.ts` exigen addendum ADR.

## 6. Verificación antes de mergear

- **CI:** `.github/workflows/phase3-ci.yml` (5 jobs: governance, docs, extension, local-db, backend). No mergees con CI rojo.
- **Local (opcional, mismo gate):** `./scripts/run_contract_closure.sh <docs|extension|local-db|backend|all>`. **Requiere `ripgrep`** — el host actual NO lo tiene instalado (`sudo apt-get install -y ripgrep`); el CI sí. El backend/tests corre en Docker: `docker compose exec -T backend python -m pytest -q`.
- **⚠️ El código está horneado en la imagen** (sin volumen): tras cambios de código, `docker compose up --build -d` antes de correr tests en el contenedor.
- Un WP no se cierra hasta que su PR está **verde**.

## 7. Coordinación con Opus (handoff por WP)

1. Opus construye el WP y deja los cambios en el working tree, ya verificados (tests verdes en el contenedor). Te avisa: "WP-X listo para GitHub".
2. Tú: creas la rama `wp/X-...`, agrupas SOLO los ficheros de ese WP, commit atómico, redactas el cuerpo de PR con los valores de la tabla §4, actualizas `CONTRACT-INVENTORY` si aplica (§5.1), y abres el PR.
3. Reportas el nº de PR y el estado del CI. Si el CI falla por gobernanza, lo arreglas; si falla por código, se lo devuelves a Opus.

## 8. Estado actual pendiente de subir (arranca por aquí)

Ya hay WP construidos y verdes en el working tree, sin commitear:
- **WP-R0** (docs): planos v2.1 (`docs/blueprint/ARCHITECTURE.md`, `BUILD-PLAN.md`), `REVISION-DIRECTIVE.md`, 2 ADR nuevos + addendum, `CAPABILITIES.md`, este documento. → PR #1, `contract_class: n/a`.
- **WP-0.1** (código): migración `0007_write_plane_fixes` + fix de idempotencia dry_run + modelos + `tests/test_wp01_idempotency_dry_run.py` (4 tests verdes; suite 67 passed / 7 skipped). → PR #2, `integration_contract + persisted_contract`, additive, actualiza CONTRACT-INVENTORY.
- **WP-0.4** (código): en construcción por Opus (atomicidad: commit único).

Sugerencia de orden: PR #1 (WP-R0, docs) primero, luego PR #2 (WP-0.1). No mezcles WPs.
