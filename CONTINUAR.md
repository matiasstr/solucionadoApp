# Punto de continuación

## Traspaso — leer esto primero (Claude o Codex)

Este archivo es la fuente del estado de trabajo; no depender del historial de chat. `AGENTS.md` contiene las reglas, `CLAUDE.md` el arranque para Claude, `apps/web/AGENTS.md` las reglas de Next 16 (leer las guías de `node_modules/next/dist/docs/` antes de tocar la web) y `docs/steps/` las instrucciones de cada paso. **No rehacer lo terminado**: fases 1, 2 y 3 completas (P0-01, P1-01 a P1-04, P2-01 a P2-03, P3-01 y P3-02) y **P4-01**. Empezar por **P4-02**. Resolver decisiones rutinarias siguiendo los ADRs (0001–0011) y el formato de respuestas de `docs/API.md`, sin confirmaciones innecesarias. Al cerrar cada paso actualizar **CONTINUAR.md, CLAUDE.md y ROADMAP.md** (y README si cambia la operación), luego commit y push.

Los resultados de abajo son el registro de las sesiones del 2026-09-18 al 2026-09-23, no una garantía del estado de servicios en una fecha posterior. No hay implementación parcial de P4-02 que recuperar.

## Estado: 2026-09-23 — Fases 1, 2 y 3 completas; P4-01 completo

Raíz: `C:\Users\PC\Desktop\TusOfertasApp\solucionadoApp`. Remoto: `git@github.com:matiasstr/solucionadoApp.git`. Rama: `main`.

**Próximo paso: P4-02 — Onboarding y páginas privadas** (`docs/steps/phase-04.md`): `/onboarding`, `/mis-compras`, `/mi-despensa` y panel de preferencias, contra la API de P4-01 (contratos en `docs/API.md#rutinas-y-despensa-privadas` y `packages/shared`).
No están implementadas las pantallas de rutinas/despensa/onboarding, el optimizador, los importadores ni los jobs.

## Qué ya existe

- P0-01: requerimientos, arquitectura, dominio, schema, ADRs, Compose, roadmap.
- P1-01: monorepo npm workspaces; Next 16.3.5 / React 19.3 / Tailwind 4 / TanStack Query; Nest 11.2.5; Prisma 7.10.0. Portada es-AR.
- P1-02: migración `20260918120000_init` (PostGIS, CHECKs, triggers, GiST), `PrismaService` (`@prisma/adapter-pg`), `/api/health` y `/api/health/ready`, `StoreProximityRepository`, scripts `db:*` y `test:db`, ADR 0006.
- P1-03: `/api/auth/register|login|refresh|logout`, `GET/PATCH /api/users/me`; Argon2id, JWT HS256, refresh rotativo en cookie HttpOnly con detección de replay, CSRF (Origin + `X-Requested-With: tusofertas-web`), rate limit. ADR 0003.
- P1-04: auth en la web con rewrite same-origin (`API_ORIGIN`), token solo en memoria, refresh compartido, `(auth)/login|register`, `(private)/inicio|bienvenida`, E2E en Edge real. ADR 0007.
- **P2-01: catálogo, comercios, historia de precios, unidades y seed DEMO.**
  - Dominio (sin Prisma ni Nest): `catalog/domain/decimal.ts` (`DecimalValue`, entero BigInt escalado, HALF_UP), `units.ts` (KG/G, L/ML, UNIT; `toBaseQuantity`, `convertQuantity`, `unitPricePer100g`), `naming.ts`; `prices/domain/price-normalizer.ts`, `price-freshness.ts` (precio actual, desempate, umbral), `price-identity.ts` (clave idempotente), `price-records.ts`.
  - Infraestructura: `CategoryRepository` (upsert con detección de ciclos), `CanonicalProductRepository`, `ProductRepository` (valida dimensión contra el canónico, EAN, cantidad), `StoreRepository` (coordenadas completas o ninguna), `ProductPriceRepository` (`record` created/duplicate/conflict, `recordMany` para el seed, `findCurrentByProduct` con `DISTINCT ON`, `findHistory`).
  - Aplicación: `RecordPriceObservationUseCase`, `GetCurrentPricesUseCase` (frescura + precio por 100 g + orden por precio unitario). Módulos `CatalogModule`, `StoresModule`, `PricesModule` registrados en `AppModule` (todavía **sin controladores**: los endpoints son P2-02).
  - Configuración nueva: `PRICE_MAX_AGE_DAYS` (7) y `PRICE_SOURCE_PRECEDENCE` (vacío) en `apps/api/.env.example` y `ApiConfig.prices`.
  - Seed: `apps/api/src/seed/` (`demo-catalog.ts` datos puros, `demo-id.ts` UUID v5 determinista, `seed-demo-catalog.ts`, `main.ts` CLI). `npm.cmd run db:seed [-- --anchor=AAAA-MM-DD --days=N]`. No corre con `NODE_ENV=production` ni contra base remota sin `SEED_ALLOW_REMOTE=true`; nunca borra datos.
  - ADR 0008 (decimal propio, precio actual/frescura, política DEMO). README con tabla de precios por unidad base y sección del dataset.
