# Punto de continuación

## Traspaso — leer esto primero (Claude o Codex)

Este archivo es la fuente del estado de trabajo; no depender del historial de chat. `AGENTS.md` contiene las reglas, `CLAUDE.md` el arranque para Claude y `docs/steps/phase-01.md` las instrucciones de cada paso. **No rehacer lo terminado** (P0-01, P1-01, P1-02, P1-03). Empezar por **P1-04**. Resolver decisiones rutinarias siguiendo los ADRs (0001–0006), sin confirmaciones innecesarias. Al cerrar cada paso actualizar **CONTINUAR.md, CLAUDE.md y ROADMAP.md** (y README si cambia la operación), luego commit y push.

Los resultados de abajo son el registro de la sesión del 2026-09-18, no una garantía del estado de servicios en una fecha posterior. No hay implementación parcial de P1-04 que recuperar.

## Estado: 2026-09-18 — P0-01, P1-01, P1-02 y P1-03 completos

Raíz: `C:\Users\PC\Desktop\TusOfertasApp\solucionadoApp`. Remoto: `git@github.com:matiasstr/solucionadoApp.git`. Rama: `main`.

**Próximo paso: P1-04 — Auth frontend** (`docs/steps/phase-01.md`, ADR 0003). Cierra la fase 1; después sigue P2-01.
No están implementados catálogo, rutinas, optimizador, importadores ni jobs. El frontend solo tiene la portada de P1-01.

## Qué ya existe

- P0-01: requerimientos, arquitectura, dominio, schema, ADRs, Compose, README y roadmap.
- P1-01: monorepo npm workspaces; Next 16.3.5 / React 19.3 / Tailwind 4 / TanStack Query; Nest 11.2.5; Prisma 7.10.0. Portada es-AR.
- P1-02: migración `20260918120000_init` (PostGIS, CHECKs, triggers, GiST), `PrismaService` con `@prisma/adapter-pg`, `/api/health` (liveness) y `/api/health/ready` (DB), `StoreProximityRepository`, scripts `db:migrate`/`db:deploy`/`db:status`/`test:db`, ADR 0006.
- **P1-03 (esta sesión):**
  - `apps/api/src/modules/auth/`: `auth.controller.ts` (register/login/refresh/logout), `auth.service.ts` (Argon2id, rotación atómica con `UPDATE` condicional, replay → revoca familia, logout revoca familia), `access-token.service.ts` (JWT HS256 vía `@nestjs/jwt`, issuer/audience/typ), `jwt-auth.guard.ts` + `CurrentUser`, `origin.guard.ts` (CSRF: Origin/Referer en allowlist + `X-Requested-With: tusofertas-web`), `refresh-token.ts` (cookie `tusofertas_refresh`, HttpOnly, SameSite=Lax, Path=/api/auth, Secure en producción), `password-hasher.ts`, `auth.dto.ts`, `auth.constants.ts`.
  - `apps/api/src/modules/users/`: `GET/PATCH /api/users/me` con DTO whitelist (sin mass assignment), `toUserProfile` (sin passwordHash; decimales como string).
  - `apps/api/src/config/`: nuevas variables `JWT_ACCESS_SECRET` (obligatoria, ≥ 32; producción rechaza el valor de ejemplo), `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_TTL_SECONDS` (900), `REFRESH_TOKEN_TTL_DAYS` (30), `AUTH_RATE_LIMIT_PER_MINUTE` (10). `ConfigModule` global con token `API_CONFIG`.
  - `common/public-http.exception.ts`: errores públicos `{statusCode, error, message, fields?}`; la validación global devuelve `fields` (nombres, nunca valores).
  - Dependencias exactas: `argon2` 0.45.1, `@nestjs/jwt` 12.0.2, `@nestjs/throttler` 6.7.0.
  - ADR 0003 actualizado con la implementación y la política de refresh concurrente. README con tabla de endpoints.
- `apps/api/.env` local tiene un `JWT_ACCESS_SECRET` aleatorio propio (no versionado). Otro equipo: copiar `apps/api/.env.example` y generar uno con el comando que indica.
- No hizo falta migración nueva: `RefreshSession` del esquema inicial alcanza.

