# Punto de continuación

## Traspaso — leer esto primero (Claude o Codex)

Este archivo es la fuente del estado de trabajo; no depender del historial de chat. `AGENTS.md` contiene las reglas, `CLAUDE.md` el arranque para Claude, `apps/web/AGENTS.md` las reglas de Next 16 (leer las guías de `node_modules/next/dist/docs/` antes de tocar la web) y `docs/steps/` las instrucciones de cada paso. **No rehacer lo terminado**: fases 1 a 4 completas (P0-01, P1-01 a P1-04, P2-01 a P2-03, P3-01, P3-02, P4-01, P4-02) , **fase 5 completa** (P5-01 a P5-03), **fase 6 completa** (P6-01, P6-02), **fase 7 completa** (P7-01, P7-02), **fase 8 completa** (P8-01, P8-02), **fase 9 completa** (P9-01, P9-02), **fase 10 completa** (P10-01, P10-02): **las diez fases están terminadas**. Lo que sigue es trabajo separado, sin paso asignado (redespliegue, worker, fuente real y diseño; ver "Cómo seguir"). Resolver decisiones rutinarias siguiendo los ADRs (0001–0025) y el formato de respuestas de `docs/API.md`, sin confirmaciones innecesarias. Al cerrar cada paso actualizar **CONTINUAR.md, CLAUDE.md y ROADMAP.md** (y README si cambia la operación), luego commit y push.

Los resultados de abajo son el registro de las sesiones del 2026-09-18 al 2026-10-01, no una garantía del estado de servicios en una fecha posterior. No hay implementación parcial que recuperar.

## Estado: 2026-10-01 — Las diez fases completas (P10-02 cerrado)

Raíz: `C:\Users\PC\Desktop\TusOfertasApp\solucionadoApp`. Remoto: `git@github.com:matiasstr/solucionadoApp.git`. Rama: `main`.

**Próximo paso: trabajo separado, sin paso asignado** (ROADMAP, "Después de las diez fases"): redesplegar producción, desplegar worker y Redis, conectar una fuente real y la deuda de diseño. Detalle en "Cómo seguir" al final de este archivo.
Los beneficios de pago se usan en el plan (pagar hoy, reintegro, costo final; ADR 0024), el comparador (`paymentBenefits`) y las pantallas; el resumen y las alertas analizan todas las series sin tope oculto (ADR 0025). No hay una fuente real de precios ni de promociones; el worker de jobs no está desplegado (preparado con imágenes y runbook), así que en producción las alertas no se evaluarían. **Producción tiene todo hasta P8-01** (último deploy: 2026-09-30, commit `337320b`): le faltan P8-02 (sin cambios HTTP), P9-01 (API `/alerts` y `/notifications`), P9-02 (pantallas de alertas), P10-01 (`/benefits`, `/benefit-usage`, campos nuevos de promociones; migración `20261001120000_payment_benefits`) y P10-02 (plan versión 2, `paymentBenefits` en ofertas, pantallas; sin migración nueva); el próximo deploy de la API aplica las migraciones `20260930120000_import_run_progress_time`, `20260930180000_price_alerts_notifications` y `20261001120000_payment_benefits` (aditivas; la última reemplaza un `CHECK` de `Promotion` por uno compatible con las promociones existentes). Ver "Deploy". Deuda de diseño pendiente (logo y tipografía): ver ROADMAP, sección "Deuda de diseño".

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
  - Tests: `test/price-analysis.test.cjs` (9) e integración `test/integration/price-history.test.cjs` (7; corre hacia el final porque inserta observaciones de otra fuente). ADR 0016.

- **P6-02 (sesión 2026-09-29): historial visual y resumen.** Cierra la fase 6.
  - API: módulo `apps/api/src/modules/dashboard/` (`domain/savings-summary.ts` con `selectPlansForSavings`/`summarizeSavings`/`weekStart`, `domain/opportunities.ts` con `rankOpportunities`, `application/get-dashboard.use-case.ts`, `presentation/dashboard.controller.ts` y contratos) registrado en `AppModule`: `GET /dashboard` privado. `ProductPriceRepository.findBetween` y `findLatestPerSeries` ahora reciben **varios productos** (`DISTINCT ON (productId, storeId, source)`).
  - Web: `components/product/price-history.tsx` (gráfico SVG, análisis explicado, tabla) integrado en la ficha con `periodo`/`sucursal` en la URL (los filtros de la comparación los conservan); `components/dashboard/dashboard-view.tsx`, `app/(private)/dashboard/page.tsx`, `lib/dashboard/queries.ts`, `usePriceHistory` en `lib/catalog/queries.ts`, enlace "Resumen" en la barra y en `/inicio`; los cambios de plan invalidan el resumen. Estilos `.history-*` y `.dashboard-*`.
  - Contratos en `packages/shared` y `docs/API.md` (secciones del historial y "Resumen"). ADR 0017.
  - Tests: `test/dashboard-savings.test.cjs` (6), `test/integration/dashboard.test.cjs` (4, último del runner: inserta un precio bajo) y `apps/web/e2e/history.e2e.cjs` (7, sumado a `test:e2e`).

- **P7-01 (sesión 2026-09-29): puertos de proveedores e importador por lotes.** Abre la fase 7.
  - Migración `20260929180000_external_identity_refs`: `ExternalProductRef` y `ExternalStoreRef` (únicas por `(source, externalId)`, `CHECK` de claves no vacías). Aplicada en la base de desarrollo.
  - `apps/api/src/modules/imports/`: `domain/import.types.ts` (contratos crudos, normalizados, motivos, resumen), `domain/import-normalizer.ts` (`parseLocalizedDecimal`, `isValidGtin`, `parseUnit`, `parseSaleMode`, `parseObservedAt`, `normalizeStore`/`normalizeProduct`/`normalizePriceRecord`/`normalizePromotionRecord`), `domain/batching.ts` (`runBatches`, `BatchRunError`), `application/ports.ts`, `application/import-run.ts` (`ImportRun`, `importId`, `sanitizeError`, `ImportProviderError`), `application/price-importer.ts`, `application/promotion-importer.ts`, `infrastructure/prisma-import.gateway.ts`, `infrastructure/providers/mock-price.provider.ts` (`MockPriceProvider`, `MockPromotionProvider`) y `json-lines-price.provider.ts` (`readLines`), `cli.ts`. Sin módulo Nest ni endpoints.
  - Repositorios: `ProductPriceRepository.recordBatch` (`INSERT … ON CONFLICT DO NOTHING RETURNING`), `ProductRepository.findManyByIds`/`findByEans`, `CanonicalProductRepository.findByNormalizedNames`. `uuidV5` pasó a `src/common/uuid-v5.ts` (el seed lo reutiliza).
  - Scripts: `npm.cmd run import` (raíz y API). `scripts/test-db.cjs` corre ahora **un proceso por archivo en el orden declarado** e imprime el total.
  - Tests: `test/import-normalizer.test.cjs` (6), `test/import-batching.test.cjs` (7) e integración `test/integration/imports.test.cjs` (8, último). ADR 0018.

