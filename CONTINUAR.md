# Punto de continuación

## Traspaso — leer esto primero (Claude o Codex)

Este archivo es la fuente del estado de trabajo; no depender del historial de chat. `AGENTS.md` contiene las reglas, `CLAUDE.md` el arranque para Claude, `apps/web/AGENTS.md` las reglas de Next 16 (leer las guías de `node_modules/next/dist/docs/` antes de tocar la web) y `docs/steps/` las instrucciones de cada paso. **No rehacer lo terminado**: la fase 1 completa (P0-01, P1-01 a P1-04) y **P2-01**. Empezar por **P2-02**. Resolver decisiones rutinarias siguiendo los ADRs (0001–0008), sin confirmaciones innecesarias. Al cerrar cada paso actualizar **CONTINUAR.md, CLAUDE.md y ROADMAP.md** (y README si cambia la operación), luego commit y push.

Los resultados de abajo son el registro de las sesiones del 2026-09-18 y 2026-09-21, no una garantía del estado de servicios en una fecha posterior. No hay implementación parcial de P2-02 que recuperar.

## Estado: 2026-09-21 — Fase 1 completa + P2-01

Raíz: `C:\Users\PC\Desktop\TusOfertasApp\solucionadoApp`. Remoto: `git@github.com:matiasstr/solucionadoApp.git`. Rama: `main`.

**Próximo paso: P2-02 — API de productos, canónicos, sucursales y precios actuales** (`docs/steps/phase-02.md`, ADR 0002 y 0008, `docs/DOMAIN.md`).
No están implementados los endpoints del catálogo, promociones, comparador, rutinas, optimizador, importadores ni jobs.

## Qué ya existe

- P0-01: requerimientos, arquitectura, dominio, schema, ADRs, Compose, roadmap.
- P1-01: monorepo npm workspaces; Next 16.3.5 / React 19.3 / Tailwind 4 / TanStack Query; Nest 11.2.5; Prisma 7.10.0. Portada es-AR.
- P1-02: migración `20260918120000_init` (PostGIS, CHECKs, triggers, GiST), `PrismaService` (`@prisma/adapter-pg`), `/api/health` y `/api/health/ready`, `StoreProximityRepository`, scripts `db:*` y `test:db`, ADR 0006.
- P1-03: `/api/auth/register|login|refresh|logout`, `GET/PATCH /api/users/me`; Argon2id, JWT HS256, refresh rotativo en cookie HttpOnly con detección de replay, CSRF (Origin + `X-Requested-With: tusofertas-web`), rate limit. ADR 0003.
- P1-04: auth en la web con rewrite same-origin (`API_ORIGIN`), token solo en memoria, refresh compartido, `(auth)/login|register`, `(private)/inicio|bienvenida`, E2E en Edge real. ADR 0007.
- **P2-01 (esta sesión): catálogo, comercios, historia de precios, unidades y seed DEMO.**
  - Dominio (sin Prisma ni Nest): `catalog/domain/decimal.ts` (`DecimalValue`, entero BigInt escalado, HALF_UP), `units.ts` (KG/G, L/ML, UNIT; `toBaseQuantity`, `convertQuantity`, `unitPricePer100g`), `naming.ts`; `prices/domain/price-normalizer.ts`, `price-freshness.ts` (precio actual, desempate, umbral), `price-identity.ts` (clave idempotente), `price-records.ts`.
  - Infraestructura: `CategoryRepository` (upsert con detección de ciclos), `CanonicalProductRepository`, `ProductRepository` (valida dimensión contra el canónico, EAN, cantidad), `StoreRepository` (coordenadas completas o ninguna), `ProductPriceRepository` (`record` created/duplicate/conflict, `recordMany` para el seed, `findCurrentByProduct` con `DISTINCT ON`, `findHistory`).
  - Aplicación: `RecordPriceObservationUseCase`, `GetCurrentPricesUseCase` (frescura + precio por 100 g + orden por precio unitario). Módulos `CatalogModule`, `StoresModule`, `PricesModule` registrados en `AppModule` (todavía **sin controladores**: los endpoints son P2-02).
  - Configuración nueva: `PRICE_MAX_AGE_DAYS` (7) y `PRICE_SOURCE_PRECEDENCE` (vacío) en `apps/api/.env.example` y `ApiConfig.prices`.
  - Seed: `apps/api/src/seed/` (`demo-catalog.ts` datos puros, `demo-id.ts` UUID v5 determinista, `seed-demo-catalog.ts`, `main.ts` CLI). `npm.cmd run db:seed [-- --anchor=AAAA-MM-DD --days=N]`. No corre con `NODE_ENV=production` ni contra base remota sin `SEED_ALLOW_REMOTE=true`; nunca borra datos.
  - ADR 0008 (decimal propio, precio actual/frescura, política DEMO). README con tabla de precios por unidad base y sección del dataset.

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

