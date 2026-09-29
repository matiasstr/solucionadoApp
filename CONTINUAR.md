# Punto de continuación

## Traspaso — leer esto primero (Claude o Codex)

Este archivo es la fuente del estado de trabajo; no depender del historial de chat. `AGENTS.md` contiene las reglas, `CLAUDE.md` el arranque para Claude, `apps/web/AGENTS.md` las reglas de Next 16 (leer las guías de `node_modules/next/dist/docs/` antes de tocar la web) y `docs/steps/` las instrucciones de cada paso. **No rehacer lo terminado**: fases 1 a 4 completas (P0-01, P1-01 a P1-04, P2-01 a P2-03, P3-01, P3-02, P4-01, P4-02) , **fase 5 completa** (P5-01 a P5-03) y **P6-01**. Empezar por **P6-02**. Resolver decisiones rutinarias siguiendo los ADRs (0001–0016) y el formato de respuestas de `docs/API.md`, sin confirmaciones innecesarias. Al cerrar cada paso actualizar **CONTINUAR.md, CLAUDE.md y ROADMAP.md** (y README si cambia la operación), luego commit y push.

Los resultados de abajo son el registro de las sesiones del 2026-09-18 al 2026-09-29, no una garantía del estado de servicios en una fecha posterior. No hay implementación parcial de P6-02 que recuperar.

## Estado: 2026-09-29 — Fases 1 a 5 completas y P6-01 completo

Raíz: `C:SERSPCDESKTOPTUSOFERTASAPPSOLUCIONADOAPP`. Remoto: `git@github.com:matiasstr/solucionadoApp.git`. Rama: `main`.

**Próximo paso: P6-02 — Historial visual y dashboard** (`docs/steps/phase-06.md`): gráfico accesible del historial en `/producto/[id]` sobre `GET /products/:id/price-history`, y `/dashboard` con próxima compra, rutinas, oportunidades y ahorro **estimado** que no cuente dos veces planes superpuestos. Instrucciones al final de este archivo.
No están implementados el gráfico, el dashboard, los importadores, los jobs, las alertas ni las promociones bancarias. **El despliegue de producción no incluye P4-02 ni la fase 5** (último deploy: 2026-09-24); ver "Deploy". Deuda de diseño pendiente (logo y tipografía): ver ROADMAP, sección "Deuda de diseño".

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

- **P4-02 (sesión 2026-09-27): onboarding y páginas privadas.** Cierra la fase 4.
  - Rutas nuevas en `apps/web/src/app/(private)/`: `onboarding` (con `Suspense` por `useSearchParams`), `mis-compras`, `mi-despensa`, `preferencias`. `/bienvenida` redirige a `/onboarding` y el registro lleva ahí. La barra privada (`components/auth/private-shell.tsx`) tiene navegación con `aria-current`.
  - Datos: `lib/account/queries.ts` (hooks con claves `['me'|'routines'|'inventory', userId]`, mutaciones que invalidan en `onSettled`, `useEnsureRoutine` que reconsulta antes de crear, buscador público de canónicos y detalle para el preferido) y `lib/account/quantities.ts` (unidades por dimensión, `parseQuantityInput` con coma o punto decimal y sin separador de miles, presets de frecuencia 7/14/15/30, fecha argentina, `apiFieldErrors` que reparte `fields` de la API entre los campos visibles).
  - Componentes: `account/canonical-picker.tsx` (resultados como botones; deshabilita lo ya cargado), `account/form-parts.tsx` (`QuantityFields`, `FieldError`, `FormAlert` con foco, `ConfirmDelete` en dos pasos con manejo de foco), `routines/routine-item-editor.tsx` (cantidad/unidad/frecuencia a la vista; preferido, reemplazos y marcas en `<details>`), `routines/routines-view.tsx`, `inventory/inventory-view.tsx`, `preferences/preference-fields.tsx` (localidad con sugerencias de sucursales, provincia de lista cerrada, geolocalización solo por botón, radio y sucursales como radios), `preferences/preferences-view.tsx` y `onboarding/onboarding-view.tsx`. `account-home.tsx` pasó a resumen con aviso de onboarding pendiente.
  - `lib/api.ts` y `authRequest` aceptan `DELETE`; `AuthProvider.updateUser` mantiene el usuario de sesión al día tras editar el perfil. Contratos de pedido nuevos en `packages/shared` (`UpdateProfileRequest`, `CreateRoutineItemRequest`, …).
  - **API**: `PATCH /users/me` acepta `onboardingCompleted: true` (fecha del servidor, idempotente con `updateMany … onboardingCompletedAt: null`; `false`/`null` son 400). Documentado en `docs/API.md`. ADR 0012.
  - E2E nuevo `apps/web/e2e/account.e2e.cjs` (13 casos) sumado a `npm.cmd run test:e2e`; `auth.e2e.cjs` ahora espera `/onboarding` tras registrarse.

