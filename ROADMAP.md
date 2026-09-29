# Roadmap de Tus Ofertas

El objetivo es ayudar a una persona en Argentina a gastar menos en sus compras habituales. El flujo central es **rutina → necesidad semanal → inventario → precios y promociones → restricciones → plan → ahorro estimado**.

Este documento conserva el alcance y estado de cada paso. Las instrucciones ejecutables están en `docs/steps/`. El punto exacto para retomar, las verificaciones efectivamente ejecutadas y cualquier bloqueo deben quedar en [CONTINUAR.md](CONTINUAR.md). No hace falta conservar el chat para continuar.

## Cómo trabajar y guardar el avance

1. Leer `CONTINUAR.md`, este archivo, la guía de la fase correspondiente y los documentos de arquitectura. Revisar el estado del repositorio y conservar cambios existentes.
2. Elegir el primer paso pendiente cuyas dependencias estén completas. Explicar brevemente qué se implementará y si cambia una decisión previa.
3. Implementar un paso pequeño de extremo a extremo. Si cambia una decisión, registrar un ADR en `docs/architecture-decisions/`.
4. Ejecutar las verificaciones indicadas. Registrar el comando, el resultado y cualquier verificación que no pudo ejecutarse. Una limitación del entorno no equivale a un test aprobado.
5. Actualizar este archivo, README si cambió la operación y `CONTINUAR.md` **después de cada paso y antes de cerrar la sesión o agotar el contexto**.
6. Al completar **cada paso**, revisar el diff, hacer un commit del paso y ejecutar `git push`, siguiendo el protocolo de publicación de abajo. El usuario autorizó esta secuencia; no pedir confirmación ordinaria para cada commit o push.
7. Al interrumpir un paso, guardar archivos, qué funciona, qué falta, errores reproducibles y el próximo comando. No marcarlo terminado. No esperar al último momento para hacer el checkpoint.

Estados: **PENDIENTE**, **EN CURSO**, **BLOQUEADO**, **COMPLETO**. Un paso solo se cierra como COMPLETO cuando sus entregables y verificaciones necesarias están confirmados y su commit fue publicado. Si la implementación terminó pero falta el push, registrar por separado “implementación verificada; publicación pendiente” y el bloqueo. El estado de una fase depende de todos sus pasos.

## Commit y push después de cada paso

El repositorio usa `origin` → `git@github.com:matiasstr/solucionadoApp.git` y rama `main`. Verificar el estado actual antes de asumir que esas referencias siguen iguales. Esta autorización incluye commits y pushes ordinarios de los pasos; no autoriza `--force`, descartar trabajo ajeno ni reescribir historia.

1. Terminar las verificaciones y actualizar la documentación/checkpoint del paso. Revisar `git status --short`, `git branch --show-current`, `git remote -v`, `git diff --check` y `git diff`. Preservar cambios ajenos y excluir `.env`, secretos, logs y artefactos generados.
2. Preparar únicamente los archivos del paso con `git add -- <rutas revisadas>`. Revisar `git diff --cached --check` y `git diff --cached`; incluir código, tests, lockfile y documentación pertinentes. No usar `git add .` sin revisar todo el árbol.
3. Crear un commit identificable, por ejemplo `git commit -m "feat(P1-01): initialize web and API workspaces"`. Mantener un commit por paso completado; un ajuste posterior puede tener su propio commit, sin reescribir los ya publicados.
4. Si la rama verificada es `main`, ejecutar `git push origin main` y comprobar código de salida y mensaje. Verificar después `git status -sb` y `git rev-parse HEAD`; informar hash y resultado de publicación. Si hay otra rama, inspeccionar su seguimiento antes de publicar; no cambiar ni pisar ramas automáticamente.
5. Si falta el remoto, autenticación, conectividad o el push es rechazado, conservar el commit local y registrar en `CONTINUAR.md` el error sanitizado y el siguiente comando de recuperación. No inventar otro remoto ni forzar el push. Un rechazo por cambios remotos exige inspeccionar e integrar esos cambios sin perder trabajo antes de reintentar.