- **P7-02 (sesión 2026-09-29): ejecuciones, cuarentena y recuperación.** Cierra la fase 7.
  - Migración `20260929220000_import_runs_quarantine`: enums `ImportKind`/`ImportRunStatus`, tablas `ImportRun` (contadores, `committedPosition`, `resumedFromId`, `error`; `CHECK` de contadores y de `finishedAt`) y `QuarantinedRecord`. Aplicada en desarrollo.
  - Dominio `imports/domain/recovery.ts` (`withRetries` con `shouldRetry`, `CommitWatermark`). `ImportRun` reescrito: `begin` con un `ImportRunRecorder`, cuarentena por tandas (`QUARANTINE_FLUSH_SIZE` = 500), `checkpoint` después de cada lote, `end`; `MEMORY_RECORDER` por defecto. Importadores con `recorder`, `retry` y `resume`; `assertResumable`. Lote máximo 1.000.
  - `infrastructure/prisma-import-run.recorder.ts` (`start`, `quarantine`, `progress`, `finish`, `find`, `report`). Proveedores con `replayable`; `JsonLinesPriceProvider` con `url` + `allowedHosts` (`assertAllowedUrl`, sin redirecciones, tiempo y tamaño máximos). CLI con `--url`, `--resume`, `--max-retries`, `--report` e `IMPORT_ALLOWED_HOSTS`.
  - Docs: `docs/IMPORTS.md` (guía para proveedores) y ADR 0019. Tests: `test/import-recovery.test.cjs` (4) y 6 nuevos en `test/integration/imports.test.cjs`.

- **P8-01 (sesión 2026-09-29): Redis, BullMQ, worker y comandos.** Abre la fase 8.
  - Dependencias `bullmq` 6.3.9 e `ioredis` 6.0.0 (exactas, CommonJS; BullMQ 6 carga ioredis solo si está instalado). Lockfile con los binarios de `msgpackr-extract` de todas las plataformas.
  - `modules/jobs/domain/job-contracts.ts`: nombres, colas (`imports`, `plans`, `alerts`), datos por job con `parseJobPayload` estricto (al encolar y al procesar), `jobIdFor` por ejecución lógica, `upcomingWeekStart`. `jobs.config.ts`: `validateJobsEnvironment` (`REDIS_URL`, `JOBS_*`, `IMPORT_FILES_DIR`, `IMPORT_ALLOWED_HOSTS`).
  - `jobs/application/`: `JobContext` (sin BullMQ), `JobFailedError`/`PermanentJobError`, `ImportJobRunner` (reanuda en el reintento la ejecución `FAILED` anotada en el progreso del job) y `WeeklyPlansJobRunner` (usuarios con rutinas con productos, por páginas). `ShoppingPlansService.generateScheduled` (no guarda planes vacíos); el servicio ahora se exporta del módulo.
  - `jobs/infrastructure/`: `redis-connection.ts` (worker reconecta siempre; comando falla rápido), `job-producer.ts` (`enqueue` con dedupe y `JobConflictError`, `status`, `counts`), `job-workers.ts` (`startJobWorkers`, un worker por cola, errores saneados, `UnrecoverableError` para fallas permanentes, `RedisUnavailableError` al arrancar).
  - `jobs/worker.module.ts` (`WorkerModule`, `createWorkerContext`), `src/worker.ts` (entrypoint con apagado ordenado) y `jobs/cli.ts`. Scripts `npm.cmd run worker` y `npm.cmd run jobs` (raíz y API).
  - `imports/infrastructure/import-target.ts` (`importTargetProblem`): el resguardo "nunca producción ni base remota sin permiso" ahora lo comparten el comando de importación y los jobs.
  - Docs: ADR 0020, README ("Jobs y worker"), `apps/api/.env.example`. Tests: `test/jobs.test.cjs` (8) e integración `test/integration/jobs.test.cjs` (9, último del runner, con Redis real y prefijo propio).

- **P8-02 (sesión 2026-09-30): programación, operación e imágenes.** Cierra la fase 8.
  - Migración `20260930120000_import_run_progress_time` (`ImportRun.updatedAt`, último avance). Importadores con `onRunStarted`; `PrismaImportRunRecorder.markInterrupted`/`closeStale` e `INTERRUPTED_ERROR`.
  - Contratos: `anchorDate`/`weekStart` aceptan `null` (relativas), `resolveAnchorDate`/`resolveWeekStart`, `PERMANENT_FAILURE`/`isPermanentFailure`, `importRunIdOf`. `JobContext.scheduledFor` (instante del turno desde el id `repeat:<id>:<ms>`, `scheduledFor()` exportada en `job-workers.ts`). `ImportJobRunner` anota la ejecución al empezar y en el reintento cierra la que quedó abierta y la reanuda.
  - `job-workers.ts`: fallas permanentes marcadas en el progreso, logs con `importRunId`, `runtime.ready()`. `job-producer.ts`: `schedule`/`schedules`/`unschedule` (`SCHEDULE_TIME_ZONE`, cron de 5 campos), `failed`, `retry` (`JobRetryError`, `--force`), `health` (retraso). `application/operations-report.ts` (`OperationsReport.snapshot`). `infrastructure/worker-health.ts` (`/health`, `/ready`). `jobs.config.ts`: `JOBS_STALE_RUN_MINUTES`, `PRICE_MAX_AGE_DAYS`, `WORKER_HEALTH_PORT`/`HOST`.
  - `src/worker.ts`: servidor de salud y `--until-idle`. `jobs/cli.ts`: `schedule`, `schedules`, `unschedule`, `failed`, `retry`, `report`, `close-stale-runs`.
  - `apps/api/Dockerfile` (`api`, `worker`, `migrate`), `.dockerignore`, perfil `app` en `docker-compose.yml`. Docs: ADR 0021, `docs/RUNBOOK.md`, README, `.env.example`. Tests: 5 unitarios nuevos en `test/jobs.test.cjs` y 9 de integración en `test/integration/jobs.test.cjs` (describe "operación de jobs").

- **P9-01 (sesión 2026-09-30): alertas de precio y bandeja.** Abre la fase 9.
  - Migración `20260930180000_price_alerts_notifications`: enums `AlertCondition`/`NotificationKind`, tablas `PriceAlertRule` (`revision`, `notifiedUnitPrice`, `lastOutcome`, …; `CHECK` de moneda ARS, objetivo según condición, positivo, radio, sustitutos, marcas ≤ 20) y `Notification` (snapshot, `readAt`; único `(ruleId, eventKey)`, `ruleId` pasa a `null` al borrar la regla).
  - Dominio `alerts/domain/`: `alert-rules.ts` (`assertAlertRule`, `MAX_ALERT_RULES_PER_USER` = 20), `alert-evaluation.ts` (`eligibleProducts`, `evaluateRule`, `decide`, `alertEventKey`), `notification-content.ts` (`buildNotificationContent`, `formatArs`).
  - Aplicación: `PriceAlertsService` (CRUD con ownership, límite con bloqueo del usuario, `revision` +1 y rearmado en cada edición), `NotificationsService` (cursor, `unread`, `unreadCount`, leído idempotente), `EvaluatePriceAlertsUseCase` (`run`, `evaluateUser` sin escribir, `apply` con `FOR UPDATE` y `createMany … skipDuplicates`). Controladores `AlertsController` y `NotificationsController`; `AlertsModule` en la raíz y en el worker.
  - `prices/application/current-price-analysis.ts` (`CurrentPriceAnalysis`): el análisis del precio actual por serie, extraído del dashboard; `GetDashboardUseCase` ahora lo usa (sin cambio de comportamiento, 152/152).
  - Config: `ALERT_COOLDOWN_HOURS` (24, 0 a 720) en `ApiConfig.alerts`; `JOBS_ALERT_CONCURRENCY` (1). Jobs: `CHECK_PRICE_ALERTS` implementado, payload `{ v, userId }` (reemplaza `{ v, asOf }`, que nunca se había encolado), cola `alerts` consumida por el worker, id `price-alerts-<día>-<resumen>` o `--key`; `schedule CHECK_PRICE_ALERTS` con id `price-alerts`.
  - Contratos en `packages/shared` (`PriceAlertDto`, `NotificationDto`, …), `docs/API.md` (sección "Alertas y avisos"), ADR 0022, README, RUNBOOK. Tests: `test/alerts.test.cjs` (8), `test/integration/alerts.test.cjs` (8, después de `dashboard` en el runner) y 1 en `test/integration/jobs.test.cjs`.