- **P2-02: API pública de catálogo y precios.**
  - Endpoints (prefijo `/api`, sin sesión): `GET /products`, `/products/:id`, `/products/:id/prices`, `/canonical-products`, `/canonical-products/:id`, `/stores`, `/stores/:id`.
  - `common/pagination.ts` (cursor keyset opaco `(clave, id)`, `limit` 1-50, `toPage`/`toPaginatedDto`) y `common/query.ts` (`requireUuid`, `parseCursorOrFail`: un id mal formado es 400, no 404).
  - Repositorios con `search(...)` paginado: productos y canónicos por `normalizedName`, sucursales por `name`; las lecturas de sucursal ahora incluyen `chainName` (`StoreSummaryRecord`).
  - `GetProductUseCase`, `GetCanonicalProductUseCase` (con alternativas), `SearchStoresUseCase` (cercanía ordenada por distancia, sin cursor) y `GetProductPricesUseCase` (alcance `COORDINATES` / `LOCALITY` / `ALL`, radio km convertido a metros, `scope` explícito en la respuesta).
  - DTOs de query con `class-validator`; `whitelist` + `forbidNonWhitelisted` del bootstrap hacen que un filtro desconocido responda 400 con `fields`.
  - Contratos en los `contracts.ts` de cada módulo y espejados en `packages/shared/src/index.ts` para la web.
- **P2-03: motor de promociones simples.**
  - Dominio puro en `promotions/domain/`: `promotion.types.ts`, `promotion-rule.ts` (valida y rechaza reglas incompletas nombrando el campo), `promotion-eligibility.ts` (vigencia `[validFrom, validUntil)`, día ISO leído en `America/Argentina/Buenos_Aires` con `Intl`, alcance) y `promotion-calculator.ts` (`priceLine`).
  - `priceLine` cobra una línea con **una sola** promoción (la que más conviene; desempate por id) y devuelve la evaluación de todas las consideradas con su `skipReason`. Redondeo monetario una sola vez.
  - `catalog/domain/packaging.ts` (`planPurchase`): envases enteros con excedente visible; granel sin redondeo. Se reusa en fase 5.
  - `DecimalValue` sumó `floorToInteger`, `isInteger` y `toTrimmedString`.
  - `PromotionRepository` (upsert validado, `findActiveFor`, `search` paginado por `(validUntil, id)`) y `GET /promotions` + `GET /promotions/:id` con el campo `automatic`.
  - Seed: 9 promociones demo con vigencia relativa al ancla (activas, una futura, una vencida, una solo los martes, una con mínimo de compra y una bancaria que no se aplica). ADR 0009.
- **P3-01: búsqueda y comparación.**
  - `catalog/domain/search-term.ts`: un término de 8 a 14 dígitos es EAN exacto; el resto se normaliza sin tildes para nombre y marca. Un texto que se queda sin letras devuelve cero resultados, no el catálogo.
  - `GET /products` suma `brand`, `chainId`, `city`+`province` y `latitude`+`longitude`+`radiusKm` (disponibilidad real: el producto tiene precio observado ahí) y devuelve `scope` con el alcance aplicado. **Cambio de contrato**: la respuesta ahora incluye `scope`.
  - `GET /canonical-products/:id/prices` (`CanonicalPricesController` en el módulo de precios): compara todas las presentaciones por sucursal, con `matchType` EXACT/ALTERNATIVE según `productId`, precio regular, precio por unidad base, distancia, frescura y la promoción automática con su `minimumQuantity` y `promotionalUnitPrice`.
  - `sortBy` (`UNIT_PRICE` por defecto, `PRICE`, `DISTANCE`) en las dos rutas de precios; ordenar por distancia sin coordenadas es 400.
  - `StoreScopeResolver` (módulo de comercios) reemplaza la resolución de alcance duplicada; `ProductPriceRepository.findCurrentByProducts` resuelve varias presentaciones en una sola consulta (`DISTINCT ON (productId, storeId)`), sin N+1.
  - **`docs/API.md`**: formato estable de todas las respuestas públicas, con parámetros, límites y ejemplos reales del dataset DEMO.
