# API de Tus Ofertas

Formato estable de las respuestas públicas de lectura (catálogo, precios, promociones y comercios) y de la API privada de rutinas, despensa, planes de compra, alertas, avisos y beneficios de pago. Los contratos TypeScript están en [`packages/shared/src/index.ts`](../packages/shared/src/index.ts); acá se documentan parámetros, límites y forma de la respuesta. Autenticación y perfil están en el [README](../README.md#api-de-autenticación-y-perfil).

Todos los ejemplos salieron del dataset **DEMO** (`npm.cmd run db:seed`): los precios son ficticios y no representan ofertas reales de esas cadenas.

## Convenciones

- Prefijo `/api`. Catálogo, precios, comercios y promociones son públicos: no requieren sesión. Rutinas, despensa y planes sí (ver [Rutinas y despensa](#rutinas-y-despensa-privadas) y [Planes de compra](#planes-de-compra-privados)).
- **Decimales como texto** (`"1314.51"`), nunca `number`: el redondeo binario cambiaría importes (ADR 0002). Los importes van con 2 decimales y los precios por unidad base con 6.
- **Fechas ISO 8601 en UTC** (`"2026-09-21T12:00:00.000Z"`). El calendario comercial (días de promoción) se interpreta en `America/Argentina/Buenos_Aires`.
- **Errores**: `{ statusCode, error, message, fields? }`. `fields` nombra propiedades, nunca valores. Un identificador mal formado devuelve `400`, no `404`.
- **Parámetros desconocidos o fuera de rango fallan con `400`** en vez de ignorarse en silencio.
- No se exponen entidades Prisma ni campos internos (`normalizedName`, `isActive`, `idempotencyKey`).

### Paginación

Por cursor sobre un orden estable, no por número de página: insertar filas no saltea ni repite resultados.

```json
{ "items": [], "page": { "limit": 20, "nextCursor": "WyJhcnJveiAuLi4iLCI0M2Q4Il0" } }
```

`nextCursor` es opaco (base64url) y es `null` cuando no hay más resultados. Se devuelve tal cual en el parámetro `cursor`. La búsqueda por cercanía ordena por distancia, que no es un keyset, así que **rechaza `cursor`** en lugar de devolver resultados repetidos.

### Límites

| Parámetro | Límite |
| --- | --- |
| `limit` | 1 a 50 (20 por defecto) |
| `search` | 2 a 120 caracteres |
| `radiusKm` | 0,1 a 100; exige `latitude` y `longitude` |
| Sucursales evaluadas por consulta | 200 |
| Ofertas de una comparación | 50 |

### Ubicación y distancia

Tres alcances posibles, informados en `scope.origin`:

| `origin` | Cuándo | `distanceMeters` |
| --- | --- | --- |
| `COORDINATES` | `latitude` + `longitude` (+ `radiusKm` opcional, 5 km por defecto) | Distancia en línea recta, calculada con PostGIS |
| `LOCALITY` | `city` + `province` | `null`: sin coordenadas no se afirma distancia |
| `ALL` | Sin filtros de ubicación | `null` |

`latitude` y `longitude` se envían juntas; un radio sin coordenadas es `400`. Ordenar por distancia sin coordenadas también es `400`: es preferible el error a un orden inventado.

### Precios y frescura

Todo precio viaja con su procedencia:

```json
{
  "price": "1314.51",
  "currency": "ARS",
  "unitPrice": "1314.510000",
  "unitPriceUnit": "KG",
  "unitPricePer100g": "131.451000",
  "source": "demo-seed",
  "freshness": { "observedAt": "2026-09-21T12:00:00.000Z", "ageDays": 1, "maxAgeDays": 7, "isStale": false }
}
```

- `price` es el precio del paquete completo o de la base de cotización (venta por peso).
- `unitPrice` es el precio por unidad base (`KG`, `L` o `UNIT`) y es lo que hace comparables dos presentaciones. `unitPricePer100g` solo existe para masa.
- Pasados `maxAgeDays` (configurable, 7 por defecto) la observación se marca `isStale` pero **se sigue mostrando con su fecha**. `includeStale=false` la excluye.

## Catálogo

### `GET /products`

| Parámetro | Descripción |
| --- | --- |
| `search` | Texto libre. Si son 8 a 14 dígitos se busca como **EAN exacto**; si no, por nombre y marca sin tildes ni puntuación |
| `categoryId`, `canonicalProductId`, `brand` | Filtros de catálogo |
| `chainId` | Solo productos con precio observado en esa cadena |
| `city` + `province`, o `latitude` + `longitude` + `radiusKm` | Solo productos con precio observado en esas sucursales |
| `limit`, `cursor` | Paginación |

```json
{
  "items": [
    {
      "id": "43d81156-cc59-59ed-985d-bb4b1a13b4ca",
      "ean": "2900000000018",
      "name": "Arroz largo fino Pampa 1 kg (DEMO)",
      "brand": "Pampa",
      "categoryId": "43554ec0-071e-51da-8bf5-0c437f205922",
      "canonicalProductId": "368bf812-cebb-50e4-a02a-bd87fa564fa4",
      "quantity": "1",
      "unit": "KG",
      "saleMode": "PACKAGED",
      "packageCount": 1,
      "bestOffer": {
        "store": { "chainName": "Vea", "name": "Vea Flores (DEMO)", "distanceMeters": null },
        "price": "1212.78",
        "currency": "ARS",
        "unitPrice": "1212.780000",
        "unitPriceUnit": "KG",
        "unitPricePer100g": "121.278000",
        "source": "demo-seed",
        "freshness": { "observedAt": "2026-09-22T12:00:00.000Z", "ageDays": 0, "maxAgeDays": 7, "isStale": false },
        "promotion": null,
        "paymentBenefits": []
      }
    }
  ],
  "page": { "limit": 20, "nextCursor": null },
  "scope": { "origin": "ALL", "radiusKm": null, "storesConsidered": null }
}
```

`bestOffer` es la oferta **más barata por unidad base** dentro del alcance consultado, con la misma forma que las ofertas de la comparación (incluidas `promotion` y `paymentBenefits`). Es `null` cuando el producto no tiene precio observado en esas sucursales: el listado lo dice en vez de mostrar un precio de otra zona. El orden de la página sigue siendo alfabético (la paginación es por cursor); para ordenar por precio se compara un canónico.

`quantity` es el contenido total: un pack de 6 × 2,25 L tiene `quantity: "13.5"`, `unit: "L"` y `packageCount: 6`; no se multiplica de nuevo. Para `saleMode: "VARIABLE_WEIGHT"`, `quantity` es la base de cotización (1 KG).

Un `search` que se queda sin contenido al normalizar (por ejemplo `--`) devuelve **cero resultados**, no el catálogo entero.

### `GET /products/:id`

Devuelve el producto con `category` y `canonicalProduct` (o `null` si todavía no está agrupado). `404` si no existe o está inactivo.

### `GET /canonical-products` y `GET /canonical-products/:id`

Lista de necesidades equivalentes (`search`, `categoryId`, `limit`, `cursor`) y su ficha, que incluye `category` y `products`: las alternativas aceptables. Pertenecer al mismo canónico no las hace idénticas; todas comparten unidad base.

## Precios

### `GET /products/:id/prices`

Precio actual de **una** presentación en cada sucursal alcanzada.

| Parámetro | Descripción |
| --- | --- |
| `latitude` + `longitude` + `radiusKm`, o `city` + `province` | Alcance (ver arriba) |
| `includeStale` | `false` excluye los precios desactualizados; por defecto se muestran marcados |
| `sortBy` | `UNIT_PRICE` (por defecto), `PRICE` o `DISTANCE` |

```json
{
  "product": { "id": "43d81156-…", "name": "Arroz largo fino Pampa 1 kg (DEMO)", "quantity": "1", "unit": "KG" },
  "scope": { "origin": "COORDINATES", "radiusKm": 5, "distancesAvailable": true, "storesConsidered": 3, "maxAgeDays": 7, "includeStale": true },
  "sortBy": "UNIT_PRICE",
  "prices": [
    {
      "store": { "id": "331b0ba2-…", "chainName": "Vea", "name": "Vea Flores (DEMO)", "city": "Ciudad Autónoma de Buenos Aires", "distanceMeters": 2372.74540579 },
      "price": "1267.57",
      "currency": "ARS",
      "unitPrice": "1267.570000",
      "unitPriceUnit": "KG",
      "unitPricePer100g": "126.757000",
      "source": "demo-seed",
      "freshness": { "observedAt": "2026-09-21T12:00:00.000Z", "ageDays": 0, "maxAgeDays": 7, "isStale": false }
    }
  ]
}
```

Una fila por sucursal: la observación más reciente, con desempate determinista por fuente, ingesta e id (ADR 0008).

### `GET /products/:id/price-history`

Historial y análisis del precio de **una presentación** (P6-01, [ADR 0016](architecture-decisions/0016-price-history-analysis.md)). Público.

| Parámetro | Regla |
| --- | --- |
| `from`, `to` | Días argentinos `AAAA-MM-DD`, ambos incluidos. Por defecto, los últimos 30 días con hoy incluido. Hasta 366 días; `from` posterior a `to` o un día inexistente es `400` |
| `storeId` | Una sola sucursal. No se combina con ubicación (`400` en `storeId`) |
| `latitude` + `longitude` (+ `radiusKm`), o `city` + `province` | Mismo alcance que los precios actuales. Sin nada: todas las sucursales con historial |

Respuesta:

```json
{
  "product": { "id": "…", "name": "Pollo entero fresco por kg (DEMO)", "…": "…" },
  "range": { "from": "2026-08-31", "to": "2026-09-29", "days": 30, "timeZone": "America/Argentina/Buenos_Aires", "granularity": "DAY" },
  "scope": { "origin": "STORE", "radiusKm": null, "storesConsidered": 1 },
  "policy": { "dailyClose": "LAST_OBSERVATION_OF_DAY", "windowDays": 30, "minDaysWithData": 7, "goodDealBelowRatio": "0.85", "expensiveAboveRatio": "1.15", "maxAgeDays": 7 },
  "series": [
    {
      "store": { "id": "…", "name": "Coto Caballito (DEMO)", "chainName": "Coto", "distanceMeters": null, "…": "…" },
      "source": "demo-seed",
      "unitPriceUnit": "KG",
      "daysInRange": 30,
      "daysWithData": 29,
      "points": [
        "…",
        { "date": "2026-09-28", "price": "3459.86", "unitPrice": "3459.860000", "observedAt": "2026-09-28T12:00:00.000Z", "observations": 1 }
      ],
      "analysis": {
        "classification": "NORMAL",
        "current": { "price": "3459.86", "unitPrice": "3459.860000", "observedAt": "2026-09-28T12:00:00.000Z", "date": "2026-09-28", "ageDays": 1, "isStale": false },
        "baseWindow": { "from": "2026-08-29", "to": "2026-09-27", "days": 30, "daysWithData": 30, "observations": 30 },
        "average": "3310.864667",
        "lowest": "3174.950000",
        "lowestDate": "2026-08-31",
        "highest": "3459.860000",
        "ratioToAverage": "1.0450"
      }
    }
  ],
  "seriesLimit": 20,
  "truncated": false
}
```

- **Una serie por sucursal y fuente**: nunca se mezclan sucursales ni fuentes. Hasta 20 series (las observadas más recientemente); `truncated` avisa si quedaron afuera.
- **Un punto por día argentino**: la última observación del día; `observations` cuenta las del día. Los días sin dato no aparecen: no se interpolan.
- **Análisis** del precio actual de la serie (su última observación, aunque sea anterior a `to`) contra los cierres diarios de los **30 días anteriores** a su día (`baseWindow`); el día actual no entra en la base, así se puede detectar un mínimo nuevo. Promedio por día (cada día pesa igual), mínimo con su fecha, máximo y `ratioToAverage`. No depende del rango pedido.
- **Clasificación**, en este orden: sin precio → `INSUFFICIENT_DATA`; precio de más de `maxAgeDays` días → `STALE`; menos de 7 días con dato en la base → `INSUFFICIENT_DATA`; por debajo del mínimo de la base → `HISTORIC_LOW` (igualarlo no alcanza); por debajo del 85 % del promedio → `GOOD_DEAL`; por encima del 115 % → `EXPENSIVE`; si no, `NORMAL`. Las comparaciones son exactas (sin redondear el umbral).
- Son precios de góndola observados: las promociones condicionales o por cantidad no entran en la serie.

### `GET /canonical-products/:id/prices`

La comparación: **todas las presentaciones** de una necesidad, en cada sucursal alcanzada, comparables por unidad base.

| Parámetro | Descripción |
| --- | --- |
| `productId` | Producto por el que se llegó: sus ofertas son `matchType: "EXACT"`, el resto `"ALTERNATIVE"` |
| `sortBy` | `UNIT_PRICE` (por defecto), `PRICE` o `DISTANCE` |
| `includeStale`, alcance por ubicación | Igual que arriba |
| `limit` | Hasta 50 ofertas |

El orden por envase (`PRICE`) y por unidad base (`UNIT_PRICE`) **puede diferir**: el paquete de 500 g cuesta menos que el de 1 kg y es más caro por kilo. Esa es la comparación que le importa a quien compra.

```json
{
  "canonicalProduct": { "id": "368bf812-…", "name": "Arroz largo fino", "defaultUnit": "KG" },
  "scope": { "origin": "COORDINATES", "radiusKm": 10, "distancesAvailable": true, "storesConsidered": 6, "maxAgeDays": 7, "includeStale": true },
  "sortBy": "UNIT_PRICE",
  "offers": [
    {
      "product": { "name": "Arroz largo fino Pampa 1 kg (DEMO)", "quantity": "1", "unit": "KG" },
      "matchType": "EXACT",
      "store": { "name": "Carrefour Almagro (DEMO)", "distanceMeters": 2483.44564505 },
      "price": "1314.51",
      "unitPrice": "1314.510000",
      "unitPricePer100g": "131.451000",
      "source": "demo-seed",
      "freshness": { "observedAt": "2026-09-21T12:00:00.000Z", "ageDays": 1, "maxAgeDays": 7, "isStale": false },
      "promotion": {
        "id": "503f73b4-…",
        "name": "Arroz Pampa 1 kg con 20% de descuento (DEMO)",
        "type": "PERCENTAGE",
        "minimumQuantity": 1,
        "regularTotal": "1314.51",
        "total": "1051.61",
        "discount": "262.90",
        "promotionalUnitPrice": "1051.610000",
        "eligibleWeekdays": [],
        "terms": null
      },
      "paymentBenefits": [
        {
          "id": "…",
          "name": "25% con tarjeta de crédito del Banco Demo (DEMO)",
          "availableToday": true,
          "conditions": {
            "type": "BANK_DISCOUNT",
            "discountPercentage": "25.00",
            "discountAmount": null,
            "paymentMethod": "CREDIT_CARD",
            "bank": "Banco Demo",
            "membershipProgram": null,
            "eligibleWeekdays": [],
            "minimumSpend": null,
            "discountCap": "5000.00",
            "capPeriod": "PURCHASE",
            "timing": "IMMEDIATE",
            "refundDelayDays": null,
            "stackable": false
          },
          "terms": "Tope de $5.000 por compra. Condiciones ficticias."
        }
      ]
    }
  ]
}
```

Sobre `promotion`:

- Es `null` cuando ninguna promoción **automática** alcanza a esa oferta. Las que dependen del banco, del medio de pago, de una membresía o de compras anteriores nunca se aplican solas: se consultan en `GET /promotions`.
- `minimumQuantity` son las unidades que hay que llevar (2 en un 2×1 o en una segunda unidad con descuento). `regularTotal`, `total` y `discount` corresponden a esa cantidad.
- `price` y `unitPrice` siguen siendo el precio **sin** promoción: la comparación no se pierde.
- El orden usa el precio regular; el beneficio se muestra al lado porque depende de cuántas unidades se compren.

Sobre `paymentBenefits` (P10-02):

- Son los beneficios **que dependen de cómo paga la persona** (banco, medio de pago o membresía) vigentes en esa sucursal para ese producto: los del día primero (`availableToday`) y después por id. Si no valen hoy, `conditions.eligibleWeekdays` dice cuándo.
- **No cambian `price`, `unitPrice` ni el orden**: la comparación sigue siendo entre precios equivalentes. Si un beneficio corresponde, y cuánto, depende de la canasta entera (mínimo, tope, un solo pago por compra); eso lo calcula el plan por compra con lo declarado (ver "Planes de compra") o `POST /benefits/evaluate`.
- `conditions` trae todas las condiciones de la regla (las mismas que `payment` y `benefitNotes` en el plan): porcentaje o monto, medio, banco, membresía, días, compra mínima, tope y período, en caja o reintegro con plazo, y si se acumula.
- El endpoint es público: no sabe qué medios tiene quien consulta, así que nunca dice "te corresponde".

## Comercios

### `GET /stores` y `GET /stores/:id`

Filtros: `search` (nombre o cadena), `chainId`, `city`, `province`, y `latitude` + `longitude` + `radiusKm` para buscar por cercanía. Con coordenadas ordena por distancia y no admite `cursor`; sin coordenadas pagina alfabéticamente.

```json
{
  "id": "331b0ba2-…",
  "chainId": "ae0001f6-…",
  "chainName": "Vea",
  "name": "Vea Morón (DEMO)",
  "address": "Av. Rivadavia 18000",
  "city": "Morón",
  "province": "Buenos Aires",
  "latitude": null,
  "longitude": null,
  "distanceMeters": null
}
```

Una sucursal sin coordenadas se devuelve igual, con `latitude`, `longitude` y `distanceMeters` en `null`: existe y se puede listar por localidad, pero no se puede afirmar a qué distancia está.

## Promociones

### `GET /promotions` y `GET /promotions/:id`

Filtros: `storeId`, `chainId`, `productId`, `canonicalProductId`, `type`, `activeAt` (ISO), `includeInactive`, `limit`, `cursor`. Por defecto lista **solo lo vigente ahora**, ordenado por lo que vence antes.

```json
{
  "id": "503f73b4-…",
  "name": "Arroz Pampa 1 kg con 20% de descuento (DEMO)",
  "type": "PERCENTAGE",
  "scope": { "storeId": "716a1ca4-…", "chainId": null, "productId": "43d81156-…", "canonicalProductId": null },
  "discountPercentage": "20.00",
  "fixedPrice": null,
  "requiredQuantity": null,
  "discountAmount": null,
  "benefit": { "timing": "IMMEDIATE", "refundDelayDays": null },
  "stackable": false,
  "conditions": {
    "paymentMethod": null, "bank": null, "membershipProgram": null,
    "minimumSpend": null, "discountCap": null, "capPeriod": null, "capGroup": null, "eligibleWeekdays": []
  },
  "automatic": true,
  "terms": null,
  "source": "demo-seed",
  "validFrom": "2026-09-18T12:00:00.000Z",
  "validUntil": "2026-09-26T12:00:00.000Z"
}
```

- El alcance comercial es **una sucursal o una cadena**, nunca las dos; el de producto es como máximo uno, y sin ninguno la promoción cubre todo el comercio.
- La vigencia es `[validFrom, validUntil)`: el último instante no está incluido.
- `automatic: false` significa que el sistema **no** puede calcularla solo (banco, medio de pago, membresía o tope que abarca varias compras). Se informa para que la persona decida, no para prometer un ahorro.
- `eligibleWeekdays` usa ISO 1 = lunes … 7 = domingo y se interpreta en hora argentina; vacío significa todos los días.

- P10-01: `discountAmount` es el monto fijo de un `BANK_DISCOUNT` (en lugar del porcentaje); `benefit.timing` dice si el beneficio es en caja (`IMMEDIATE`) o un reintegro posterior (`REFUND`, con `refundDelayDays` si la fuente lo informa); `stackable` si se acumula con otra promoción acumulable; `conditions.capGroup` agrupa promociones que comparten el tope.

Tipos: `PERCENTAGE`, `SECOND_UNIT`, `TWO_FOR_ONE`, `FIXED_PRICE` y `BANK_DISCOUNT`. La semántica exacta de cada uno está en [ADR 0009](architecture-decisions/0009-promotion-engine.md). El buscador y el plan todavía aplican solo lo que no depende de la persona; los beneficios de pago con sus preferencias y topes se evalúan con `POST /benefits/evaluate` ([ADR 0023](architecture-decisions/0023-payment-benefits-engine.md)).

## Beneficios de pago (privados)

Requieren sesión; `Cache-Control: no-store`. Decisiones en [ADR 0023](architecture-decisions/0023-payment-benefits-engine.md).

| Método y ruta | Cuerpo | Resultado |
| --- | --- | --- |
| `POST /benefits/evaluate` | `{ purchases: [{ storeId, date, lines: [{ productId, quantity }] }] }`: hasta 10 compras y 100 líneas | `200` con la evaluación; no guarda nada |
| `GET /benefit-usage` | — | `200 { items: [{ capKey, periodKey, consumed, updatedAt }] }`: lo informado por la persona |
| `PUT /benefit-usage/:promotionId` | `{ consumed, date? }` | `200` con `capKey`, `periodKey`, `limit` y `remaining`. Lo ya usado de ese tope **fuera de la app** en el período que contiene `date` (hoy por defecto). Un tope por compra no se arrastra: `400 CAP_NOT_TRACKABLE` |
| `DELETE /benefit-usage/:promotionId?date=` | — | `204`; el saldo vuelve a ser desconocido |

**Evaluación.** Cada compra se cobra con los precios actuales de la sucursal (`lines[].priceSource`, `observedAt`, `isStale`). Los productos sin precio quedan en `missingPrices`, no se inventan. Usa las promociones vigentes ese día (mediodía argentino) y las preferencias de pago del perfil (`paymentMethods`, `banks`, `membershipPrograms`). El orden:
1. Una promoción del producto por línea.
2. Un beneficio de pago por compra, sobre las líneas de su alcance. Una línea con promoción queda afuera salvo que las dos sean acumulables (`stackable`).
3. Compra mínima, porcentaje o monto, tope.
4. Redondeo.

Errores: `400 STORE_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `QUANTITY_INVALID` (envasados en unidades enteras), `DATE_INVALID`, `TOO_MANY_LINES`.

- `result.purchases[]`: `regularTotal`, `productDiscount`, `paymentDiscount` (en caja), **`payToday`** (lo que se paga), **`refundEstimated`** (reintegro posterior, con `payment.refundDelayDays`) y `costAfterRefund`.
- `result.evaluations[]`: cada promoción considerada, con `layer` (`PRODUCT`/`PAYMENT`), `status` y `reason`:
  - `APPLIED`;
  - `NOT_CHOSEN` (`BETTER_PROMOTION`, `ONE_PAYMENT_BENEFIT_PER_PURCHASE`);
  - `CONDITIONAL`: depende de algo no informado (`BANK_NOT_DECLARED`, `PAYMENT_METHOD_NOT_DECLARED`, `MEMBERSHIP_NOT_DECLARED`, `CAP_REMAINING_UNKNOWN`). Trae el importe posible, que **no** se suma;
  - `NOT_ELIGIBLE`: `BANK_NOT_ELIGIBLE`, `PAYMENT_METHOD_NOT_ELIGIBLE`, `WEEKDAY_NOT_ELIGIBLE`, `EXPIRED`, `MINIMUM_SPEND_NOT_REACHED`, `NOT_STACKABLE`, `CAP_EXHAUSTED`, `NO_SAVINGS`, ….

  También trae el estado del tope (`limit`, `consumedOutside`, `usedBefore`, `remaining`).
- `result.totals.conditionalAmount`: beneficio extra posible si se confirmara lo que falta. Por compra cuenta el mejor, no la suma.
- `result.caps[]`: cada tope usado, con su período (`2026-W40`, `2026-10`, `CAMPAIGN` o la compra) y cuánto se usó en esta evaluación.

Ejemplo real (DEMO, miércoles; débito y Banco Demo y Billetera Demo declarados; $2.000 del tope mensual informados). Un 2x1 de fideos (no acumulable), el reintegro de Coto sobre el resto y $1.500 en Jumbo:

```json
{
  "totals": { "regularTotal": "41911.88", "productDiscount": "1443.08", "paymentDiscount": "1500.00", "payToday": "38968.80", "refundEstimated": "5734.45", "costAfterRefund": "33234.35", "conditionalAmount": "0.00" },
  "purchases": [
    { "purchaseId": "compra-1", "payToday": "20557.92", "refundEstimated": "5734.45", "costAfterRefund": "14823.47",
      "payment": { "name": "Reintegro del 30% con débito del Banco Demo los miércoles (DEMO)", "timing": "REFUND", "refundDelayDays": 30, "base": "19114.84", "amount": "5734.45" } },
    { "purchaseId": "compra-2", "payToday": "18410.88", "refundEstimated": "0.00",
      "payment": { "name": "$1.500 de descuento pagando con Billetera Demo (DEMO)", "timing": "IMMEDIATE", "refundDelayDays": null, "base": "19910.88", "amount": "1500.00" } }
  ]
}
```

Sin preferencias declaradas, esos dos beneficios aparecen `CONDITIONAL` (`BANK_NOT_DECLARED`). Con las preferencias pero sin informar el consumo del tope mensual, el reintegro queda `CAP_REMAINING_UNKNOWN`.


## Rutinas y despensa (privadas)

Requieren `Authorization: Bearer <accessToken>` (sin token: `401`) y responden con `Cache-Control: no-store`. **Solo ven lo del usuario del token**: una rutina, un ítem o una fila de despensa ajena responde `404` con el mismo cuerpo que una inexistente. Un ítem se identifica por rutina **y** por id: un ítem propio bajo la URL de una rutina ajena también es `404`. Enviar `userId`, `routineId` o cualquier campo no documentado es `400`. Decisiones en [ADR 0011](architecture-decisions/0011-routines-inventory-ownership.md).

**Cantidades**: texto decimal (`"500"`, `"1.5"`) con cualquier unidad de la dimensión del canónico (`KG`/`G`, `L`/`ML`, `UNIT`). Se guardan y se devuelven en la unidad del canónico: `{"quantity": "500", "unit": "G"}` para arroz vuelve como `{"quantity": "0.5", "unit": "KG"}`. Otra dimensión es `400 UNIT_DIMENSION_MISMATCH`; más de 4 decimales en la unidad del canónico es `400 QUANTITY_INVALID`. Cantidad y unidad se envían siempre juntas.

**Frecuencia**: `frequencyDays` de 1 a 365 (semanal = 7, cada 15 días = 15; un mes no se aproxima a 30) y `anchorDate` como fecha de calendario `AAAA-MM-DD`, que debe existir.

| Método y ruta | Cuerpo | Resultado |
| --- | --- | --- |
| `GET /shopping-routines` | — | `200 { items: RoutineDto[] }`, por fecha de alta |
| `POST /shopping-routines` | `{ name, frequencyDays?, anchorDate? }` | `201 RoutineDto`. Por defecto 7 días y ancla hoy en hora argentina. `409 ROUTINE_LIMIT` (20 por usuario) |
| `GET /shopping-routines/:id` | — | `200 RoutineDto` con sus ítems |
| `PATCH /shopping-routines/:id` | `{ name?, frequencyDays?, anchorDate? }` | `200 RoutineDto`; los ítems que heredan ven el cambio |
| `DELETE /shopping-routines/:id` | — | `204`; borra sus ítems. La despensa no cambia |
| `POST /shopping-routines/:id/items` | ver abajo | `201 RoutineItemDto`; `409 ROUTINE_ITEM_DUPLICATE` si el canónico ya está; `409 ROUTINE_ITEM_LIMIT` (100) |
| `PATCH /shopping-routines/:id/items/:itemId` | los mismos campos salvo `canonicalProductId` | `200 RoutineItemDto` |
| `DELETE /shopping-routines/:id/items/:itemId` | — | `204` |
| `GET /inventory` | — | `200 { items: InventoryItemDto[] }`, por nombre del canónico |
| `POST /inventory` | `{ canonicalProductId, quantity, unit }` | `201 InventoryItemDto`; `409 INVENTORY_DUPLICATE` si ya hay fila para ese canónico |
| `PATCH /inventory/:id` | `{ quantity, unit }` | `200 InventoryItemDto`; actualiza `updatedAt` |
| `DELETE /inventory/:id` | — | `204` |

Campos de un ítem:

| Campo | Regla |
| --- | --- |
| `canonicalProductId` | Obligatorio al crear; no se cambia después (borrar y volver a agregar). Inexistente: `400 CANONICAL_NOT_FOUND` |
| `quantity` + `unit` | Necesidad **por ocurrencia**, mayor que cero |
| `preferredProductId` | Opcional; `null` lo quita. Debe ser una presentación activa del mismo canónico: si no, `400 PREFERRED_PRODUCT_INVALID` |
| `allowSubstitutes` | `true` por defecto. En `false` exige preferido: `400 PREFERRED_PRODUCT_REQUIRED` |
| `frequencyDays` + `anchorDate` | Opcionales y **juntos**. Omitidos o ambos `null`: hereda de la rutina. Solo uno: `400 SCHEDULE_OVERRIDE_INCOMPLETE` |
| `preferredBrands`, `excludedBrands` | Hasta 20 cada una; se recortan y se deduplican sin distinguir mayúsculas ni tildes. Una marca en ambas: `400 BRANDS_OVERLAP` |

En un PATCH las reglas se evalúan sobre el resultado: no se puede quitar el preferido de un ítem sin sustitutos, ni preferir una marca que ya está excluida.

```json
{
  "id": "…",
  "routineId": "…",
  "canonicalProduct": { "id": "…", "name": "Arroz largo fino", "defaultUnit": "KG" },
  "preferredProduct": { "id": "…", "name": "Arroz largo fino Pampa 1 kg", "brand": "Pampa", "quantity": "1", "unit": "KG" },
  "quantity": "0.5",
  "unit": "KG",
  "schedule": { "frequencyDays": 7, "anchorDate": "2026-09-21", "inherited": true },
  "allowSubstitutes": false,
  "preferredBrands": ["Pampa"],
  "excludedBrands": ["Del Sur"],
  "createdAt": "2026-09-23T15:04:05.000Z",
  "updatedAt": "2026-09-23T15:04:05.000Z"
}
```

`schedule` es la frecuencia **aplicada**; `inherited: true` indica que viene de la rutina. La despensa es un saldo aproximado (`{ id, canonicalProduct, quantity, unit, updatedAt }`), admite cero y no registra lotes, vencimientos ni consumo automático: generar un plan no la modifica.

### Preferencias de compra (`PATCH /users/me`)

| Campo | Regla |
| --- | --- |
| `maxTravelDistanceKm` | 0,1 a 100 km (el mismo rango que `radiusKm`) |
| `maxStoresPerShoppingPlan` | 1 a 20, o `null` = **sin límite**. Cero es inválido |
| `city` + `province` | Juntas; `null` en las dos las borra |
| `latitude` + `longitude` | Juntas; opcionales |
| `onboardingCompleted` | Solo `true`: fija `onboardingCompletedAt` con la hora del servidor y conserva la primera fecha si se repite. `false`/`null` son `400` ([ADR 0012](architecture-decisions/0012-onboarding-private-pages.md)) |
| `paymentMethods` | Lista sin repetidos de `CASH`, `DEBIT_CARD`, `CREDIT_CARD`, `TRANSFER`, `WALLET`. Vacía = no declaró ninguno: los beneficios que dependen del medio quedan **condicionados** (ADR 0023) |
| `banks`, `membershipPrograms` | Hasta 20 nombres sin repetir, de 1 a 120 caracteres; se comparan sin mayúsculas, tildes ni espacios. Nunca se piden números de tarjeta ni credenciales |

Las columnas que no admiten vacío (`maxTravelDistanceKm`, penalizaciones, listas) rechazan `null` con `400`.

## Planes de compra (privados)

Mismas reglas que rutinas y despensa: `Authorization: Bearer`, `Cache-Control: no-store`, y un plan ajeno responde `404` igual que uno inexistente. Un plan guardado es un **snapshot**: nombres, presentación, precio observado, fuente, fecha y promoción viajan con cada línea, así un precio nuevo o una rutina editada no cambian un plan ya emitido. Los importes son **estimaciones** con los últimos precios observados. Decisiones en [ADR 0013](architecture-decisions/0013-planner-needs-candidates.md) (necesidades y candidatos), [ADR 0014](architecture-decisions/0014-planner-optimizer.md) (optimizador y ahorro) y [ADR 0015](architecture-decisions/0015-saved-plans.md) (persistencia y estados). Desde P10-02 cada visita se cobra como una compra con los medios de pago declarados y los topes informados ([ADR 0024](architecture-decisions/0024-plan-payment-benefits.md)).

| Método y ruta | Cuerpo | Resultado |
| --- | --- | --- |
| `POST /shopping-plans/generate` | `{ startDate?, endDate? }` (`AAAA-MM-DD`; por defecto siete días desde hoy en Argentina) y cabecera **`Idempotency-Key`** obligatoria | `201 ShoppingPlanDto` si creó el plan; `200` con el **mismo** plan si la clave ya se había usado |
| `GET /shopping-plans?limit=` | — | `200 { items: ShoppingPlanSummaryDto[] }`, del más nuevo al más viejo (`limit` 1 a 50, 20 por defecto) |
| `GET /shopping-plans/:id` | — | `200 ShoppingPlanDto` |
| `PATCH /shopping-plans/:id` | `{ status: "ACTIVE" \| "COMPLETED" }` | `200 ShoppingPlanDto` |

**Idempotencia.** `Idempotency-Key` es un token opaco del cliente (8 a 80 letras, números, `-` o `_`; la web usa un UUID por intento). Sin ella o con otro formato: `400 IDEMPOTENCY_KEY_REQUIRED`. Un reintento con la misma clave devuelve el plan ya guardado (también si llegan varios pedidos a la vez); la misma clave con **otras** fechas explícitas es `409 IDEMPOTENCY_KEY_REUSED`. Ventana inválida: `400 PLAN_WINDOW_INVALID` (día inexistente o fin anterior) o `400 PLAN_WINDOW_TOO_LONG` (más de `PLANNER_MAX_HORIZON_DAYS`, 28). Generar no descuenta la despensa ni registra una compra.

**Estados.** Un plan nace `DRAFT`. `DRAFT → ACTIVE`, `DRAFT → COMPLETED` y `ACTIVE → COMPLETED`; pedir el estado que ya tiene es un no-op (`200`, sin cambiar `completedAt`). Al activar un plan, otro `ACTIVE` del mismo usuario cuya ventana se superpone vuelve a `DRAFT`: un solo plan activo por período. Un borrador o activo cuya `endDate` ya pasó se informa `EXPIRED` y no admite cambios (`400 PLAN_EXPIRED`); cualquier otra transición es `400 PLAN_STATUS_TRANSITION_INVALID`. `EXPIRED` y `DRAFT` no se pueden pedir (`400 VALIDATION_FAILED`). Completar un plan no prueba una compra ni un ahorro real.

`ShoppingPlanSummaryDto`:

```json
{
  "id": "…",
  "status": "DRAFT",
  "startDate": "2026-09-29",
  "endDate": "2026-10-05",
  "generatedAt": "2026-09-29T08:29:12.000Z",
  "completedAt": null,
  "coverage": "COMPLETE",
  "lineCount": 2,
  "visitCount": 1,
  "unfulfilledCount": 0,
  "optimizedCost": "8485.82",
  "effectiveCost": "8485.82",
  "estimatedSavings": "214.50",
  "refundEstimated": "0.00"
}
```

`coverage` es `COMPLETE`, `PARTIAL` (hay faltantes) o `EMPTY` (nada que comprar). `estimatedSavings` es `null` cuando no hubo base comparable (ninguna sucursal tenía todo): sin comparación no hay ahorro que mostrar. `optimizedCost` es lo que se paga en las cajas (con descuentos de pago en caja, sin reintegros). `refundEstimated` (P10-02) es el reintegro estimado, **aparte** del ahorro; `null` en planes generados antes de P10-02, que no se recalculan.

`ShoppingPlanDto` agrega:

| Campo | Contenido |
| --- | --- |
| `method` | `EXACT_BOUNDED` (óptimo entre los candidatos evaluados), `HEURISTIC` (se superó el presupuesto de búsqueda de visitas o de canastas) o `NO_CANDIDATES` |
| `optimizerVersion`, `baselineMethod` | Versión del algoritmo y base usada (`SINGLE_STORE_REGULAR_PRICES` o `NONE`) |
| `location` | `{ origin: COORDINATES \| LOCALITY \| NONE, radiusKm, city, province }` usada al generar |
| `settings` | Penalidad por visita, por km y máximo de sucursales usados |
| `totals` | `productCost` (con promociones del producto), `regularProductCost`, `promotionDiscount`, **`paymentDiscount`** (descuentos de pago en caja), **`payToday`** (`productCost − paymentDiscount`: lo que se paga en las cajas), **`refundEstimated`** (reintegros posteriores), **`costAfterRefund`**, **`conditionalAmount`** (beneficios posibles que dependen de un dato no informado: no sumados), `visitCount`, `storeCount`, `storeVisitPenaltyCost`, `distancePenaltyCost`, `effectiveCost` (`payToday` + penalidades), `effectiveCostAfterRefund` (lo que decide la recomendación) y `totalDistanceKm` (`null` si alguna distancia se desconoce) |
| `savings` | `{ estimatedSavings, effectiveCostDifference, baselineStoreName, baselineProductCost }` o `null`. `estimatedSavings` es `baselineProductCost − payToday`: dinero que no se paga frente a comprar todo en una sucursal a precio regular; **nunca incluye reintegros** y puede ser negativo. `effectiveCostDifference` incluye penalidades y no es dinero |
| `schedule` | `[{ date, visits: [{ storeId, storeName, chainName, distanceMeters, roundTripKm, subtotal, paymentDiscount, payToday, refundEstimated, payment, benefitNotes, lines }] }]`, por fecha y sucursal. Cada visita es **una compra**: `payment` es el beneficio de pago aplicado (`promotionId`, `name`, `timing` `IMMEDIATE`/`REFUND`, `refundDelayDays`, `base`, `amount`, `conditions`, `cap`) o `null`; `benefitNotes` lista lo que no se sumó con `status` `CONDITIONAL` (falta un dato: `BANK_NOT_DECLARED`, `CAP_REMAINING_UNKNOWN`, …, con el importe posible), `NOT_ELIGIBLE` (`BANK_NOT_ELIGIBLE`, `MINIMUM_SPEND_NOT_REACHED`, `WEEKDAY_NOT_ELIGIBLE`, `CAP_EXHAUSTED`, …) o `NOT_CHOSEN` (un solo pago por compra). `conditions` trae todo lo de la regla: tipo, porcentaje o monto, medio, banco, membresía, días (`eligibleWeekdays`, ISO 1 = lunes), `minimumSpend`, `discountCap`, `capPeriod`, `timing`, `refundDelayDays` y `stackable` |
| `benefits` | P10-02. `{ payer: { paymentMethods, banks, memberships, declared }, caps: [{ key, periodKey, limit, consumedOutside, usedHere }], criteria: string[], basketSearch }` o `null` en planes anteriores. `criteria` son los criterios usados, para mostrar tal cual; `basketSearch` es `NOT_NEEDED` (ninguna regla de pago aplicable cambia la suma de líneas), `EXHAUSTIVE` (todas las asignaciones de los candidatos) o `LOCAL_SEARCH` (aproximado, con la limitación `BASKET_BENEFITS_APPROXIMATED`) |
| `needs` | Cómo se calculó cada necesidad: `grossQuantity`, `netQuantity`, `inventorySubtracted` y `sources` (rutina, ocurrencias, cantidad) |
| `unfulfilled` | Necesidades sin cubrir con `reason` (`NO_LOCATION`, `NO_PRICE_IN_SCOPE`, `ONLY_STALE_PRICES`, `PREFERRED_PRODUCT_UNAVAILABLE`, `MAX_STORES_LIMIT`, …) |
| `coveredByInventory` | Lo que la despensa ya cubre |
| `limitations`, `warnings` | `[{ code, message }]` para mostrar tal cual: precios estimados, distancia en línea recta, recorte de candidatos, ubicación aproximada o faltante y, desde P10-02, `REFUND_PENDING` (hay reintegros: hoy se paga más), `BENEFITS_CONDITIONAL` (beneficios que dependen de datos no informados) y `BASKET_BENEFITS_APPROXIMATED`. `MINIMUM_SPEND_NOT_EVALUATED` y `PAYMENT_PROMOTIONS_EXCLUDED` solo aparecen en planes anteriores |
| `prices` | `{ oldestObservedAt, newestObservedAt }` de los precios usados, o `null` |

Cada línea (`PlanLineDto`):

```json
{
  "id": "…",
  "canonicalProductId": "…",
  "canonicalName": "Arroz largo fino",
  "productId": "…",
  "productName": "Arroz largo fino Pampa 1 kg (DEMO)",
  "brand": "Pampa",
  "matchType": "EXACT",
  "neededQuantity": "2",
  "quantity": "2",
  "unit": "KG",
  "packageCount": 2,
  "saleMode": "PACKAGED",
  "surplus": "0",
  "quantityIsEstimate": false,
  "price": "2103.22",
  "regularPrice": "2629.02",
  "discount": "525.80",
  "promotion": { "id": "…", "name": "Arroz Pampa 1 kg con 20% de descuento (DEMO)" },
  "priceObservedAt": "2026-09-28T12:00:00.000Z",
  "priceSource": "demo-seed",
  "reasonCodes": ["CHEAPEST_EVALUATED", "PROMOTION_APPLIED"],
  "reason": "Es la opción más barata entre las sucursales y fechas evaluadas. Aplica \"Arroz Pampa 1 kg con 20% de descuento (DEMO)\" comprando el 29/09.",
  "alternatives": [{ "offerId": "…", "productName": "…", "storeName": "…", "date": "2026-09-29", "total": "2380.00", "difference": "276.78" }]
}
```

`price`, `regularPrice` y `discount` son **totales de la línea**. `quantity` es lo que se compra (envases enteros: puede superar la necesidad y `surplus` lo muestra; venta por peso: `packageCount` `null` y `quantityIsEstimate` `true`). `reasonCodes`: `CHEAPEST_EVALUATED`, `CHEAPER_OPTION_NOT_WORTH_IT` (había algo más barato en otra visita que no convenía sumar), `EXACT_PRODUCT_REQUIRED`, `PREFERRED_PRODUCT`, `PROMOTION_APPLIED` y `BASKET_BENEFIT_CHOICE` (P10-02: más cara que otra opción del plan, pero llevarla en esta compra suma al beneficio de pago o alcanza su mínimo). `alternatives.difference` es alternativa − elegida. Con beneficios de pago, `price`/`regularPrice`/`discount` son los del motor (promoción del producto); el pago se informa por visita, no por línea.

**Planes viejos.** Los snapshots `schemaVersion: 1` (antes de P10-02) se leen tal cual: `payToday` = `productCost`, sin reintegros, `payment: null`, `benefitNotes: []` y `benefits: null`. Nada se recalcula.

## Resumen (privado)

### `GET /dashboard`

Requiere sesión; `Cache-Control: no-store`. Todo sale de los datos del usuario del token. Decisiones en [ADR 0017](architecture-decisions/0017-dashboard-estimated-savings.md).

```json
{
  "today": "2026-09-29",
  "nextPurchase": {
    "planId": "…",
    "status": "ACTIVE",
    "startDate": "2026-09-29",
    "endDate": "2026-10-05",
    "date": "2026-09-29",
    "dateHasPassed": false,
    "visits": [{ "storeId": "…", "storeName": "Carrefour Almagro (DEMO)", "chainName": "Carrefour", "lineCount": 1, "subtotal": "9573.90" }],
    "remainingLines": 1
  },
  "routines": { "routineCount": 1, "itemCount": 1 },
  "savings": {
    "estimated": {
      "week": { "amount": "0.00", "plans": 1 },
      "month": { "amount": "0.00", "plans": 1 },
      "total": { "amount": "0.00", "plans": 1 },
      "plansWithoutBaseline": 0,
      "selection": "ONE_PLAN_PER_PERIOD_ACTIVE_OR_COMPLETED"
    },
    "registered": { "available": false, "message": "Todavía no registramos compras: el ahorro de esta pantalla es estimado." }
  },
  "opportunities": { "items": [], "unavailableReason": null, "storesConsidered": 3, "seriesAnalyzed": 3 }
}
```

- `nextPurchase`: del plan `ACTIVE` vigente o, si no hay, del `DRAFT` vigente más nuevo; el primer día con compras desde hoy (si todos pasaron, el último con `dateHasPassed: true`). `null` sin plan vigente.
- `savings.estimated`: solo planes `COMPLETED` o `ACTIVE` vigentes, **uno por período** (ante superposición gana el completado y después el más nuevo). Semana ISO, mes calendario y acumulado por fecha de inicio del plan. `plans` cuenta los que suman; los que no tuvieron base comparable no suman y se informan en `plansWithoutBaseline`.
- `savings.registered`: siempre `available: false` hasta que exista registro de compras. Nunca se completa con estimaciones.
- `opportunities.items`: productos habituales (respetando "sin reemplazos" y marcas excluidas) cuyo precio actual en una sucursal de la zona es `HISTORIC_LOW` o `GOOD_DEAL` según el análisis del historial; hasta 10. Cada ítem trae producto, sucursal (con distancia si hay coordenadas), `price`, `unitPrice`, `average`, `lowest` y `ratioToAverage`. `unavailableReason`: `NO_ROUTINES`, `NO_LOCATION` o `NO_STORES_IN_SCOPE`.

## Alertas y avisos (privados)

Mismas reglas que rutinas y planes: `Authorization: Bearer`, `Cache-Control: no-store`, y una alerta o un aviso ajenos responden `404` igual que uno inexistente. Los avisos son **solo dentro de la app**: no se envían emails ni notificaciones push. Decisiones en [ADR 0022](architecture-decisions/0022-price-alerts-notifications.md).

| Método y ruta | Cuerpo | Resultado |
| --- | --- | --- |
| `GET /alerts` | — | `200 { items: PriceAlertDto[], limit: 20 }`, por fecha de alta |
| `POST /alerts` | ver abajo | `201 PriceAlertDto`; `409 ALERT_LIMIT` (20 por persona) |
| `PATCH /alerts/:id` | los mismos campos salvo `canonicalProductId` | `200 PriceAlertDto`. Las reglas se evalúan sobre el resultado; editar vuelve a habilitar el aviso |
| `DELETE /alerts/:id` | — | `204`. Los avisos ya emitidos quedan en la bandeja con `ruleId: null` |
| `GET /notifications?limit=&cursor=&unread=` | — | `200 { items: NotificationDto[], page: { limit, nextCursor }, unreadCount }`, del más nuevo al más viejo; `unread=true` solo los no leídos |
| `PATCH /notifications/:id/read` | — | `200 NotificationDto` con `readAt`; repetirlo conserva la primera fecha |

Campos de una alerta:

| Campo | Regla |
| --- | --- |
| `canonicalProductId` | Obligatorio al crear; no se cambia. Inexistente: `400 CANONICAL_NOT_FOUND` |
| `condition` | `TARGET_PRICE` (el precio por unidad llega al objetivo o baja de él), `HISTORIC_LOW` (mínimo de los últimos 30 días según el historial) o `GOOD_DEAL` (buena oferta o mínimo) |
| `targetUnitPrice` + `targetUnit` | Solo y obligatorios en `TARGET_PRICE`: precio **por unidad base del genérico** (`KG`, `L` o `UNIT`), hasta 2 decimales y mayor que cero. Falta: `400 TARGET_PRICE_REQUIRED`; en otra condición: `400 TARGET_PRICE_NOT_ALLOWED`; otra unidad: `400 UNIT_DIMENSION_MISMATCH`; cero: `400 TARGET_PRICE_INVALID` |
| `currency` | Opcional, solo `"ARS"`: otra es `400 CURRENCY_NOT_SUPPORTED` |
| `productId` | Presentación preferida, opcional (`null` la quita). Debe ser activa y del mismo genérico: `400 PREFERRED_PRODUCT_INVALID` |
| `allowSubstitutes` | `true` por defecto. En `false` exige `productId` (`400 PREFERRED_PRODUCT_REQUIRED`) y solo vigila esa presentación |
| `excludedBrands` | Hasta 20; se recortan y deduplican sin distinguir mayúsculas ni tildes. No se aplican a la presentación preferida |
| `radiusKm` | 0,1 a 100 (`400 RADIUS_INVALID`); `null` usa `maxTravelDistanceKm` de las preferencias. Sin coordenadas se usa la localidad |
| `active` | `false` pausa la alerta: no se evalúa ni avisa |

```json
{
  "id": "…",
  "canonicalProduct": { "id": "…", "name": "Pollo entero fresco", "defaultUnit": "KG" },
  "product": null,
  "allowSubstitutes": true,
  "excludedBrands": [],
  "condition": "TARGET_PRICE",
  "target": { "unitPrice": "4000.00", "unit": "KG", "currency": "ARS" },
  "radiusKm": null,
  "active": true,
  "status": { "lastEvaluatedAt": "2026-09-30T20:19:07.831Z", "lastOutcome": "NOTIFIED", "lastNotifiedAt": "2026-09-30T20:19:07.831Z" },
  "createdAt": "2026-09-30T20:19:06.810Z",
  "updatedAt": "2026-09-30T20:19:06.810Z"
}
```

**Cuándo avisa.** La evaluación la hace el job `CHECK_PRICE_ALERTS` (a mano o programado, ver [RUNBOOK](RUNBOOK.md)), no el API. Usa la última observación de cada presentación en las sucursales de la zona (hasta 20), **solo precios frescos** (`PRICE_MAX_AGE_DAYS`) y **sin promociones**: nunca avisa por una promoción que podría no aplicarle a la persona. Las oportunidades exigen el historial mínimo del análisis (7 días con dato). Entre varios candidatos gana el menor precio por unidad. Avisa la primera vez que la condición se cumple y de nuevo solo si el precio **mejora** o si la condición dejó de cumplirse y volvió a cumplirse; nunca antes de `ALERT_COOLDOWN_HOURS` (24) desde el aviso anterior. `status.lastOutcome` explica la última evaluación: `NOTIFIED`, `ALREADY_NOTIFIED`, `COOLDOWN`, `NO_MATCH`, `NO_FRESH_PRICES`, `INSUFFICIENT_DATA`, `NO_ELIGIBLE_PRODUCTS`, `NO_LOCATION` o `NO_STORES_IN_SCOPE`.

Un aviso es un snapshot: un precio nuevo no lo cambia. `data` trae el motivo, el producto, si es una **alternativa** a la presentación preferida, la sucursal (con distancia si hay coordenadas), precio, precio por unidad, fuente, fecha observada, el objetivo y el análisis:

```json
{
  "id": "…",
  "kind": "PRICE_ALERT",
  "ruleId": "…",
  "title": "Pollo entero fresco llegó a tu precio objetivo",
  "message": "Pollo entero fresco por kg (DEMO) a $ 3.191,30 ($ 3.191,30 por kg) en Carrefour Almagro (DEMO), precio visto el 29/09 (fuente demo-seed). Tu objetivo: $ 4.000,00 por kg.",
  "link": "/producto/…",
  "data": { "reason": "TARGET_PRICE", "isAlternative": false, "price": "3191.30", "unitPrice": "3191.300000", "unitPriceUnit": "KG", "source": "demo-seed", "observedAt": "2026-09-29T12:00:00.000Z", "…": "…" },
  "readAt": null,
  "createdAt": "2026-09-30T20:19:09.371Z"
}
```

## Qué todavía no expone la API

Importadores de fuentes reales (solo hay un proveedor simulado y archivos JSON Lines), avisos fuera de la app (email o push) y una vista HTTP de las colas de jobs. Los jobs se operan por comando, no por HTTP ([RUNBOOK](RUNBOOK.md)). El estado por paso está en [ROADMAP.md](../ROADMAP.md).