- **P9-02 (sesión 2026-09-30): pantallas de alertas y bandeja.** Cierra la fase 9.
  - `apps/web/src/lib/alerts/queries.ts` (`useAlerts`, `useCreateAlert`, `useUpdateAlert`, `useDeleteAlert`, `useNotifications` con `useInfiniteQuery`, `useLatestNotifications`, `useMarkNotificationRead`; claves por usuario) y `lib/alerts/format.ts` (textos de condición, alcance y `lastOutcome`, `packageEquivalent`, `parsePriceInput`).
  - `components/alerts/alert-creator.tsx` (`AlertCreator` en la ficha, ancla `#crear-alerta` con foco al llegar desde el buscador; ingresar si no hay sesión) y `components/alerts/alerts-view.tsx` (bandeja y administración). Página `app/(private)/alertas/page.tsx`.
  - Cambios: link "Alertas" con contador de no leídos en `private-shell.tsx`, tarjeta "Avisos de precio" en `dashboard-view.tsx`, `AlertCreator` en `product-view.tsx`, link "Avisame si baja" en `product-card.tsx`, estilos al final de `globals.css` (incluye `.sr-only`).
  - E2E `apps/web/e2e/alerts.e2e.cjs` (en `test:e2e`); `search.e2e.cjs` (tabula hasta la tarjeta y verifica la acción de alerta) y `history.e2e.cjs` (link de la tarjeta) ajustados por el link nuevo.

- **P10-01 (sesión 2026-09-30): beneficios de pago, elegibilidad y topes.** Abre la fase 10.
  - Migración `20261001120000_payment_benefits` (enum `BenefitTiming`; `Promotion.discountAmount`, `benefitTiming`, `refundDelayDays`, `capGroup`; `CHECK` de tipo reemplazado y nuevos; tabla `BenefitCapUsage`).
  - Dominio `promotions/domain/`: `PromotionRule` con los campos nuevos y su validación (`DISCOUNT_AMOUNT`, `REFUND`, `CAP_GROUP`); `payer-eligibility.ts` (`payerEligibility`, tres estados); `benefit-engine.ts` (`evaluateBenefits`, `capKeyOf`, `capPeriodKey`, `isoWeekKey`); `promotion-eligibility.ts` separa `calendarOrScopeSkipReason`; `promotion-calculator.ts` exporta `lineOutcome` (sin cambiar `priceLine`).
  - Módulo `benefits/`: `EvaluateBenefitsUseCase` (precios actuales con `GetCurrentPricesUseCase`, promociones con `findActiveBetween`, preferencias y consumo informado), `BenefitUsageService`, controladores `BenefitsController` y `BenefitUsageController`, DTOs con validación anidada (primer uso de `@ValidateNested`).
  - Contratos: `promotion.contracts.ts` y `packages/shared` (`discountAmount`, `benefit`, `stackable`, `capGroup`; tipos de la evaluación y del consumo). Importador (`import.types.ts`, `import-normalizer.ts` con alias `reintegro`/`inmediato`, `promotion-importer.ts` con `capGroup` prefijado por la fuente). Seed DEMO: `coto-banco-reintegro-miercoles`, `vea-banco-demo-20` (mismo tope mensual) y `jumbo-billetera-1500`.
  - Tests: `test/benefit-engine.test.cjs` (12), `test/integration/benefits.test.cjs` (7, después de `alerts` en el runner); helpers de reglas de cinco tests existentes con los campos nuevos; `promotions.test.cjs` con el contrato nuevo.

- **P10-02 (sesión 2026-10-01): beneficios en el plan, el comparador y las pantallas; validación final.** Cierra la fase 10 y las diez fases. Parte 1 (API del plan) en `755329a`.
  - Dominio `shopping-plans/domain/plan-benefits.ts`: `PlanBenefitContext`, `isLineVerifiable`, `costRelevantRules`, `BasketEvaluator` (cada visita = una compra de `evaluateBenefits`), `searchBaskets` (`EXHAUSTIVE` dentro del presupuesto; si no `LOCAL_SEARCH` determinista que siempre evalúa primero el plan por líneas).
  - `plan-optimizer.ts`: `optimizePlan(input, settings, benefits?)`.
    - Visitas con `paymentDiscount`, `payToday`, `refundEstimated`, `payment` y `benefitNotes`.
    - Totales con `paymentDiscount`, `payToday`, `refundEstimated`, `costAfterRefund`, `conditionalAmount` y `effectiveCostAfterRefund`.
    - `search.basketSearch`/`basketEvaluations` y `benefits` (lo declarado, topes, `criteria`).
    - Motivo `BASKET_BENEFIT_CHOICE`, que nombra el beneficio de la compra. `CHEAPER_OPTION_NOT_WORTH_IT` queda solo para visitas que el plan no hace.
    - Limitaciones `REFUND_PENDING`, `BENEFITS_CONDITIONAL` y `BASKET_BENEFITS_APPROXIMATED`. `OPTIMIZER_VERSION` `planner-2026-10-01.1`.
    - El ahorro estimado es base − `payToday` (nunca reintegros). `conditionsOf` vive en `promotions/domain/benefit-conditions.ts` (compartido con el comparador).
  - `PlanShoppingUseCase` carga preferencias de pago y `BenefitCapUsage`; `BuildPlanCandidatesUseCase.executeWithPromotions` devuelve también las reglas. Config `PLANNER_MAX_BASKET_EVALUATIONS` (2000, 1 a 50.000).
  - Snapshots `schemaVersion: 2`. La API lee 1 y 2 (`READABLE_SNAPSHOT_VERSIONS`) y completa los planes viejos sin recalcular (`refundEstimated: null`, `benefits: null`). **`optimizedCost` guarda `payToday`** para que sigan cerrando los `CHECK` de `ShoppingPlan` (sin migración).
  - Comparador: `OfferPromotionResolver.paymentBenefits` agrega `paymentBenefits` a cada oferta de `GET /products` y `GET /canonical-products/:id/prices`: beneficios de banco, medio o membresía vigentes, con `availableToday` y `conditions`. No cambian precio ni orden.
  - Web:
    - `lib/benefits/format.ts` (condiciones legibles, motivos, períodos de tope) y `lib/benefits/queries.ts` (promociones condicionadas, `/benefit-usage`).
    - `components/preferences/payment-fields.tsx` (medios, bancos y programas con sugerencias), `components/preferences/cap-usage.tsx` ("Topes de beneficios ya usados").
    - Plan (`plan-view.tsx`): pagar hoy / reintegro / costo final, pago por compra, notas y criterios con topes nombrados.
    - Comparador (`product-view.tsx`, lista `.offer-benefits`) y tarjeta (`product-card.tsx`, también corrige el link "Avisame si baja" que se salía de la tarjeta).
    - Onboarding (medios opcionales en el paso 2) y textos de alertas. `HttpMethod` admite `PUT`.
  - Validación a escala (ADR 0025):
    - `ProductPriceRepository.findCurrentWithWindowStats` (ventana de 30 días resumida en SQL) + `classifyCurrentPrice`/`summarizeCloses` en `price-analysis.ts`. `CurrentPriceAnalysis` ya no trunca en 50.000 observaciones.
    - `findCurrentByProducts` con sucursales usa `LATERAL … LIMIT 1` por índice.
    - `apps/api/scripts/bench-api.cjs` y la sección de tiempos del RUNBOOK.
  - Contratos en `packages/shared` (`BenefitConditionsDto`, `PlanVisitPaymentDto`, `PlanBenefitNoteDto`, `PlanBenefitsSummaryDto`, `OfferPaymentBenefitDto`, `InformBenefitUsageRequest`, `InformedBenefitUsageDto`, `UpdateProfileRequest` con medios), `docs/API.md`, ADR 0024 y 0025, README final (catálogo de endpoints, diagrama, limitaciones), ARCHITECTURE y RUNBOOK.
  - Tests:
    - `test/shopping-plan-benefits.test.cjs` (12, con enumeración independiente en 150 canastas y los `CHECK` de cada registro), `shopping-plan-persistence.test.cjs` y `environment.test.cjs`.
    - Integración: 3 en `shopping-plans-api.test.cjs`, `search-api.test.cjs` (`paymentBenefits`) y `test/integration/price-analysis-sql.test.cjs` (2, SQL contra memoria serie por serie; en el runner después de `price-history`).
    - E2E `apps/web/e2e/journey.e2e.cjs` (6, en `test:e2e`).

