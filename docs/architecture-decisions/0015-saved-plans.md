# ADR 0015 — Planes guardados: snapshot, idempotencia y estados

Estado: aceptado. Fecha: 2026-09-29. Contexto: P5-03 (cierra la fase 5). Guarda el resultado de ADR 0013 y 0014.

## Decisión

**Snapshot, no referencias vivas.** `POST /shopping-plans/generate` calcula el plan con `PlanShoppingUseCase` y lo guarda en una sola escritura (`ShoppingPlan` + `ShoppingPlanItem`, creación anidada de Prisma dentro de una transacción). Columnas: fechas, `optimizedCost` (productos), penalidades, `effectiveCost`, `totalDistanceKm`, `optimizerVersion` y `baselineMethod`. Tres JSON versionados (`schemaVersion: 1`, armados por `toPlanRecord`, función pura):

- `inputSnapshot`: ventana, ubicación, límites, penalidades, necesidades con su origen (rutinas, ocurrencias, despensa restada) y un **resumen** de candidatos (ofertas y descartes contados por motivo). No se guardan todas las ofertas con sus fechas: pesarían cientos de KB por plan y lo que se muestra ya viaja en las líneas.
- `resultSnapshot` (columna nueva): cobertura, búsqueda, totales, base, ahorro, visitas, limitaciones y lo cubierto por la despensa.
- `snapshot` de cada línea: nombres, presentación, compra, precio observado (id, fecha, fuente), promoción, motivos y alternativas.

La respuesta se arma **solo** con columnas y snapshots: un precio nuevo, una rutina editada o un producto renombrado no cambian un plan emitido. Al leer se valida `schemaVersion`; una versión desconocida es un error, no una interpretación a ciegas.

**Sin base, ahorro cero guardado y nulo en la API.** Los `CHECK` exigen `estimatedSavings = estimatedRegularCost − optimizedCost`. Sin base comparable se guarda `estimatedRegularCost = optimizedCost` (ahorro 0) con `baselineMethod = 'NONE'`, y la API responde `estimatedSavings: null` y `savings: null`: la pantalla no muestra un ahorro que no se pudo medir.

**Idempotencia por cabecera.** `Idempotency-Key` es obligatoria (8 a 80 caracteres seguros) y se guarda en `ShoppingPlan.idempotencyKey` con unicidad `(userId, idempotencyKey)` y un `CHECK` de formato (migración `20260929120000_shopping_plan_generation`). Antes de calcular se busca la clave; si existe, se devuelve ese plan con `200`. Dos pedidos simultáneos compiten en el `INSERT`: el perdedor recibe `P2002`, relee y devuelve el del ganador. La misma clave con otras fechas explícitas es `409 IDEMPOTENCY_KEY_REUSED`. La web genera una clave por intento y la **reutiliza** solo si el error fue de conexión (la respuesta pudo perderse con el plan ya guardado).

**Estados explícitos.** `DRAFT → ACTIVE | COMPLETED`, `ACTIVE → COMPLETED`; repetir el estado actual es un no-op (reintentos seguros, `completedAt` no cambia). Activar un plan devuelve a `DRAFT` cualquier otro `ACTIVE` del usuario cuya ventana se superponga, en la misma transacción: un solo plan activo por período, así el dashboard de P6-02 no cuenta dos veces el mismo ahorro. `EXPIRED` no se persiste: un borrador o activo cuya `endDate` pasó se **informa** vencido (calendario argentino) y no admite cambios. Persistir el vencimiento es trabajo de los jobs (fase 8). Completar no prueba una compra ni un ahorro real.

**Web.** `/plan-semanal` (privada, en la barra): generar, cronograma por día y sucursal, totales separados (productos, ahorro estimado con su base, visitas, km, costo de conveniencia aparte), faltantes con motivo y enlace a Preferencias, lo cubierto por la despensa, avisos, "cómo calculamos" y planes anteriores. El plan elegido vive en `?plan=<id>`; sin parámetro se muestra el último, así recargar da el mismo resultado.

## Alternativas consideradas

- **Deduplicar por huella de entradas** (mismo usuario, ventana e insumos en los últimos minutos): evita la cabecera, pero un usuario que regenera a propósito sin cambios recibiría el plan viejo y la huella depende de la hora de cálculo.
- **Guardar todas las ofertas candidatas:** trazabilidad total a costa de mucho espacio por plan; el resumen por motivo alcanza para explicar y las líneas guardan lo elegido con sus alternativas.
- **Persistir `EXPIRED` al leer:** una lectura con escritura sorprende y compite con otros pedidos; se deja para un job.

## Consecuencias

Reintentar la generación es seguro. Un plan pasado se lee siempre igual. El listado no pagina por cursor (devuelve los últimos N, hasta 50); no hay borrado de planes ni límite por usuario: si el volumen crece, retención y rate limit por usuario van con la operación de la fase 8.
