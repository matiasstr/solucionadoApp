# ADR 0016 — Historial y análisis de precios

Estado: aceptado. Fecha: 2026-09-29. Contexto: P6-01. Se apoya en ADR 0002 (dinero y calendario) y 0008 (precio actual, frescura, append-only).

## Decisión

**Serie = producto × sucursal × fuente.** `GET /products/:id/price-history` devuelve una serie por cada par sucursal/fuente con observaciones. Nunca se promedian sucursales ni fuentes: un precio de Coto no es evidencia del de Jumbo, y dos fuentes pueden medir distinto. Unidad comparable: `unitPrice` en la unidad base del producto (KG, L o UNIT), además del precio del envase.

**Cierre diario en calendario argentino.** Cada serie tiene un punto por día de `America/Argentina/Buenos_Aires` (UTC−3 fijo, sin horario de verano desde 2009): la **última** observación del día (desempate: ingesta más reciente, id). Así un importador que reporta diez veces al día no pesa diez veces más que uno diario. Los días sin dato no se rellenan ni se interpolan; `observations` dice cuántas lecturas hubo ese día.

**Análisis del precio actual contra los 30 días anteriores.** El precio actual es la última observación de la serie (aunque quede fuera del rango pedido). La base son los cierres de los 30 días **anteriores** a su día: el día actual no entra, porque una base que incluye al precio actual nunca permite que esté por debajo de su propio mínimo. Promedio de cierres (cada día pesa igual) con seis decimales, mínimo (con el día más reciente en que se vio), máximo y `actual / promedio`. El análisis no depende del rango que se muestra.

**Clasificación con precedencia estable:**

| Orden | Condición | Etiqueta |
| --- | --- | --- |
| 1 | No hay observaciones | `INSUFFICIENT_DATA` |
| 2 | El precio actual tiene más de `PRICE_MAX_AGE_DAYS` días | `STALE` |
| 3 | Menos de 7 días con dato en la base | `INSUFFICIENT_DATA` |
| 4 | Actual **menor** que el mínimo de la base | `HISTORIC_LOW` |
| 5 | Actual `< 0,85 ×` promedio | `GOOD_DEAL` |
| 6 | Actual `> 1,15 ×` promedio | `EXPENSIVE` |
| 7 | Resto | `NORMAL` |

Las comparaciones son exactas con `DecimalValue` (`actual` contra `promedio × umbral` sin redondear). Igualar el mínimo no es un mínimo nuevo. "Mínimo histórico" significa **mínimo de la ventana disponible** (`baseWindow` dice cuál y cuántos días tuvo dato), no de toda la historia.

**Límites.** Rango de 1 a 366 días (por defecto los últimos 30, hoy incluido), hasta 20 series por respuesta (las observadas más recientemente; `truncated` lo avisa) y 50.000 observaciones por consulta (más es `400` pidiendo acotar). Una sucursal (`storeId`) **o** una ubicación, no las dos. Público, igual que los precios actuales.

**Solo precio de góndola.** `ProductPrice` es el precio regular observado; las promociones (condicionales o por cantidad) no se mezclan en la serie ni en el análisis.

## Alternativas consideradas

- **Promedio por observación:** sesgado por la frecuencia de cada fuente.
- **Base que incluye el día actual:** hace imposible detectar un mínimo nuevo sin una regla extra.
- **Promediar sucursales de una cadena:** oculta diferencias reales entre sucursales.
- **Interpolar días faltantes:** inventa observaciones que no existen.

## Consecuencias

La etiqueta es reproducible con un reloj fijo y se explica con los datos de la respuesta (base, promedio, mínimo, umbrales en `policy`). Con fuentes reales (fase 7) habrá que decidir si alguna fuente merece prioridad en la vista; hoy cada una es su propia serie. El gráfico y el dashboard (P6-02) consumen este contrato.