- **P3-02: pantallas de comparación.**
  - Rutas nuevas en `apps/web`: `/buscar` (`components/search/search-view.tsx`) y `/producto/[id]` (`components/product/product-view.tsx`), más el buscador en la portada. Todas públicas.
  - Estado en la URL (`lib/catalog/filters.ts`): `q`, `cadena`, `ciudad`/`provincia`, `lat`/`lon`, `orden`. Escribir hace `router.replace` (con 400 ms de espera); cambiar un filtro hace `router.push`, así "atrás" lo deshace.
  - `lib/catalog/queries.ts`: hooks de TanStack Query con claves que incluyen todos los filtros y `signal` para cancelar lo que quedó viejo (`apiRequest` ahora acepta `AbortSignal` y no confunde un `AbortError` con un servicio caído).
  - `lib/format.ts`: moneda, fechas y distancias en `es-AR`; los importes solo se convierten a número para mostrarlos.
  - **Cambio de API para que las tarjetas tengan precio**: `GET /products` devuelve `bestOffer` (la más barata por unidad base del alcance, con promoción y frescura). La búsqueda y la comparación se movieron al módulo `search` (`ProductsSearchController`, `CanonicalPricesController`, `OfferPromotionResolver`), que compone catálogo, precios, comercios y promociones sin ciclos.
  - **Corrección del seed**: `latestObservationAnchor()` ancla en el último mediodía UTC **ya transcurrido**. Antes, corriendo antes de las 12:00 UTC, el dataset fechaba precios en el futuro (los tests lo detectaron).
  - E2E nuevo: `apps/web/e2e/search.e2e.cjs` (10 casos) y `npm.cmd run test:e2e` ahora corre las dos suites.

- **P4-01 (sesión 2026-09-23): API privada de rutinas y despensa.**
  - Módulos `apps/api/src/modules/routines/` (`domain/routine-rules.ts`, `application/routines.service.ts`, `presentation/` con controller, DTOs y contratos) e `inventory/` (servicio, controller, DTOs). Registrados en `AppModule`; todo detrás de `JwtAuthGuard` y con `Cache-Control: no-store`.
  - Endpoints: `GET/POST /shopping-routines`, `GET/PATCH/DELETE /shopping-routines/:id`, `POST /shopping-routines/:id/items`, `PATCH/DELETE /shopping-routines/:id/items/:itemId`, `GET/POST /inventory`, `PATCH/DELETE /inventory/:id`. Formato en `docs/API.md` (sección "Rutinas y despensa") y espejo en `packages/shared/src/index.ts` (`RoutineDto`, `RoutineItemDto`, `InventoryItemDto`, …).
  - **Ownership**: cada consulta filtra por el `userId` del token (`findFirst`/`updateMany`/`deleteMany` con `userId`; ítems con `routine: { userId }` + `routineId`). Ajeno e inexistente dan el mismo 404.
  - `catalog/domain/need-quantity.ts` (`toCanonicalQuantity`): acepta G/ML/KG/L/UNIT de la dimensión del canónico y guarda la unidad base sin redondear; rechaza más de 4 decimales y otra dimensión.
  - `common/rule-errors.ts`: `rethrowRuleErrors` (errores de dominio → 400 con su código), `rethrowUniqueAs` (P2002 → 409) e `IsOptionalNotNull` (omitible pero no `null`).
  - Límites (20 rutinas por usuario, 100 ítems por rutina) contados en transacción con `SELECT … FOR UPDATE` sobre la fila del usuario o de la rutina.
  - Preferencias en `PATCH /users/me`: radio 0,1–100 km, ciudad+provincia juntas, `null` rechazado en columnas no nulas (antes daba 500). `maxStoresPerShoppingPlan: null` = sin límite.
  - ADR 0011. **Sin migración nueva** (el schema de P1-02 ya tenía tablas, unicidad y CHECKs).

## Verificaciones ejecutadas (P4-01, 2026-09-23)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (validate, generate, typecheck, lint, **77/77** unitarios —9 nuevos en `test/routine-rules.test.cjs`—, build API + web con 8 rutas) |
| `npm.cmd run test:db` | **79/79** integración real (67 previos + **12** de `test/integration/routines-api.test.cjs`) |

Qué cubren los tests nuevos: 401 sin token en los 12 endpoints; alta con valores por defecto (7 días, ancla hoy en hora argentina) y quincenal; PATCH parcial con herencia de la frecuencia nueva; borrado en cascada de ítems; frecuencias 0/366/7,5/texto, fecha imposible y campos extra rechazados; límite de 20 rutinas con 25 altas simultáneas (exactamente 20 creadas); 5 kg de pollo semanal heredado; 500 g de arroz guardados como `0.5000 KG`; frecuencia propia de 15 días; un ítem por canónico con 3 altas simultáneas (201/409/409); unidad de otra dimensión, cantidad cero/negativa/numérica/con precisión excesiva, canónico inexistente, preferido de otro canónico o inexistente, sin sustitutos sin preferido, marcas solapadas por mayúsculas, frecuencia sin ancla y viceversa (ninguna fila creada); PATCH con reglas sobre el estado resultante; despensa con conversión G→KG, cero válido, duplicado 409, negativo y dimensión incompatible 400, `updatedAt` que avanza; **dos usuarios**: listar/leer/editar/borrar rutina, ítem y despensa ajenos, ítem propio bajo rutina ajena y ajeno bajo propia, todo 404 con el mismo cuerpo que lo inexistente y sin cambios en la base; preferencias válidas e inválidas.