- **P5-01 (sesión 2026-09-29): necesidades y candidatos del planificador.** Abre la fase 5.
  - Módulo `apps/api/src/modules/shopping-plans/` (registrado en `AppModule`, sin controladores todavía). Dominio puro: `plan-calendar.ts` (ventana inclusiva en calendario argentino, `resolvePlanWindow`, `occurrencesInWindow`, `argentineNoon` = 15:00 UTC), `needs.ts` (`buildNeeds`), `candidates.ts` (`buildCandidates`), `planner.types.ts` (contratos de entrada/salida con `schemaVersion: 1`) y `planning-errors.ts` (`PlanningRuleError`: `PLAN_WINDOW_INVALID`, `PLAN_WINDOW_TOO_LONG`).
  - Aplicación: `BuildPlanCandidatesUseCase.execute(userId, { startDate?, endDate?, now? })` carga usuario, rutinas con ítems, despensa y canónicos (todo filtrado por `userId`), resuelve ubicación (coordenadas → `StoreScopeResolver` con `maxTravelDistanceKm`; solo localidad → ciudad sin distancia; nada → sin sucursales), precios actuales en **una** consulta, promociones vigentes en la ventana (`PromotionRepository.findActiveBetween`, nuevo; `findActiveFor` lo reutiliza) y presentaciones de todos los canónicos, activas o no (`ProductRepository.listByCanonicalProducts`, nuevo).
  - Configuración nueva en `ApiConfig.planner` y `apps/api/.env.example`: `PLANNER_MAX_HORIZON_DAYS` (28), `PLANNER_MAX_CANDIDATE_DATES` (7), `PLANNER_MAX_CANDIDATE_STORES` (8), `PLANNER_MAX_OFFERS_PER_STORE` (2).
  - Tests: `test/shopping-plan-needs.test.cjs` (13), `test/shopping-plan-candidates.test.cjs` (18), uno nuevo en `environment.test.cjs` e integración `test/integration/shopping-plans.test.cjs` (8, sumado a `scripts/test-db.cjs`). ADR 0013.

- **P5-02 (sesión 2026-09-29): optimizador determinista.**
  - Dominio: `optimized-plan.types.ts` (contrato `OptimizedPlan`, `OPTIMIZER_VERSION`) y `plan-optimizer.ts` (`optimizePlan`, `countCombinations`). Visitas = sucursal + fecha; fechas dominadas descartadas; enumeración exacta de subconjuntos de sucursales (hasta el máximo del usuario) × subconjuntos de fechas útiles si entra en el presupuesto; si no, una fecha por sucursal o agregado de a una sucursal (`HEURISTIC`). Importes en enteros de 1e-5 ARS; totales redondeados una vez por componente.
  - Aplicación: `PlanShoppingUseCase.execute(userId, query)` → `{ candidates, plan }` con `storeVisitPenalty`, `distancePenaltyPerKm` y `maxStoresPerShoppingPlan` del usuario.
  - Configuración: `PLANNER_MAX_COMBINATIONS` (100000) en `ApiConfig.planner` y `.env.example`.
  - Tests: `test/shopping-plan-optimizer.test.cjs` (16, con contraste contra enumeración exhaustiva independiente en 200 canastas con semilla fija), `environment.test.cjs` ampliado y 3 de integración en `shopping-plans.test.cjs`. ADR 0014.

