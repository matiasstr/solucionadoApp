# ADR 0014 — Optimizador del plan: búsqueda exacta acotada y ahorro prudente

Estado: aceptado. Fecha: 2026-09-29. Contexto: P5-02. Implementa ADR 0004 sobre los candidatos de ADR 0013.

## Decisión

**El problema es elegir visitas.** Una visita es una sucursal en una fecha. Dado un conjunto de visitas, cada necesidad toma su opción más barata entre ellas (con desempate por presentación preferida, marca preferida, fecha más temprana e ids). Así el costo depende solo de qué visitas se hacen:

```text
costo efectivo = productos con promociones
               + storeVisitPenalty × visitas
               + distancePenaltyPerKm × km de ida y vuelta de cada visita
```

Ir a la misma sucursal dos días son dos visitas (dos penalidades y dos viajes) pero una sola sucursal para `maxStoresPerShoppingPlan`. La distancia es ida y vuelta en línea recta desde la ubicación del usuario por visita (PostGIS): no es una ruta. Sin coordenadas la distancia es desconocida, no cero: no suma penalidad y `totalDistanceKm` queda null con la limitación `DISTANCE_UNKNOWN`.

**Orden lexicográfico y determinista:** primero cubrir la mayor cantidad de necesidades, después el menor costo efectivo, menos visitas, menos km y, por último, las visitas en orden de id de sucursal y fecha. Importes internos en enteros de 1e-5 ARS (productos con dos decimales y km × $/km con cinco entran exactos). Cada componente se redondea a centavos una sola vez y `effectiveCost` es su suma, así cierra con el `CHECK` de `ShoppingPlan`.

**Búsqueda exacta acotada.**

1. Por sucursal se descartan las fechas **dominadas**: una fecha en la que ninguna necesidad sale más barata que en otra que se conserva (ante empate, se conserva la más temprana). Es exacto: cambiar una fecha dominada por la que la domina nunca empeora el costo.
2. Se cuentan las combinaciones: subconjuntos de hasta `min(maxStores, sucursales)` sucursales y, en cada una, subconjuntos no vacíos de sus fechas útiles. Si entran en `PLANNER_MAX_COMBINATIONS` (100.000 por defecto, unos 150 ms en el peor caso), se evalúan todas: `EXACT_BOUNDED`, óptimo **entre los candidatos acotados de P5-01**, nunca "el mejor del país".
3. Si no entran: una fecha por sucursal (la que más cubre y más barato) y todos los subconjuntos de sucursales; y si tampoco entran, se agregan sucursales de a una mientras mejoren. Las dos variantes son `HEURISTIC`, respetan el máximo de sucursales y lo informan con `SEARCH_BUDGET_EXCEEDED`.

El presupuesto es de **operaciones**, no de tiempo: un límite de tiempo haría que el mismo pedido dé resultados distintos según la carga del servidor.

**Base habitual prudente (ADR 0004).** Las **mismas** necesidades que cubre el plan, compradas en **una sola sucursal a precio regular** (sin promociones), en la sucursal donde esa canasta sale más barata. `estimatedSavings = base.productCost − plan.productCost`: solo dinero de productos, puede ser negativo si las penalidades llevaron a pagar más para ir menos. Se informa aparte la diferencia de costo efectivo, que no es dinero ahorrado. Si ninguna sucursal tiene todo lo del plan, no hay base (`NO_SINGLE_STORE_COVERS_PLAN`) y **no se muestra ahorro**. Elegir la sucursal más barata como base hace que el ahorro informado sea el menor defendible.

**Faltantes y plan parcial.** Las necesidades sin ofertas de P5-01 conservan su motivo; las que quedan afuera por el máximo de sucursales se informan como `MAX_STORES_LIMIT`. Un plan con faltantes es `PARTIAL` y su base se calcula solo sobre lo cubierto: nunca se compara una canasta parcial contra una completa.

**Explicable.** Cada línea trae códigos de motivo (`CHEAPEST_EVALUATED`, `CHEAPER_OPTION_NOT_WORTH_IT`, `EXACT_PRODUCT_REQUIRED`, `PREFERRED_PRODUCT`, `PROMOTION_APPLIED`), una frase en castellano y hasta dos alternativas con su diferencia. El resultado lleva `optimizerVersion`, el método, las combinaciones evaluadas y las fechas útiles por sucursal.

**Fuera de alcance, informado.** Promociones con mínimo de compra (`MINIMUM_SPEND_NOT_EVALUATED`) y con banco, medio de pago o membresía (`PAYMENT_PROMOTIONS_EXCLUDED`, P10-01) no se aplican. No se compran envases de más para activar una promoción por pares: con dinero como objetivo, llevar más nunca baja el total a pagar (en el mejor caso lo iguala).

## Alternativas consideradas

- **Programación lineal entera:** exacta y escalable, pero agrega una dependencia nativa y el tamaño acotado de P5-01 (≤ 8 sucursales, pocas fechas útiles) no la necesita.
- **Base en la sucursal más cercana o la "habitual":** no hay dato de sucursal habitual y la más cercana puede ser cara, lo que inflaría el ahorro.
- **Base con promociones:** mediría solo el ahorro por combinar sucursales y fechas; se prefirió la definición de ADR 0004 (precio regular) y se deja explícito en `baseline.method`.
- **Presupuesto por tiempo:** no determinista.

## Consecuencias

Los tests contrastan el optimizador con una enumeración exhaustiva independiente en 200 canastas aleatorias con semilla fija (incluidos máximos de sucursales, penalidades y distancias) y verifican que los importes cierren. P5-03 guarda `OptimizedPlan` y `PlanCandidates` como snapshot con `optimizerVersion`, y toma de acá `estimatedRegularCost` (base), `optimizedCost`, las penalidades y `baselineMethod`.
