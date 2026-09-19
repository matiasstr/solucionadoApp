# Punto de continuación

## Traspaso — leer esto primero (Claude o Codex)

Este archivo es la fuente del estado de trabajo; no depender del historial de chat. `AGENTS.md` contiene las reglas, `CLAUDE.md` el arranque para Claude, `apps/web/AGENTS.md` las reglas de Next 16 (leer las guías de `node_modules/next/dist/docs/` antes de tocar la web) y `docs/steps/` las instrucciones de cada paso. **No rehacer lo terminado**: la fase 1 completa (P0-01, P1-01 a P1-04). Empezar por **P2-01**. Resolver decisiones rutinarias siguiendo los ADRs (0001–0007), sin confirmaciones innecesarias. Al cerrar cada paso actualizar **CONTINUAR.md, CLAUDE.md y ROADMAP.md** (y README si cambia la operación), luego commit y push.

Los resultados de abajo son el registro de la sesión del 2026-09-18, no una garantía del estado de servicios en una fecha posterior. No hay implementación parcial de P2-01 que recuperar.

## Estado: 2026-09-18 — Fase 1 completa

Raíz: `C:\Users\PC\Desktop\TusOfertasApp\solucionadoApp`. Remoto: `git@github.com:matiasstr/solucionadoApp.git`. Rama: `main`.

**Próximo paso: P2-01 — Catálogo, sucursales, precios históricos, conversión de unidades y seed** (`docs/steps/phase-02.md`, ADR 0002, `docs/DOMAIN.md`).
No están implementados catálogo, comparador, rutinas, optimizador, importadores ni jobs.

## Qué ya existe

- P0-01: requerimientos, arquitectura, dominio, schema, ADRs, Compose, roadmap.
- P1-01: monorepo npm workspaces; Next 16.3.5 / React 19.3 / Tailwind 4 / TanStack Query; Nest 11.2.5; Prisma 7.10.0. Portada es-AR.
- P1-02: migración `20260918120000_init` (PostGIS, CHECKs, triggers, GiST), `PrismaService` (`@prisma/adapter-pg`), `/api/health` y `/api/health/ready`, `StoreProximityRepository`, scripts `db:*` y `test:db`, ADR 0006.
- P1-03: `/api/auth/register|login|refresh|logout`, `GET/PATCH /api/users/me`; Argon2id, JWT HS256, refresh rotativo en cookie HttpOnly con detección de replay, CSRF (Origin + `X-Requested-With: tusofertas-web`), rate limit. ADR 0003.
- **P1-04 (esta sesión):**
  - `apps/web/next.config.ts`: rewrite `/api/:path*` → `API_ORIGIN` (solo servidor; en desarrollo `http://127.0.0.1:3001`; sin valor en producción no hay rewrite). Headers de seguridad básicos. `apps/web/.env.example` ahora solo tiene `API_ORIGIN` (se quitó `NEXT_PUBLIC_API_URL`).
  - `apps/web/src/lib/api.ts` (cliente same-origin con errores tipados `ApiError`), `lib/auth/session.ts` (única promesa de refresh compartida + indicador sin secretos `tusofertas:had-session`), `lib/auth/auth-provider.tsx` (token solo en memoria, reintento único tras 401, limpieza de caché TanStack Query), `lib/auth/safe-redirect.ts`.
  - Rutas: `(auth)/login`, `(auth)/register` (formulario accesible `components/auth/auth-form.tsx`), `(private)/inicio`, `(private)/bienvenida` (onboarding honesto, perfil real desde la API) con `components/auth/private-shell.tsx`. Portada con "Ingresar" / "Crear cuenta" / "Mi cuenta".
  - `packages/shared`: contratos `UserProfile`, `SessionResponse`, `ApiErrorBody`.
  - API: `TRUST_PROXY` (Express `trust proxy`, `loopback` en desarrollo); `/auth/refresh` con 6× el límite de intentos.
  - E2E `apps/web/e2e/auth.e2e.cjs` (`npm.cmd run test:e2e`, Edge real vía `playwright-core` 1.63.0). ADR 0007.
  - `apps/web/AGENTS.md` y `apps/web/CLAUDE.md`: los genera `next dev`; se versionan (lo pide el propio archivo).

## Verificaciones ejecutadas (P1-04)

| Control | Resultado |
| --- | --- |
| `npm.cmd run verify` | Exit 0 (validate, generate, typecheck, lint, 13/13 unitarios, build API+web con rutas `/`, `/login`, `/register`, `/inicio`, `/bienvenida`) |
| `npm.cmd run test:db` | 24/24 integración con PostgreSQL/PostGIS real |
| `npm.cmd run test:e2e` | **8/8** en Edge headless contra `npm run dev`: anónimo sin refresh y redirección a login; registro con validación accesible, cookie HttpOnly/Lax/path, email duplicado; recarga con **un único** refresh pese a StrictMode; 401 → refresh → reintento; logout; login solo con teclado + error uniforme + `?next=//evil.example` bloqueado; refresh rechazado; móvil 390 px sin desborde. Sin tokens en storage, URL ni `document.cookie` |
| Revisión visual | Capturas en `.cache/verification/p1-04/` (escritorio y móvil). Se corrigieron: orden de tabulación del botón "Mostrar", error de campo que no se limpiaba al editar, numeración de "Lo que viene" |
| `npm.cmd audit` | 0 vulnerabilidades |

## Decisiones y notas