No ejecutado en esta sesión: `npm.cmd run test:e2e` (no hubo cambios en la web), smoke manual contra la base de desarrollo y `npm.cmd audit`.

## Decisiones y notas (P4-01)

- **404 igual para ajeno e inexistente**, incluso en ítems anidados: el UUID no es permiso ni se confirma que exista (ADR 0011).
- **El canónico identifica al ítem**: no se cambia por PATCH. Para la web (P4-02): un 409 `ROUTINE_ITEM_DUPLICATE`/`INVENTORY_DUPLICATE` al reintentar un alta significa "ya existe, editala", no un error a mostrar tal cual.
- **Reglas sobre el estado resultante** en PATCH: no se puede quitar el preferido si `allowSubstitutes=false`, ni preferir una marca excluida. Frecuencia y ancla del ítem se envían juntas (`null`+`null` = heredar).
- El preferido se valida (activo, mismo canónico y dimensión) **solo cuando se elige**: si luego se desactiva, editar la cantidad sigue funcionando. P5-01 debe tratar un preferido inactivo.
- `ARGENTINA_TIME_ZONE` quedó definido también en `routines/domain/routine-rules.ts` (además de promociones) para no acoplar dominios.
- Los tests de integración nuevos usan `AUTH_RATE_LIMIT_PER_MINUTE=10000` porque registran muchas cuentas; supertest debe crear cada pedido justo antes de esperarlo (construirlos todos antes da `ECONNREFUSED`).

## Verificaciones ejecutadas (P3-02, 2026-09-22)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (validate, generate, typecheck, lint, **68/68** unitarios, build API + web con 8 rutas) |
| `npm.cmd run test:db` | **67/67** integración real |
| `npm.cmd run test:e2e` (búsqueda) | **10/10** en Edge headless contra web + API reales |
| Revisión visual | Capturas en `.cache/verification/p3-02/` (escritorio y móvil, búsqueda y ficha) |

Qué cubren los E2E nuevos: buscar desde la portada sin cuenta y con el término en la URL; tarjetas con precio, precio por unidad, sucursal y fecha; sin resultados y búsqueda vacía; filtros de cadena y localidad en la URL, "atrás" que deshace el último filtro y enlace compartido que reproduce la búsqueda; ficha con producto exacto y alternativas etiquetadas, ordenada por precio por kilo; orden por envase en la comparación y distancia deshabilitada sin ubicación; promoción con su condición sin tapar el precio regular; móvil 390 px sin desborde y sin distancias inventadas; recorrido por teclado hasta abrir un producto; backend caído con mensaje, botón de reintento y filtros conservados.

Revisión visual: se corrigió el selector de orden, que aparecía en la búsqueda sin ordenar nada (la lista es alfabética por la paginación por cursor); ahora solo está en la comparación y el listado dice cómo está ordenado.

## Verificaciones ejecutadas (P3-01, 2026-09-22)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (validate, generate, typecheck, lint, **68/68** unitarios, build API + web) |
| `npm.cmd run test:db` | **67/67** integración real (56 previos + **11** de `test/integration/search-api.test.cjs`) |
| Smoke manual | API en el puerto 3010 contra la base de desarrollo: `GET /api/canonical-products/:id/prices` con coordenadas devolvió ofertas ordenadas por precio por kilo, con distancia y con la promoción del 20% de Carrefour Almagro; esa respuesta quedó como ejemplo en `docs/API.md` |

Qué cubren los tests nuevos: búsqueda con y sin tildes que da el mismo resultado; término sin letras que devuelve cero y no el catálogo; búsqueda por marca y por EAN exacto (y EAN inexistente sin caer en texto); filtros por cadena, localidad y radio con el `scope` informado; radio mayor que alcanza más sucursales; localidad sin sucursales; filtros combinados y paginación sin repetir; comparación con todas las presentaciones en la misma unidad base; exacto contra alternativa; orden por envase y por kilo que difieren (el paquete más barato no es el más barato por kilo); orden por distancia solo con coordenadas; promoción con cantidad mínima 1 (porcentaje), 2 (2x1) y precio fijo, conservando el precio regular; promoción bancaria que no aparece como precio; `includeStale`, `limit`, canónico inexistente y `sortBy` inválido.