- **P5-03 (sesión 2026-09-29): planes guardados y `/plan-semanal`.** Cierra la fase 5.
  - Migración `20260929120000_shopping_plan_generation`: `ShoppingPlan.idempotencyKey` (único por usuario, `CHECK` de formato) y `ShoppingPlan.resultSnapshot`. Aplicada en la base de desarrollo; producción la aplica el build de la API al desplegar.
  - Dominio: `plan-status.ts` (transiciones, `effectiveStatus` con vencimiento por fecha argentina) y `plan-snapshot.ts` (`toPlanRecord`: columnas y snapshots `schemaVersion: 1`).
  - API: `ShoppingPlansService` + `ShoppingPlansController` (`POST /shopping-plans/generate` con `Idempotency-Key`, `GET /shopping-plans`, `GET /shopping-plans/:id`, `PATCH /shopping-plans/:id`), contratos en `presentation/shopping-plan.contracts.ts`, `packages/shared` y `docs/API.md` (sección "Planes de compra"). CORS permite `Idempotency-Key`.
  - Web: `app/(private)/plan-semanal/page.tsx` (con `Suspense`), `components/plans/plan-view.tsx`, `lib/plans/queries.ts`, enlace "Plan semanal" en la barra, tarjeta en `/inicio` (reemplaza "Lo que viene") y estilos `.plan-*`. `apiRequest`/`authRequest` aceptan cabeceras propias.
  - Tests: `test/shopping-plan-persistence.test.cjs` (3), `test/integration/shopping-plans-api.test.cjs` (9) y `apps/web/e2e/plan.e2e.cjs` (7, sumado a `test:e2e`). ADR 0015.

- **P6-01 (sesión 2026-09-29): historial y análisis de precios.**
  - Dominio puro `apps/api/src/modules/prices/domain/price-analysis.ts`: `argentineDate`/`argentineDayStart` (UTC−3 fijo), `dailyCloses` (última observación del día argentino, desempate ingesta e id), `analyzeSeries` (base de los 30 días anteriores al día del precio actual, promedio por día, mínimo con fecha, máximo, `ratioToAverage`, clasificación con precedencia `STALE` → `INSUFFICIENT_DATA` (< 7 días) → `HISTORIC_LOW` → `GOOD_DEAL` (< 0,85) → `EXPENSIVE` (> 1,15) → `NORMAL`).
  - `ProductPriceRepository.findBetween` y `findLatestPerSeries` (`DISTINCT ON (storeId, source)`); `GetPriceHistoryUseCase` (rango 1–366 días, `storeId` **o** ubicación con `StoreScopeResolver`, hasta 20 series, hasta 50.000 observaciones); ruta `GET /products/:id/price-history` en `ProductPricesController` con `PriceHistoryQueryDto`; contratos en `prices/presentation/price-history.contracts.ts`, `packages/shared` y `docs/API.md`.
  - Tests: `test/price-analysis.test.cjs` (9) e integración `test/integration/price-history.test.cjs` (7, último del runner porque inserta observaciones de otra fuente). ADR 0016.

## Verificaciones ejecutadas (P6-01, 2026-09-29)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (validate, generate, typecheck, lint, **140/140** unitarios, build API + web) |
| `npm.cmd run test:db` | **107/107** integración real (100 previos + 7 de `price-history.test.cjs`) |

Qué cubren los tests nuevos: día argentino en el borde de las 03:00 UTC; cierre diario con varios precios por día y empate de hora; umbrales exactos (82,449999 buena oferta, 82,45 normal; 111,55 normal, 111,550001 caro); mínimo nuevo gana a buena oferta y el empate con el mínimo no cuenta; base de 30 días que excluye el día actual y lo más viejo; promedio por día aunque haya nueve lecturas en uno; pocos días (6 no, 7 sí), solo el precio actual y sin datos; precio viejo `STALE` con base relativa a su fecha; determinismo. En integración contra la base sembrada: rango por defecto, series únicas por sucursal y fuente, puntos ordenados sin duplicar días; Disco Belgrano `STALE` (dejó de informar hace 12 días); Vea Flores con huecos día por medio y evidencia suficiente; localidad (Morón sin distancia) y radio real; rango acotado que no cambia el análisis y rango sin datos; **otra fuente = otra serie** y dos precios del mismo día = un punto con `observations: 2`; validaciones (orden de fechas, más de 366 días, día inexistente, formato, sucursal + ubicación, radio sin coordenadas, parámetro desconocido, uuid y producto inexistente).

