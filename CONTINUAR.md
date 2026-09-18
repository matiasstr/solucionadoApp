# Punto de continuación

## Traspaso a Claude — leer esto primero

El usuario pidió dejar el proyecto listo para continuar con **Claude**, sin depender de este chat. **No rehacer la planificación ni el bootstrap**: están implementados y publicados. Empezar por **P1-02** y avanzar por los pasos del roadmap, guardando el progreso después de cada paso y antes de agotar el contexto. Resolver decisiones rutinarias siguiendo los ADRs, sin pedir confirmaciones innecesarias.

Este archivo es la fuente del estado de trabajo. `AGENTS.md` contiene las reglas del proyecto y `docs/steps/phase-01.md` las instrucciones de implementación y pruebas. Los resultados de abajo son el registro de la sesión del 2026-09-18, no una garantía del estado de servicios o auditorías en una fecha posterior. No hay bloqueos de código conocidos ni implementación parcial de P1-02 que recuperar.

## Estado: 2026-09-18 — P0-01 y P1-01 completos

Raíz: `C:\Users\PC\Desktop\TusOfertasApp\solucionadoApp`.
Remoto: `git@github.com:matiasstr/solucionadoApp.git`. Rama: `main`.

**Próximo paso: P1-02 — Prisma operativo, migraciones y PostGIS.**
No están implementados auth, catálogo, rutinas, optimizador, importadores ni jobs. La fase 1 completa requiere P1-02, P1-03 y P1-04.

## Qué ya existe

- P0-01: pedido original, arquitectura, dominio, schema inicial de 15 entidades, ADRs, Compose, README y roadmap de 25 pasos con diez guías.
- P1-01: monorepo npm workspaces; Next 16.3.5 / React 19.3 / Tailwind 4 / TanStack Query; Nest 11.2.5; TypeScript strict; Prisma 7.10.0.
- Portada en español argentino, adaptable a móvil y escritorio, que indica honestamente que aún no hay precios disponibles.
- API `GET /api/health` (liveness únicamente), configuración validada, Helmet, CORS allowlist, DTO validation global, errores JSON y logging sin secretos.
- Paquetes pequeños `shared`, `ui`, `config`; scripts de desarrollo, build y verificación.
- Esquema Prisma validado y cliente generado. **No hay migraciones ni conexión operativa a DB todavía.**
- Compose preparado con PostgreSQL 17/PostGIS 3.5 y Redis 7.4; motor Docker disponible, contenedores del proyecto aún no iniciados.

## Verificaciones ejecutadas

| Control | Resultado |
| --- | --- |
| `npm.cmd ci` | Instalación limpia correcta; 610 paquetes; 0 vulnerabilidades conocidas reportadas |
| `npm.cmd run verify` | Exit 0: Prisma validate/generate, typecheck de workspaces, lint, tests y build |
| Tests API | 8/8: health/headers, errores, CORS, entorno y redacción de secretos |
| Build | Nest y Next producción correctos; rutas `/` y not-found generadas |
| Smoke HTTP final | Web 200; `/api/health` 200 con `{status:"ok",service:"tusofertas-api"}` |
| Revisión visual | Escritorio 1440 px y emulación móvil 390 px; ancho visible/scroll 390/390, sin desborde |
| `docker compose config --quiet` | Exit 0 |
| `docker info --format '{{.ServerVersion}}'` | Motor disponible: 28.5.2 |
| `git diff --check` | Correcto antes del cierre |

Los logs y capturas están en `.cache/verification/`, ignorados por Git. Los procesos temporales de verificación se detuvieron; para abrir la app usar `npm.cmd run dev`. No existe suite E2E de compras todavía.

## Decisiones y problemas resueltos

- Leer los cinco ADRs. El 0005 documenta overrides de dependencias de Nest/Prisma y concurrently 9.2.4.
- npm conservó una copia obsoleta de concurrently en el workspace. Se regeneró el lockfile y se verificó con instalación limpia. `npm ls` confirma versiones coherentes; no volver a instalar 9.2.1.
- PowerShell bloquea wrappers `.ps1`: usar `npm.cmd` / `npx.cmd`.
- Node observado 22.18.0; npm 10.9.3. No cambiar majors al retomar.
- Primeros accesos de red fallaron por sandbox; reintentos con la herramienta autorizada funcionaron. No son bloqueos del código.
- Ningún precio de ejemplo es un precio real, y el schema no implica funcionalidades implementadas.

## Git y autorización persistente

El usuario pidió **commit y push al completar cada paso**, sin confirmaciones ordinarias. Actualizar documentación, revisar cambios, excluir secretos/generados, hacer commit con ID del paso y push. No usar force push ni sobrescribir trabajo ajeno.