Las restricciones técnicas de permisos del entorno se gestionan por el mecanismo de aprobación correspondiente, sin convertir la secuencia ordinaria autorizada en preguntas repetidas. El checkpoint puede identificar el último commit publicado de pasos anteriores; el hash del commit actual se informa tras crearlo y se incorpora al siguiente checkpoint, evitando commits recursivos solo para registrar su propio hash.

## Alcance de la primera sesión

Crear el diseño persistente y comenzar la fase 1 con el bootstrap del monorepo. Esta sesión abarca **P0-01 y P1-01**. Base de datos operativa, migraciones y autenticación quedan explícitamente para pasos posteriores. El schema inicial documenta el destino y puede existir antes de que sus módulos funcionen.

### P0-01 — Diseño y documentos para continuar

**Dependencia:** ninguna. **Alcance/archivos:** `docs/REQUERIMIENTOS.md`, `docs/ARCHITECTURE.md`, `docs/DOMAIN.md`, `docs/architecture-decisions/`, schema inicial Prisma, `docker-compose.yml`, README, ROADMAP, CONTINUAR y estas guías.

**Instrucciones:** conservar el pedido original; definir monorepo y responsabilidades de módulos, relaciones e invariantes del dominio, estrategia de importadores y límites de implementación; documentar decisiones sobre dinero/unidades/tiempo, sesiones y costo del optimizador. Enumerar riesgos y qué se implementa en cada paso. El diseño debe distinguir modelos previstos de funcionalidades operativas.

**Validación:** revisar cobertura de entidades y diez fases contra REQUERIMIENTOS, consistencia entre schema/ADRs/guías y viabilidad de las dependencias. Validar configuración de Compose con `docker compose config`; Compose ya creado y validado es un entregable inicial, pero la salud real de sus servicios se comprueba en P1-02. En P1-01 validar/generar schema con Prisma, sin afirmar que se aplicó a una base.

**Done:** un modelo que no vio el chat puede identificar qué existe, qué falta, cómo validar y qué paso ejecutar. Revisar estos entregables antes de cambiar el estado a COMPLETO.

| Paso | Entregable | Dependencias | Estado |
| --- | --- | --- | --- |
| P0-01 | Arquitectura, carpetas, dominio, Prisma inicial, Docker Compose, ADRs, riesgos, roadmap y guía de continuidad | — | COMPLETO |
| P1-01 | Bootstrap npm workspaces, Next.js, NestJS, paquetes, Compose y scripts | P0-01 | COMPLETO |
| P1-02 | PostgreSQL/PostGIS, Prisma operativo, migración inicial y comprobación de integridad | P1-01 | COMPLETO |
| P1-03 | Auth backend, sesiones refresh seguras, perfil y tests | P1-02 | COMPLETO |
| P1-04 | Auth frontend y navegación protegida | P1-03 | COMPLETO |
| P2-01 | Catálogo, sucursales, precios históricos, conversión de unidades y seed | P1-02 | COMPLETO |
| P2-02 | API de productos, canónicos, sucursales y precios actuales | P2-01 | COMPLETO |
| P2-03 | Motor básico de promociones con tests y datos demo | P2-01 | COMPLETO |
| P3-01 | Búsqueda y comparación API con filtros y paginación | P2-02, P2-03 | COMPLETO |
| P3-02 | Landing, buscador y ficha de producto | P3-01, P1-04 | COMPLETO |
| P4-01 | CRUD de rutinas y despensa con ownership | P1-03, P2-02 | COMPLETO |
| P4-02 | Onboarding, mis compras, despensa y preferencias | P4-01, P3-02 | COMPLETO |
| P5-01 | Necesidad semanal y candidatos de compra | P4-02, P2-03 | COMPLETO |
| P5-02 | Optimizador determinista, límites y pruebas de costo | P5-01 | COMPLETO |
| P5-03 | Persistencia, cronograma y ahorro estimado del plan | P5-02 | COMPLETO |
| P6-01 | Historial y análisis de ofertas con calidad de datos | P2-02 | COMPLETO |
| P6-02 | Gráfico, dashboard y distinción de ahorro estimado/registrado | P6-01, P5-03 | PENDIENTE |
| P7-01 | Puertos de proveedores, normalización e importador mock por lotes | P2-01, P2-03 | PENDIENTE |
| P7-02 | Ejecuciones idempotentes, cuarentena y documentación para proveedores | P7-01 | PENDIENTE |
| P8-01 | Redis, BullMQ, workers y comandos manuales | P7-02, P5-03 | PENDIENTE |
| P8-02 | Programación, recuperación y operación de jobs | P8-01, P6-01 | PENDIENTE |
| P9-01 | Reglas de alertas y notificaciones dentro de la app | P8-02, P6-02 | PENDIENTE |
| P9-02 | UI, preferencias, deduplicación y pruebas de entrega | P9-01 | PENDIENTE |
| P10-01 | Promociones bancarias, medios de pago, topes y elegibilidad | P2-03, P5-03 | PENDIENTE |
| P10-02 | Integración del planificador, UI y validación final del producto | P10-01, P9-02 | PENDIENTE |