## Verificaciones ejecutadas (P1-03)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0: validate, generate, typecheck, lint, **13/13 unitarios** (incluye `test/auth.test.cjs`: CSRF, validación, 11 variantes de JWT inválido, rate limit 429), build API+web |
| `npm.cmd run test:db` | Base `_test` recreada, migraciones no-op al repetir, sin drift, **24/24 integración** (13 de DB + 11 de auth: registro normalizado + Argon2id + cookie, email duplicado y 5 registros concurrentes → 1 cuenta, credenciales inválidas uniformes, perfil/ownership, mass assignment, cuenta eliminada, rotación, replay revoca familia, 2 refresh simultáneos → 1 gana, vencido, logout, logs sin secretos). Log en `.cache/verification/p1-03-test-db.log` |
| `npm.cmd audit` | 0 vulnerabilidades |
| Smoke contra `npm run dev` (DB de desarrollo) | register 201, `/users/me` 200, refresh 200, logout 204, refresh posterior 401, Origin ajeno 403 |

## Decisiones y notas

- Refresh concurrente: política **estricta** (dos refresh simultáneos con el mismo token revocan la familia). P1-04 debe compartir una sola promesa de refresh en vuelo.
- Rate limit en memoria (una instancia). Detrás de un proxy configurar `trust proxy`. Con varias réplicas, mover a Redis.
- Web en `localhost:3000` y API en `localhost:3001` son el mismo *site*: la cookie Lax viaja con `fetch(..., { credentials: 'include' })`. Usar el mismo host (`localhost` en ambos, no mezclar con `127.0.0.1`). Alternativa: rewrite de Next `/api` → API.
- `npm test` no requiere DB; `npm run test:db` requiere Docker corriendo.
- PowerShell bloquea wrappers `.ps1`: usar `npm.cmd` / `npx.cmd`. Node 22.18.0; npm 10.9.3. `node --test <directorio>` no funciona en Node 22.
- Supertest: no construir varias requests contra un server sin listen por adelantado (cierra el server); usar funciones.

## Git y autorización persistente

El usuario pidió **commit y push al completar cada paso**, sin confirmaciones ordinarias. No usar force push ni sobrescribir trabajo ajeno. Excluir `.env`, generados y logs.

- P0-01 `bf6653b`; P1-01 `0f84809`; checkpoints `d92b6e4`, `b8c0d58`; **P1-02 `e16ba35`** (publicado).
- P1-03: commit `feat(P1-03): ...` en `main`; su hash se informa al cerrar la sesión y se registra en el siguiente checkpoint.

## Cómo seguir con P1-04

1. Leer `AGENTS.md`, `ROADMAP.md`, `docs/steps/phase-01.md` (P1-04), ADR 0003 (sección Implementación) y la tabla de endpoints del README.
2. `git status --short --branch`, `git log -4 --oneline`, `docker compose ps` (si no corre: `docker compose up -d`), `npm.cmd run db:status`, `npm.cmd run dev`.
3. En `apps/web`: rutas `/login` y `/register`, cliente HTTP (`credentials: 'include'`, headers `X-Requested-With: tusofertas-web` y `Content-Type`), proveedor de auth con access token solo en memoria, refresh al iniciar, una única promesa de refresh compartida y un reintento como máximo, limpieza de caché TanStack Query al salir, navegación privada, pantalla honesta de onboarding pendiente.
4. Mostrar errores con `error`/`fields` de la API. Accesible con teclado y en móvil.
5. Validar: build, lint, typecheck; E2E real registro → recarga → refresh → logout; sin tokens en storage ni URLs. Capturas en escritorio y móvil.
6. Actualizar README/ROADMAP/CONTINUAR/CLAUDE.md; commit y push. Siguiente: P2-01.

## Prompt listo para pegar (Claude o Codex)

> Continuá el proyecto en C:\Users\PC\Desktop\TusOfertasApp\solucionadoApp. Leé primero CLAUDE.md (o AGENTS.md) y CONTINUAR.md. P0-01, P1-01, P1-02 y P1-03 ya están implementados, probados y publicados; no los rehagas. El próximo paso es P1-04 (auth frontend), descrito en docs/steps/phase-01.md y ADR 0003. Implementalo contra la API real, probalo de punta a punta y actualizá README, ROADMAP, CONTINUAR y CLAUDE.md. Tenés autorización para commit y push al completar cada paso; no pidas confirmaciones rutinarias. No marques como probado lo que no ejecutaste.