## Verificaciones ejecutadas (P10-02, 2026-10-01)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (**208/208** unitarios, typecheck y lint de API y web, build API + web) |
| `npm.cmd run test:db` | **164/164** en 16 archivos. Recrea la base `_test`, aplica las migraciones dos veces y verifica que no haya drift (migraciones en base nueva). Incluye 3 nuevos de planes, `paymentBenefits` y 2 de equivalencia SQL |
| `npm.cmd run test:e2e` | **55/55** en Edge contra API 3010 y web 3100 (`E2E_BASE_URL=http://127.0.0.1:3100`); 6 nuevos del recorrido completo |
| Benchmark (`scripts/bench-api.cjs`, base aparte `tusofertas_bench` con ~259.000 precios, borrada al terminar) | p50 final: búsqueda cerca 29 ms, sin ubicación 97 ms, comparación 59 ms, historial 12 ms, generar plan 493 ms, listado 8 ms, resumen 295 ms. Antes de ADR 0025: comparación 136, plan 830 y resumen 889 ms (y truncado) |
| Revisión visual | Plan con reintegro de Coto los miércoles y 25% de Carrefour en caja (Pagás $7.266,37, reintegro $743,83, costo final $6.522,54, ahorro $1.433,95 sin reintegro); comparador con líneas de beneficio; buscador; móvil 390 px sin desbordes (capturas en `.cache/verification/p10-02`) |

Seguridad y accesibilidad: no hay endpoints nuevos. Los cubren los tests existentes:
- dueño de planes y consumo de topes;
- CSRF en `/auth`;
- errores y logs sin credenciales.

Los campos nuevos no exponen datos sensibles: solo lo declarado, nunca tarjetas. La lista de bancos cargados tiene un nombre accesible distinto del campo (lo detectó el E2E).

`jobs.test.cjs` falló de forma intermitente 2 veces en 7 corridas (casos distintos: "falla permanente" y "reintento") mientras corrían otros servidores y el benchmark. Pasó al repetir y en las corridas finales; ese código no cambió en P10-02. Ver ROADMAP, "Después de las diez fases".

No ejecutado: deploy (producción sigue en P8-01) ni pruebas de carga concurrente.

## Decisiones y notas (P10-02)

- **Cada visita es una compra** para el motor; la recomendación usa el costo después del reintegro confirmado y el ahorro usa lo pagado en caja (ADR 0024).
- **El comparador no aplica beneficios de pago**: los informa sin tocar precio ni orden. Es público y no sabe cómo paga quien mira; la canasta la calcula el plan.
- **`optimizedCost` = `payToday`**: mantiene los `CHECK` sin migración.
- **Análisis del precio actual en SQL** con la misma clasificación del dominio. El tope de 50.000 observaciones dejaba series sin historia con datos grandes (ADR 0025).
- La base de desarrollo se resembró (`db:seed`) y quedaron cuentas `e2e-recorrido-*@example.com` con alertas de arroz a $1.500/kg y topes informados.

## Verificaciones ejecutadas (P10-01, 2026-09-30)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (**196/196** unitarios, build API + web) |
| `npm.cmd run test:db` | **159/159** en 15 archivos (152 previos + 7 de beneficios) |
| Prueba manual (base de desarrollo resembrada, API en 3010) | Canasta Coto Lanús (aceite ×4 + fideos ×2) + Jumbo Palermo (yerba ×3) un miércoles: sin preferencias, reintegro y billetera `CONDITIONAL` (`BANK_NOT_DECLARED`); con débito/Banco Demo y billetera, $1.500 en caja y reintegro `CAP_REMAINING_UNKNOWN`; con $2.000 informados (`PUT /benefit-usage`), 2x1 de fideos $1.443,08 + reintegro $5.734,45 (30 días) sobre la base sin la línea del 2x1 (no acumulable): pagar hoy $38.968,80, costo final $33.234,35 |

Qué cubren los tests nuevos: preferencias declaradas (elegible, no elegible, desconocido, nombres normalizados, un "no" gana a un "no sé"); tope por compra sobre toda la canasta; redondeo una sola vez; monto fijo que no supera lo pagado; reintegro que no baja lo que se paga hoy y empate a favor de lo inmediato; banco incorrecto, medio no elegible, sin declarar (condicionado, no sumado), día, vigencia con hora, mínimo exacto; acumulación prohibida y permitida; topes semanal y mensual entre visitas desconocidos, informados y agotados; tope compartido por promociones de dos cadenas del mismo grupo; tope por compra de una promoción del producto entre ítems; reproducibilidad ante el orden; períodos ISO y meses en hora argentina; validación de reglas nuevas e importación. En integración: `CHECK` de la base, contrato de `/promotions`, evaluación con preferencias no declaradas/incorrectas/correctas, reintegro con tope desconocido → informado → compartido con Vea → borrado, día no elegible, monto fijo con mínimo y productos sin precio, validaciones y sesión, consumo informado por persona, importación de los campos nuevos.

No ejecutado: `npm.cmd run test:e2e` (sin cambios en la web) ni deploy.

## Decisiones y notas (P10-01)