No ejecutado en esta sesión: `npm.cmd run test:e2e` (no hubo cambios en la web desde P5-03) y `npm.cmd audit`.

## Decisiones y notas (P6-01)

- La base del análisis es **la ventana previa** al precio actual (ADR 0016): permite detectar un mínimo nuevo. "Mínimo histórico" = mínimo de esa ventana, y `baseWindow` lo dice.
- El análisis no depende del rango pedido; el rango solo filtra los puntos que se muestran.
- Las series se eligen por la observación más reciente (hasta 20) y se muestran ordenadas por cadena, sucursal y fuente.
- El ejemplo de `docs/API.md` salió de la base de desarrollo; como el seed se corrió con anclas de días distintos, ahí el máximo de la base coincide con el precio actual (el día 0 de cada corrida tiene el mismo precio). No es un error del análisis.

## Verificaciones ejecutadas (P5-03, 2026-09-29)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (validate, generate, typecheck, lint, **131/131** unitarios, build API + web con **13 rutas**) |
| `npm.cmd run test:db` | **100/100** integración real (91 previos + 9 de `shopping-plans-api.test.cjs`); la migración nueva se aplica dos veces sin drift |
| `npm.cmd run test:e2e` | **38/38** en Edge headless contra web + API reales (7 nuevos del plan, 13 de cuenta, 8 de auth, 10 de búsqueda) |
| Revisión visual | Capturas en `.cache/verification/p5-03/` (plan en escritorio y móvil 390 px) |

Cómo se corrió: puertos 3000/3001 ocupados por otro proyecto del usuario (ContextForge, no se tocó). `npm.cmd run db:deploy`, `npm.cmd run db:seed`; API con `PORT=3010 CORS_ORIGINS=http://127.0.0.1:3100,http://localhost:3100 npm.cmd run start` (desde `apps/api`, tras `build`); web con `API_ORIGIN=http://127.0.0.1:3010 npx.cmd next dev --hostname 127.0.0.1 --port 3100` (desde `apps/web`); `E2E_BASE_URL=http://127.0.0.1:3100 npm.cmd run test:e2e`. Servidores detenidos antes de `verify`.

Qué cubren los tests nuevos: transiciones y no-op, vencimiento por fecha, registro con `CHECK` que cierran, envases y peso, snapshot autosuficiente, sin base → ahorro 0/`NONE`; en HTTP: 401 en los cuatro endpoints, generación con cronograma, totales y ahorro no negativo, despensa intacta, reintento con la misma clave (200, mismo cuerpo), clave faltante/inválida, clave reusada con otras fechas (409), **tres pedidos simultáneos con la misma clave → un solo plan**, validación de ventana, plan parcial sin ubicación, promociones vigentes en la fecha recomendada, listado/lectura propios y ajeno = inexistente, activar/completar/reintentar, un solo activo por período, transiciones inválidas y vencido, **snapshot estable tras un precio nuevo**; en Edge: qué falta antes del primer plan, rutina → despensa → generar → cronograma (2 kg de pollo por peso tras 1 kg en despensa, arroz en envases, motivos, precio fechado, km, avisos, "cómo calculamos"), foco en el plan nuevo, **recarga con el mismo resultado** con y sin id, usar y completar, **respuesta perdida al generar que se reintenta sin duplicar**, "atrás" al plan anterior, móvil 390 px sin desborde, sin ubicación parcial sin ahorro.

No ejecutado en esta sesión: `npm.cmd audit` y el deploy a producción (no pedido).

## Decisiones y notas (P5-03)

