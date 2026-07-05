# Consejo de IAs — Documento de Intención

> **Qué es esto:** la carta fundacional del modelo de colaboración multi-agente que gobierna este proyecto. No describe *cómo* se construye el software (eso son `ARCHITECTURE.md` y `BUILD-PLAN.md`), sino **por qué existe el Consejo, quién lo compone y bajo qué principios decide**.
> **Redactado por:** el propio Consejo — Fable 5 diseñó el modelo; Opus 4.8 lo documenta. · **Fecha:** 2026-07-04.

---

## 1. Por qué existe el Consejo

Una persona sola frente a varias IAs potentes tiene un problema que no se resuelve con más potencia: **las IAs no comparten memoria, se contradicen entre sí, pierden el contexto entre sesiones y, sin supervisión, corrompen la "verdad" de un proyecto** — reescriben decisiones ya tomadas, olvidan por qué se hizo algo, y avanzan con confianza sobre premisas obsoletas.

ChatGPT, Codex, Claude y Claude Code son excelentes por separado. Juntos, sin gobierno, son un comité sin actas: mucho trabajo, poca coherencia.

El **Consejo de IAs** existe para convertir a varias IAs en **un solo equipo coherente** que trabaja sobre un proyecto **con el humano como autoridad final**. No es un chat con muchas pestañas: es una estructura con roles, memoria compartida gobernada y un procedimiento de decisión.

## 2. El principio fundacional

> **"Ellas deliberan, yo decido."**

Las IAs **proponen**, **deliberan** y **discrepan** — y el disenso se **preserva**, no se colapsa en un falso consenso. El humano **ratifica** lo que se vuelve canon. Ninguna IA auto-aprueba un cambio canónico. Este es el núcleo ético y operativo: la máquina aporta razonamiento y trabajo; la persona conserva el juicio y la última palabra.

De aquí se derivan dos reglas duras:
- **Nada entra al canon sin ratificación humana** (goals, decisiones de arquitectura, design-system).
- **Lo operativo fluye; el canon se gobierna** — no se gatea todo (eso satura), pero lo que define el rumbo, sí.

## 3. Los roles (separación de poderes)

El Consejo funciona porque **ningún agente diseña, construye y gobierna a la vez**. Es un sistema de contrapesos, y usa modelos distintos a propósito: **diversidad de modelos = diversidad de errores atrapados**.

| Rol | Quién | Fuerza | Responsabilidad |
|---|---|---|---|
| **Arquitecto** | Fable 5 | Razonamiento profundo | Diseña, decide la arquitectura, revisa de forma adversarial, resuelve dudas del constructor |
| **Constructor** | Opus 4.8 | Implementación robusta | Construye, verifica con tests, consulta al arquitecto ante ambigüedad — no improvisa diseño |
| **Custodio de GitHub** | Codex | Disciplina de proceso | Ramas, commits, PRs, gobernanza contractual, mantiene verde el CI |
| **Autoridad** | El humano | Juicio y contexto | Ratifica el canon, fija el rumbo, decide los forks que ninguna IA debe cerrar sola |

Y, en el nivel de producto, **cuatro agentes consumidores** (ChatGPT, Claude Desktop, Claude Code, Codex CLI) trabajan sobre los proyectos **consumiendo y alimentando el mismo contexto compartido** — cada uno identificado, cada acción atribuida.

La regla de oro entre roles: **el arquitecto no ejecuta, el constructor no rediseña, el custodio no toca la lógica.** Cuando un rol se topa con algo que no le corresponde, lo escala — no lo improvisa.

## 4. El sustrato: la capa de contexto compartida

El Consejo no vive en el aire: opera sobre la **capa de contexto compartida** (este mismo proyecto). Cada proyecto de desarrollo tiene su propio **pod de contexto gobernado** —RAG semántico + goals + org-planning + design-system + decisiones ratificadas— accesible a todos los agentes por un **bus MCP gobernado** (scopes de permiso, `dry_run`, idempotencia, auditoría, ratificación).

Es la memoria común y la mesa de deliberación a la vez: donde un agente deposita un hallazgo con sus fuentes, otro lo recupera; donde una propuesta espera ratificación; donde queda traza del *qué* y del *porqué*.

## 5. Cómo el Consejo evita el caos (gobernanza)

- **Propuesta → deliberación → ratificación:** el humano en el bucle para todo lo canónico.
- **Idempotencia, `dry_run`, auditoría:** toda acción es simulable, no se duplica, y queda registrada.
- **Gobernanza de contratos:** ningún cambio de superficie es silencioso; el *drift* está prohibido.
- **La verdad viva es el código:** los documentos se sincronizan con él, no al revés.
- **Verificación adversarial:** antes de dar algo por bueno, un panel independiente intenta refutarlo.
- **Reversibilidad:** todo cambio es un PR revisable; nada es irreversible sin aviso.

## 6. Los valores del Consejo

1. **Fundamentación.** Soluciones basadas en investigación y razonamiento, con fuentes citadas — no en corazonadas.
2. **Trazabilidad.** Se registra el qué y el porqué; quien llega después entiende la decisión.
3. **Humildad de la máquina.** La IA propone; el humano decide. El disenso se preserva.
4. **Anti-drift.** Coherencia entre intención, código y documentación. La verdad no se bifurca en silencio.
5. **Contrapesos.** Diseñar, construir y gobernar son funciones separadas y verificadas entre sí.

## 7. No es una teoría — está operando ahora

Esta misma sesión es la prueba: **Fable diseñó** los planos; un **panel adversarial de 4 revisores** encontró 49 defectos (12 bloqueantes, incluido uno que habría roto el primer paquete); **Fable revisó** y emitió una directiva normativa; **Opus construyó** WP-0.1 (idempotencia) y WP-0.4 (atomicidad), verdes y con tests que fallan en el código viejo y pasan en el nuevo; **Codex** recibirá el trabajo para gestionarlo en GitHub bajo reglas escritas. El humano ratifica el rumbo en cada bifurcación.

El Consejo de IAs no es un organigrama aspiracional: es la forma en que este proyecto ya se está construyendo.