- **Tres estados de elegibilidad**: lo no declarado queda condicionado (ADR 0023); nunca datos de tarjeta.
- **Un beneficio de pago por compra** sobre la base elegible; acumulación solo si las dos promociones lo declaran.
- **Topes en un libro compartido** por grupo y período; lo de afuera se informa o queda desconocido. Un tope por compra ahora es de la compra entera (el cálculo de línea anterior lo aplicaba por ítem).
- **`conditionalAmount` cuenta el mejor por línea y por compra**, no la suma: un test detectó que sumar inflaba el "podrías ahorrar".
- `priceLine` (buscador y planificador) no cambia en P10-01; integrar el motor es P10-02.
- La base de desarrollo se resembró (`db:seed`) con las tres promociones de pago nuevas y quedó una cuenta `beneficios-smoke-…@example.com` con preferencias y un consumo informado.

## Verificaciones ejecutadas (P9-02, 2026-09-30)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (**184/184** unitarios, typecheck y lint de la web, build API + web) |
| `npm.cmd run test:db` | **152/152** en 14 archivos (la API no cambió en P9-02) |
| `npm.cmd run test:e2e` | **49/49** en Edge contra API 3010 y web 3100 (`E2E_BASE_URL=http://127.0.0.1:3100`), 4 nuevos de alertas |
| Revisión visual | Buscador con "Avisame si baja", formulario (equivalente del envase), `/alertas` vacía y con aviso real de pollo ($ 3.191,30/kg, Carrefour Almagro) generado por el worker, contador "1" en el menú, tarjeta del resumen, móvil 390 px sin desbordes |

Qué cubre el E2E nuevo: del buscador al formulario con el foco en la sección; precio inválido con mensaje; regla "solo esta presentación" a $ 1.500/kg sobre una presentación propia ("Arroz E2E … (TEST)"); primera revisión sin precios ("Sin precios recientes en tu zona", sin avisos); precio de $ 1.200 en Coto Caballito → job real (comando `jobs` + `worker --until-idle` con prefijo propio) → aviso "Nuevo" con precio y sucursal, contador del menú y resumen → marcar leído → recarga sin "Nuevo" ni contador; alerta borrada antes de revisar no avisa; otra cuenta en móvil no ve nada.

## Decisiones y notas (P9-02)

- **La acción de alerta en el buscador es un link aparte** de la tarjeta (no se anidan links); suma una parada de tabulación por resultado.
- **Por defecto una alerta acepta alternativas** equivalentes; el aviso dice cuando es una alternativa (ADR 0022).
- **Equivalente del envase** solo como ayuda visual y no para productos por peso ni envases de 1 unidad base; la comparación la hace la API por unidad.
- **Los textos no prometen frecuencia de revisión** ni envíos fuera de la app.
- El E2E crea en la base de desarrollo una presentación "Arroz E2E <marca de tiempo> 1 kg (TEST)" por corrida, con un precio de `e2e-alertas`, y la **desactiva al terminar** (sus precios quedan: la historia es append-only). También cuentas `e2e-alertas-*@example.com` y la de revisión `revision-alertas-…@example.com` con dos alertas y un aviso.

## Verificaciones ejecutadas (P9-01, 2026-09-30)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (**184/184** unitarios, build API + web) |
| `npm.cmd run test:db` | **152/152** en 14 archivos (143 previos + 8 de alertas + 1 del job `CHECK_PRICE_ALERTS`) |
| Prueba manual (base de desarrollo, API en 3010, prefijo `tusofertas-smoke`) | Registro, ubicación en Caballito, alerta `TARGET_PRICE` de pollo a $ 4.000/kg (201) y `GOOD_DEAL` de arroz (201); `enqueue CHECK_PRICE_ALERTS --user=…` y `worker --until-idle`: job completado, aviso real "Pollo entero fresco por kg (DEMO) a $ 3.191,30 … en Carrefour Almagro (DEMO) … Tu objetivo: $ 4.000,00 por kg", `lastOutcome` `NOTIFIED` y `NO_MATCH`. API detenida y prefijo borrado |

Qué cubren los tests nuevos: reglas (objetivo requerido o prohibido, cero, decimales, unidad, moneda, sustitutos, radio); presentaciones elegibles (sin reemplazos, marcas sin mayúsculas, preferida con marca excluida); umbral (igualar alcanza, vencido, otra moneda, otra unidad, otro genérico, sustituto no permitido); oportunidades (mínimo, buena oferta, pocos datos, el objetivo no necesita historial); elección (menor precio, preferida, cercanía, alternativa); decisión (primera vez, pausa, cambio de versión, mismo precio, mejora, espera, sin espera, rearmado, sin datos); clave del evento; texto del aviso. En integración: API con errores por código, `userId` rechazado, dueño (`404`), `PATCH` evaluado sobre el resultado, marcas normalizadas, límite 20 (`409`); flujo 1600 → 1450 (avisa) → mismo (no repite) → 1700 (rearma) → 1400 (avisa); mínimo del mes con 12 días de historial y `INSUFFICIENT_DATA` con 4; precio de 10 días (`NO_FRESH_PRICES`), sin reemplazos no usa otra presentación, marcas excluidas, alternativa informada; pausa, edición y borrado **entre evaluación y aviso**; tres corridas simultáneas y el índice único con el estado borrado; bandeja con cursor, `unread`, leído idempotente, aislamiento entre personas y avisos que quedan al borrar la regla; sin ubicación y sin sucursales; el job por el worker sin duplicar al repetirlo.

No ejecutado en esta sesión: `npm.cmd run test:e2e` (sin cambios en la web) ni deploy de P8-02/P9-01.

## Decisiones y notas (P9-01)

- **Objetivo por unidad base del genérico** (KG, L, UNIT): compara presentaciones; la web puede mostrar el equivalente por paquete (ADR 0022).
- **Sin promociones** en la evaluación: nunca avisa por una promoción que podría no aplicar; sumar las elegibles queda para la fase 10.
- **Disparo por flanco + cooldown**: avisa al cumplirse y al mejorar; no repite un precio estable.
- **Evaluar sin escribir, aplicar con la regla bloqueada** y `ON CONFLICT DO NOTHING` por observación: sin duplicados entre workers ni avisos de reglas pausadas/editadas/borradas.
- `CHECK_PRICE_ALERTS` cambió de contrato (`{ v, userId }`); nunca se había encolado, así que se mantuvo `v: 1`.
- La base de desarrollo quedó con una cuenta `alertas-smoke-…@example.com`, dos alertas y un aviso; son datos locales.

## Verificaciones ejecutadas (P8-02, 2026-09-30)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (**176/176** unitarios, build API + web) |
| `npm.cmd run test:db` | **143/143** en 13 archivos, dos corridas seguidas con la base recreada (134 previos + 9 de P8-02) |
| Comando manual (base de desarrollo, prefijo `tusofertas-smoke`) | `schedule` semanal → próxima corrida domingo 2026-10-04 20:00 (23:00Z); repetirlo no duplicó; importación diaria 06:30 → 09:30Z; cron inválido (`99 …`, `… 9`, texto) rechazado con mensaje claro; `report` con colas, programaciones, último éxito por fuente, frescura (`demo-seed`, `mock-provider`) y los 14 planes de la semana 2026-10-05. Prefijo borrado |
| Imágenes y Compose | `docker build` de `api`, `worker` y `migrate`; `docker compose --profile app up -d --build`: migración no-op, API y worker **healthy** como `node`, `/api/health/ready` y `/ready` del worker OK, un job encolado desde el host procesado en el contenedor (log con `importRunId`), `docker compose stop worker` → SIGTERM, `worker_stopping`/`worker_stopped`, código 0. Contenedores quitados; volúmenes intactos |