## Decisiones y notas (P2-01)

- El dominio no usa `Prisma.Decimal` ni agrega `decimal.js`: `DecimalValue` evita acoplar el dominio y evita regenerar el lockfile (ver sección Deploy). Los repositorios escriben y devuelven cadenas.
- El normalizador **rechaza** en lugar de redondear en silencio: `numeric(14,2)` redondearía un precio con tres decimales sin avisar y eso mueve dinero.
- `ProductPrice_append_only` levanta `restrict_violation` (23001) y **Prisma lo reporta como P2003** ("foreign key"): el mensaje no menciona el trigger, pero la escritura se rechaza. No confiar en el texto del error.
- `integerDigits()` trunca (no redondea) para validar contra `numeric(14,2)`: `999999999999.99` es válido.
- Las cadenas reales llevan precios ficticios: el marcado es triple (`(DEMO)` en el nombre, `source='demo-seed'`, `importBatchId`). P2-02 debe exponer `source` y `observedAt` en toda respuesta de precio.
- `demo-seed` deja una sucursal sin coordenadas (`Vea Morón`), una que informa día por medio (`Vea Flores`) y una que dejó de informar hace 12 días (`Disco Belgrano`). Son casos de prueba, no errores.
- El E2E de auth crea cuentas `e2e-*@example.com` en la base de desarrollo. `npm test` no requiere DB; `test:db` y `db:seed` requieren Docker. PowerShell: `npm.cmd`/`npx.cmd`. Node 22.18.0; npm 10.9.3.

## Deploy (Vercel) — solo la web

- **URL de producción: https://tusofertas.vercel.app** (proyecto Vercel `tusofertas`, cuenta `matiasstr`, scope `matiasstrs-projects`). Desplegado el 2026-09-18 desde la CLI (`vercel deploy --prod --yes` en la raíz del repo; `.vercel/` ignorado por Git).
- Configuración del proyecto: root directory `apps/web`, framework Next.js, Node 22.x, install command `cd ../.. && npm ci --include=dev` (instala el monorepo desde el lockfile raíz). `.vercelignore` impide subir `.env`, `.cache`, `node_modules`, `dist`, `.next`.
- **La API y la base no están desplegadas.** Sin `API_ORIGIN` no hay rewrite: `/api/*` responde 404 y los formularios muestran "No pudimos conectar con el servicio" (verificado en producción). Portada, /login y /register cargan (200); /inicio redirige a login.
- Para auth en producción: desplegar la API Nest con PostgreSQL + PostGIS, configurar `DATABASE_URL`, `JWT_ACCESS_SECRET` propio, `CORS_ORIGINS=https://tusofertas.vercel.app`, `TRUST_PROXY` según el proveedor, correr `npm run db:deploy`, y definir `API_ORIGIN` en Vercel (`vercel env add API_ORIGIN production`) + redeploy. **No cargar el dataset demo en producción.**
- Lockfile: el original (generado en Windows) no tenía las variantes Linux de binarios opcionales (lightningcss, @tailwindcss/oxide, @next/swc, sharp, unrs-resolver) ni su `integrity` — bug npm/cli#4828 — y el build de Vercel fallaba. Se regeneraron esas entradas en una copia limpia sin `node_modules`, con **las mismas versiones**; `npm ci` + `verify` locales siguen en verde. Si vuelve a pasar tras actualizar dependencias: quitar del lock esos paquetes **y sus padres** y correr `npm install --package-lock-only` en un directorio sin `node_modules`.

### BLOQUEADO (desde 2026-09-18): API + Supabase gratis

Decisión del usuario: plan gratuito; Supabase si cumple (cumple: PostGIS, triggers/CHECKs, pooler IPv4 en modo sesión 5432 para migraciones y transacción 6543 para runtime), si no Neon.

