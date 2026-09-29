# ADR 0018 — Importadores: contratos, identidad por fuente y lotes con backpressure

Estado: aceptado. Fecha: 2026-09-29. Contexto: P7-01. Se apoya en ADR 0001 (límites de dominio), 0002 (dinero y unidades) y 0008 (normalizador, identidad idempotente, historia append-only). Conectar SEPA u otra fuente real **no** es parte de esta decisión: requiere verificar su contrato y condiciones en un paso explícito.

## Decisión

**Contratos propios.** `PriceProvider` y `PromotionProvider` (`apps/api/src/modules/imports/application/ports.ts`) entregan registros **crudos** como `AsyncIterable`, con texto tal como viene de la fuente (`"1.234,56"`, `"gr"`, `"2026-09-28"`) y un separador decimal declarado. No dependen de SEPA ni de Prisma: un proveedor nuevo implementa esa interfaz y el importador y el dominio no cambian. `PriceImporter` y `PromotionImporter` orquestan; `PrismaImportGateway` es la única pieza que conoce la base.

**Normalización pura y estricta** (`domain/import-normalizer.ts`): decimales con el separador declarado (con coma decimal el punto solo agrupa miles de a tres; `1.23` es ambiguo y se rechaza), GTIN-8/12/13/14 con dígito de control (uno inválido se descarta y se informa, no se guarda), alias de unidades y de venta por peso, instantes ISO con zona o días sin hora al mediodía argentino, coordenadas en rango. El precio final lo decide `normalizePrice` de fase 2 (sin redondeos silenciosos). Lo que no se puede interpretar con certeza se **rechaza con motivo** (`PRICE_INVALID`, `UNIT_UNKNOWN`, `OBSERVED_IN_FUTURE`, …) y la importación sigue.

**Identidad por fuente, nunca por nombre.** Dos tablas nuevas (migración `20260929180000_external_identity_refs`): `ExternalProductRef` y `ExternalStoreRef`, únicas por `(fuente, id externo)`. Resolución en este orden:

1. Vínculo ya guardado. Si la fuente cambió el contenido o la modalidad de un producto ya vinculado, se rechaza (`CONTENT_CHANGED`): otro contenido es otro producto (docs/DOMAIN.md).
2. EAN válido de un producto existente: se vincula si coincide la presentación (modalidad y contenido en unidad base); si no, colisión de identidad (`EAN_CONTENT_MISMATCH`), sin fusionar.
3. Si no hay ninguno, se crea con un id estable (UUID v5 de tipo + fuente + id externo) y se guarda el vínculo. El genérico se vincula solo con nombre normalizado **exacto** y misma dimensión; si no, el producto queda **pendiente de revisión** (`canonicalProductId` null, contado en el resumen). La categoría se busca por slug; si no existe, va a "Sin clasificar". La cadena se identifica por nombre exacto (es única).

**Precios idempotentes, historia intacta.** La clave es la de fase 2 (`buildIdempotencyKey`: id de la observación en la fuente o producto + sucursal + día). `ProductPriceRepository.recordBatch` inserta con `INSERT … ON CONFLICT DO NOTHING RETURNING`, así sabe exactamente qué insertó; lo demás se compara con lo guardado: igual = `duplicate`, distinto = `conflict` (nunca se sobrescribe). Se guardan fuente, fecha observada, fecha de ingesta (la de la base) e `importBatchId` = id de la ejecución.

**Lotes con backpressure** (`domain/batching.ts`): la resolución de identidades corre en serie (sin carreras al crear), la persistencia con hasta `concurrency` lotes en vuelo, y el próximo registro se pide al proveedor solo cuando hay lugar: en memoria nunca hay más que `lote × (concurrencia + 1)` registros. Un error deja de leer, espera los lotes en vuelo y termina en `FAILED` con lo confirmado contado; el lote incompleto no se escribe a medias. Reintentar es seguro porque todo es idempotente.

**Archivos.** `JsonLinesPriceProvider` lee JSON Lines (opcionalmente `.gz`) por trozos del stream, sin `readline` ni leer el archivo entero, con máximo por línea (una más larga es ilegible) y máximo total descomprimido (protege contra bombas de compresión). Importes y cantidades deben venir como texto: un número JSON ya perdió su formato.

**Promociones.** Solo se vinculan con sucursales, cadenas y productos que ya existen (nunca los crean); la regla se valida con el dominio de promociones y el reingreso actualiza la misma fila (id estable por fuente + id externo; se respeta la unicidad `(source, externalId)`).

**Comando manual.** `npm.cmd run import -- --provider=mock|jsonl …` imprime el resumen (leídos, creados, repetidos, conflictos, rechazados por motivo, muestras, sucursales y productos creados, pendientes de genérico, EAN descartados) y sale con código 1 si falló. Igual que el seed: no corre en producción ni contra una base remota sin `IMPORT_ALLOW_REMOTE=true`. Tamaño de lote (1–10.000) y concurrencia (1–16) por opción.

## Alternativas consideradas

- **Columnas `externalId` en `Product` y `Store`:** una sola fuente por fila; con varias fuentes hacen falta tablas de vínculo.
- **Fusionar por nombre normalizado:** "Arroz Pampa 1 kg" y "Arroz Pampa 1kg x10" se parecen y no son lo mismo.
- **`createMany` con `skipDuplicates` y contar:** no dice qué filas insertó, así que no permite distinguir un reingreso idéntico de un conflicto.
- **`readline` para archivos:** su iterador puede acumular líneas si el consumidor va más lento que el disco.

## Consecuencias

Agregar una fuente es implementar un proveedor y declarar su nombre. Los productos pendientes de genérico no participan en planes hasta que alguien los vincule (paso de revisión futuro). P7-02 agrega ejecuciones persistidas, cuarentena, reintentos y la documentación del contrato para terceros; la descarga desde endpoints permitidos (nunca una URL arbitraria) llega con la primera fuente real.
