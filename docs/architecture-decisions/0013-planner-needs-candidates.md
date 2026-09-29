# ADR 0013 — Necesidades y candidatos del planificador

Estado: aceptado. Fecha: 2026-09-29. Contexto: P5-01 (entrada del optimizador de P5-02).

## Decisión

**Dos funciones puras y un caso de uso.** `buildNeeds` y `buildCandidates` (`apps/api/src/modules/shopping-plans/domain/`) no conocen Prisma, Nest, el reloj ni la configuración: reciben todo por parámetro y el orden de la entrada no cambia la salida. `BuildPlanCandidatesUseCase` carga los datos del usuario (con el filtro de dueño en cada consulta, ADR 0011), las compone y devuelve `PlanCandidates` con `schemaVersion: 1`. No hay endpoint todavía: `POST /shopping-plans/generate` llega con P5-03, que guardará este resultado como snapshot.

**Ventana y calendario.** Fechas `AAAA-MM-DD` en `America/Argentina/Buenos_Aires`, ambos extremos incluidos. Por defecto, siete días desde hoy en Argentina. Un horizonte mayor que `PLANNER_MAX_HORIZON_DAYS` (28) se rechaza con 400: no se devuelve otro período sin avisar. Las ocurrencias son `anchorDate + k × frequencyDays` con `k ≥ 0`: antes del ancla la rutina no empezó. La aritmética usa números de día enteros, así 15 días no son "dos semanas".

**La ventana es un período de compra.** Un plan no programa cada ocurrencia por separado: la necesidad es la suma de las ocurrencias de la ventana y cualquier día evaluado sirve para comprarla. `firstOccurrence` queda en la salida por si P5-02 decide exigir comprar antes de la primera. Es la opción más simple que coincide con "armar la compra de la semana".

**Consolidación y despensa.** Los ítems del mismo canónico se suman **antes** de mirar la despensa, que se resta una sola vez: `neta = max(0, bruta − saldo)`. Se registra cuánto se restó y la antigüedad del saldo. Si la unidad del ítem o del saldo no coincide con la del canónico (P4-01 lo impide, pero el canónico puede cambiar después), el ítem se omite con `UNIT_MISMATCH` o el saldo no se resta y se avisa: nunca se convierte masa en volumen.

**Restricciones combinadas.** Entre ítems del mismo canónico, lo que restringe se suma (marcas excluidas, "sin reemplazos") y lo que prefiere se conserva si no choca con una restricción: una marca excluida por un ítem y preferida por otro queda excluida. Dos presentaciones exactas distintas no se pueden cumplir con una sola compra: la necesidad queda `CONFLICT` y se informa, sin elegir por el usuario.

**Candidatos honestos.**

- Entra una presentación de la misma dimensión, activa, de una marca no excluida y, si algún ítem no acepta reemplazos, solo la exacta. Una preferida desactivada deja la necesidad sin resolver (`PREFERRED_PRODUCT_UNAVAILABLE`) si no hay reemplazos, y se informa como `PRODUCT_INACTIVE` si los hay.
- El precio es la última observación de la sucursal y viaja como `LATEST_OBSERVATION` con id, fecha, fuente y antigüedad: es una estimación, no un precio futuro. Un precio viejo (`PRICE_MAX_AGE_DAYS`) **se descarta** con su antigüedad: no prueba que el producto siga disponible. Si es lo único que hay, la necesidad queda `ONLY_STALE_PRICES`.
- Se compran envases enteros con `planPurchase` (excedente visible) y la venta por peso marca `quantityIsEstimate`.
- Cada fecha evaluada se cobra con `priceLine` al **mediodía argentino** (15:00 UTC; Argentina no usa horario de verano desde 2009): vigencia y día de la semana se deciden ahí. Solo se listan las promociones que alcanzan a esa oferta; la bancaria figura como `PAYMENT_CONDITIONED` y el mínimo de compra como `MINIMUM_SPEND_UNKNOWN` (la canasta por sucursal existe recién en P5-02). Con la cantidad necesaria no se fuerza un segundo envase para activar un 2×1: explorar cantidades extra es trabajo del optimizador.

**Ubicación.** Con coordenadas, el radio es `maxTravelDistanceKm` medido con PostGIS y hay distancias. Con solo localidad, se usan las sucursales de esa ciudad sin radio ni distancia y se avisa `LOCATION_APPROXIMATE`. Sin ubicación **no se eligen sucursales** (`NO_LOCATION` + `LOCATION_MISSING`): un plan con comercios de cualquier lugar del país no se puede cumplir.

**Recorte determinista y visible** (límites por entorno):

| Variable | Defecto | Qué limita |
| --- | --- | --- |
| `PLANNER_MAX_HORIZON_DAYS` | 28 | Días de un plan (más es 400) |
| `PLANNER_MAX_CANDIDATE_DATES` | 7 | Fechas de compra evaluadas: las primeras de la ventana |
| `PLANNER_MAX_CANDIDATE_STORES` | 8 | Sucursales que llegan al optimizador |
| `PLANNER_MAX_OFFERS_PER_STORE` | 2 | Ofertas más baratas por necesidad y sucursal, más la preferida |

Las sucursales se ordenan por cantidad de necesidades que cubren, luego por la suma de la oferta más barata de cada necesidad cubierta, luego por distancia (sin distancia al final) y por id. Comparar importes solo entre igual cobertura evita premiar a la que parece barata porque vende menos. Dentro de cada sucursal quedan las N ofertas más baratas y, además, la presentación preferida aunque cueste más: la preferencia no está en la función de costo (ADR 0004), así que la decide el optimizador y no el recorte. Cada descarte queda con su motivo (`STORE_LIMIT`, `OFFER_LIMIT`, `PRICE_STALE`, …) y una necesidad que solo tenía ofertas en sucursales recortadas queda `ONLY_IN_TRIMMED_STORES`.

## Alternativas consideradas

- **Usar los precios viejos marcándolos:** el optimizador podría elegir un precio de hace dos semanas como si siguiera vigente. Descartarlo con motivo es más honesto y la pantalla puede explicar por qué falta.
- **Sin ubicación, usar todas las sucursales:** con un catálogo real serían cientos de sucursales de todo el país.
- **Separar las necesidades por grupo de restricciones:** obligaría a repartir la despensa entre grupos. La intersección de restricciones resuelve el caso común (una rutina exige Pampa, otra acepta cualquiera: comprar Pampa cumple las dos) y solo el choque real se informa.
- **Garantizar la sucursal más barata de cada necesidad en el recorte:** podría superar el límite de sucursales; el orden por cobertura y costo es predecible y el descarte queda registrado.

## Consecuencias

P5-02 recibe candidatos acotados, con costos por fecha ya calculados y deterministas, y puede enumerar subconjuntos de sucursales sin volver a la base. Cambiar un límite es configuración. Las necesidades sin ofertas no desaparecen: llegan al plan como faltantes con su motivo, y un plan parcial no se compara contra una canasta completa (ADR 0004).