## Verificaciones ejecutadas (P2-03, 2026-09-21)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (validate, generate, typecheck, lint, **64/64** unitarios, build API + web) |
| `npm.cmd run test:db` | **56/56** integración real (48 previos + 8 de `test/integration/promotions.test.cjs`) |
| `npm.cmd run db:seed` | 9 promociones demo cargadas; segunda corrida sin duplicar |
| Smoke manual | API en el puerto 3010: `GET /api/promotions` devuelve solo lo vigente e `includeInactive=true` las 9, con `automatic=false` únicamente en la bancaria |

Qué cubren los tests nuevos: los cuatro tipos con cantidad par e impar, cantidad mínima, precio fijo que no encarece, tope por compra, mínimo de compra sin subtotal conocido, `BANK_DISCOUNT` informado pero no aplicado, pares sobre venta por peso, envasado con cantidad fraccionaria, elección determinista sin acumular, redondeo único que cierra con el ahorro, una promoción que cambia cuál presentación conviene, envases enteros con excedente, reglas incompletas rechazadas (13 casos), vigencia y días en calendario argentino, seed idempotente, CHECK de doble alcance comercial en la base, filtros y paginación de `GET /promotions`, y el cálculo sobre el precio actual real del seed.

## Verificaciones ejecutadas (P2-02, 2026-09-21)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (validate, generate, typecheck, lint, **45/45** unitarios, build API + web) |
| `npm.cmd run test:db` | **48/48** integración real (24 de fase 1 + 10 de catálogo + **14 HTTP** de `test/integration/catalog-api.test.cjs`) |
| Smoke manual contra la base de desarrollo | API levantada en el puerto 3010 (el 3001 estaba ocupado por otro proceso del usuario y no se tocó): `/api/health/ready`, `/api/products?search=arroz` y `/api/products/:id/prices?latitude=-34.6187&longitude=-58.4407&radiusKm=5` respondieron con datos DEMO; esa respuesta quedó como ejemplo en el README |

Qué cubren los tests HTTP nuevos: paginación por cursor sin repetir ni saltear filas y `nextCursor` null al final; filtros por texto, categoría y canónico; 400 con `fields` para `limit`, `search`, uuid, cursor y parámetro desconocido; ficha con categoría y canónico sin filtrar campos internos; 404 contra 400 según el id; un precio por sucursal ordenado por precio por unidad base; 500 g más caro por kilo que 1 kg en la misma sucursal; alcance por coordenadas con distancia menor o igual al radio y conversión km a metros; alcance por localidad con `distanceMeters: null`; precios viejos marcados y `includeStale=false`; alcances incompletos rechazados; canónico con sus 3 alternativas; sucursales por cadena, localidad y cercanía ordenada por distancia; cursor rechazado en búsqueda por cercanía; sucursal sin coordenadas devuelta sin distancia.

## Verificaciones ejecutadas (P2-01, 2026-09-21)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (validate, generate, typecheck, lint, **39/39** unitarios, build API + web con las mismas 7 rutas) |
| `npm.cmd run test:db` | **34/34** integración con PostgreSQL/PostGIS real (24 previos + 10 nuevos de `test/integration/catalog.test.cjs`) |
| `npm.cmd run db:seed` (base de desarrollo) | 7 categorías, 18 canónicos, 28 productos, 5 cadenas, 10 sucursales, **7237** observaciones nuevas |
| `db:seed` repetido (mismo ancla) | **0 nuevas**: idempotente. También probado `--anchor=2026-09-21 --days=5` |
| `db:seed` con `NODE_ENV=production` | Rechazado con mensaje explícito (exit 1) |

Qué cubren los tests nuevos: seed dos veces sin duplicar y sin reescribir observaciones; historial diario de 31 días con fuente/fecha/moneda; normalización por presentación (1 kg, 500 g, pack 6 × 2,25 L); precio actual por sucursal con `ageDays`/`isStale` (sucursal que dejó de informar hace 12 días) y filtro por sucursal; precio por 100 g; reintento `duplicate`, conflicto de contenido `conflict` y observación nueva `created`; rechazo de `UPDATE`/`DELETE` sobre `ProductPrice` desde Prisma; consulta espacial en metros que excluye la sucursal sin coordenadas; `DIMENSION_MISMATCH` y `CATEGORY_CYCLE`.

No ejecutado en esta sesión: `npm.cmd run test:e2e` (no hubo cambios en la web) y `npm.cmd audit`.

## Decisiones y notas (P3-02)