- Web y API en el mismo origen vía rewrite (ADR 0007). Next conserva un `X-Forwarded-For` que envíe el cliente: confiable detrás de un edge que lo reescribe (Vercel/Cloud Run), no detrás de un proxy propio sin sobrescribirlo.
- Refresh concurrente estricto en la API; el front lo evita con la promesa compartida. No agregar llamadas directas a `/auth/refresh` fuera de `refreshSession()`.
- El E2E crea cuentas `e2e-*@example.com` en la base de desarrollo (datos ficticios). Requiere `npm.cmd run dev` corriendo y `docker compose up -d`.
- `npm test` no requiere DB; `test:db` requiere Docker. PowerShell: usar `npm.cmd`/`npx.cmd`. Node 22.18.0; npm 10.9.3.

## Deploy (Vercel) — solo la web

- **URL de producción: https://tusofertas.vercel.app** (proyecto Vercel `tusofertas`, cuenta `matiasstr`, scope `matiasstrs-projects`). Desplegado el 2026-09-18 desde la CLI (`vercel deploy --prod --yes` en la raíz del repo; `.vercel/` ignorado por Git).
- Configuración del proyecto: root directory `apps/web`, framework Next.js, Node 22.x, install command `cd ../.. && npm ci --include=dev` (instala el monorepo desde el lockfile raíz). `.vercelignore` impide subir `.env`, `.cache`, `node_modules`, `dist`, `.next`.
- **La API y la base no están desplegadas.** Sin `API_ORIGIN` no hay rewrite: `/api/*` responde 404 y los formularios muestran "No pudimos conectar con el servicio" (verificado en producción). Portada, /login y /register cargan (200); /inicio redirige a login.
- Para auth en producción: desplegar la API Nest (p. ej. Cloud Run o Render) con PostgreSQL + PostGIS (p. ej. Neon o Supabase), configurar `DATABASE_URL`, `JWT_ACCESS_SECRET` propio, `CORS_ORIGINS=https://tusofertas.vercel.app`, `TRUST_PROXY` según el proveedor, correr `npm run db:deploy`, y definir `API_ORIGIN` en Vercel (`vercel env add API_ORIGIN production`) + redeploy. Es una decisión de infraestructura/costos pendiente del usuario.
- Lockfile: el original (generado en Windows) no tenía las variantes Linux de binarios opcionales (lightningcss, @tailwindcss/oxide, @next/swc, sharp, unrs-resolver) ni su `integrity` — bug npm/cli#4828 — y el build de Vercel fallaba. Se regeneraron esas entradas en una copia limpia sin `node_modules`, con **las mismas versiones**; `npm ci` + `verify` locales siguen en verde. Si vuelve a pasar tras actualizar dependencias: quitar del lock esos paquetes **y sus padres** y correr `npm install --package-lock-only` en un directorio sin `node_modules`.

## Git y autorización persistente

El usuario pidió **commit y push al completar cada paso**, sin confirmaciones ordinarias. No usar force push ni sobrescribir trabajo ajeno. Excluir `.env`, generados y logs.

- P0-01 `bf6653b`; P1-01 `0f84809`; P1-02 `e16ba35`; P1-03 `6d04203`; **P1-04 `0e236d6`** (publicados).
- Deploy Vercel + lockfile multiplataforma: commit `chore(deploy): ...` posterior a `0e236d6`; su hash se informa al cerrar la sesión.

## Cómo seguir con P2-01

1. Leer `AGENTS.md`, `ROADMAP.md`, `docs/steps/phase-02.md` (P2-01), ADR 0002 y 0006, `docs/DOMAIN.md` (dinero, unidades, envases, historia de precios).
2. `git status --short --branch`, `git log -4 --oneline`, `docker compose ps` (si no corre: `docker compose up -d`), `npm.cmd run db:status`.
3. Módulos `catalog`, `stores`, `prices` en `apps/api/src/modules/`; normalizador de precios y conversión dimensional con aritmética decimal (Prisma `Decimal`, nunca `number` para importes); precio actual determinista con umbral de antigüedad configurable.
4. `db:seed` repetible con cadenas reales como nombres (Carrefour, Coto, Jumbo, Vea, Disco), sucursales y precios **ficticios marcados DEMO**, ≥ 30 días de historia con fecha ancla controlable. Nunca en producción automáticamente.
5. Tests unitarios de normalización/unidades y de integración (seed dos veces sin duplicar, último precio, consulta espacial). Agregar archivos nuevos a `apps/api/scripts/test-db.cjs`.
6. `npm.cmd run verify`, `npm.cmd run test:db`; actualizar README/ROADMAP/CONTINUAR/CLAUDE.md; commit y push.

## Prompt listo para pegar (Claude o Codex)

> Continuá el proyecto en C:\Users\PC\Desktop\TusOfertasApp\solucionadoApp. Leé primero CLAUDE.md (o AGENTS.md) y CONTINUAR.md. La fase 1 (P0-01, P1-01 a P1-04) ya está implementada, probada y publicada; no la rehagas. El próximo paso es P2-01 (catálogo, precios históricos, unidades y seed demo), descrito en docs/steps/phase-02.md. Implementalo, probalo contra la base real con npm.cmd run test:db y actualizá README, ROADMAP, CONTINUAR y CLAUDE.md. Tenés autorización para commit y push al completar cada paso; no pidas confirmaciones rutinarias. No marques como probado lo que no ejecutaste.