- **Idempotencia por cabecera obligatoria** (ADR 0015). La web genera un UUID por intento y lo reutiliza solo si el error fue de conexión (`SERVICE_UNAVAILABLE`).
- `EXPIRED` **no se persiste**: se informa al leer si `endDate` < hoy (Argentina). Persistirlo y la retención/limpieza de planes van con los jobs (fase 8). No hay borrado de planes ni límite por usuario; el listado devuelve los últimos N (≤ 50) sin cursor.
- `inputSnapshot` guarda un **resumen** de candidatos (conteos por motivo), no todas las ofertas con sus fechas.
- Sin base comparable se guarda ahorro 0 con `baselineMethod = 'NONE'` y la API devuelve `estimatedSavings: null` (los `CHECK` exigen la resta).
- `/inicio` ya no dice "Lo que viene": la tarjeta lleva al plan semanal.
- Deuda de diseño (logo y tipografía) sigue pendiente en ROADMAP; no se tocó en este paso.

## Verificaciones ejecutadas (P5-02, 2026-09-29)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (validate, generate, typecheck, lint, **128/128** unitarios, build API + web con 12 rutas) |
| `npm.cmd run test:db` | **91/91** integración real (88 previos + 3 del optimizador) |

Qué cubren los tests nuevos: 5 kg a $8.000 contra $7.000/kg elige la segunda; segunda sucursal que ahorra $500 con $1.000 de penalidad se rechaza (y con $0 o $400 se acepta); una sola sucursal obligatoria; máximo de sucursales que deja un faltante `MAX_STORES_LIMIT` con base solo sobre lo cubierto; distancia ida y vuelta × $/km y sin coordenadas distancia desconocida; 2×1 con 1, 2 y 3 envases; la misma sucursal en dos días (dos visitas, una sucursal) y con penalidad una sola visita; empates deterministas; sin candidatos y todo cubierto por la despensa; sin sucursal con todo no hay base ni ahorro; importes que cierran (productos, regular, descuento, penalidades, efectivo, visitas, base); promociones bancarias y con mínimo excluidas con aviso; conteo de combinaciones; **200 canastas aleatorias contra enumeración exhaustiva independiente** (costo efectivo y cobertura idénticos, con máximos de sucursales, penalidades y distancias); presupuesto excedido con método aproximado que respeta el máximo y es determinista; ajustes inválidos. En integración: canasta semanal real con plan exacto, ≤ 2 sucursales, importes que cierran y ahorro no negativo frente a una sola sucursal; penalidad por visita alta → una visita; máximo 1 sucursal; sin ubicación sin líneas ni ahorro.

No ejecutado en esta sesión: `npm.cmd run test:e2e` (no hubo cambios en la web) y `npm.cmd audit`.

## Decisiones y notas (P5-02)

- **Base prudente**: sucursal más barata con todo, a precio regular (ADR 0014). El ahorro estimado solo cuenta productos y puede ser negativo; la diferencia de costo efectivo se informa aparte y no es dinero.
- **Presupuesto por operaciones, no por tiempo**: determinista. 100.000 combinaciones ≈ 150 ms en el peor caso medido (195.420 combinaciones exactas en ~300 ms).
- `OPTIMIZER_VERSION = 'planner-2026-09-29.1'`: cambiarla si cambia el algoritmo o el contrato; P5-03 la guarda en `ShoppingPlan.optimizerVersion`.
- Para persistir (P5-03): `estimatedRegularCost` = `baseline.productCost` y `estimatedSavings` = `savings.estimatedSavings` cuando hay base; **sin base** guardar `estimatedRegularCost = optimizedCost` (ahorro 0) con `baselineMethod = 'NONE'` y que la UI no muestre ahorro (los `CHECK` exigen la igualdad). `optimizedCost` = `totals.productCost`, penalidades y `effectiveCost` de `totals`, `totalDistanceKm` puede ser null.
- Cada `PlanLine` tiene lo necesario para `ShoppingPlanItem` (canónico, producto, sucursal, `priceBasis.observationId`, promoción, `neededQuantity`, `purchase.purchasedQuantity`, envases, totales, fecha y `reason`). Para venta por peso `packageCount` es null.

## Verificaciones ejecutadas (P5-01, 2026-09-29)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (validate, generate, typecheck, lint, **112/112** unitarios, build API + web con 12 rutas) |
| `npm.cmd run test:db` | **88/88** integración real (80 previos + 8 de `shopping-plans.test.cjs`) |