- **El estado vive en la URL**, no en React: enlace compartible, "atrás" útil y nada que sincronizar. Escribir reemplaza la entrada; cambiar un filtro agrega una.
- **El orden se ofrece donde aplica.** El listado de búsqueda pagina por cursor con orden alfabético: ordenar por precio ahí sería ordenar solo la página actual. Se dice en pantalla y el selector vive en la comparación.
- **`GET /products` devuelve `bestOffer`**: sin precio en la tarjeta el comparador no sirve. Es una consulta más por página (no una por producto).
- El módulo `search` compone catálogo, precios, comercios y promociones; nadie lo importa, así que no hay ciclos. `/products/:id` sigue en catálogo y `/products/:id/prices` en precios.
- La ubicación del navegador es **opcional**: si se deniega el permiso, se avisa y se sigue sin distancias. No hay pantalla que dependa de tenerla.
- Sin `E2E_BASE_URL`, los E2E apuntan a `http://127.0.0.1:3000`. En esta sesión los puertos 3000 y 3001 estaban ocupados por otro proyecto del usuario: se levantó la API en 3010 y la web en 3100 con `API_ORIGIN`, sin tocar esos procesos.

## Decisiones y notas (P3-01)

- **`GET /products` ahora devuelve `scope`** además de `items` y `page`. Es un cambio de contrato: quien consuma la API debe ignorar campos nuevos o actualizarse (el test de P2-02 se ajustó).
- **Los filtros de ubicación filtran por disponibilidad real**: solo productos con precio observado en esas sucursales. Listar algo que no se consigue cerca sería peor que no listarlo.
- **El orden no considera promociones.** Se ordena por precio regular y el beneficio se muestra al lado con su cantidad mínima, porque depende de cuántas unidades se compren. Optimizar la canasta es trabajo de la fase 5.
- **Ordenar por distancia sin coordenadas es 400**, no un orden arbitrario.
- La comparación del canónico está acotada a 50 ofertas y resuelve precios de todas las presentaciones en **una** consulta; las promociones se traen también en una sola por canónico.
- `docs/API.md` es ahora la referencia del formato de respuesta: si cambia un contrato, se actualiza junto con `packages/shared`.

## Decisiones y notas (P2-03)

- **Una promoción por línea.** Se elige la que más conviene al comprador y se desempata por id para que el resultado no dependa del orden de entrada. `isStackable` no habilita acumulación todavía.
- **Lo que no se puede comprobar se informa, no se aplica**: banco/medio de pago, membresía, mínimo de compra sin subtotal, topes que abarcan varias compras. Cada caso tiene su `skipReason` y viaja en la respuesta del calculador.
- `FIXED_PRICE` aplica a **todas** las unidades al alcanzar `requiredQuantity` (la forma habitual en Argentina). La alternativa por grupos quedó documentada en ADR 0009 por si aparece evidencia en contra.
- El calculador no toca la base: recibe reglas ya cargadas. El planificador de fase 5 lo reusa tal cual.
- `GET /promotions` lista por defecto solo lo vigente **ahora**; `includeInactive=true` y `activeAt` permiten ver el resto sin mostrar una promoción vencida como activa.
- El ADR del deploy de la API (Supabase) será el **0010**: 0008 es catálogo/precios y 0009 promociones.

## Decisiones y notas (P2-02)

- **Ciclo de módulos evitado sin `forwardRef`:** `GET /products/:id/prices` lo sirve `ProductPricesController`, dentro de `PricesModule` (que importa `CatalogModule` y `StoresModule`). La ruta pública no cambia y catálogo/comercios no importan precios.
- **Contratos espejados, no importados:** la API no depende de `@tusofertas/shared` (igual que `UserProfile` en P1-03/P1-04). Agregar esa dependencia obligaría a regenerar `package-lock.json`, que hoy tiene entradas de binarios Linux reconstruidas a mano para Vercel. Si cambia un contrato, hay que cambiar los dos archivos.
- **Paginación por cursor, no por offset:** el cursor codifica `(clave, id)` en base64url y aprovecha el índice de `normalizedName`/`name`. La búsqueda por cercanía ordena por distancia y por eso **rechaza** `cursor` en vez de devolver resultados repetidos.
- Los tests de integración anclan el dataset al **mediodía UTC de hoy** y afirman por diferencia de días: `node --test` ordena los archivos alfabéticamente, así que `catalog-api` corre antes que `catalog` y ambos comparten la base sembrada.
- Las coordenadas viajan como decimal sin ceros sobrantes (`-34.6187`), no con escala fija.
- Estos endpoints todavía **no tienen rate limit** (el throttler vive en `AuthModule`) ni cabeceras de cache: se definen junto con el CDN en una etapa posterior.

## Decisiones y notas (P2-01)

