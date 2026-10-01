# ADR 0024 — Beneficios de pago en el plan: canastas por visita

Estado: aceptado. Fecha: 2026-10-01. Contexto: P10-02. Extiende ADR 0014 (optimizador) y ADR 0015 (planes guardados) con el motor de ADR 0023.

## Decisión

**Una visita es una compra.** El optimizador de P5-02 elegía visitas y cada necesidad tomaba su línea más barata. Eso deja de alcanzar con beneficios de pago:
- un descuento bancario, una compra mínima o un tope dependen del total de la compra;
- un tope semanal o mensual se comparte entre visitas;
- un beneficio no acumulable saca de la base las líneas con promoción.

Desde P10-02 cada visita (sucursal + fecha) se cobra con `evaluateBenefits` (ADR 0023) usando las promociones vigentes de la ventana, las preferencias declaradas de la persona (`paymentMethods`, `banks`, `membershipPrograms`) y lo informado en `BenefitCapUsage`. El costo de un plan es:

```text
costo efectivo después del reintegro = Σ costAfterRefund de cada compra
                                     + storeVisitPenalty × visitas + distancePenaltyPerKm × km
```

Solo cuenta lo **aplicado** (elegible y con saldo de tope conocido). Lo condicionado se informa (`conditionalAmount`, `benefitNotes`) y nunca se suma.

**Cuándo hace falta buscar canastas** (`shopping-plans/domain/plan-benefits.ts`). Una regla cambia el costo respecto de la suma de líneas solo si el motor podría aplicarla a esta persona y `priceLine` no: condición de pago o membresía elegible, compra mínima o tope.
- Si no hay ninguna (`basketSearch: NOT_NEEDED`), el plan de P5-02 queda igual; el motor solo agrega las notas de lo condicionado.
- Si hay, se evalúan **asignaciones completas** (cada necesidad → oferta y fecha, o ninguna, respetando el máximo de sucursales).
  - **`EXHAUSTIVE`** cuando todas entran en `PLANNER_MAX_BASKET_EVALUATIONS` (2.000 por defecto, 1 a 50.000): óptimo entre los candidatos acotados, `method: EXACT_BOUNDED`.
  - Si no, **`LOCAL_SEARCH`** determinista, `method: HEURISTIC` con la limitación `BASKET_BENEFITS_APPROXIMATED`. Fechas agrupadas por igual oferta y mismos beneficios (con su período de tope), conjuntos de visitas con asignación golosa por la tasa de pago de cada visita y mejoras de a una necesidad sobre las cuatro mejores canastas. El plan por líneas de P5-02 siempre se evalúa primero, así el resultado **nunca es peor** que ignorar los beneficios.
- El presupuesto es de evaluaciones del motor, no de tiempo: el mismo pedido da el mismo plan.

El orden sigue siendo lexicográfico: cobertura, costo efectivo después del reintegro, visitas, km, visitas en orden y elecciones.

**Importes.**
- `productCost`: líneas con la promoción del producto que eligió el motor.
- `paymentDiscount`: descuentos de pago en caja.
- `payToday = productCost − paymentDiscount`: lo que se paga en las cajas.
- `refundEstimated`: reintegros posteriores, con su plazo; `costAfterRefund = payToday − refundEstimated`.
- `effectiveCost = payToday + penalidades`; `effectiveCostAfterRefund = costAfterRefund + penalidades` decide la recomendación.
- `estimatedSavings = base − payToday`: **nunca incluye reintegros** (un reintegro llega después y puede no llegar).

Las columnas de `ShoppingPlan` guardan `optimizedCost = payToday`, así siguen cerrando los `CHECK` `effectiveCost = optimizedCost + penalidades` y `estimatedSavings = estimatedRegularCost − optimizedCost`, sin migración.

**Explicación.** Cada visita trae `payment` (beneficio aplicado con `conditions` completas: banco, medio, membresía, días, mínimo, tope y período, momento y plazo, acumulable) y `benefitNotes` (condicionados, no elegibles con motivo, no elegidos). El plan trae `benefits` (lo declarado, los topes tocados con lo informado y lo usado en el plan, `criteria` en castellano y `basketSearch`). Una línea más cara que otra opción del plan elegida por la canasta lleva `BASKET_BENEFIT_CHOICE`. Limitaciones nuevas: `REFUND_PENDING`, `BENEFITS_CONDITIONAL`, `BASKET_BENEFITS_APPROXIMATED`.

**Snapshots.** `schemaVersion: 2` en entradas, resultado y líneas, y `OPTIMIZER_VERSION` `planner-2026-10-01.1`. La API lee las versiones 1 y 2. Un plan de versión 1 se muestra como se emitió (`payToday = productCost`, sin reintegro, `benefits: null`, `refundEstimated: null` en el resumen); no se recalcula.

## Alternativas consideradas

- **Aplicar el descuento bancario a cada línea por separado**: ignora la compra mínima, el tope por compra y la exclusividad de un solo pago por compra; es lo que P5-02 marcaba como `PAYMENT_PROMOTIONS_EXCLUDED`.
- **Contar el reintegro como ahorro**: muestra dinero que no se tiene en la caja y que depende del banco; se muestra aparte.
- **Elegir por `payToday` en lugar del costo después del reintegro**: descartaría reintegros confirmados que sí bajan el costo. Se decide por el costo final y se muestra lo que se paga hoy con `REFUND_PENDING`.
- **Programación entera / solver externo**: exacto en más casos, pero suma una dependencia nativa y tiempos menos predecibles. Con los candidatos acotados de ADR 0013 la enumeración y la búsqueda local alcanzan; queda abierto si crecen los límites.
- **Agregar una columna `payToday` a `ShoppingPlan`**: no hace falta; `optimizedCost` pasa a significar lo pagado en caja, que sin pagos es lo mismo que antes.

## Consecuencias

El plan compara escenarios equivalentes (misma canasta, mismas preferencias, mismos topes) y explica qué beneficio usa, cuál depende de un dato que falta y por qué otro no corresponde. Los tests contrastan la búsqueda exhaustiva con una enumeración independiente en 150 canastas chicas con topes, y el método aproximado contra el óptimo y el plan por líneas. Con más sucursales o fechas candidatas el plan puede ser aproximado: está identificado en `method`, `basketSearch` y las limitaciones.
