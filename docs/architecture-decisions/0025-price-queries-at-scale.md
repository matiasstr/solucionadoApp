# ADR 0025 — Análisis del precio actual en la base y precio actual por índice

Estado: aceptado. Fecha: 2026-10-01. Contexto: validación final de P10-02 con un dataset mayor que el DEMO. Ajusta ADR 0016 (análisis), ADR 0017 (resumen) y ADR 0022 (alertas) sin cambiar sus reglas.

## Problema

La validación de P10-02 midió la API contra una base aparte con unas 259.000 observaciones:
- el seed DEMO;
- una importación simulada de 60 sucursales × 140 presentaciones × 30 días.

Aparecieron dos problemas que el seed chico no mostraba:

1. **Series sin historia en el resumen y en las alertas.** `CurrentPriceAnalysis` traía las observaciones de la ventana (38 días) con un tope de 50.000 filas para no cargar una zona entera en memoria. Para una persona en Caballito con 18 productos habituales, la ventana tenía 218.012 observaciones. Las series que quedaban después del tope se analizaban sin historia: "datos insuficientes", sin oportunidades ni avisos. Era un error silencioso de resultado, no solo de tiempo.
2. **Precio actual leyendo toda la historia.** `findCurrentByProducts` usaba `DISTINCT ON (productId, storeId)` sobre toda la historia de los productos pedidos y ordenaba cientos de miles de filas para quedarse con una por par. Lo usan el buscador, la comparación y los candidatos del planificador.

## Decisión

**Resumen de la ventana en SQL** (`ProductPriceRepository.findCurrentWithWindowStats`). Una sola consulta devuelve una fila por serie (producto + sucursal + fuente) con lo mismo que calculaba el dominio:
- el precio actual (última observación desde `now − (PRICE_MAX_AGE_DAYS + 1)` días; mismo desempate);
- el resumen de sus cierres diarios en los 30 días argentinos anteriores al día de ese precio:
  - días con dato y observaciones;
  - suma exacta (`numeric`);
  - mínimo con el día más reciente en que se vio;
  - máximo.

El cierre del día es la última observación (desempate: ingesta más reciente e id), con el día argentino en UTC−3 fijo, igual que `dailyCloses`.

**Una sola clasificación.** El dominio se partió en `summarizeCloses` (cierres → `WindowStats`) y `classifyCurrentPrice` (precio actual + `WindowStats` → `PriceAnalysis`). `analyzeSeries` (ficha e historial, P6-01) usa los dos pasos. `CurrentPriceAnalysis` (resumen y alertas) usa el resumen de SQL y la misma `classifyCurrentPrice`, así que no hay reglas duplicadas. Un test de integración (`price-analysis-sql.test.cjs`) compara las dos vías **serie por serie** con casos límite y todas las series del catálogo DEMO:
- varias observaciones el mismo día;
- empate de hora resuelto por ingesta;
- 01:00 UTC que todavía es el día anterior en Argentina;
- mínimo repetido;
- serie sin historia, precio viejo y menos de 7 días.

**Precio actual por índice cuando se conocen las sucursales.** `findCurrentByProducts` con `storeIds` recorre los pares producto × sucursal con `CROSS JOIN LATERAL (… ORDER BY observedAt DESC, precedencia, ingesta, fuente, id LIMIT 1)` sobre el índice `(productId, storeId, observedAt DESC)`. Mismo orden, mismo desempate y entradas sin repetidos. Sin sucursales ("todas") se mantiene la consulta anterior. Medido en el dataset de arriba: 7.277 filas idénticas, ~85 ms contra ~410 ms.

**Medición reproducible.** `apps/api/scripts/bench-api.cjs` mide en serie búsqueda, comparación, historial, generación de planes, listado y resumen contra una API local. El procedimiento (base aparte, importación simulada, limpieza) está en `docs/RUNBOOK.md`.

## Resultados (misma máquina y datos, p50 de 20 pedidos)

| Pedido | Antes | Después |
| --- | --- | --- |
| `GET /products?search=` cerca (5 km) | 95–104 ms | 29 ms |
| `GET /canonical-products/:id/prices` (5 km) | 128–136 ms | 59 ms |
| `POST /shopping-plans/generate` (18 productos) | 796–830 ms | 493 ms |
| `GET /dashboard` | 889 ms, **con series truncadas** | 295 ms, sin truncar |

El resto no cambió: búsqueda sin ubicación ~100 ms, historial ~12 ms, listado de planes ~8 ms. En la generación del plan, ~380 ms son la carga de candidatos y ~70 ms el optimizador con beneficios.

## Alternativas consideradas

- **Subir el tope de observaciones**: solo corre el límite; la memoria y el tiempo crecen con la zona.
- **Leer la ventana por partes**: sin pérdida, pero trae todas las filas a Node (más lento que el cálculo en la base).
- **Tabla de cierres diarios precalculados** al importar: sería lo más rápido, pero suma una migración, mantenimiento en el pipeline y otra fuente de verdad. Queda como siguiente paso si el resumen tiene que bajar de ~300 ms con más datos.
- **Calcular la clasificación completa en SQL**: duplicaría las reglas de ADR 0016. Solo se resumen los cierres; las reglas quedan en el dominio.

## Consecuencias

El resumen y las alertas analizan todas las series de la zona con el mismo criterio que la ficha, sin tope oculto. Los tiempos medidos son de una máquina de desarrollo con un dataset sintético. Sirven para comparar y para detectar regresiones; **no prueban escala de producción**: la mayor parte del costo es recorrer la ventana de 30 días de cada serie.