- El dominio no usa `Prisma.Decimal` ni agrega `decimal.js`: `DecimalValue` evita acoplar el dominio y evita regenerar el lockfile (ver sección Deploy). Los repositorios escriben y devuelven cadenas.
- El normalizador **rechaza** en lugar de redondear en silencio: `numeric(14,2)` redondearía un precio con tres decimales sin avisar y eso mueve dinero.
- `ProductPrice_append_only` levanta `restrict_violation` (23001) y **Prisma lo reporta como P2003** ("foreign key"): el mensaje no menciona el trigger, pero la escritura se rechaza. No confiar en el texto del error.
- `integerDigits()` trunca (no redondea) para validar contra `numeric(14,2)`: `999999999999.99` es válido.
- Las cadenas reales llevan precios ficticios: el marcado es triple (`(DEMO)` en el nombre, `source='demo-seed'`, `importBatchId`). P2-02 debe exponer `source` y `observedAt` en toda respuesta de precio.
- `demo-seed` deja una sucursal sin coordenadas (`Vea Morón`), una que informa día por medio (`Vea Flores`) y una que dejó de informar hace 12 días (`Disco Belgrano`). Son casos de prueba, no errores.
- El E2E de auth crea cuentas `e2e-*@example.com` en la base de desarrollo. `npm test` no requiere DB; `test:db` y `db:seed` requieren Docker. PowerShell: `npm.cmd`/`npx.cmd`. Node 22.18.0; npm 10.9.3.

## Deploy (Vercel) — web + API + Supabase (ADR 0010)

Desplegado y verificado el 2026-09-24. Cuenta `matiasstr`, scope `matiasstrs-projects`, org `team_HaHit5F3SLJ9EspBBNJOkRgR`. `.vercel/` (ignorado por Git) apunta al proyecto **web**.

| Proyecto | URL | Root | Deploy (desde la raíz del repo) |
| --- | --- | --- | --- |
| `tusofertas` (web) | https://tusofertas.vercel.app | `apps/web` | `vercel deploy --prod --yes` |
| `tusofertas-api` (`prj_nXuVeI3OOFdz5YLQgm5aAofCP6CY`) | https://tusofertas-api.vercel.app | `apps/api` | `VERCEL_ORG_ID=team_HaHit5F3SLJ9EspBBNJOkRgR VERCEL_PROJECT_ID=prj_nXuVeI3OOFdz5YLQgm5aAofCP6CY vercel deploy --prod --yes` |

- Base: **Supabase `tusofertas-db`** (integración del Marketplace, conectada a `tusofertas-api`). Inyecta `POSTGRES_URL` (pooler transacción), `POSTGRES_URL_NON_POOLING` (sesión) y otras; no copiarlas a la máquina.
- Build de la API: `apps/api/vercel.json` → `node scripts/vercel-build.cjs` (generate + `migrate deploy` solo si `VERCEL_ENV=production` + build + `public/robots.txt`). Migración `20260918120000_init` aplicada en Supabase (PostGIS incluido); los deploys siguientes informan "No pending migrations".
- Runtime: `api/index.js` resuelve la URL con `api/_database-url.js` (`POSTGRES_URL` → `sslmode=verify-full` + `sslrootcert=certs/supabase-ca.crt`, incluido con `includeFiles`). TLS verificado, sin desactivar la validación.
- Variables de la API: `JWT_ACCESS_SECRET` (aleatoria), `CORS_ORIGINS=https://tusofertas.vercel.app` + las de la integración. Web: `API_ORIGIN=https://tusofertas-api.vercel.app`.
- **Producción no tiene dataset DEMO**: el catálogo está vacío (búsquedas sin resultados) hasta la fase 7. No correr `db:seed` contra Supabase.
- `@nestjs/jwt` se reemplazó por `jsonwebtoken` 9.0.3 porque es solo ESM y el cargador de Vercel no lo acepta (`ERR_REQUIRE_ESM`). Antes de sumar una dependencia de runtime, verificar que publique CommonJS.
- Smoke en producción (2026-09-24, vía la web same-origin): health 200, ready 200 con `database: up`, ruta inexistente 404, registro 201 con cookie `Secure`, `/users/me` 200, alta y baja de rutina 201/204, sin token 401, clave incorrecta 401, login 200, refresh 200, refresh reusado 401 (replay), logout 204, registro sin CSRF 403, `/`, `/login` y `/buscar` 200. Quedó la cuenta de prueba `smoke-1790282114436@example.com` (no hay endpoint para borrarla).
- `TRUST_PROXY=vercel` (un salto) cargado en `tusofertas-api`: el rate limit de auth cuenta por IP de cliente. Verificado en producción que Vercel entrega una sola entrada en `X-Forwarded-For` y descarta la del cliente (ADR 0010). Pendiente para P8: el contador es memoria por instancia.
- `.agents/`, `.claude/` y `skills-lock.json` (skills locales que instaló la integración) están en `.gitignore`.
- Lockfile: el original (generado en Windows) no tenía las variantes Linux de binarios opcionales (lightningcss, @tailwindcss/oxide, @next/swc, sharp, unrs-resolver) ni su `integrity` — bug npm/cli#4828 — y el build de Vercel fallaba. Se regeneraron esas entradas en una copia limpia sin `node_modules`, con **las mismas versiones**; `npm ci` + `verify` locales siguen en verde. Si vuelve a pasar tras actualizar dependencias: quitar del lock esos paquetes **y sus padres** y correr `npm install --package-lock-only` en un directorio sin `node_modules`.

