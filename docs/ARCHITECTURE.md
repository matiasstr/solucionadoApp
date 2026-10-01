# Arquitectura

Estado: implementada en las diez fases (P0-01 a P10-02) y demostrada con datos DEMO y simulados. Lo que falta para operar con datos reales (fuente de precios, worker y despliegue completo) está en "Pendiente fuera del código" al final; el estado verificado de cada sesión, en `CONTINUAR.md`.

## Objetivo y límites

Ayudar a una persona en Argentina a gastar menos en sus compras habituales. El flujo principal es rutina → necesidad del período → inventario → precios/promociones elegibles → restricciones → cronograma → ahorro estimado. La búsqueda pública es una entrada al producto, no el centro del dominio.

Monorepo con npm workspaces y monolito modular NestJS. Una base PostgreSQL con PostGIS. Next.js App Router consume la API por el mismo origen; TanStack Query administra el estado remoto del cliente. Un **worker** aparte (mismo código, otro proceso) consume colas BullMQ en Redis para importaciones, planes semanales y alertas; el API HTTP no usa Redis. Sin servicios independientes ni bus de eventos.

```mermaid
flowchart TD
  Sources[Proveedor simulado / archivos JSON Lines; fuente real pendiente] --> Providers[PriceProvider y PromotionProvider]
  Providers --> Pipeline[Normalización, identidad por fuente, lotes, cuarentena]
  Pipeline --> DB[(PostgreSQL + PostGIS)]
  Cmd[Comandos import y jobs] --> Redis[(Redis: colas BullMQ)]
  Redis --> Worker[Worker: importaciones, planes semanales, alertas]
  Worker --> Pipeline
  DB --> API[NestJS: API modular /api]
  API --> Web[Next.js: buscador, cuenta, plan, alertas]
  Routine[Rutinas + despensa + preferencias de pago] --> Needs[Necesidades del período]
  Needs --> Candidates[Candidatos: sucursales, ofertas y fechas]
  DB --> Candidates
  Candidates --> Optimizer[Optimizador determinista]
  Benefits[Motor de beneficios: una compra por visita, topes compartidos] --> Optimizer
  Optimizer --> Plan[Plan: pagar hoy, reintegro, ahorro estimado]
  Plan --> API
  Worker --> Alerts[Avisos en la bandeja]
  Alerts --> DB
```

## Estructura del monorepo

```text
apps/
  api/
    prisma/schema.prisma
    prisma/migrations/           # P1-02
    prisma.config.ts
    src/
      main.ts
      app.module.ts
      common/                    # errores y configuración HTTP
      config/
      modules/
        health/                  # P1-01
        auth/                    # P1-03
        users/                   # P1-03
        catalog/                 # fase 2
        stores/                  # fase 2
        prices/                  # fases 2, 3 y 6
        routines/                # fase 4
        inventory/               # fase 4
        shopping-plans/          # fase 5
        promotions/              # base P2-03; motor de beneficios y condiciones P10-01/P10-02
        benefits/                # P10-01: evaluación de canastas y topes informados
        search/                  # P3-01/P3-02: búsqueda y comparación (ofertas con promoción y beneficios)
        dashboard/               # P6-02: resumen privado
        imports/                 # fase 7
        jobs/                    # fase 8: contratos, handlers, worker y comando (P8-01)
        alerts/                  # fase 9
  web/
    src/app/                     # rutas App Router
    src/components/
    src/lib/                     # API, query, formatos
packages/
  shared/                        # contratos HTTP seguros; sin Prisma ni secretos
  ui/                            # componentes realmente reutilizados
  config/                        # TypeScript y herramientas
infra/docker/                    # preparación local
docs/
  REQUERIMIENTOS.md
  DOMAIN.md
  ARCHITECTURE.md
  architecture-decisions/
  steps/
ROADMAP.md
CONTINUAR.md
```

No se crean servicios vacíos que aparenten funcionalidad: un módulo existe cuando tiene comportamiento probado.

## Responsabilidades y dependencias

| Módulo | Responsabilidad | No debe hacer |
| --- | --- | --- |
| Auth / users | Identidad, sesiones, preferencias y ownership | Exponer hashes o decidir ofertas |
| Catalog | Producto concreto, equivalencias y categorías | Confundir sustituto con producto exacto |
| Stores | Cadenas, sucursales y distancias | Inventar coordenadas de usuario |
| Prices | Observaciones, precio vigente, historial y análisis | Sobrescribir el historial |
| Routines / inventory | Consumo esperado y existencias declaradas | Descontar inventario por generar un borrador |
| Promotions | Elegibilidad y cálculo de descuentos | Suponer banco/tarjeta o acumulación |
| Shopping plans | Necesidades, optimización y snapshots | Hablar con SEPA o depender de Nest en el algoritmo |
| Imports | Adaptadores, normalización, deduplicación y lotes | Cargar archivos grandes completos en memoria |
| Jobs / alerts | Orquestación, reintentos, notificaciones idempotentes | Duplicar lógica del dominio |

