# ADR 0023 — Beneficios de pago, elegibilidad y topes compartidos

Estado: aceptado. Fecha: 2026-09-30. Contexto: P10-01 (abre la fase 10). Extiende ADR 0009 (motor de promociones simples).

## Decisión

**Modelo.** La migración `20261001120000_payment_benefits` agrega a `Promotion`:
- `discountAmount`: monto fijo, solo `BANK_DISCOUNT` y en lugar del porcentaje (`CHECK`: uno solo).
- `benefitTiming`: `IMMEDIATE` en caja o `REFUND`, reintegro posterior que solo puede ser un beneficio de pago.
- `refundDelayDays`: de 1 a 180, solo en un reintegro y solo si la fuente lo informa.
- `capGroup`: promociones que comparten un mismo tope, por ejemplo el mensual de un banco. Exige tope y el importador lo prefija con la fuente.

Banco, medio de pago, membresía, días, compra mínima, tope y período ya existían (P2-03). El importador y el seed DEMO aceptan los campos nuevos. Promociones viejas siguen válidas (inmediatas, sin grupo) y los planes guardados no se recalculan.

**Preferencias declaradas, tres estados.** La elegibilidad se decide con lo que la persona declaró en su perfil (`paymentMethods`, `banks`, `membershipPrograms`): **elegible**, **no elegible** (declaró y no coincide: banco incorrecto, medio no elegible) o **desconocido** (no declaró esa condición). Desconocido nunca es beneficio confirmado: queda **condicionado**, se muestra con el importe posible y no se suma. Bancos y membresías se comparan sin mayúsculas, tildes ni espacios. Nunca se pide número de tarjeta, CVV ni credenciales.

**Motor por compra** (`promotions/domain/benefit-engine.ts`, función pura). Evalúa compras completas en orden cronológico:
1. **Promociones del producto**: una por línea, la que más conviene (ADR 0009). Ahora también con condición de banco o membresía y con topes de período.
2. **Un beneficio de pago por compra**, porque se paga con un solo medio. Va sobre la base elegible: las líneas de su alcance, con el precio que quedó después del paso 1.
3. **Compra mínima** sobre esa base; porcentaje o monto fijo (nunca más que la base); tope.
4. **Redondeo** HALF_UP a centavos, una vez por importe.

Ante igual importe gana el descuento en caja frente al reintegro (se paga menos hoy) y después el id más chico. Por compra devuelve:
- lo que se paga hoy (`payToday`), el reintegro estimado (`refundEstimated`, con su plazo) y el costo después del reintegro;
- cada promoción considerada con su estado (`APPLIED`, `NOT_CHOSEN`, `CONDITIONAL`, `NOT_ELIGIBLE`), el motivo y el estado del tope.

`conditionalAmount` es el beneficio **extra** posible si se confirmara lo que falta. Por línea y por compra cuenta el mejor, no la suma: son alternativas.

**Acumulación explícita.** Un beneficio de pago se acumula con la promoción de una línea solo si **las dos** se declaran acumulables (`isStackable`). Si no, esa línea queda fuera de la base del pago ("no acumulable con otras promociones", que es lo que hace la caja). Promociones del producto entre sí no se acumulan.

**Topes compartidos.** Un libro de topes por clave: el grupo o la promoción sola. También por período:
- `PURCHASE`: la compra entera, no cada ítem. Esto corrige el tope por línea que tenía el cálculo anterior para una promoción que abarca varios productos.
- `WEEK`: semana ISO del día argentino.
- `MONTH`: mes del día argentino.
- `CAMPAIGN`: toda la campaña.

Lo usado se consume en orden entre ítems, compras y promociones del mismo grupo. Lo usado **fuera de la app** se informa con `PUT /benefit-usage/:promotionId` (tabla `BenefitCapUsage`, por persona, clave y período). Sin ese dato el saldo es desconocido y el beneficio queda condicionado. Con el tope agotado, `CAP_EXHAUSTED`. Nunca se promete un reintegro completo sin saber el saldo.

**API.** `POST /benefits/evaluate` (privado) evalúa una canasta de hasta 10 compras y 100 líneas. Usa:
- los precios actuales de cada sucursal (con fuente y frescura; los productos sin precio quedan en `missingPrices`);
- las promociones vigentes ese día (al mediodía argentino);
- las preferencias y los topes informados de la persona.

No guarda nada. `GET/PUT/DELETE /benefit-usage` administra lo informado; borrar vuelve a "desconocido". `GET /promotions` informa `discountAmount`, `benefit` (momento y plazo), `stackable` y `conditions.capGroup`.

**Lo que no cambia todavía.** `priceLine` (buscador y planificador) sigue aplicando solo lo verificable sin preferencias. Integrar el motor por compra en el optimizador, el comparador y las pantallas es P10-02.

## Alternativas consideradas

- **Preferencias vacías como "todos los medios"**: mostraría ahorros que la mayoría no tiene (lo prohíbe `docs/DOMAIN.md`).
- **Elegir por línea entre promoción del producto y descuento bancario**: más ahorro teórico, pero no es lo que pasa en la caja cuando el banco dice "no acumulable".
- **Sumar todos los condicionados**: dos descuentos bancarios no se usan a la vez; sumarlos infla el "podrías ahorrar" (se detectó en los tests).
- **Tope mensual sin dato de consumo como disponible completo**: prometería un reintegro que puede no existir.
- **Guardar datos de la tarjeta para validar el banco**: innecesario y riesgoso; alcanza con lo declarado.

## Consecuencias

El motor explica, para cada compra, qué beneficio aplica, cuál depende de algo que la persona no informó y cuál no corresponde y por qué, con un cálculo reproducible. P10-02 lo usa en el plan (canastas por visita, topes entre visitas de la semana) y en la interfaz (pagar hoy, reintegro, costo final). Una fuente real de promociones bancarias sigue pendiente: el contrato de importación ya acepta los campos.