## Git y autorización persistente

El usuario pidió **commit y push al completar cada paso**, sin confirmaciones ordinarias. No usar force push ni sobrescribir trabajo ajeno. Excluir `.env`, generados y logs.

- P0-01 `bf6653b`; P1-01 `0f84809`; P1-02 `e16ba35`; P1-03 `6d04203`; P1-04 `0e236d6`; deploy web `277fa36`; adaptador serverless de la API `1cc2fae` (publicados).
- **P2-01** `df94c12` (publicado).
- **P2-02** `1aa5e5c` (publicado).
- **P2-03** `c1ffb10` (publicado).
- **P3-01** `f099b9a` (publicado).
- **P3-02** `900f2c9` (publicado).
- **P4-01** `b965226` (publicado).
- **Deploy de la API (ADR 0010)** `06ab251` (publicado). IP de cliente en Vercel: commit `fix(deploy): ...` del 2026-09-24.
- `apps/web/next-env.d.ts` aparece modificado cada vez que corre `next dev`/`build`: es generado y versionado a pedido del propio archivo; commitearlo si cambia.

## Cómo seguir con P4-02

1. Leer `AGENTS.md`, `apps/web/AGENTS.md` (y las guías de Next 16 en `node_modules/next/dist/docs/`), `ROADMAP.md`, `docs/steps/phase-04.md` (P4-02), `docs/API.md#rutinas-y-despensa-privadas` y ADR 0007 y 0011.
2. `git status --short --branch`, `git log -4 --oneline`, `docker compose up -d`, `npm.cmd run db:deploy`, `npm.cmd run db:seed`, `npm.cmd run dev`.
3. Rutas privadas nuevas en `apps/web/src/app/(private)/`: `onboarding`, `mis-compras`, `mi-despensa`, más un panel de preferencias ligado a `PATCH /users/me`. Hooks de TanStack Query con claves por usuario; invalidar al mutar y **limpiar la caché al logout**.
4. Onboarding: localidad, radio 2/5/10/20 km, máximo de sucursales 1/2/3/sin límite (`null`), productos habituales (buscador de canónicos `GET /canonical-products?search=`). Coordenadas opcionales y **solo tras una acción del usuario**. Persistir progreso (por ejemplo, crear la rutina al primer paso y reusar su id; tratar el 409 de duplicado como "ya estaba") y no bloquear el uso público. Marcar `onboardingCompletedAt` requiere un campo nuevo en `PATCH /users/me` o un endpoint: decidir y documentar.
5. Cantidad + unidad + frecuencia en el flujo principal; preferido, marcas y sustitución en una sección secundaria. Confirmación para borrar; errores con `fields` junto a cada campo.
6. E2E en `apps/web/e2e/` (Edge real): onboarding completo y reanudado; 5 kg de pollo semanal + 2 kg en despensa; edición y borrado; ubicación omitida; usuario sin rutina; persistencia tras reload; teclado y móvil 390 px; caché limpia al logout. Agregar la suite a `npm.cmd run test:e2e`.
7. `npm.cmd run verify`, `npm.cmd run test:db`, `npm.cmd run test:e2e`; actualizar README/ROADMAP/CONTINUAR/CLAUDE.md; commit y push. Cierra la fase 4; el siguiente es P5-01.

## Prompt listo para pegar (Claude o Codex)

> Continuá el proyecto en C:\Users\PC\Desktop\TusOfertasApp\solucionadoApp. Leé primero CLAUDE.md (o AGENTS.md) y CONTINUAR.md. Las fases 1, 2 y 3 y el paso P4-01 (API privada de rutinas y despensa) ya están implementados, probados y publicados; no los rehagas. El próximo paso es P4-02 (onboarding, /mis-compras, /mi-despensa y preferencias en la web), descrito en docs/steps/phase-04.md, contra la API documentada en docs/API.md. Antes de tocar apps/web leé apps/web/AGENTS.md. Probalo con E2E en Edge real (npm.cmd run test:e2e) además de npm.cmd run verify y npm.cmd run test:db, y actualizá README, ROADMAP, CONTINUAR y CLAUDE.md. Tenés autorización para commit y push al completar cada paso; no pidas confirmaciones rutinarias. No marques como probado lo que no ejecutaste.
