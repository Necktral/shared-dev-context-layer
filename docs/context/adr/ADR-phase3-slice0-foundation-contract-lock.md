# ADR - Fase 3 arranca con Foundation & Contract Lock

**Estado:** accepted  
**Fecha:** 2026-03-30  
**Tipo:** Architecture Decision Record  
**Ambito:** Fase 3 / VS Code Control Plane Read-Only

## 1. Contexto

Fase 3 define una extension de VS Code que actua como **control plane local read-only** para WIS Context Sync.

La fase debe preservar el contrato existente:

- mismas 5 tools MCP
- mismo transporte `streamable-http` sobre `/mcp`
- misma postura read-only
- resolucion de scope autoritativa en WIS, no en el cliente

El riesgo principal al iniciar esta fase es comenzar por UI, handoff o integracion incompleta sin haber fijado antes los invariantes operativos y la carcasa ejecutable minima. Eso generaria drift, retrabajo y ambiguedad sobre la autoridad real del sistema, algo prohibido por el Contract, la Architecture y el Acceptance Gate.

## 2. Decision

Se decide que **Fase 3 comienza formalmente con un Slice 0 de Foundation & Contract Lock** antes de abrir Session Lifecycle, Environment Inspection, WIS Connectivity, UI, Conflict UX o Handoff.

Este slice:

- crea el scaffold de la extension
- establece activacion y comando minimo
- define el endpoint MCP explicito
- introduce observabilidad basica
- congela invariantes de contrato y autoridad
- prohibe write paths y mutacion local automatica desde el arranque

## 3. Justificacion

El plan de implementacion define una secuencia por slices delgados donde foundation antecede a identity/session, connectivity, UI, conflict handling, handoff y hardening.

La arquitectura propuesta exige que la extension sea:

- observacional
- veraz
- contract-safe
- no destructiva
- preparada para futuros handoffs, no para ejecucion en Fase 3

El acceptance gate bloquea la fase si aparecen writes, drift contractual, crashes de activacion o false-success UI en estados degradados.

Por tanto, arrancar por foundation no es conveniencia: es una decision de contencion de riesgo.

## 4. Consecuencias

### Positivas

- reduce drift temprano
- vuelve verificable el arranque de Fase 3
- separa claramente contrato de implementacion incremental
- permite que Session Manager y WIS Client se monten sobre una base estable
- evita que la extension nazca como segunda fuente de verdad

### Negativas

- el primer slice no entrega todavia valor UI rico
- puede percibirse como avance menos visible si se juzga solo por interfaz
- exige disciplina para no expandir alcance prematuramente

## 5. Alternativas consideradas

### Alternativa A - Empezar por UI

Rechazada.  
Genera alto riesgo de desacople entre presentacion y verdad operacional.

### Alternativa B - Empezar por WIS client completo

Rechazada.  
Sin base de activacion/configuracion/observabilidad, la integracion se vuelve fragil y dificil de depurar.

### Alternativa C - Empezar por handoff builder

Rechazada.  
Seria prematuro; Fase 3 primero debe consolidar su rol de consumidor read-only y no de ejecutor ni orquestador downstream.

## 6. Restricciones derivadas

Desde esta ADR quedan fijadas estas restricciones para Fase 3:

- no cambiar transporte MCP
- no renombrar tools
- no introducir writes
- no resolver scope de forma autoritativa en cliente
- no ocultar estados degradados ni conflictos
- no introducir automatismos de ejecucion local

## 7. Criterio de revision

Esta ADR solo debe revisarse si ocurre uno de estos eventos:

- cambio explicito del contrato MCP
- cambio explicito del modelo de autoridad entre WIS y extension
- cambio aprobado del alcance de Fase 3
- descubrimiento de restriccion tecnica que haga inviable el arranque por foundation

## 8. Estado posterior

Con esta decision aceptada, el flujo operativo de Fase 3 queda:

**Slice 0 foundation -> evidencia -> Slice 1 session/identity -> Slice 2 environment -> Slice 3 WIS client -> Slice 4 scope-aware loading -> Slice 5 control plane UI -> Slice 6 conflict/degraded UX -> Slice 7 handoff -> Slice 8 hardening/gate**
