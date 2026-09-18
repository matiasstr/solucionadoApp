# ADR 0004 — Costo efectivo y ahorro honesto

Estado: aceptado para fase 5; todavía no implementado.

## Contexto

Minimizar solo el precio puede producir demasiados viajes. El ejemplo conceptual del pedido no define dimensiones ni cómo separar penalizaciones de dinero pagado.

## Decisión

`effectiveCost = optimizedCost + storeVisitPenaltyArs * storeVisitCount + distancePenaltyArsPerKm * estimatedTravelKm`.

`optimizedCost` ya incluye descuentos elegibles: no descontarlos otra vez. Contar visitas por sucursal/fecha; estimar ida y vuelta desde origen por visita, sin prometer ruteo real. Penalizaciones son preferencias monetizadas; no son combustible ni importes cobrados.

Comparar las mismas necesidades y cantidades de envases en baseline y plan. Baseline inicial: canasta elegible en una sola sucursal si existe cobertura completa; documentar otro método si no existe. `estimatedSavings = estimatedRegularCost - optimizedCost`. Conservar baseline/método/observaciones usados y no inflar ahorro con penalizaciones, faltantes o planes regenerados.

Las recomendaciones consideran vigencia en fecha de compra, cantidad y condiciones de promoción. Sin banco confirmado no aplicar descuentos bancarios. Inventario se resta una sola vez al agregar necesidades por canónico. Generar un plan no consume inventario.

Buscar exactamente entre candidatos acotados. Si se supera el presupuesto computacional, usar fallback determinista identificado como aproximado, sin llamarlo mínimo global. Desempate estable por costo, visitas, distancia e ID. Distinguir faltantes y distancia desconocida. `maxStores=null` significa sin límite preferido del usuario, no sin límite computacional.

## Consecuencias

El dashboard muestra ahorro **estimado**; ahorro confirmado exige registrar compras reales en una evolución posterior. Los tests incluyen una segunda tienda cuyo ahorro no compensa la visita y casos de cobertura incompleta, paquetes, promociones y restricciones incompatibles.