Qué cubren los tests nuevos: ventana por defecto de 7 días y rechazo de fechas imposibles, fin anterior y horizonte excedido; mediodía argentino y día ISO; ocurrencias con ancla anterior, posterior y dentro de la ventana, diaria, quincenal (15 días no son dos semanas) y ventana de dos semanas; **5 kg − 2 kg = 3 kg**; despensa mayor, igual y cero; **dos rutinas con el mismo canónico restando la despensa una vez**; cantidades fraccionarias; ítem sin ocurrencias registrado; unidades incompatibles (ítem en L para canónico en KG, despensa en otra unidad no restada, canónico inexistente); restricciones combinadas y conflicto de exactas; venta por peso con precio como estimación fechada; **envases con excedente** (900 ml × 4 para 3 L); **preferido sin sustituto exacto**; preferido desactivado con y sin reemplazos; marcas excluidas sin distinguir mayúsculas; dimensión distinta; **precio stale** descartado y necesidad `ONLY_STALE_PRICES`; sin precio en el alcance; **sin ubicación**; solo localidad con aviso; promoción de los martes solo el martes y bancaria nunca aplicada; 2×1 con uno y dos envases; recorte de sucursales por cobertura/costo/distancia, de ofertas por sucursal conservando la preferida y de fechas; determinismo con la entrada invertida. En integración, contra la base sembrada: 5 kg − 2000 g con ofertas a ≤ 5 km por PostGIS, dos rutinas, quincenal fuera y dentro de la ventana, preferido exacto con el 20 % de Carrefour Almagro aplicado y la bancaria `PAYMENT_CONDITIONED`, CABA por localidad sin distancias y Disco Belgrano descartado por precio viejo, Morón con la sucursal sin coordenadas, sin ubicación, aislamiento entre cuentas y errores 400/401.

No ejecutado en esta sesión: `npm.cmd run test:e2e` (no hubo cambios en la web) y `npm.cmd audit`.

## Decisiones y notas (P5-01)

- **La ventana es un período de compra**: la necesidad es la suma de las ocurrencias y cualquier fecha evaluada sirve; `firstOccurrence` queda en la salida por si P5-02 decide exigir comprar antes (ADR 0013).
- **Precios viejos se descartan** (no se usan como estimación) con `PRICE_STALE` y su antigüedad. **Sin ubicación no hay sucursales** (`NO_LOCATION`), nunca "todas".
- Cada fecha se cobra al **mediodía argentino** (15:00 UTC). Las promociones que no alcanzan a la oferta no se listan; las que sí, se listan por fecha con su `skipReason`.
- **No se fuerza cantidad extra para activar un 2×1**: con 500 g de fideos se compra un envase y el 2×1 figura `NO_SAVINGS`. Explorar cantidades mayores (y mínimos de compra por sucursal, hoy `MINIMUM_SPEND_UNKNOWN`) es trabajo de P5-02.
- El recorte conserva siempre la presentación preferida en cada sucursal, además de las N más baratas: la preferencia no está en la función de costo, así que la resuelve el optimizador (por ejemplo, como desempate).
- `findCurrentByProducts` con `storeIds` vacío devuelve **todas** las sucursales: el caso de uso no consulta precios si no hay sucursales en el alcance.
- `ProductRepository.listByCanonicalProducts` trae hasta 2000 presentaciones; con catálogo real (fase 7) puede hacer falta acotar por necesidad.

## Verificaciones ejecutadas (P4-02, 2026-09-27)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (validate, generate, typecheck, lint, **80/80** unitarios, build API + web con **12 rutas**) |
| `npm.cmd run test:db` | **80/80** integración real (79 previos + 1 de `onboardingCompleted` en `routines-api.test.cjs`) |
| `npm.cmd run test:e2e` | **31/31** en Edge headless contra web + API reales (13 de cuenta, 8 de auth, 10 de búsqueda) |
| Revisión visual | Capturas en `.cache/verification/p4-02/` (onboarding y mis compras en escritorio; móvil 390 px de todas las páginas privadas y del editor abierto) |