Qué cubren los tests nuevos: fechas relativas con reloj controlado (domingo 20:00, domingo 23:30 que ya es lunes en UTC, lunes 00:00, cruces de mes), instante del turno desde el id, marcas de progreso, configuración de operación, servidor de salud (vivo, listo, apagándose, 404/405). En integración: dos productores programan a la vez → una programación y un turno, próxima corrida en hora argentina, cron inválido, quitarla borra el turno; turno programado cada segundo resuelve la semana con su instante y no duplica el plan; fallo agotado listado (no permanente, con `importRunId`) y reintento manual sin duplicar precios; falla permanente (archivo inexistente) sin reintento automático ni manual sin `--force`, y con el archivo creado completa; **worker que se cuelga a mitad** con la ejecución abierta en la posición 8 → otro worker la cierra como interrumpida y la reanuda leyendo solo 4; ejecuciones colgadas en el reporte y `closeStale` que cierra solo las viejas; reporte sin datos de usuarios y retraso de cola; `--until-idle` con `/ready` 200 que termina solo con código 0; `/ready` 503 con la base caída sin mostrar la contraseña.

No ejecutado en esta sesión: `npm.cmd run test:e2e` (sin cambios en la web) ni un despliegue del worker (Cloud Run queda documentado en el runbook, no creado).

## Decisiones y notas (P8-02)

- **Programaciones solo por comando** (`jobs -- schedule`), idempotentes por id; el worker no las crea al arrancar (ADR 0021).
- **El instante del turno sale del id del job** (`repeat:<programación>:<ms>`): BullMQ no guarda `opts.prevMillis` con el job (se comprobó en el test).
- **Todas las réplicas de un prefijo con los mismos `JOBS_LOCK_DURATION_MS`/`JOBS_STALLED_INTERVAL_MS`**: el test encontró que un worker con 30 s fija `stalled-check` por 30 s y demora la detección de jobs caídos de los demás. Por eso los procesos aparte de los tests usan los mismos tiempos.
- **Reintento manual conserva el progreso** y pone los intentos en cero; las fallas permanentes piden `--force`.
- **Imagen de runtime con `--omit=dev --omit=optional`**: el CLI de Prisma, TypeScript y Prisma Studio entraban como peers opcionales de `@prisma/client` (`devOptional`); sin ellos, 518 MB. `msgpackr-extract` (opcional) queda afuera: BullMQ usa la versión en JavaScript.
- Compose, perfil `app`: API en `127.0.0.1:3011` y salud del worker en `127.0.0.1:3012` (3000/3001 los usa otro proyecto del usuario). Usa `NODE_ENV=development` (secreto de ejemplo) e `IMPORT_ALLOW_REMOTE=true` porque el host de la base de Compose es `postgres`.
- Quedaron imágenes locales `tusofertas-api`, `tusofertas-worker` y `tusofertas-migrate` (`:latest`, de Compose). La base de desarrollo tiene una ejecución `IMPORT_PROMOTIONS` más (la del worker en contenedor).
- `JOBS_TEST_VERBOSE=1` muestra los logs de los workers en `test/integration/jobs.test.cjs`.

## Verificaciones ejecutadas (P8-01, 2026-09-29)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (validate, generate, typecheck, lint, **171/171** unitarios, build API + web) |
| `npm.cmd run test:db` | **134/134** en 13 archivos (125 previos + 9 de jobs con Redis real) |
| Worker real (manual) | Contra la base de desarrollo con prefijo `tusofertas-smoke`: `IMPORT_PRICES` completado (16 leídos, 16 **conflictos sin sobrescribir** por datos simulados previos), reencolar lo mismo devolvió el job existente, `IMPORT_PROMOTIONS` completado con 2 rechazos, `GENERATE_WEEKLY_PLANS` para 2026-10-05: 18 usuarios, **14 borradores creados**, 4 sin necesidades; `CHECK_PRICE_ALERTS` rechazado (código 1). Claves de Redis del smoke borradas |
| API HTTP sin BullMQ | Cargar `dist/bootstrap` no carga `bullmq` ni `ioredis` (`require.cache`); solo los archivos de `modules/jobs/infrastructure` los importan |

Qué cubren los tests nuevos: contratos y colas; datos válidos y rechazados (versión, extras, faltantes, fechas imposibles, rangos, tipos, tamaño); rutas fuera del directorio, absolutas, con `..` o de otro tipo; URLs con credenciales, parámetros, fragmento o protocolo inválido; semana (lunes, cruce de año); ids deterministas, sin `:` ni numéricos, por día y por clave; configuración con valores por defecto y errores sin valores; conexiones; destino de importación. En integración: un job de cada tipo con estado, resultado y datos (`ImportRun`, precios, planes), dedupe y conflicto de id, `CHECK_PRICE_ALERTS` rechazado, semana sin necesidades sin plan guardado, job de todos los usuarios que cuenta a cada uno una vez y repite (no duplica) el ya planificado; **intento que muere después de escribir** y se repite sin duplicar; **importación FAILED reanudada** desde la posición 8 en el reintento; **worker caído** cuyo job queda activo y lo retoma otro al vencer el bloqueo, sin duplicar; **apagado** que espera el job en curso y deja 0 conexiones del worker en `CLIENT LIST`; Redis caído: encolar falla, el worker no arranca y el comando termina con código 1 sin salida ni la contraseña; `dist/worker.js` como proceso aparte procesa un job sin volcar secretos en los logs.

No ejecutado en esta sesión: `npm.cmd run test:e2e` (sin cambios en la web), `npm.cmd audit` (el `npm install` informó 0 vulnerabilidades) ni el apagado por señal del proceso real: en Windows `kill` no entrega SIGTERM, así que el apagado ordenado se probó en el mismo proceso (`runtime.close()` + `app.close()`, lo mismo que hace el manejador de la señal).

## Decisiones y notas (P8-01)

- **El API HTTP no usa Redis** (ADR 0020): BullMQ solo lo cargan `src/worker.ts` y `modules/jobs/cli.ts`. Vercel no cambia.
- **Datos validados dos veces** y sin secretos: una URL firmada o con usuario no entra a la cola; los archivos, solo relativos a `IMPORT_FILES_DIR`.
- **Ids por ejecución lógica**: importaciones por día + resumen de los datos (o `--key`), planes por semana; el mismo id con otros datos es un error.
- **Planes programados como borrador**, clave `job-weekly-<lunes>`, sin planes vacíos. La semana por defecto es la que empieza hoy (si es lunes) o la próxima; el comando acepta desde la semana en curso hasta 4 semanas adelante.
- **Importaciones por job con el mismo resguardo** que el comando (nunca producción ni base remota sin `IMPORT_ALLOW_REMOTE`): fallan sin reintentar.
- El worker valida también la configuración del API (necesita `JWT_ACCESS_SECRET` porque arma los mismos módulos); separarlo queda para P8-02 (imágenes y secretos).
- Una ejecución de importación cuyo worker muere queda `RUNNING`; el job se retoma, pero marcar la ejecución colgada queda para P8-02.
- La base de desarrollo tiene ahora 14 planes borrador de la semana 2026-10-05 (clave `job-weekly-2026-10-05`) generados por la prueba manual; son datos locales.