## Estado de la fase 2 (catálogo y datos) — COMPLETA

**P2-01 — COMPLETO** (commit `df94c12`). Dominio sin Prisma ni Nest: `DecimalValue` (entero BigInt escalado, HALF_UP), conversión dimensional KG/G, L/ML y UNIT, normalizador de precios que rechaza en vez de redondear en silencio, precio actual determinista con umbral de frescura configurable y clave idempotente por producto/sucursal/día. Repositorios de categorías (sin ciclos), canónicos, productos (valida dimensión contra su canónico), cadenas/sucursales y observaciones append-only. Seed DEMO repetible (`npm.cmd run db:seed`): 7 categorías, 18 canónicos, 28 presentaciones, 5 cadenas, 10 sucursales y ~7.200 observaciones de 31 días, con ids UUID v5 deterministas. Decisiones en [ADR 0008](docs/architecture-decisions/0008-catalog-prices-demo-data.md).

**P2-02 — COMPLETO.** Endpoints públicos de lectura con prefijo `/api`: `GET /products`, `/products/:id`, `/products/:id/prices`, `/canonical-products`, `/canonical-products/:id`, `/stores`, `/stores/:id`. Paginación por cursor (keyset `(clave, id)`, `limit` 1–50), filtros estrictos que fallan en vez de ignorarse, consultas por cercanía en kilómetros convertidos a metros (PostGIS) y por localidad sin afirmar distancia, y precios que siempre viajan con `source`, `observedAt`, `ageDays` e `isStale`. Contratos espejados en `packages/shared` para la web; no se expone ninguna entidad Prisma.

**P2-03 — COMPLETO.** Calculador puro `priceLine` para `PERCENTAGE`, `SECOND_UNIT`, `TWO_FOR_ONE` y `FIXED_PRICE`: una sola promoción por línea (la que más conviene, con desempate por id), redondeo monetario una sola vez y la evaluación de cada regla considerada, aplique o no. Lo que no se puede comprobar se informa con su motivo en vez de aplicarse: banco o medio de pago, membresía, mínimo de compra sin subtotal, topes que abarcan varias compras. Vigencia `[validFrom, validUntil)` en UTC con días elegibles leídos en `America/Argentina/Buenos_Aires`. Envases enteros con excedente visible (`planPurchase`). 9 promociones demo (activas, futura, vencida, por día, con mínimo y bancaria) y `GET /promotions`. Decisiones en [ADR 0009](docs/architecture-decisions/0009-promotion-engine.md); `BANK_DISCOUNT` sigue sin aplicarse hasta P10-01.

Verificado al cerrar la fase: `npm.cmd run verify` (64/64 unitarios, typecheck, lint, build API + web) y `npm.cmd run test:db` (56/56 contra PostgreSQL/PostGIS real, incluidos 22 tests HTTP). Los ejemplos de requests y responses están en el README.

**Siguiente: P4-01** (CRUD de rutinas y despensa con ownership).

## Estado de la fase 3 (comparador) — COMPLETA

**P3-01 — COMPLETO.** `GET /products` busca por nombre, marca o EAN (8 a 14 dígitos se tratan como código exacto) y acota por categoría, canónico, marca, cadena, localidad o radio, devolviendo el alcance aplicado. `GET /canonical-products/:id/prices` compara todas las presentaciones de una necesidad en cada sucursal: precio de envase y precio por unidad base, coincidencia exacta contra alternativa, distancia cuando hay coordenadas, frescura de cada observación y la promoción automática que corresponda, con su cantidad mínima y el precio regular conservado. `sortBy` admite `UNIT_PRICE`, `PRICE` y `DISTANCE`; ordenar por distancia sin coordenadas es un error explícito. El precio actual de varias presentaciones se resuelve en una sola consulta (`DISTINCT ON` por producto y sucursal), sin N+1. Formato estable documentado en [docs/API.md](docs/API.md).