Cómo se corrió: el puerto 3000 estaba ocupado por otro proceso del usuario (no se tocó). `npm.cmd run db:seed`; API con `PORT=3010 CORS_ORIGINS=http://127.0.0.1:3100,http://localhost:3100 npm.cmd run start` (desde `apps/api`, tras `build`); web con `API_ORIGIN=http://127.0.0.1:3010 npx.cmd next dev --hostname 127.0.0.1 --port 3100` (desde `apps/web`); luego `E2E_BASE_URL=http://127.0.0.1:3100 npm.cmd run test:e2e`. Los servidores se detuvieron antes de `verify` (el build y `next dev` comparten `.next`).

Qué cubren los E2E nuevos: registro → onboarding sin pedir ubicación; zona, radio 10 km y "sin límite" guardados; retomar tras recargar (paso guardado y datos precargados); cantidad inválida con error en el campo y foco; **5 kg de pollo semanal**; alta cuya respuesta se pierde (la API la guardó) y el reintento se informa como "ya estaba" sin duplicar ítems ni rutinas; 500 g de arroz mostrados como 0,5 kg; persistencia tras reload; terminar marca el onboarding y el aviso desaparece; **2 kg de pollo en despensa** visibles junto a la necesidad; producto ya cargado deshabilitado en el buscador; edición con frecuencia propia de 15 días y marcas, con el error `BRANDS_OVERLAP` junto al campo; borrado con confirmación, cancelar que devuelve el foco y borrado persistente; editar y borrar en la despensa; alta completa solo con teclado; **cuenta sin rutina y sin ubicación** que omite todo, con `/buscar` usable antes de terminar; geolocalización solo tras el botón (permiso concedido, guardado, quitado) y aviso al denegarla; localidad sin provincia marcada en el campo; móvil 390 px sin desborde en las seis pantallas y con el editor abierto; logout y login de otra cuenta en la misma pestaña sin datos de la anterior.

No ejecutado en esta sesión: `npm.cmd audit` y el deploy de P4-02 a producción.

## Decisiones y notas (P4-02)

- **Terminar el onboarding** es `onboardingCompleted: true` en `PATCH /users/me`, no un endpoint nuevo; solo `true`, fecha del servidor, idempotente (ADR 0012).
- **Progreso**: los datos se guardan en la API en cada "Continuar"; el paso va en `?paso=` y, para retomar sin él, en `localStorage` como número por cuenta (`tusofertas:onboarding-step:<userId>`). No es un secreto; si el storage falla se vuelve al paso 1 con los datos ya cargados.
- **La vista de onboarding lee `localStorage` en un inicializador de `useState`**: es seguro porque `PrivateShell` solo monta hijos con sesión, ya en el navegador (nunca en SSR).
- **Rutina del onboarding** = la primera de la cuenta, creada con el primer producto ("Compras habituales"). `useEnsureRoutine` vuelve a listar antes de crear.
- **Cantidades**: se acepta coma o punto decimal; "1.500" se lee como 1,5 (no hay separador de miles) y la pantalla devuelve el valor formateado para que se note.
- **Frecuencia propia de un ítem**: al elegirla se envía con el ancla de la rutina (o la propia que ya tuviera); "igual que la lista" envía `null`+`null` solo si antes tenía una propia.
- Los editores de ítem y de despensa ponen el foco en la cantidad al abrirse, porque el botón elegido desaparece.
- **Producción sin actualizar**: P4-02 no se desplegó en esta sesión. Para publicarlo: deploy de la API (por el cambio de `PATCH /users/me`) y después de la web, con los comandos de "Deploy". En producción el buscador de canónicos no devuelve nada hasta la fase 7 (no hay catálogo), así que el paso de productos queda vacío.

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