En módulos con reglas usar `domain/` (funciones y tipos puros), `application/` (casos de uso y puertos), `infrastructure/` (Prisma, proveedores) y `presentation/` (controllers/DTO). En health y CRUD sencillo mantener pocos archivos. Dependencias hacia dominio/aplicación; estos no importan adaptadores, decoradores Nest ni el cliente Prisma.

`PriceProvider` y `PromotionProvider` entregan `AsyncIterable` de registros crudos. `PriceImporter` y `PromotionImporter` orquestan; la normalización de productos y registros vive en `imports/domain/import-normalizer.ts` y el precio final lo decide `normalizePrice` (fase 2). Implementado en P7-01 con un proveedor simulado y uno de archivo JSON Lines; SEPA queda como adaptador futuro con su propio paso. Se conservan fuente, fecha observada, ingestión, clave de idempotencia e id de la ejecución; la identidad por fuente vive en `ExternalProductRef`/`ExternalStoreRef`. Desde P7-02 cada ejecución queda en `ImportRun`, los rechazos en `QuarantinedRecord` (sin el registro completo), los lotes se reintentan con límite y una ejecución fallida se reanuda desde su posición confirmada solo si la fuente es repetible; las descargas se limitan a `IMPORT_ALLOWED_HOSTS`. Ver [ADR 0018](architecture-decisions/0018-import-pipeline.md), [ADR 0019](architecture-decisions/0019-import-runs-recovery.md) y [docs/IMPORTS.md](IMPORTS.md).

Jobs (P8-01, [ADR 0020](architecture-decisions/0020-jobs-bullmq-worker.md)): `src/worker.ts` es un proceso aparte del API HTTP (contexto Nest sin servidor) con un worker de BullMQ por cola (`imports`, `plans`). Los handlers de `jobs/application/` no dependen de BullMQ y llaman a `PriceImporter`, `PromotionImporter` y `ShoppingPlansService.generateScheduled`; `jobs/domain/job-contracts.ts` define nombres, colas, datos (validados al encolar y al procesar) e ids por ejecución lógica. El API HTTP no importa BullMQ ni necesita Redis. Encolar y consultar es un comando (`npm.cmd run jobs`), no un endpoint. Desde P8-02 ([ADR 0021](architecture-decisions/0021-job-scheduling-operations.md)): programaciones en hora argentina con `upsertJobScheduler`, reporte operativo (`jobs/application/operations-report.ts`), fallos agotados con reintento manual, worker con `/health`/`/ready` y modo `--until-idle`, e imágenes en `apps/api/Dockerfile`. Operación en [docs/RUNBOOK.md](RUNBOOK.md).

Alertas (P9-01, [ADR 0022](architecture-decisions/0022-price-alerts-notifications.md)): `alerts/domain/` evalúa y decide en funciones puras (`alert-evaluation.ts`, `alert-rules.ts`, `notification-content.ts`); `EvaluatePriceAlertsUseCase` lee precios con `prices/application/current-price-analysis.ts` (compartido con el dashboard) y aplica cada resultado con la regla bloqueada. El job `CHECK_PRICE_ALERTS` corre en el worker; el API solo administra reglas y la bandeja. El único canal es dentro de la app.

Beneficios de pago (P10-01, [ADR 0023](architecture-decisions/0023-payment-benefits-engine.md)): `promotions/domain/benefit-engine.ts` cobra compras completas (promoción del producto por línea, un beneficio de pago por compra, topes compartidos por período y grupo) con la elegibilidad de `payer-eligibility.ts`; el módulo `benefits` lo expone (`POST /benefits/evaluate`) y guarda el consumo de topes informado.

Plan con beneficios (P10-02, [ADR 0024](architecture-decisions/0024-plan-payment-benefits.md)): `shopping-plans/domain/plan-benefits.ts` cobra cada visita como una compra del motor y busca la canasta (exhaustiva dentro de `PLANNER_MAX_BASKET_EVALUATIONS` o búsqueda local determinista); el optimizador de P5-02 sigue eligiendo visitas cuando ninguna regla de pago aplicable cambia la suma de líneas. `priceLine` sigue siendo el cálculo de línea del buscador y de los candidatos. El comparador informa `paymentBenefits` por oferta con `promotions/domain/benefit-conditions.ts` (las mismas condiciones que el plan), sin cambiar precios ni orden.

