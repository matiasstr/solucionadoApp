# Runbook de operación

Operación del worker, las colas y las importaciones (P8-01 y P8-02), y cómo medir tiempos de respuesta con un dataset grande (P10-02, al final). Decisiones en [ADR 0020](architecture-decisions/0020-jobs-bullmq-worker.md) y [ADR 0021](architecture-decisions/0021-job-scheduling-operations.md). Comandos para PowerShell desde la raíz del repo; en otra terminal, `npm` en vez de `npm.cmd`.

## Qué corre dónde

| Pieza | Qué hace | Cómo se ejecuta | Dónde está hoy |
| --- | --- | --- | --- |
| API HTTP | Atiende la web. No usa Redis | `npm.cmd run dev` / imagen `api` | Vercel (producción) y local |
| Worker | Procesa las colas `imports`, `plans` y `alerts` | `npm.cmd run worker` / imagen `worker` | **Solo local** (no desplegado) |
| Comando `jobs` | Encola, programa, consulta, reintenta | `npm.cmd run jobs -- …` | Local |
| Redis | Colas y programaciones (persistente, AOF) | Compose | Local |
| PostgreSQL | Datos, `ImportRun`, cuarentena | Compose / Supabase | Local y producción |

Todavía no hay una fuente real de precios: las importaciones programables son la simulada y archivos o descargas JSON Lines que alguien provea. Ninguna importación corre en producción (resguardo del código: `NODE_ENV=production` o una base remota sin `IMPORT_ALLOW_REMOTE=true` la rechazan).

## Arranque

```powershell
docker compose up -d                 # PostgreSQL y Redis
npm.cmd run db:deploy                # migraciones pendientes
npm.cmd run worker                   # worker persistente (deja la terminal ocupada)
npm.cmd run jobs -- counts           # desde otra terminal: Redis responde
```

Con contenedores (mismas bases de Compose, API en `127.0.0.1:3011`, salud del worker en `127.0.0.1:3012`):

```powershell
docker compose --profile app up -d --build   # migrate (una vez), api y worker
docker compose ps                            # api y worker "healthy"
```

Variables en `apps/api/.env.example` (`JOBS_*`, `WORKER_HEALTH_*`, `IMPORT_FILES_DIR`, `IMPORT_ALLOWED_HOSTS`). **Todas las réplicas del mismo `JOBS_PREFIX` con los mismos `JOBS_LOCK_DURATION_MS` y `JOBS_STALLED_INTERVAL_MS`.**

## Programar

```powershell
npm.cmd run jobs -- schedule GENERATE_WEEKLY_PLANS --cron="0 20 * * 0"                 # domingo 20:00: semana siguiente
npm.cmd run jobs -- schedule CHECK_PRICE_ALERTS --cron="15 * * * *"                     # alertas de precio cada hora (P9-01)
npm.cmd run jobs -- schedule IMPORT_PRICES --cron="30 6 * * *" --provider=jsonl --source=mi-fuente --file=diario/precios.jsonl.gz
npm.cmd run jobs -- schedules                                                          # próxima corrida de cada una
npm.cmd run jobs -- unschedule weekly-plans
```

- Cron de 5 campos en **hora argentina**. Repetir `schedule` con el mismo job y fuente actualiza la misma programación (no la duplica).
- Sin `--anchor`/`--week` las fechas son relativas al turno. El archivo de una importación programada se lee de `IMPORT_FILES_DIR` en cada turno: reemplazarlo antes de la hora.
- El worker no crea programaciones al arrancar; se hacen con este comando una vez por entorno.

## Observar

```powershell
npm.cmd run jobs -- report           # todo junto (JSON)
npm.cmd run jobs -- failed           # fallos agotados, con motivo y si son permanentes
npm.cmd run jobs -- status <id>      # un job: estado, intentos, progreso, resultado
```

| En el reporte | Qué mirar |
| --- | --- |
| `queues.<cola>.oldestWaitingSeconds` | Retraso: si crece, el worker no corre o no alcanza |
| `queues.<cola>.counts.failed` | Fallos agotados: ver `jobs -- failed` |
| `schedules[].next` | Próxima corrida de cada programación |
| `imports[].lastSuccess` | Último éxito por fuente; `lastRun.status`/`error` si la última falló |
| `staleImportRuns` | Ejecuciones abiertas sin avance: procesos caídos |
| `priceFreshness[].stale` | Fuente más vieja que `PRICE_MAX_AGE_DAYS`: sus precios se ven desactualizados |
| `weeklyPlans` | Semana de los últimos planes programados y cuántos por estado |

Logs del worker: JSON por línea, con `event` (`job_started`, `job_completed`, `job_retrying`, `job_failed`, `worker_redis_error`, …), `jobId` e `importRunId`. El detalle de una importación: `npm.cmd run import -- --report=<importRunId>`. Salud del worker (con `WORKER_HEALTH_PORT`): `/health` (vivo) y `/ready` (Redis y la base).

## Parar