Verificado al cerrar P3-01: `npm.cmd run verify` (68/68 unitarios, typecheck, lint, build API + web) y `npm.cmd run test:db` (67/67 contra PostgreSQL/PostGIS real, incluidos los 11 tests HTTP nuevos de búsqueda y comparación).

**P3-02 — COMPLETO.** Portada con buscador conectado, `/buscar` y `/producto/[id]`, todas públicas. Los filtros viven en la URL, así que un enlace compartido reproduce la búsqueda y "atrás" deshace el último cambio; escribir reemplaza la entrada del historial y cambiar un filtro agrega una. Las tarjetas muestran precio, precio por unidad base, sucursal, distancia cuando se puede calcular, promoción con su cantidad mínima y la fecha del precio. La ficha separa el producto exacto de las alternativas y conserva el precio regular junto al promocional. Sin ubicación el orden por distancia queda deshabilitado y la pantalla lo explica. Etiqueta DEMO visible, formato `es-AR`, estados de carga, vacío y error con reintento que no pierden los filtros, y vista móvil sin desbordes.

Para que las tarjetas pudieran mostrar precio, `GET /products` ahora devuelve `bestOffer` (la oferta más barata por unidad base dentro del alcance), y la búsqueda y la comparación se movieron al módulo `search`, que compone catálogo, precios, comercios y promociones sin ciclos. El seed pasó a anclar las observaciones en el último mediodía UTC **ya transcurrido**: antes podía fechar precios en el futuro.

Verificado al cerrar la fase: `npm.cmd run verify` (68/68 unitarios, typecheck, lint, build API + web), `npm.cmd run test:db` (67/67 contra PostgreSQL/PostGIS real) y `npm.cmd run test:e2e` (10/10 de búsqueda y comparación en Edge real, con capturas de escritorio y móvil en `.cache/verification/p3-02`).

## Estado de la fase 4 (compras habituales) — COMPLETA