- Hecho: proyecto Vercel `tusofertas-api` (id `prj_nXuVeI3OOFdz5YLQgm5aAofCP6CY`; root `apps/api`, framework other, Node 22, install `cd ../.. && npm ci --include=dev`, build `npm run db:generate && npm run build && mkdir -p public`). Variables de producción cargadas: `JWT_ACCESS_SECRET` (aleatoria, sensible), `CORS_ORIGINS=https://tusofertas.vercel.app`. Adaptador serverless `apps/api/api/index.js` + `apps/api/vercel.json` (región gru1, todo reescrito a `/api/index`), **probado en local** con la base de Docker (ready 200, validación 400, ruta inexistente 404) y commiteado.
- **Bloqueo que requiere al usuario:** `vercel integration add supabase` exige aceptar los términos del Marketplace en https://vercel.com/matiasstrs-projects/~/integrations/accept-terms/supabase?source=cli
- Próximo comando (con el proyecto API, sin cambiar `.vercel/` de la web): `VERCEL_ORG_ID=<orgId de .vercel/project.json> VERCEL_PROJECT_ID=prj_nXuVeI3OOFdz5YLQgm5aAofCP6CY vercel integration add supabase --name tusofertas-db -m region=gru1 --no-env-pull --non-interactive`.
- Después: mapear la URL pooled de la integración a `DATABASE_URL`, revisar SSL de `pg` con el pooler, `prisma migrate deploy` contra la URL de sesión (5432), deploy de la API, `API_ORIGIN=https://tusofertas-api.vercel.app` en el proyecto web + redeploy, smoke de registro/login en producción, **ADR 0009** (el 0008 ya está usado por el catálogo).

## Git y autorización persistente

El usuario pidió **commit y push al completar cada paso**, sin confirmaciones ordinarias. No usar force push ni sobrescribir trabajo ajeno. Excluir `.env`, generados y logs.

- P0-01 `bf6653b`; P1-01 `0f84809`; P1-02 `e16ba35`; P1-03 `6d04203`; P1-04 `0e236d6`; deploy web `277fa36`; adaptador serverless de la API `1cc2fae` (publicados).
- **P2-01**: commit `feat(P2-01): ...` creado y publicado en esta sesión; su hash se informa al cerrar la sesión e integra el próximo checkpoint.
- `apps/web/next-env.d.ts` aparece modificado cada vez que corre `next dev`/`build`: es generado y versionado a pedido del propio archivo; commitearlo si cambia.

## Cómo seguir con P2-02

1. Leer `AGENTS.md`, `ROADMAP.md`, `docs/steps/phase-02.md` (P2-02), ADR 0002 y **0008**, y la sección de precios del README.
2. `git status --short --branch`, `git log -4 --oneline`, `docker compose ps` (si no corre: `docker compose up -d`), `npm.cmd run db:status`, `npm.cmd run db:seed`.
3. Endpoints: `GET /products`, `/products/:id`, `/products/:id/prices`, `GET /canonical-products`, `/canonical-products/:id`, `GET /stores`, `/stores/:id`. Sin historia (fase 6).
4. Reusar lo de P2-01: repositorios y casos de uso ya existen; agregar DTOs (`class-validator`), controladores y contratos en `packages/shared`. Serializar decimales como texto y fechas ISO; **incluir siempre `source`, `observedAt` y la marca de desactualizado** en cualquier precio. No exponer entidades Prisma.
5. Paginación acotada, orden estable, filtros válidos; consultas por latitud/longitud/radio en km convertido a metros (`StoreProximityRepository`); sin coordenadas, permitir localidad sin afirmar distancia.
6. Tests: unitarios de DTOs/serialización y de integración (filtros, paginación, producto inexistente, parámetros inválidos, precios ausentes/antiguos, radio en km, agrupación por sucursal). Agregar los archivos nuevos a `apps/api/scripts/test-db.cjs`.
7. `npm.cmd run verify`, `npm.cmd run test:db`; actualizar README/ROADMAP/CONTINUAR/CLAUDE.md; commit y push.

## Prompt listo para pegar (Claude o Codex)

> Continuá el proyecto en C:\Users\PC\Desktop\TusOfertasApp\solucionadoApp. Leé primero CLAUDE.md (o AGENTS.md) y CONTINUAR.md. La fase 1 (P0-01, P1-01 a P1-04) y P2-01 (catálogo, precios, unidades y seed demo) ya están implementados, probados y publicados; no los rehagas. El próximo paso es P2-02 (API de productos, canónicos, sucursales y precios actuales), descrito en docs/steps/phase-02.md. Reusá los repositorios y casos de uso de P2-01, probalo contra la base real con npm.cmd run test:db y actualizá README, ROADMAP, CONTINUAR y CLAUDE.md. Tenés autorización para commit y push al completar cada paso; no pidas confirmaciones rutinarias. No marques como probado lo que no ejecutaste.