- Worker en terminal: **Ctrl+C** una vez = deja de tomar jobs, espera los que están en curso y cierra Redis y la base. Una segunda vez corta en el acto (los jobs en curso se retoman solos después, ver abajo).
- Contenedor: `docker compose stop worker` (SIGTERM, hasta 60 s de gracia). `docker compose rm -sf api worker migrate` los quita sin tocar las bases.
- Nunca `docker compose down -v`: borra los volúmenes (datos y colas).

## Recuperar

| Situación | Qué pasa solo | Qué hacer |
| --- | --- | --- |
| Un job falla una vez | Se reintenta hasta `JOBS_ATTEMPTS` con espera creciente | Nada |
| Se agotaron los intentos | Queda en `failed` 30 días | Corregir la causa y `jobs -- retry <id>`; una importación se reanuda desde lo confirmado |
| Falla permanente (datos, configuración, archivo, host, producción) | No se reintenta | Corregir y `jobs -- retry <id> --force`, o encolar de nuevo con otra `--key` |
| El worker murió con un job en curso | Al vencer el bloqueo otro worker lo retoma y cierra la ejecución abierta | Arrancar un worker |
| Un `npm.cmd run import` murió | La ejecución queda `RUNNING` | `jobs -- close-stale-runs` y después `npm.cmd run import -- … --resume=<id>` |
| Redis caído | El worker reconecta solo; `jobs` falla con código 1 (nunca informa éxito) | `docker compose up -d` |
| Base caída | Los jobs fallan y se reintentan; `/ready` da 503 | Levantar la base; reintentar los fallidos agotados |

Reintentar nunca duplica: los precios son idempotentes (lo ya escrito cuenta como repetido) y los planes semanales usan la clave `job-weekly-<lunes>` por usuario.

## En la nube (preparado, no desplegado)

1. Aplicar migraciones una vez con la imagen `migrate` antes de actualizar API y worker.
2. Redis persistente (Memorystore u otro con persistencia): las programaciones y los fallidos viven ahí.
3. Worker como **servicio** Cloud Run con instancias mínimas ≥ 1, CPU siempre asignada, `WORKER_HEALTH_PORT=$PORT` y `WORKER_HEALTH_HOST=0.0.0.0` (con CPU solo durante pedidos BullMQ no renueva bloqueos). O como **Cloud Run Job** con `node dist/worker.js --until-idle`, disparado por Cloud Scheduler cada N minutos: procesa lo pendiente y termina.
4. Secretos (`DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`) desde el gestor de secretos, nunca en la imagen. El worker hoy también valida la configuración del API porque arma los mismos módulos.
5. Programar con `jobs -- schedule` una sola vez contra ese Redis. Mientras no haya una fuente real habilitada (con su ADR de licencia), no programar importaciones en producción.

## Tiempos de respuesta (benchmark local)

Para medir la API con más datos que el seed DEMO sin tocar la base de desarrollo (P10-02, [ADR 0025](architecture-decisions/0025-price-queries-at-scale.md)):

1. Crear una base aparte en el PostgreSQL de Compose (`CREATE DATABASE tusofertas_bench;` con el usuario de desarrollo) y, **solo en esa terminal**, apuntar `DATABASE_URL` a ella: `$env:DATABASE_URL = '<la URL de .env con /tusofertas_bench al final>'`. Las variables del proceso tienen precedencia sobre los `.env`.
2. Desde `apps/api`, con el build hecho (`npm.cmd run build`):
   ```powershell
   npx.cmd prisma migrate deploy
   node --env-file-if-exists=../../.env dist/seed/main.js
   node --env-file-if-exists=../../.env dist/modules/imports/cli.js --provider=mock --stores=60 --products=140 --days=30 --promotions --batch-size=1000
   ```
   La importación simulada agrega unas 252.000 observaciones en ~26 s.
3. Levantar la API contra esa base en otro puerto y medir desde otra terminal:
   ```powershell
   $env:PORT = '3020'; node --env-file-if-exists=../../.env --env-file-if-exists=.env dist/main.js
   $env:BENCH_BASE_URL = 'http://127.0.0.1:3020'; node scripts/bench-api.cjs --runs=20
   ```
   El script solo acepta una URL local: crea una cuenta `bench-…@example.com` con zona en Caballito, débito y crédito del Banco Demo y una rutina con todos los productos genéricos, y genera planes.
4. Detener la API y borrar la base (`DROP DATABASE tusofertas_bench;`).

Resultados del 2026-10-01 (p50 de 20 pedidos en serie, ~259.000 observaciones, 63 sucursales a 5 km): búsqueda cerca 29 ms; búsqueda sin ubicación 97 ms; comparación 59 ms; historial 12 ms; generar plan de 18 productos 493 ms (~380 ms de candidatos y ~70 ms del optimizador con beneficios); listado de planes 8 ms; resumen 295 ms. Son números de una máquina de desarrollo con datos sintéticos: sirven para comparar entre versiones, no prueban escala de producción.
