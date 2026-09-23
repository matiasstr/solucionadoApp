# API de Tus Ofertas

Formato estable de las respuestas públicas de lectura (catálogo, precios, promociones y comercios) y de la API privada de rutinas y despensa. Los contratos TypeScript están en [`packages/shared/src/index.ts`](../packages/shared/src/index.ts); acá se documentan parámetros, límites y forma de la respuesta. Autenticación y perfil están en el [README](../README.md#api-de-autenticación-y-perfil).

Todos los ejemplos salieron del dataset **DEMO** (`npm.cmd run db:seed`): los precios son ficticios y no representan ofertas reales de esas cadenas.

## Convenciones

- Prefijo `/api`. Catálogo, precios, comercios y promociones son públicos: no requieren sesión. Rutinas y despensa sí (ver [Rutinas y despensa](#rutinas-y-despensa-privadas)).
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
        "promotion": null
      }
    }
  ],
  "page": { "limit": 20, "nextCursor": null },
  "scope": { "origin": "ALL", "radiusKm": null, "storesConsidered": null }
}
```

`bestOffer` es la oferta **más barata por unidad base** dentro del alcance consultado, con la misma forma que las ofertas de la comparación (incluida `promotion`). Es `null` cuando el producto no tiene precio observado en esas sucursales: el listado lo dice en vez de mostrar un precio de otra zona. El orden de la página sigue siendo alfabético (la paginación es por cursor); para ordenar por precio se compara un canónico.

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
      }
    }
  ]
}
```

Sobre `promotion`:

- Es `null` cuando ninguna promoción **automática** alcanza a esa oferta. Las que dependen del banco, del medio de pago, de una membresía o de compras anteriores nunca se aplican solas: se consultan en `GET /promotions`.
- `minimumQuantity` son las unidades que hay que llevar (2 en un 2×1 o en una segunda unidad con descuento). `regularTotal`, `total` y `discount` corresponden a esa cantidad.
- `price` y `unitPrice` siguen siendo el precio **sin** promoción: la comparación no se pierde.
- El orden usa el precio regular; el beneficio se muestra al lado porque depende de cuántas unidades se compren.

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
  "conditions": {
    "paymentMethod": null, "bank": null, "membershipProgram": null,
    "minimumSpend": null, "discountCap": null, "capPeriod": null, "eligibleWeekdays": []
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

Tipos: `PERCENTAGE`, `SECOND_UNIT`, `TWO_FOR_ONE`, `FIXED_PRICE` y `BANK_DISCOUNT` (modelado, sin aplicar hasta P10-01). La semántica exacta de cada uno está en [ADR 0009](architecture-decisions/0009-promotion-engine.md).

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

Las columnas que no admiten vacío (`maxTravelDistanceKm`, penalizaciones, listas) rechazan `null` con `400`.

## Qué todavía no expone la API

Historial de precios y gráficos (fase 6), planes de compra y ahorro estimado (fase 5), alertas (fase 9) y promociones bancarias aplicadas (fase 10). El estado por paso está en [ROADMAP.md](../ROADMAP.md).