**P4-01 — COMPLETO.** API privada `/shopping-routines` (rutinas con nombre, frecuencia en días y ancla; ítems con canónico, preferido opcional, cantidad por ocurrencia, frecuencia heredada o propia, sustitución y marcas preferidas/excluidas) y `/inventory` (una fila por canónico, saldo no negativo con fecha de actualización). Toda consulta filtra por el usuario del token: lo ajeno responde 404 igual que lo inexistente, también para ítems bajo una rutina que no corresponde. Las cantidades se aceptan en cualquier unidad de la dimensión y se guardan en la del canónico sin redondear. En un PATCH las reglas (preferido obligatorio sin sustitutos, marcas disjuntas sin distinguir mayúsculas ni tildes, frecuencia y ancla juntas) se evalúan sobre el resultado. Límites de 20 rutinas y 100 ítems contados bajo bloqueo de fila. Preferencias en `PATCH /users/me`: radio 0,1–100 km, `null` = sin límite de sucursales, localidad completa y `null` rechazado en columnas obligatorias. Sin migración nueva: el schema de P1-02 ya tenía tablas, unicidad y `CHECK`. Decisiones en [ADR 0011](docs/architecture-decisions/0011-routines-inventory-ownership.md); contratos en [docs/API.md](docs/API.md#rutinas-y-despensa-privadas).

Verificado al cerrar P4-01: `npm.cmd run verify` (77/77 unitarios, typecheck, lint, build API + web) y `npm.cmd run test:db` (79/79 contra PostgreSQL/PostGIS real, incluidos los 12 tests HTTP nuevos de `routines-api.test.cjs`).

**Deploy (2026-09-24).** Web, API y base Supabase en producción, con migraciones en el build y TLS verificado ([ADR 0010](docs/architecture-decisions/0010-api-deploy-vercel-supabase.md)). Sin dataset DEMO en producción.

**P4-02 — COMPLETO.** Web privada contra la API de P4-01: `/onboarding` en cuatro pasos (zona con ubicación exacta opcional y pedida solo al tocar un botón; radio 2/5/10/20 km y máximo 1/2/3/sin límite de sucursales; productos habituales con buscador de canónicos, cantidad, unidad y frecuencia; resumen), `/mis-compras` (listas, necesidades con frecuencia propia o heredada, presentación preferida, marcas y reemplazos en una sección plegada, stock de la despensa junto a cada necesidad), `/mi-despensa` y `/preferencias`. Cada paso guarda antes de avanzar y el onboarding se retoma donde quedó; un reintento no duplica rutinas ni ítems (el 409 se toma como "ya estaba"). Registrarse lleva al onboarding pero nada lo exige: `/inicio` muestra un aviso para continuarlo. Borrar pide confirmación; los errores de la API se muestran junto al campo. Caché por usuario, invalidada al mutar y vaciada al cerrar sesión. Único cambio de API: `onboardingCompleted: true` en `PATCH /users/me` (idempotente, fecha del servidor). Decisiones en [ADR 0012](docs/architecture-decisions/0012-onboarding-private-pages.md).

Verificado al cerrar la fase: `npm.cmd run verify` (80/80 unitarios, typecheck, lint, build API + web con 12 rutas), `npm.cmd run test:db` (80/80 contra PostgreSQL/PostGIS real, con el test nuevo de `onboardingCompleted`) y `npm.cmd run test:e2e` (31/31 en Edge real: 13 nuevos de cuenta, 8 de auth y 10 de búsqueda; capturas en `.cache/verification/p4-02`).

**Siguiente: P5-01** (necesidad semanal y candidatos de compra).

## Estado de la fase 5 (planificador) — COMPLETA

**P5-01 — COMPLETO.** Dominio puro y determinista en `apps/api/src/modules/shopping-plans/domain/`: `buildNeeds` cuenta ocurrencias de cada ítem en la ventana del plan (fechas inclusivas en calendario argentino, `anchorDate + k × frequencyDays` con `k ≥ 0`), suma los ítems del mismo canónico entre rutinas, resta la despensa una sola vez (mínimo cero, con antigüedad del saldo) y combina restricciones (sin reemplazos, marcas excluidas sobre preferidas; dos exactas distintas son `CONFLICT`). `buildCandidates` filtra presentaciones (dimensión, activa, sustitución, marca), usa la última observación de precio como estimación con fecha y fuente, descarta los precios viejos con su antigüedad, calcula envases enteros con excedente y el costo de cada fecha con `priceLine` (mediodía argentino), y recorta de forma determinista sucursales, ofertas y fechas con límites configurables (`PLANNER_*`), registrando cada descarte y cada necesidad sin ofertas con su motivo. `BuildPlanCandidatesUseCase` carga rutinas, despensa y preferencias del usuario, resuelve la ubicación (radio PostGIS, localidad con aviso o ninguna) y compone ambas funciones. Sin endpoints todavía (P5-03). Decisiones en [ADR 0013](docs/architecture-decisions/0013-planner-needs-candidates.md).

Verificado al cerrar P5-01: `npm.cmd run verify` (112/112 unitarios —31 nuevos de necesidades, candidatos y configuración—, typecheck, lint, build API + web) y `npm.cmd run test:db` (88/88 contra PostgreSQL/PostGIS real, con 8 nuevos en `shopping-plans.test.cjs`).

**P5-02 — COMPLETO.** `optimizePlan` (dominio puro, `shopping-plans/domain/plan-optimizer.ts`) elige visitas (sucursal + fecha) minimizando costo efectivo = productos con promociones + penalidad por visita + penalidad por km de ida y vuelta, con orden lexicográfico (cobertura, costo, visitas, km, id). Descarta fechas dominadas (exacto), enumera todas las combinaciones de hasta `maxStoresPerShoppingPlan` sucursales y sus fechas útiles si entran en `PLANNER_MAX_COMBINATIONS` (`EXACT_BOUNDED`) y si no usa un método aproximado identificado (`HEURISTIC`). Base habitual prudente: las mismas necesidades en la sucursal más barata con todo, a precio regular; sin ella no hay ahorro. Totales separados (productos, penalidades, efectivo) que cierran con los `CHECK` de `ShoppingPlan`, faltantes con motivo (`MAX_STORES_LIMIT` incluido), explicación y alternativas por línea, limitaciones visibles. `PlanShoppingUseCase` aplica las preferencias del usuario. Decisiones en [ADR 0014](docs/architecture-decisions/0014-planner-optimizer.md).

Verificado al cerrar P5-02: `npm.cmd run verify` (128/128 unitarios —16 nuevos del optimizador, entre ellos el contraste con enumeración exhaustiva independiente en 200 canastas aleatorias—, typecheck, lint, build API + web) y `npm.cmd run test:db` (91/91 contra PostgreSQL/PostGIS real, con 3 nuevos del optimizador sobre la base sembrada).

**P5-03 — COMPLETO.** Planes guardados: `POST /shopping-plans/generate` (cabecera `Idempotency-Key` obligatoria; un reintento devuelve el mismo plan), `GET /shopping-plans`, `GET /shopping-plans/:id` y `PATCH /shopping-plans/:id` con transiciones explícitas (`DRAFT → ACTIVE | COMPLETED`, `ACTIVE → COMPLETED`, un solo plan activo por período, `EXPIRED` informado por fecha). Snapshot versionado de entradas, resultado y cada línea: un precio nuevo no reescribe un plan emitido. Migración `20260929120000_shopping_plan_generation` (`idempotencyKey` único por usuario, `resultSnapshot`). Pantalla privada `/plan-semanal`: cronograma por día y sucursal con cantidades (envases o peso estimado), precio estimado con su fecha, promoción, motivo y alternativas; totales separados y ahorro **estimado** frente a una sola sucursal (oculto sin base); faltantes con motivo, lo cubierto por la despensa, avisos, "cómo calculamos" y planes anteriores; el plan elegido vive en la URL. Decisiones en [ADR 0015](docs/architecture-decisions/0015-saved-plans.md).

Verificado al cerrar la fase: `npm.cmd run verify` (131/131 unitarios, typecheck, lint, build API + web con 13 rutas), `npm.cmd run test:db` (100/100 contra PostgreSQL/PostGIS real, con 9 nuevos de `shopping-plans-api.test.cjs`) y `npm.cmd run test:e2e` (38/38 en Edge real, con 7 nuevos del plan semanal; capturas en `.cache/verification/p5-03`).

**Siguiente: P6-01** (historial y análisis de ofertas con calidad de datos).

## Estado de la fase 6 (historial y oportunidades) — EN CURSO

**P6-01 — COMPLETO.** `GET /products/:id/price-history` (público): una serie por sucursal y fuente, un punto por día argentino (última observación del día, huecos sin rellenar), rango inclusivo de 1 a 366 días (por defecto los últimos 30), una sucursal **o** una ubicación, hasta 20 series. Dominio puro `prices/domain/price-analysis.ts`: cierre diario, base de los 30 días anteriores al precio actual (el día actual no entra), promedio por día, mínimo con fecha, máximo y razón contra el promedio; clasificación con precedencia estable (`STALE`, `INSUFFICIENT_DATA` con menos de 7 días, `HISTORIC_LOW`, `GOOD_DEAL` < 85 %, `EXPENSIVE` > 115 %, `NORMAL`) y comparaciones decimales exactas. Repositorio: `findBetween` y `findLatestPerSeries` (una consulta cada uno). Decisiones en [ADR 0016](docs/architecture-decisions/0016-price-history-analysis.md).

Verificado al cerrar P6-01: `npm.cmd run verify` (140/140 unitarios, 9 nuevos del análisis) y `npm.cmd run test:db` (107/107, 7 nuevos del endpoint contra la base sembrada).

**Siguiente: P6-02** (gráfico del historial en `/producto/[id]` y dashboard de ahorro estimado).

## Deuda de diseño (pedida por el usuario el 2026-09-29)

Pendiente, sin paso asignado; no bloquea la fase 5. Resolverla en una sesión propia de UI, con capturas antes/después en escritorio y móvil:

- **Logo**: mejorarlo un poco (hoy es provisorio).
- **Tipografía**: al usuario le resulta rara la fuente actual; elegir otra más legible para una app de compras y aplicarla de forma consistente (títulos, cuerpo, números/precios).

## Las diez fases

| Fase | Resultado visible al completarla | Guía |
| --- | --- | --- |
| 1. Fundaciones y autenticación | Desarrollo local reproducible y registro/login funcionales | [phase-01](docs/steps/phase-01.md) |
| 2. Catálogo y datos | Productos, equivalentes, sucursales, precios y promociones básicas demo | [phase-02](docs/steps/phase-02.md) |
| 3. Comparador | Buscar y comparar precios exactos y alternativas en móvil | [phase-03](docs/steps/phase-03.md) |
| 4. Hábitos e inventario | Registrar necesidades, existencias y preferencias | [phase-04](docs/steps/phase-04.md) |
| 5. Planificador | Cronograma semanal determinista con costos explicables | [phase-05](docs/steps/phase-05.md) |
| 6. Historial y oportunidades | Ofertas basadas en historial y dashboard de ahorro | [phase-06](docs/steps/phase-06.md) |
| 7. Importadores | Incorporación de fuentes sin acoplarlas al dominio | [phase-07](docs/steps/phase-07.md) |
| 8. Jobs | Procesamiento asíncrono operable con BullMQ | [phase-08](docs/steps/phase-08.md) |
| 9. Alertas | Notificaciones útiles con preferencias y deduplicación | [phase-09](docs/steps/phase-09.md) |
| 10. Bancos y promociones avanzadas | Recomendaciones según condiciones y medios de pago | [phase-10](docs/steps/phase-10.md) |

Las fases se implementan en este orden para entregar incrementos verificables. Algunas dependencias técnicas permiten trabajo independiente; eso no habilita a declarar completas las fases previas. Las promociones simples se adelantan a P2-03 porque el optimizador de fase 5 las necesita; reglas bancarias y de medios de pago conservan su lugar en fase 10.

## Reglas que ningún paso debe romper

- TypeScript estricto; módulos pequeños; `domain/application/infrastructure/presentation` donde aporten claridad. Las interfaces de proveedores no dependen de SEPA.
- Importes y cantidades persistidos como Decimal según ADR 0002, transportados como strings; conversiones dimensionales explícitas. No usar aritmética binaria de `number` para importes finales. UI `es-AR`/ARS.
- El historial agrega observaciones; no sobrescribe precios anteriores. Cada precio tiene fuente, fecha observada y calidad/frescura. Los datos demo se identifican como ficticios.
- Producto exacto y sustituto tienen etiquetas distintas. Las restricciones de marca y sustitución del usuario se respetan.
- `effectiveCostARS = productsTotalAfterDiscountsARS + storeVisitPenaltyARS × numberOfVisits + distancePenaltyARSPerKm × modeledDistanceKm`. No multiplicar precios por penalizaciones de unidades incompatibles. Documentar cómo se estiman visitas y distancia; no prometer rutas ni gasto real de combustible.
- Un resultado exacto solo es óptimo sobre el conjunto acotado de candidatos evaluados. El recorte y cualquier fallback heurístico deben informarse; nunca afirmar un óptimo global que no se calculó.
- Los ahorros del plan son estimaciones con una base comparable y fija. Ahorro registrado requiere evidencia de compra; no surge automáticamente al crear o completar un plan.
- Access JWT de corta vida en memoria del frontend; refresh en cookie HttpOnly, almacenado hasheado en backend, con rotación, detección de reutilización y protección CSRF. Nunca guardar tokens en localStorage ni logs.
- Toda consulta o mutación de recursos privados filtra por usuario autenticado; IDs enviados por el cliente no determinan ownership.
- Sin ubicación precisa no se inventan distancias. Sin información suficiente no se inventan precios, disponibilidad, elegibilidad o ahorro.

## Checkpoint mínimo obligatorio

Al actualizar `CONTINUAR.md`, dejar: fecha, paso activo, pasos verificados, archivos tocados, comandos ejecutados y resultados, bloqueos, siguiente paso exacto y criterios pendientes. Registrar también rama/remoto, último commit publicado conocido y cualquier commit local cuyo push quede pendiente. Si el árbol de trabajo contiene cambios de otra sesión, describirlos y preservarlos. No incluir credenciales, tokens ni valores privados de `.env`.
