# Punto de continuación

## Traspaso — leer esto primero (Claude o Codex)

Este archivo es la fuente del estado de trabajo; no depender del historial de chat. `AGENTS.md` contiene las reglas, `CLAUDE.md` el arranque para Claude y `docs/steps/phase-01.md` las instrucciones de cada paso. **No rehacer lo terminado** (P0-01, P1-01, P1-02). Empezar por **P1-03**. Resolver decisiones rutinarias siguiendo los ADRs (0001–0006), sin confirmaciones innecesarias. Al cerrar cada paso actualizar **CONTINUAR.md, CLAUDE.md y ROADMAP.md** (y README si cambia la operación), luego commit y push.

Los resultados de abajo son el registro de la sesión del 2026-09-18, no una garantía del estado de servicios en una fecha posterior. No hay implementación parcial de P1-03 que recuperar.

## Estado: 2026-09-18 — P0-01, P1-01 y P1-02 completos

Raíz: `C:\Users\PC\Desktop\TusOfertasApp\solucionadoApp`. Remoto: `git@github.com:matiasstr/solucionadoApp.git`. Rama: `main`.

**Próximo paso: P1-03 — Auth backend y perfil** (`docs/steps/phase-01.md`, ADR 0003). Luego P1-04 (auth frontend) cierra la fase 1.
No están implementados auth, catálogo, rutinas, optimizador, importadores ni jobs.

## Qué ya existe

- P0-01: requerimientos, arquitectura, dominio, schema, ADRs, Compose, README y roadmap de 25 pasos con diez guías.
- P1-01: monorepo npm workspaces; Next 16.3.5 / React 19.3 / Tailwind 4 / TanStack Query; Nest 11.2.5; TypeScript strict; Prisma 7.10.0. Portada en es-AR; API con Helmet, CORS allowlist, validación global, errores JSON y logging sin secretos.
- **P1-02 (esta sesión):**
  - Migración `apps/api/prisma/migrations/20260918120000_init/migration.sql`: SQL de `prisma migrate diff --from-empty` + `CREATE EXTENSION IF NOT EXISTS postgis` + CHECKs de `docs/DOMAIN.md`, índice único `lower(email)`, trigger append-only en `ProductPrice` (SQLSTATE 23001), trigger que deriva `Store.location` de longitud/latitud, índice GiST `Store_location_gist_idx` (también declarado en el schema para evitar drift).
  - `apps/api/src/database/`: `PrismaService` (adaptador `@prisma/adapter-pg` 7.10.0, conexión diferida, `isReady()` con timeout, `$disconnect` al cerrar) y `DatabaseModule.forRoot(url)` global. `AppModule.forRoot(config)`.
  - `DATABASE_URL` obligatoria y validada en `apps/api/src/config/environment.ts` (errores solo nombran la variable).
  - `GET /api/health` = liveness (sin DB). `GET /api/health/ready` = `SELECT 1`; 200 `{status:"ok",checks:{database:"up"}}` o 503 `{status:"unavailable",checks:{database:"down"}}`.
  - `apps/api/src/modules/stores/infrastructure/store-proximity.repository.ts`: `ST_DWithin` parametrizado en metros, ordenado por distancia. Aún no está registrado en un módulo Nest (lo conecta P2-02).
  - Scripts: `db:migrate` (migrate dev), `db:deploy`, `db:status`, `test:db` (raíz y workspace API). `apps/api/scripts/test-db.cjs` recrea **solo** una base cuyo nombre termina en `_test`.
  - `TEST_DATABASE_URL` agregado a `.env.example`. `pg` 8.23.0 como devDependency (script/tests).
  - ADR 0006 (runtime DB, PostGIS, integridad en SQL). README, DOMAIN y ROADMAP actualizados.
- Base de desarrollo `tusofertas` migrada con `db:deploy`; `db:status` = "Database schema is up to date!". Contenedores `postgres` y `redis` del proyecto corriendo (healthy). Volúmenes intactos.

## Verificaciones ejecutadas (P1-02)