**Incidente 2026-09-28 (resuelto el 2026-09-29): base de producción suspendida.** `vercel integration list --all` mostró `tusofertas-db` (Supabase) como **Suspended**: `/api/health/ready` daba 503 (`database: down`) y todo login/registro en producción devolvía 500. No era un bug del código; el usuario reactivó el recurso desde el dashboard. El 2026-09-29 volvió a figurar **Available**, `ready` 200 con `database: up`, y se creó la cuenta de prueba `prueba@example.com` en producción (registro 201, login 200, `/users/me` 200; la contraseña la tiene el usuario, no se guarda acá). Si vuelve a pasar: mismo diagnóstico y reactivar desde Vercel → Storage → `tusofertas-db` (o `vercel integration open supabase`). En local también existe `prueba@example.com` en la base de desarrollo. Producción sigue **sin P4-02**.

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
- **Deploy de la API (ADR 0010)** `06ab251` (publicado). IP de cliente en Vercel: `3c6c3c7` (publicado).
- **P4-02** `7092b2b` (publicado).
- **P5-01** `8288c45` (publicado).
- **P5-02** `a750151` (publicado).
- **P5-03** `22cdc58` (publicado).
- **P6-01**: commit `feat(P6-01): ...` del 2026-09-29 (ver `git log`).
- `apps/web/next-env.d.ts` aparece modificado cada vez que corre `next dev`/`build`: es generado y versionado a pedido del propio archivo; commitearlo si cambia.

## Cómo seguir con P6-02

1. Leer `AGENTS.md`, `ROADMAP.md`, `docs/steps/phase-06.md` (P6-02), ADR 0004, 0015 y 0016, `apps/web/AGENTS.md` y las guías de Next 16 en `node_modules/next/dist/docs/` antes de tocar la web.
2. `git status --short --branch`, `git log -4 --oneline`, `docker compose up -d`, `npm.cmd run db:deploy`, `npm.cmd run db:seed`.
3. `/producto/[id]`: gráfico accesible del historial (SVG propio o sin dependencias nuevas que compliquen el lockfile; ver notas de Deploy) con filtro de sucursal y período (`from`/`to` en la URL), tabla o resumen equivalente, huecos visibles (sin unir días faltantes como si hubiera dato), fecha y fuente, y la etiqueta del análisis con su explicación (promedio, mínimo con fecha, ventana, "datos insuficientes" o "desactualizado").
4. `/dashboard` (privado): próxima compra (plan `ACTIVE` o el último `DRAFT` vigente), rutinas, oportunidades (por ejemplo productos habituales con `GOOD_DEAL` o `HISTORIC_LOW` cerca) y ahorro **estimado** semanal/mensual/acumulado que tome **un solo plan por período** (el `ACTIVE`/`COMPLETED`; nunca borradores ni planes reemplazados o superpuestos). Si reduce composición en el frontend, un endpoint privado de resumen. **Ahorro registrado**: no existe registro de compras, así que se muestra "sin compras registradas" y nunca se suman estimaciones como ahorro real.
5. Estados sin rutina, sin plan o sin datos con acciones útiles. Las alertas (fase 9) no se muestran como enviadas.
6. Tests: resumen contra datos persistidos, períodos y duplicación, generar/completar no cambia ahorro registrado; E2E de historial con filtros y dashboard vacío/parcial/completo, móvil y teclado.
7. `npm.cmd run verify`, `npm.cmd run test:db`, `npm.cmd run test:e2e`; actualizar README/ROADMAP/CONTINUAR/CLAUDE.md; commit y push. Con P6-02 se cierra la fase 6 (siguiente: P7-01).

## Prompt listo para pegar (Claude o Codex)

> Continuá el proyecto en C:\Users\PC\Desktop\TusOfertasApp\solucionadoApp. Leé primero CLAUDE.md (o AGENTS.md) y CONTINUAR.md. Las fases 1 a 5 y P6-01 (historial y análisis de precios, ADR 0016) ya están implementadas, probadas y publicadas en GitHub; no las rehagas. El próximo paso es P6-02 (gráfico del historial y dashboard de ahorro estimado), descrito en docs/steps/phase-06.md. Probalo con npm.cmd run verify, npm.cmd run test:db y npm.cmd run test:e2e, y actualizá README, ROADMAP, CONTINUAR y CLAUDE.md. Tenés autorización para commit y push al completar cada paso; no pidas confirmaciones rutinarias. No marques como probado lo que no ejecutaste.