## Verificaciones ejecutadas (P7-02, 2026-09-29)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (validate, generate, typecheck, lint, **163/163** unitarios, build API + web) |
| `npm.cmd run test:db` | **125/125** integración real en 12 archivos (119 previos + 6 de P7-02) |
| Comando manual | Contra la base de desarrollo: una ejecución con semilla distinta sobre los mismos productos/días dio 1 creado, **21 conflictos sin sobrescribir** y 2 rechazados en cuarentena; la repetición, 0 creados y 1 repetido; `--report` mostró la cuarentena por motivo; `--url` a un host no permitido se rechazó antes de pedirlo |

Qué cubren los tests nuevos: reintentos que superan un error pasajero, se agotan o no reintentan lo que no mejora; opciones inválidas; marca de confirmado con lotes que terminan en desorden y arranque desde una reanudación; URL permitida, HTTP local, host fuera de la lista, HTTP remoto, credenciales, protocolo y host parecido; errores saneados. En integración: ejecución guardada con contadores iguales al resumen, cuarentena con posiciones y sin contenido, precios que apuntan a su ejecución, informe; misma importación dos veces sin duplicar (dos ejecuciones); error pasajero reintentado sin contar dos veces; fallo persistente con posición confirmada 20 y **reanudación que procesa solo lo posterior**, enlazada a la anterior; fuente no repetible que no se reanuda; registros fuera de orden y repetidos; descarga desde un servidor local permitido, host no permitido sin pedido, redirección rechazada, descarga no reanudable; **planes emitidos e historia DEMO intactos** (hash de snapshots).

No ejecutado en esta sesión: `npm.cmd run test:e2e` (no hubo cambios en la web) y `npm.cmd audit`.

## Decisiones y notas (P7-02)

- **Cuarentena mínima**: motivo, posición, detalle saneado e id externo; nunca el registro (ADR 0019).
- **Reanudar solo si la fuente es repetible** (`replayable`); una descarga se reimporta completa (idempotente).
- **Lote máximo 1.000**: un lote de precios es un único `INSERT`, así un reintento no deja conteos engañosos.
- Una ejecución que muere sin terminar queda `RUNNING` (el `CHECK` exige `finishedAt` solo al terminar): los jobs de la fase 8 pueden detectarlo.
- La base de desarrollo acumuló ejecuciones y datos simulados de las pruebas del comando (fuente `mock-provider`); son datos locales.

## Verificaciones ejecutadas (P7-01, 2026-09-29)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (validate, generate, typecheck, lint, **159/159** unitarios, build API + web) |
| `npm.cmd run test:db` | **119/119** integración real en 12 archivos (111 previos + 8 de `imports.test.cjs`); repetido tras los últimos ajustes |
| Comando manual | `npm.cmd run import -- --provider=mock --stores=3 --products=10 --days=3 --corrupt-every=17 --without-ean-every=5 --promotions` contra la base de desarrollo: 90 leídos, 85 creados, 5 rechazados (2 `PRICE_INVALID`, `UNIT_UNKNOWN`, `STORE_INVALID`, `OBSERVED_AT_INVALID`), 3 sucursales y 10 productos creados, 1 pendiente de genérico; promociones 4 creadas y 2 rechazadas. Repetido: 0 creados, 85 repetidos |

Qué cubren los tests nuevos: coma decimal con miles, ambigüedades y negativos; GTIN-8/12/13/14; alias de unidades y venta por peso; fechas con zona, día al mediodía argentino, día imposible y sin zona; registro válido sin redondeo, sin EAN y con EAN inválido descartado; 13 motivos de rechazo sin copiar valores; promociones con importes con coma y datos desconocidos; **backpressure** (retenidos ≤ lote × (concurrencia + 1), identidad en serie); **un millón de registros de 1 KB en streaming con heap acotado**; lote que falla (deja de leer y conserva lo confirmado) y proveedor cortado a mitad de lote (no escribe el incompleto); lectura de líneas partidas, CRLF, demasiado largas y tope total; mock reproducible y perezoso. En integración: mock de punta a punta (72 precios, 3 sucursales, 8 productos, 2 sin EAN, 1 pendiente; fecha de ingesta distinta de la observada; historia DEMO intacta), reimportación sin duplicar, conflicto sin sobrescribir, vínculo por EAN con el producto DEMO y colisión con otro contenido, cambio de contenido de un producto vinculado, corruptos con motivo, fallo a mitad y reanudación sin duplicar, proveedor alternativo `.jsonl.gz` y archivo inexistente, promociones vinculadas/rechazadas y reimportación que actualiza.

No ejecutado en esta sesión: `npm.cmd run test:e2e` (no hubo cambios en la web) y `npm.cmd audit`.

## Decisiones y notas (P7-01)

- **Identidad por fuente, nunca por nombre** (ADR 0018). Un producto sin genérico exacto queda con `canonicalProductId` null: no participa en planes hasta que se vincule (revisión futura).
- **La base de desarrollo tiene datos simulados** de la prueba del comando: sucursales `Sucursal Mock N (MOCK)` cerca de Caballito y productos `Producto mock N: … (MOCK)`, fuente `mock-provider`. Pueden aparecer en búsquedas y planes locales; no afectan la base de pruebas ni producción.
- **Runner de integración**: `node --test` con varios archivos los ordenaba alfabéticamente; los comentarios de "último del runner" de P6 eran falsos (pasaban igual). Ahora `scripts/test-db.cjs` corre un proceso por archivo en el orden de `INTEGRATION_FILES`; `catalog-api` sigue antes que `catalog` porque este asume la base sembrada.
- El mock usa por defecto el día de **ayer**: un día sin hora es el mediodía argentino y el de hoy puede ser todavía futuro.
- No hay descarga desde internet: llega con la primera fuente real, con endpoints permitidos por configuración (nunca una URL de un usuario).

## Verificaciones ejecutadas (P6-02, 2026-09-29)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (validate, generate, typecheck, lint, **146/146** unitarios, build API + web con **14 rutas**) |
| `npm.cmd run test:db` | **111/111** integración real (107 previos + 4 de `dashboard.test.cjs`) |
| `npm.cmd run test:e2e` | **45/45** en Edge headless (7 nuevos de historial y resumen); tras el último ajuste de redacción se repitió `history.e2e.cjs`: 7/7 |
| Revisión visual | Capturas en `.cache/verification/p6-02/` (ficha con historial y resumen, escritorio y móvil 390 px); se ajustó la proporción del gráfico para móvil y la redacción de la explicación |

Qué cubren los tests nuevos: semana ISO; solo planes en uso o completados (borradores y vencidos afuera); superposición con completado antes que activo y el más nuevo entre iguales; semana/mes/acumulado por fecha de inicio con ahorro negativo y sin base informado aparte; todo en cero sin planes; oportunidades solo mínimo/buena oferta, ordenadas y acotadas. En integración: 401; cuenta nueva sin plan ni ahorro y sin ahorro registrado; rutina sin zona (`NO_LOCATION`); borrador que no suma, plan en uso que suma, dos completados del mismo período que cuentan una vez, completar no registra ahorro; **precio actual a la mitad → `HISTORIC_LOW` en las oportunidades**. En Edge: gráfico accesible con título y descripción, etiqueta explicada, tabla; sucursal desactualizada (Disco Belgrano) sin etiqueta de oferta; sucursal y período en la URL con "atrás"; período con teclado; móvil sin desborde; resumen vacío, con plan en uso (próxima compra y ahorro de un plan) y tras completarlo sin duplicar.