- P0-01: commit `bf6653b`, push a `origin/main` confirmado.
- P1-01: commit `0f84809`, push a `origin/main` confirmado. Este checkpoint registra el cierre después de verificar la publicación.
- Checkpoint posterior: `d92b6e4`, también publicado. El árbol estaba limpio y `HEAD` coincidía con `origin/main` antes de preparar este traspaso a Claude.
- Si el push falla, guardar el error y reintentar con el mecanismo autorizado; no afirmar que se publicó.

## Cómo seguir con P1-02

1. Leer `AGENTS.md`, `ROADMAP.md`, `docs/steps/phase-01.md`, `docs/DOMAIN.md`, `docs/ARCHITECTURE.md` y los ADRs.
2. Revisar `git status --short` y `git log -3 --oneline`. Conservar cambios existentes. Leer schema y constraints pendientes antes de crear SQL.
3. Crear los `.env` a partir de ejemplos **solo si no existen**. Ejecutar `docker compose up -d`, `docker compose ps`, `npm.cmd run db:validate` y `npm.cmd run db:generate`.
4. Crear migración inicial revisable con `CREATE EXTENSION IF NOT EXISTS postgis` antes de usar geography; completar CHECKs e índice GiST. Definir sincronización de coordenadas/geography. Ver DOMAIN para invariantes.
5. Incorporar adaptador PostgreSQL compatible con Prisma 7 y módulo DB con cierre limpio. Agregar readiness independiente de liveness. Hoy no está instalada la dependencia `@prisma/adapter-pg`.
6. Crear scripts `db:migrate` y `db:deploy`; documentarlos. No existe `db:seed` todavía: se implementa en P2-01.
7. Probar aplicación y repetición de migraciones, constraints y consulta espacial en una DB de prueba PostgreSQL/PostGIS real; no usar mock como prueba de SQL. No borrar volúmenes existentes.
8. Ejecutar controles correspondientes, actualizar README/ROADMAP/este archivo, hacer commit y push. Continuar luego con P1-03 (auth backend).

**Cierre de P1-02:** SQL versionado, cliente conectado, PostGIS/GiST/constraints comprobados, readiness verdadero y comandos reproducibles. Si hay un bloqueo, dejar paso EN CURSO y el próximo comando exacto.

### Archivos concretos para empezar

- `apps/api/prisma/schema.prisma`: modelo ya definido; revisar invariantes en `docs/DOMAIN.md` antes de migrar.
- `apps/api/prisma.config.ts`: configuración Prisma 7; carga `.env` raíz. No mover la URL al schema como en versiones anteriores.
- `apps/api/package.json` y `package.json`: agregar dependencias del adaptador y scripts de migraciones manteniendo workspaces y lockfile.
- `apps/api/prisma/migrations/`: crear SQL versionado. Revisar SQL antes de aplicarlo; PostGIS debe existir antes de crear el campo geography, también en la base shadow de desarrollo.
- `apps/api/src/`: incorporar módulo/servicio de DB e integrarlo en `app.module.ts`. Encapsular consultas espaciales parametrizadas.
- `apps/api/src/modules/health/`: conservar liveness; añadir readiness que devuelva indisponibilidad si falla DB.
- `apps/api/test/`: agregar pruebas contra una base PostgreSQL/PostGIS aislada. La suite actual no requiere DB; mantener clara esa separación.
- `README.md`, `ROADMAP.md`, `CONTINUAR.md`: actualizar comandos, resultados, estado y próxima acción al cerrar.

### Primeros comandos de inspección (PowerShell)

```powershell
cd C:\Users\PC\Desktop\TusOfertasApp\solucionadoApp
git status --short --branch
git log -4 --oneline
node --version
npm.cmd --version
docker compose config --quiet
docker compose ps
```

Si se retoma en otro equipo, ajustar únicamente la ruta y usar `npm ci` para instalar desde el lockfile. No reinstalar dependencias ni repetir todas las pruebas sin motivo si el entorno actual sigue preparado. No hacer `git reset --hard`, force push ni `docker compose down -v` para resolver diferencias.

## Prompt listo para pegar en Claude

> Continuá el proyecto en C:\Users\PC\Desktop\TusOfertasApp\solucionadoApp. Leé primero CLAUDE.md, AGENTS.md y CONTINUAR.md. No necesito otra planificación: P0-01 y P1-01 ya están implementados, probados y publicados. El próximo paso es P1-02, descrito en docs/steps/phase-01.md. Implementalo, probá migraciones y PostGIS con una base real, corregí los errores y actualizá README, ROADMAP y CONTINUAR. Tenés autorización para los comandos necesarios y para hacer commit y push al completar cada paso; no pidas confirmaciones rutinarias y respetá los controles del entorno. Trabajá por pasos y guardá un checkpoint al cerrar cada uno y antes de agotar contexto, con comandos ejecutados, resultados, pendientes y próxima acción exacta. No marques como probado lo que no ejecutaste. Después de P1-02 sigue P1-03, autenticación backend.
