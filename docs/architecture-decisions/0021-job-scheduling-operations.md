# ADR 0021 — Programación y operación de jobs

Estado: aceptado. Fecha: 2026-09-30. Contexto: P8-02 (cierra la fase 8). Extiende ADR 0020. Operación diaria en [docs/RUNBOOK.md](../RUNBOOK.md).

## Decisión

**Programación con job schedulers de BullMQ.** `npm.cmd run jobs -- schedule <JOB> --cron="m h dm M dw"` crea o actualiza una programación con `upsertJobScheduler` en la zona `America/Argentina/Buenos_Aires` (sin horario de verano). El upsert es idempotente por id: correrlo dos veces o desde varias réplicas deja **una** programación y **un** job por turno (probado con dos productores a la vez). El id por defecto es uno por job y fuente (`weekly-plans`, `import-prices-<fuente>`, `import-promotions-mock-provider`). El worker **no** crea programaciones al arrancar: así una réplica nueva no pisa lo que se decidió. Cron de 5 campos, validado; un patrón inválido se rechaza con un mensaje claro.

**Fechas relativas.** En una programación, `anchorDate` (simulado) y `weekStart` (planes) van en `null` y se resuelven con el **instante programado** del turno, que BullMQ codifica en el id (`repeat:<programación>:<ms>`; `opts.prevMillis` no se guarda con el job). Es el mismo en cada reintento, así un reintento del lunes no genera la semana siguiente. Semana: la que empieza ese día si es lunes, si no la siguiente (domingo 20:00 → la semana que empieza al otro día). Al encolar a mano las fechas se siguen fijando al encolar.

**Estado observable.** `jobs -- report` junta, sin datos de usuarios: por cola, cantidades por estado y **retraso** (antigüedad del job más viejo en espera); programaciones con su próxima corrida; los últimos fallidos; por fuente, la última ejecución y el **último éxito** (`ImportRun`); ejecuciones abiertas **sin avance** (migración `20260930120000_import_run_progress_time`: `ImportRun.updatedAt` se actualiza con cada lote confirmado); **frescura** por fuente (última observación y si supera `PRICE_MAX_AGE_DAYS`); y los últimos planes semanales programados por estado. Los logs del worker llevan `jobId` e `importRunId` para correlacionar con `ImportRun`.

**Fallos agotados.** Un job que agota sus intentos queda en el conjunto `failed` de su cola 30 días (registro explícito, `jobs -- failed`). Lo que falló por datos, configuración o destino no permitido se marca **permanente** en el progreso del job y no se reintenta solo. `jobs -- retry <id>` lo devuelve a la cola con los intentos en cero y **conserva su progreso**: una importación se reanuda desde lo confirmado y los planes no se duplican (clave por semana). Una falla permanente solo con `--force`, después de corregir la causa.

**Workers caídos.** La importación anota su ejecución en el job apenas empieza. Si el worker muere, el bloqueo vence y otro retoma el job; como el reintento tiene el bloqueo, cierra la ejecución que quedó abierta (`FAILED`, "se interrumpió") y la reanuda desde su posición confirmada. Las ejecuciones abiertas por un comando manual que murió se cierran con `jobs -- close-stale-runs` (sin avance por `JOBS_STALE_RUN_MINUTES`, 30 por defecto) y se reanudan con `--resume`. Todas las réplicas de un prefijo deben usar los mismos `JOBS_LOCK_DURATION_MS` y `JOBS_STALLED_INTERVAL_MS`: el control de jobs caídos lo hace una sola por intervalo, y una con un intervalo largo demora el de las demás (se vio en los tests).

**Planes programados no deciden por el usuario.** Siguen creando borradores (ADR 0020): nunca activan ni reemplazan un plan del usuario; si la semana no tiene necesidades no se guarda nada.

**Imágenes.** `apps/api/Dockerfile` con tres destinos sobre `node:22.18.0-bookworm-slim`: `api` (HTTP, healthcheck `/api/health`), `worker` (healthcheck `/health` del servidor de salud del worker) y `migrate` (`prisma migrate deploy`, una vez antes de actualizar). Usuario `node` sin privilegios, secretos solo por variables, dependencias de producción sin CLI de Prisma ni TypeScript (`--omit=dev --omit=optional`: entraban como peers opcionales de `@prisma/client`; la imagen pasó de 873 MB a 518 MB). El worker expone `/health` (vivo; 503 mientras se apaga) y `/ready` (Redis y la base responden) si se define `WORKER_HEALTH_PORT`. Compose tiene un perfil `app` (`docker compose --profile app up -d --build`) que no cambia el `docker compose up -d` de siempre.

**API HTTP, worker persistente y job finito.** El API atiende pedidos y puede escalar a cero. El worker persistente necesita CPU todo el tiempo: en Cloud Run, un servicio con instancias mínimas ≥ 1 y CPU siempre asignada (con CPU solo durante pedidos, BullMQ deja de renovar bloqueos y los jobs se retoman una y otra vez). Alternativa más barata: un **Cloud Run Job** con `node dist/worker.js --until-idle`, disparado por Cloud Scheduler: promueve los turnos vencidos, procesa lo pendiente y termina cuando las colas quedan vacías (los turnos futuros esperan a la próxima ejecución). En ambos casos las programaciones viven en Redis, que tiene que ser persistente (AOF en Compose; Memorystore o equivalente en la nube). Nada de esto está desplegado.

## Alternativas consideradas

- **Cron del sistema o de Cloud Scheduler encolando cada job:** duplica la lógica de programación fuera de la app y no evita dobles encolados por sí solo.
- **Crear las programaciones al arrancar el worker:** cómodo, pero cada despliegue podría pisar un cambio hecho a mano y varias réplicas competirían por escribirlas.
- **Guardar la fecha resuelta al crear la programación:** todos los turnos repetirían la misma semana.
- **Tabla propia de fallidos (dead-letter):** el conjunto `failed` de BullMQ ya es un registro explícito con razón, intentos y progreso; una tabla sumaría sincronización sin información nueva.
- **Imagen única con `npm ci` completo:** 873 MB con compiladores y Prisma Studio que el runtime no usa.

## Consecuencias

La fase 8 queda operable en local con comandos claros y sin cron en la nube. Queda pendiente, para cuando haya una fuente real y un destino de despliegue elegido: desplegar Redis persistente y el worker, programar importaciones reales y alertar sobre el reporte (hoy se consulta a mano). El reporte agrega `ProductPrice` por fuente con un recorrido completo: con volúmenes grandes conviene un índice o una tabla de resumen.