No ejecutado en esta sesión: `npm.cmd audit` y el deploy a producción (no pedido).

## Decisiones y notas (P6-02)

- **Ahorro estimado = un plan por período** (ADR 0017): `COMPLETED` o `ACTIVE` vigente; gana el completado y después el más nuevo; por fecha de inicio (semana ISO, mes calendario). Un activo vencido sin completar no suma.
- **Ahorro registrado no existe** y así se muestra; completar no lo crea.
- Oportunidades: hasta 20 sucursales de la zona y 10 resultados; solo etiquetas concluyentes a favor.
- El gráfico es SVG propio (sin dependencias nuevas, por el lockfile) y muestra una sucursal a la vez; con otra fuente (`source`) la etiqueta lo dice.
- `/inicio` y `/dashboard` conviven: `/inicio` sigue siendo el destino del login y del onboarding (los E2E lo usan); `/dashboard` es "Resumen" en la barra.

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

Desplegado y verificado el 2026-09-24; **redesplegado el 2026-09-30** con todo hasta P8-01 (ver abajo). Cuenta `matiasstr`, scope `matiasstrs-projects`, org `team_HaHit5F3SLJ9EspBBNJOkRgR`. `.vercel/` (ignorado por Git) apunta al proyecto **web**.

**Incidente 2026-09-28 (resuelto el 2026-09-29): base de producción suspendida.** `vercel integration list --all` mostró `tusofertas-db` (Supabase) como **Suspended**: `/api/health/ready` daba 503 (`database: down`) y todo login/registro en producción devolvía 500. No era un bug del código; el usuario reactivó el recurso desde el dashboard. El 2026-09-29 volvió a figurar **Available**, `ready` 200 con `database: up`, y se creó la cuenta de prueba `prueba@example.com` en producción (registro 201, login 200, `/users/me` 200; la contraseña la tiene el usuario, no se guarda acá). Si vuelve a pasar: mismo diagnóstico y reactivar desde Vercel → Storage → `tusofertas-db` (o `vercel integration open supabase`). En local también existe `prueba@example.com` en la base de desarrollo.

**Deploy 2026-09-30 (commit `337320b`, P4-02 a P8-01).** API primero: el build aplicó en Supabase `20260929120000_shopping_plan_generation`, `20260929180000_external_identity_refs` y `20260929220000_import_runs_quarantine` (todas aditivas: columnas con valor por defecto y tablas nuevas) y quedó en `tusofertas-api.vercel.app`. Web después: `vercel deploy --prod` cortó con `fetch failed` (red del CLI mientras seguía el build), pero `vercel inspect` mostró el deployment **Ready** con el alias `tusofertas.vercel.app`; si vuelve a pasar, verificar con `vercel inspect <url>` antes de reintentar. Smoke (vía la web, mismo origen): `/`, `/login`, `/buscar`, `/dashboard`, `/plan-semanal`, `/mis-compras` 200; health y ready 200 (`database: up`); registro 201, `/users/me` 200, `/dashboard` 200 (ahorro estimado en cero, sin compras registradas), `/shopping-plans` 200, generar plan 201, historial de un producto inexistente 404, `/dashboard` sin token 401, refresh 200, login con clave incorrecta 401. Quedó la cuenta de smoke `smoke-1790778811@example.com` con un plan vacío. **El worker de jobs no está en producción** (Vercel no corre procesos persistentes; P8-02 prepara imágenes) y producción sigue sin catálogo.

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
- **P6-01** `15474cb` (publicado).
- **P6-02** `b11d264` (publicado).
- **P7-01** `7f31af1` (publicado).
- **P7-02** `f9d5b11` (publicado).
- **P8-01** `337320b` (publicado; desplegado el 2026-09-30, registro del deploy en `200f484`).
- **P8-02** `345ed37` (publicado).
- **P9-01** `c12c34a` (publicado).
- **P9-02** `465c9f2` (publicado).
- **P10-01** `3392625` (publicado).
- **P10-02** parte 1 `755329a` (publicado); cierre del paso: commit `feat(P10-02): ...` del 2026-10-01 (ver `git log`).
- `apps/web/next-env.d.ts` aparece modificado cada vez que corre `next dev`/`build`: es generado y versionado a pedido del propio archivo; commitearlo si cambia.

## Cómo seguir (después de las diez fases)

Las diez fases están completas. Lo que queda es trabajo separado (ROADMAP, "Después de las diez fases"); cada punto merece su propia sesión con verificación:

1. **Redesplegar producción** con los comandos de "Deploy" de este archivo. El build de la API aplica tres migraciones aditivas: `20260930120000_import_run_progress_time`, `20260930180000_price_alerts_notifications` y `20261001120000_payment_benefits`. Verificar `/api/health/ready`, registro, plan y alertas. Producción no tiene dataset DEMO: sin datos el catálogo está vacío.
2. **Desplegar worker y Redis persistente** (RUNBOOK, "En la nube"), y programar `CHECK_PRICE_ALERTS` y `GENERATE_WEEKLY_PLANS` contra ese Redis.
3. **Fuente real de precios**: ADR de acceso y licencia (SEPA u otra), adaptador `PriceProvider` y pruebas con datos reales antes de programar importaciones.
4. **Deuda de diseño** (logo y tipografía): ROADMAP, "Deuda de diseño".
5. Opcionales: avisos por email o push; cierres diarios precalculados si el resumen debe bajar de ~300 ms con más datos; aislar `jobs.test.cjs`.

Antes de tocar código: `git status --short --branch`, `git log -4 --oneline`, `docker compose up -d`, `npm.cmd run db:deploy`, `npm.cmd run db:seed`; API en 3010 y web en 3100 si 3000/3001 están ocupados. Al cerrar: `npm.cmd run verify`, `npm.cmd run test:db`, `npm.cmd run test:e2e` (con los servidores corriendo; detenerlos antes de `verify`), actualizar README/ROADMAP/CONTINUAR/CLAUDE.md, commit y push.

## Prompt listo para pegar (Claude o Codex)

> Continuá el proyecto en C:\Users\PC\Desktop\TusOfertasApp\solucionadoApp. Leé primero CLAUDE.md (o AGENTS.md) y CONTINUAR.md. Las diez fases (P0-01 a P10-02) están implementadas, probadas y publicadas en GitHub; no las rehagas. Lo que sigue es trabajo separado (ver "Cómo seguir" en CONTINUAR.md y "Después de las diez fases" en ROADMAP.md): redesplegar producción, desplegar worker y Redis, conectar una fuente real o resolver la deuda de diseño; preguntá cuál priorizar si no está claro. Verificá con npm.cmd run verify, npm.cmd run test:db y npm.cmd run test:e2e, y actualizá README, ROADMAP, CONTINUAR y CLAUDE.md. Tenés autorización para commit y push al completar cada paso; no pidas confirmaciones rutinarias, pero un deploy a producción es una acción externa: confirmalo antes. No marques como probado lo que no ejecutaste.
