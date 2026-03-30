# WIS Fase 3 - Slice 0 SSOT

**Titulo:** VS Code Extension Foundation & Contract Lock  
**Estado:** approved for implementation  
**Fase:** 3  
**Slice:** 0  
**Dependencias:** Fase 2 completada; contrato MCP estable; `docs/context` como canon operativo  
**Tipo:** SSOT operativo de ejecucion

## 1. Proposito

Definir el paquete canonico de ejecucion para el **Slice 0 de Fase 3**: establecer la base ejecutable de la extension de VS Code como **control plane local read-only** de WIS, congelando desde el inicio el contrato que no puede degradarse en slices posteriores.

Fase 3 existe para introducir una extension que consume WIS en modo lectura, preserva el contrato MCP, muestra estado operacional y prepara handoffs sin writes ni ejecucion automatica local.

## 2. Objetivo del slice

Cerrar un baseline ejecutable y verificable que deje lista la carcasa contractual de la extension:

- activacion valida dentro de VS Code
- un comando base funcional
- configuracion explicita del endpoint MCP
- canal local de logs/diagnostico
- garantias explicitas de read-only
- estructura inicial compatible con los modulos objetivos de Fase 3

Este slice corresponde al bloque **foundation** del plan de implementacion y precede a session/identity, connectivity, UI, conflict handling, handoff y hardening.

## 3. Resultado esperado

Al finalizar el slice debe existir una extension que:

- cargue sin romper el extension host
- exponga al menos un comando contractual
- permita definir de forma explicita el endpoint MCP terminado en `/mcp`
- registre eventos de activacion y ejecucion en un output channel
- no contenga rutas de write, auto-edit, shell autorun ni auto-commit

Esto preserva el rol arquitectonico de la extension como adaptador local observacional, no como motor de ejecucion, sistema de verdad o policy engine.

## 4. Invariantes congelados

Desde Slice 0 quedan fijados estos invariantes:

### 4.1 Identidad

- `consumer = "vscode_extension"` como identidad canonica de integracion

### 4.2 Transporte

- MCP sobre `streamable-http`
- endpoint explicito terminado en `/mcp`
- no se permite cambio de transporte en Fase 3

### 4.3 Superficie MCP preservada

Las cinco tools que Fase 3 debe consumir y no puede renombrar ni sustituir son:

- `get_active_task`
- `get_context_snapshot`
- `get_recent_errors`
- `get_validation_status`
- `get_approved_decisions`

### 4.4 Autoridad

- WIS sigue siendo la fuente de verdad
- la extension puede sugerir scope, no resolverlo como autoridad
- no se permiten writes
- no se permite ejecucion automatica de cambios locales
- no se permite bypass de `delegated_limited`

## 5. Alcance

### En alcance

- scaffold formal de la extension
- manifest/activation entrypoint
- un comando base visible y ejecutable
- output channel local
- configuracion explicita del endpoint MCP
- configuracion minima de modo diagnostico
- estructura inicial alineada con:
  - Activation Layer
  - Session Manager
  - WIS Client
  - Context Presenter
  - Handoff Builder
  - Environment Inspector

### Fuera de alcance

- UI rica final
- webview complejo
- consumo completo de las 5 tools
- handoff ejecutable
- resolucion avanzada de scope
- tratamiento completo de `scope_conflict`
- auto-refresh
- cache persistente no trivial
- cualquier capacidad de write o mutacion local automatica

## 6. Entregables obligatorios

1. Proyecto base de extension VS Code operativo.
2. Comando minimo contractual:
   - `WIS: Load Operational Context`
   - o alias equivalente siempre que preserve intencion y trazabilidad contractual
3. Output channel para logs de activacion y ejecucion.
4. Configuracion explicita para:
   - MCP base URL
   - diagnostic mode
   - session reset reservado para Slice 1
5. Nota visible de postura read-only.
6. Estructura de carpetas/modulos suficiente para crecer sin drift.

## 7. Definition of Done

Slice 0 solo pasa si se cumplen todas:

### A. Activacion

- la extension se activa con workspace abierto
- no rompe VS Code
- no produce error fatal de activacion
- comandos y superficie minima quedan registradas correctamente

### B. Comando base

- el comando existe en Command Palette
- se ejecuta de forma controlada
- su ejecucion deja evidencia en logs/output
- no requiere reload de VS Code por cada prueba

### C. Configuracion

- el endpoint MCP es explicito
- no existe autodiscovery opaco
- el endpoint esperado termina en `/mcp`

### D. Observabilidad

- existe output channel
- hay log de activacion
- hay log de invocacion del comando
- existe senal minima de diagnostico local

### E. Seguridad y no-deriva

- no hay write path
- no hay auto-edit de archivos
- no hay shell autorun
- no hay auto-commit
- no se cambio transporte
- no se cambio nombre de tools
- no existe logica local que suplante la resolucion autoritativa de WIS

## 8. Evidencia minima de cierre

El cierre del slice requiere un paquete corto de evidencia:

- prueba de activacion exitosa
- prueba de presencia y ejecucion del comando
- prueba de configuracion explicita del endpoint
- log de output channel
- prueba de ausencia de write behavior
- confirmacion de que no hubo drift de transporte ni de nombres MCP

El gate de Fase 3 es binario Go/No-Go y exige evidencia, no solo intencion documental.

## 9. Riesgos criticos

### R1. Overbuild temprano

Construir UI compleja o flujos ricos antes de fijar el contrato.  
**Impacto:** drift, retrabajo, falsa percepcion de progreso.

### R2. Endpoint ambiguo

Introducir magia de descubrimiento del endpoint.  
**Impacto:** soporte opaco, errores no reproducibles.

### R3. Scope local prematuro

Empezar a inferir foco local como si fuera verdad.  
**Impacto:** divergencia con WIS.

### R4. Violacion read-only

Abrir una ruta lateral de mutacion.  
**Impacto:** rompe la definicion de Fase 3.

### R5. Observabilidad insuficiente

No dejar trazas desde el inicio.  
**Impacto:** imposibilidad de endurecer con rigor despues.

## 10. Criterio de salida hacia Slice 1

Slice 0 habilita Slice 1 unicamente cuando:

- activacion y comando base esten cerrados
- configuracion MCP sea explicita
- output channel exista
- las invariantes esten protegidas
- el equipo pueda pasar a `consumer/session lifecycle` sin reabrir fundamentos

## 11. Siguiente paso

Una vez cerrado este slice, el siguiente paquete operativo es:

**Fase 3 - Slice 1: Consumer Identity & Session Lifecycle**

con foco en:

- `consumer = vscode_extension`
- creacion/reuso de `session_key`
- reset de sesion
- diagnosticos de sesion

## 12. Regla de gobernanza

Este SSOT no abre una linea infinita de documentos. Despues de su aprobacion, lo que sigue es:

**implementacion -> evidencia -> cierre -> siguiente slice**

No debe crearse documentacion nueva salvo:

- cambio real de contrato
- decision arquitectonica material
- evidencia de cierre o auditoria
