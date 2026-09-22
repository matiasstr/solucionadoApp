# ADR 0009 — Motor de promociones simples

Estado: aceptado. Fecha: 2026-09-21. Contexto: P2-03 (promociones simples antes del optimizador).

## Decisión

**Calculador puro.** `priceLine(línea, reglas, contexto)` (`apps/api/src/modules/promotions/domain/promotion-calculator.ts`) es una función sin Prisma ni Nest: recibe precio unitario, cantidad y modalidad de venta, y devuelve el total, el ahorro y **la evaluación de cada regla considerada**, aplique o no. El planificador de fase 5 reutiliza esta función tal cual.

**Una sola promoción por línea.** Se elige la que más le conviene al comprador; ante igual ahorro gana el id más chico, así el resultado no depende del orden de entrada. `isStackable` no habilita acumulación: hasta definir compatibilidades explícitas, acumular sería inventar un beneficio.

**Semántica de los cuatro tipos.** `PERCENTAGE` descuenta sobre las unidades elegibles; `SECOND_UNIT` descuenta una unidad por cada par completo (tres unidades tienen un solo par); `TWO_FOR_ONE` cobra `cantidad - floor(cantidad / 2)`; `FIXED_PRICE` fija el precio por unidad de venta al alcanzar `requiredQuantity`. Las promociones por pares exigen unidades enteras del mismo producto, así que **no aplican a venta por peso**. Un envasado con cantidad fraccionaria es un error de entrada, no un caso a redondear.

**Lo que no se puede comprobar no se aplica**, pero se informa con su motivo (`skipReason`):

| Motivo | Cuándo |
| --- | --- |
| `PAYMENT_CONDITIONED` | `BANK_DISCOUNT`, o cualquier regla atada a banco o medio de pago (P10-01) |
| `MEMBERSHIP_CONDITIONED` | Requiere una membresía que el sistema no conoce |
| `MINIMUM_SPEND_UNKNOWN` / `MINIMUM_SPEND_NOT_REACHED` | Hay mínimo de compra y no se informó el subtotal, o no alcanza |
| `CAP_PERIOD_UNSUPPORTED` | El tope abarca semana, mes o campaña: haría falta el beneficio ya usado |
| `NO_SAVINGS` | El cálculo no mejora el precio regular (incluye un precio fijo más caro) |
| `WEEKDAY_NOT_ELIGIBLE`, `NOT_STARTED`, `EXPIRED`, `SCOPE_*`, `SALE_MODE_UNSUPPORTED`, `QUANTITY_*` | Vigencia, calendario, alcance, modalidad o cantidad |

Solo el tope `PURCHASE` se aplica, limitando el descuento a `discountCap`.

**Calendario argentino.** La vigencia es `[validFrom, validUntil)` sobre instantes UTC, pero `eligibleWeekdays` se resuelve en `America/Argentina/Buenos_Aires` con `Intl.DateTimeFormat`: un domingo a las 21:00 en Argentina es lunes en UTC y vale el día argentino. Lista vacía significa todos los días.

**Reglas incompletas rechazadas.** `validatePromotionRule` repite en la aplicación los CHECK de la tabla `Promotion` (un solo alcance comercial, como máximo un alcance de producto, campos coherentes con el tipo, porcentaje en `(0,100]`, tope y período juntos, días ISO sin repetir) y nombra el campo culpable. La base sigue siendo la última barrera, pero el error que llega a la API es accionable.

**Redondeo una sola vez.** El total de la línea se redondea a dos decimales al final (HALF_UP) y el ahorro se calcula como `regular redondeado - total redondeado`, así ambos siempre cierran.

**`GET /promotions` informa, no promete.** Lista por defecto solo lo vigente ahora; `includeInactive=true` y `activeAt` permiten ver el resto. Cada promoción viaja con `automatic`, que distingue las que el sistema puede calcular solo de las que dependen del usuario o de compras previas. Aplicar promociones a una canasta es trabajo del planificador (fase 5), no de este endpoint.

## Alternativas consideradas

- **Acumular promociones compatibles:** sin una tabla de compatibilidades declarada, cualquier combinación sería una suposición.
- **Aplicar `BANK_DISCOUNT` asumiendo el medio de pago más común:** mostraría un ahorro que la mayoría no obtiene.
- **Precio fijo por grupos** (`floor(cantidad / requiredQuantity)` unidades al precio fijo y el resto regular): es otra semántica posible; se eligió "al alcanzar el mínimo, todas las unidades", que es la forma habitual en Argentina, y queda documentada acá para poder cambiarla con evidencia.
- **Ocultar las promociones que no se aplican:** el usuario perdería la explicación de por qué no le corresponden.

## Consecuencias

El optimizador de fase 5 recibe costos deterministas y explicables sin recalcular reglas. Agregar un tipo nuevo exige tocar `computeOutcome` y sus tests, no el resto del sistema. Las promociones bancarias quedan modeladas y visibles desde hoy, y P10-01 solo tendrá que habilitar su cálculo cuando existan las preferencias del usuario. Un mínimo de compra solo se evalúa cuando el llamador puede informar el subtotal elegible de esa sucursal, lo que empuja la decisión al nivel donde existe la canasta.