Consultas de precios a escala (P10-02, [ADR 0025](architecture-decisions/0025-price-queries-at-scale.md)): el análisis del precio actual del resumen y de las alertas resume la ventana de 30 días en SQL (`findCurrentWithWindowStats`) y clasifica con la misma función del dominio que la ficha (`classifyCurrentPrice`); el precio actual con sucursales conocidas se busca por índice (`LATERAL … LIMIT 1`).

## API, cliente y entorno

- API bajo `/api`; endpoints del pedido se agregan a ese prefijo. Fechas ISO, importes y cantidades decimales como strings. IDs UUID. Paginación con límite máximo y orden estable.
- ValidationPipe con whitelist y rechazo de campos desconocidos. DTOs explícitos, errores JSON consistentes, logging JSON sin cuerpos de autenticación ni headers sensibles.
- Web: español argentino, ARS, mobile-first, contraste y foco accesibles. Estados carga/vacío/error/éxito; precio por unidad y antigüedad de la observación visibles.
- PostgreSQL es fuente de verdad. Redis no almacena el único ejemplar de precios, planes ni sesiones.
- Desarrollo: apps ejecutadas en host, PostGIS y Redis en Compose; puertos de datos publicados solamente en loopback. Imágenes `api`, `worker` y `migrate` en `apps/api/Dockerfile` (perfil `app` de Compose).
- Despliegue actual: web y API en Vercel con Supabase (ADR 0010), redesplegadas por última vez con todo hasta P8-01. El worker y Redis no están desplegados (preparación para Cloud Run en [RUNBOOK](RUNBOOK.md#en-la-nube-preparado-no-desplegado)).
- Producción: HTTPS, mismo sitio para web/API, secretos externos, pooling de conexiones y migración como tarea única antes de actualizar aplicaciones. No ejecutar migraciones automáticamente por réplica.

## Decisiones y riesgos

| Riesgo o ambigüedad | Decisión / mitigación | Paso |
| --- | --- | --- |
| Disponibilidad, esquema o condiciones de SEPA | Mock primero, adaptadores independientes; verificar acceso real al implementar | P7 |
| Frescos sin EAN y falsos equivalentes | EAN nullable, mapeo explícito y revisión de ambiguos; no unir por nombre solamente | P2/P7 |
| Datos atrasados o sucursales sin stock confirmado | TTL configurable y cobertura explícita; observación no implica stock garantizado | P3/P5 |
| Falta ubicación precisa | Ciudad/provincia; distancia desconocida y sin garantía de radio hasta tener coordenadas | P3/P4 |
| Moneda, redondeos y envases | Decimal; unidades compatibles; paquetes enteros; peso variable explícito | P2/P5 |
| Ofertas por cantidad/banco y topes | Motor básico (P2-03) y motor por compra con elegibilidad declarada y topes compartidos (P10-01/P10-02); lo desconocido queda condicionado y fuera del ahorro | P2-03/P5/P10 |
| Combinaciones de tiendas costosas | Búsqueda exacta acotada y fallback determinista identificado, también para canastas con beneficios | P5/P10 |
| Volumen de precios por zona | Ventanas resumidas en SQL sin tope oculto, precio actual por índice, benchmark reproducible ([RUNBOOK](RUNBOOK.md#tiempos-de-respuesta-benchmark-local)) | P10-02 |
| Pérdida de progreso entre modelos | Pasos identificados, criterios verificables, checkpoint obligatorio | Todos |
| Modelo inicial amplio | Migración revisada en P1-02; reglas SQL y de aplicación listadas en DOMAIN | P1-02 |
| Inflación y comparación histórica | Ventana reciente por producto/sucursal/unidad; sin prometer ahorro real | P6 |
| Cuenta, ubicación y sesiones sensibles | Auth probado, mínimo dato, scopes por usuario, logs redactados | P1-03/P4 |

## Referencias de implementación

Se verificaron las guías oficiales para [Next App Router](https://nextjs.org/docs/app/getting-started/installation), [NestJS](https://docs.nestjs.com/) y [adaptadores Prisma](https://www.prisma.io/docs/orm/overview/databases/database-drivers). Las versiones concretas quedan en los manifests y en el lockfile; no actualizar de major al retomar un paso sin revisar compatibilidad.

## Pendiente fuera del código

- **Fuente real de precios y promociones**: solo hay un proveedor simulado y archivos o descargas JSON Lines. Conectar una fuente (por ejemplo SEPA) requiere su propio paso: acceso, licencia y adaptador.
- **Worker y Redis en la nube**: preparados (imágenes, healthchecks, runbook), no desplegados. Sin ellos, en producción no corren importaciones programadas, planes semanales ni alertas.
- **Redespliegue**: producción tiene hasta P8-01; el próximo deploy de la API aplica las migraciones aditivas de P8-02, P9-01 y P10-01.
- **Avisos fuera de la app** (email o push) y una vista HTTP de las colas: no implementados.
