# ADR 0019 — Ejecuciones de importación, cuarentena y recuperación

Estado: aceptado. Fecha: 2026-09-29. Contexto: P7-02 (cierra la fase 7). Extiende ADR 0018.

## Decisión

**Ejecuciones persistidas.** Tabla `ImportRun` (migración `20260929220000_import_runs_quarantine`): tipo, fuente, estado (`RUNNING`, `COMPLETED`, `COMPLETED_WITH_REJECTIONS`, `FAILED`), inicio y fin, contadores (leídos, creados, repetidos, conflictos, actualizados, rechazados, sucursales y productos creados, pendientes de genérico, EAN descartados, lotes, reintentos), posición confirmada, ejecución que reanuda y error saneado (sin credenciales ni contenido). `CHECK`: contadores no negativos y `finishedAt` presente si y solo si terminó. Los precios guardan `importBatchId` = id de la ejecución. La ejecución se crea al empezar y sus contadores se actualizan después de cada lote confirmado: si el proceso muere, queda `RUNNING` con lo confirmado a la vista.

**Cuarentena mínima.** `QuarantinedRecord`: ejecución, posición en el flujo, motivo, detalle saneado e identificador externo. **Nunca** el registro completo: puede traer datos que no corresponde guardar y no hace falta para diagnosticar (la fuente y la posición permiten encontrarlo). Se escribe por tandas: después de cada lote y cada 500 rechazos seguidos, así una racha de basura no se acumula en memoria. `--report=<id>` muestra la ejecución, los rechazos por motivo y los primeros 20.

**Un fallo parcial no es un éxito.** Con rechazos o conflictos el estado es `COMPLETED_WITH_REJECTIONS`; con error, `FAILED`.

**Reintentos limitados.** Un lote que falla se reintenta hasta `retries` veces (2 por defecto, máximo 5) con espera creciente. Es seguro porque escribir un lote es idempotente y cada lote de precios es **un solo `INSERT`** (lote máximo 1.000), así un reintento nunca encuentra un lote a medio escribir. En promociones se reintenta cada escritura, salvo una regla inválida, que no mejora reintentando.

**Reanudación honesta.** Los lotes pueden terminar en desorden (concurrencia); `CommitWatermark` guarda la última posición hasta la que **todo** quedó resuelto (escrito o en cuarentena), sin huecos. Una ejecución `FAILED` se reanuda desde ahí (`--resume=<id>`), creando otra ejecución enlazada, **solo** si el proveedor declara `replayable` (misma secuencia en cada lectura: archivo local, generador con semilla). Una descarga no lo declara: se reimporta completa y los repetidos no se duplican. No se afirma reanudación donde no es posible.

**Descargas acotadas.** `JsonLinesPriceProvider` acepta una URL solo de un host de `IMPORT_ALLOWED_HOSTS`, por HTTPS (HTTP solo en la máquina local), sin credenciales en la URL, **sin seguir redirecciones** (podrían llevar a otro host), con tiempo máximo y con el tope de tamaño descomprimido; el host se valida al crear el proveedor, antes de cualquier pedido. No hay endpoint HTTP de importación: ningún usuario puede pedir que el servidor descargue una URL.

**Documentación para proveedores**: [docs/IMPORTS.md](../IMPORTS.md) (licencias y contrato a verificar, esquema JSON Lines, identidad, límites, pasos).

## Alternativas consideradas

- **Guardar el registro completo en cuarentena:** más cómodo para depurar, pero copia datos de terceros sin necesidad; posición + fuente alcanzan para ubicarlo.
- **Reanudar siempre desde la última posición leída:** con lotes en paralelo puede saltear un lote que falló en el medio.
- **Reintentos ilimitados o por tiempo:** esconden una falla real y dejan la ejecución colgada.
- **Seguir redirecciones del mismo host:** un redireccionamiento abierto del servidor de la fuente llevaría a cualquier lado.

## Consecuencias

Una importación se audita después (qué entró, qué no y por qué) sin volver a leer el archivo. Los jobs de la fase 8 pueden programar `PriceImporter` con este mismo registro y usar `RUNNING` sin fin para detectar procesos caídos. La primera fuente real (SEPA u otra) queda para un paso explícito con su ADR de licencia y contrato.