| Control | Resultado |
| --- | --- |
| `docker compose up -d` / `ps` | postgres (PostgreSQL 17.5, PostGIS 3.5.2) y redis healthy |
| `npm.cmd run db:validate` / `db:generate` | Válido; cliente Prisma 7.10.0 generado |
| `npm.cmd run test:db` | Base `tusofertas_test` recreada; migración aplicada; segunda aplicación "No pending migrations"; `migrate diff` contra el schema vacío; **13/13 tests de integración** (PostGIS/GiST, readiness real, lectura/escritura, sincronización de location, radio, email, coordenadas, producto/EAN, historial append-only e idempotencia, promociones, rutinas/inventario/planes, categoría) |
| `npm.cmd run verify` | Exit 0 (validate, generate, typecheck, lint, 9/9 tests unitarios, build API+web). Log en `.cache/verification/p1-02-verify.log` |
| `npm.cmd run db:deploy` + `db:status` en dev | Migración aplicada; schema up to date |
| Smoke HTTP con `npm run start` de la API | health 200; ready 200 con DB; `docker compose stop postgres` → ready 503 y health 200; `start` → ready 200 de nuevo. Log sin URL de DB |
| `npm.cmd audit` | 0 vulnerabilidades |

Los tests encontraron y se corrigió un bug real: los CHECK de coordenadas aceptaban una sola coordenada (`true AND NULL` pasa un CHECK). La migración aún no estaba publicada, por eso se corrigió en el mismo archivo.

## Decisiones y notas

- Leer ADRs 0001–0006. Prisma ignora `spatial_ref_sys`, CHECKs, triggers e índices por expresión en el diff; cambiarlos requiere migración SQL nueva. No usar `db push`.
- `npm test` no requiere DB (readiness se prueba caída con puerto cerrado). `npm run test:db` requiere Docker corriendo.
- PowerShell bloquea wrappers `.ps1`: usar `npm.cmd` / `npx.cmd`. Node 22.18.0; npm 10.9.3. No cambiar majors.
- `node --test <directorio>` no funciona en Node 22: pasar archivos explícitos.
- `RefreshSession` ya existe en la migración (tokenHash único, familyId, replacedById único, expiresAt > createdAt): P1-03 probablemente no necesita migración nueva, salvo campos adicionales que decida.
- Ningún precio de ejemplo es real; fixtures de tests son ficticios.

## Git y autorización persistente

El usuario pidió **commit y push al completar cada paso**, sin confirmaciones ordinarias. No usar force push ni sobrescribir trabajo ajeno. Excluir `.env`, generados y logs.

- P0-01: `bf6653b`. P1-01: `0f84809`. Checkpoints: `d92b6e4`, `b8c0d58` (traspaso a Claude). Todos publicados.
- P1-02: commit `feat(P1-02): ...` en `main`; su hash y resultado del push se informan al cerrar la sesión y se registran en el siguiente checkpoint.
- Si el push falla, guardar el error y reintentar; no afirmar que se publicó.

## Cómo seguir con P1-03

1. Leer `AGENTS.md`, `ROADMAP.md`, `docs/steps/phase-01.md` (sección P1-03), ADR 0003 y 0006, `docs/DOMAIN.md` (usuarios/sesiones).
2. `git status --short --branch`, `git log -4 --oneline`, `docker compose ps` (si no corre: `docker compose up -d`), `npm.cmd run db:status`.
3. Implementar `apps/api/src/modules/auth` y `users`: register/login/refresh/logout, `GET/PATCH /api/users/me`, Argon2id, JWT corto con issuer/audience, refresh en cookie HttpOnly con hash en DB, rotación atómica, replay revoca familia, CSRF/Origin, rate limit, redacción en logs. Agregar variables de claves a `validateEnvironment` y `.env.example` (sin valores reales).
4. Tests unitarios + integración contra `tusofertas_test` (extender `test/integration/` y `scripts/test-db.cjs` para correr los archivos nuevos): concurrencia de registro, rotación simultánea, replay, ownership.
5. `npm.cmd run verify` y `npm.cmd run test:db`; actualizar README/ROADMAP/CONTINUAR/CLAUDE.md; commit y push.

**Cierre de P1-03:** endpoints documentados, flujos seguros demostrados con tests reales, sin secretos en fixtures ni logs. Si hay bloqueo, dejar el paso EN CURSO con el próximo comando exacto.

## Prompt listo para pegar (Claude o Codex)

> Continuá el proyecto en C:\Users\PC\Desktop\TusOfertasApp\solucionadoApp. Leé primero CLAUDE.md (o AGENTS.md), y CONTINUAR.md. P0-01, P1-01 y P1-02 ya están implementados, probados y publicados; no los rehagas. El próximo paso es P1-03 (auth backend), descrito en docs/steps/phase-01.md y ADR 0003. Implementalo, probalo contra la base real con npm.cmd run test:db, y actualizá README, ROADMAP, CONTINUAR y CLAUDE.md. Tenés autorización para commit y push al completar cada paso; no pidas confirmaciones rutinarias. No marques como probado lo que no ejecutaste.
