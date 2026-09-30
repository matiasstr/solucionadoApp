# ADR 0020 — Jobs con BullMQ y worker separado

Estado: aceptado. Fecha: 2026-09-29. Contexto: P8-01 (abre la fase 8). Usa ADR 0015 (planes) y ADR 0018/0019 (importación).

## Decisión

**Dependencias.** `bullmq` 6.3.9 e `ioredis` 6.0.0, versiones exactas y CommonJS. BullMQ 6 ya no trae `ioredis`: lo carga solo si está instalado, así que se declara explícito. Solo lo cargan el worker y el comando de jobs: el API HTTP (y su función de Vercel) **no importa BullMQ ni necesita Redis** para arrancar (verificado con `require.cache`). El lockfile incluye los binarios opcionales de `msgpackr-extract` para todas las plataformas.

**Proceso aparte.** `npm.cmd run worker` (`src/worker.ts`) arma un contexto Nest sin HTTP (`WorkerModule`: configuración, base y `ShoppingPlansModule`) y un worker de BullMQ por cola: `imports` (concurrencia 1) y `plans` (2). Con SIGINT o SIGTERM deja de tomar jobs, **espera los que están en curso**, cierra Redis y Prisma y termina; una segunda señal corta en el acto. Si Redis no responde al arrancar en 10 s, termina con código 1 y un mensaje sin la URL.

**Configuración aparte.** `validateJobsEnvironment` (`jobs.config.ts`) valida `REDIS_URL` (`redis:`/`rediss:`), `JOBS_PREFIX`, intentos, espera, concurrencias, bloqueo, `IMPORT_FILES_DIR` (absoluta) e `IMPORT_ALLOWED_HOSTS`; los errores nombran variables, nunca valores. El worker además valida la configuración del API (usa los mismos servicios); separar sus secretos queda para el despliegue (P8-02).

**Jobs.** Los handlers no dependen de BullMQ (reciben un `JobContext`) y llaman a los casos de uso ya probados:

| Job | Cola | Qué hace | Id (una ejecución lógica) |
| --- | --- | --- | --- |
| `IMPORT_PRICES` | `imports` | `PriceImporter` con `PrismaImportRunRecorder` (proveedor simulado o JSON Lines) | `prices-<día>-<resumen de los datos>` o `prices-<clave>` |
| `IMPORT_PROMOTIONS` | `imports` | `PromotionImporter` (por ahora solo el simulado) | `promotions-<día>-<resumen>` o `promotions-<clave>` |
| `GENERATE_WEEKLY_PLANS` | `plans` | Un borrador por usuario con rutinas con productos, con `ShoppingPlansService.generateScheduled` y la clave `job-weekly-<lunes>` | `weekly-plans-<lunes>[-<usuario>]` |
| `CHECK_PRICE_ALERTS` | `alerts` | **Solo contrato** (datos `{ v, asOf }`): no se encola ni se procesa hasta la fase 9 | `price-alerts-<día>` |

**Datos chicos y validados dos veces.** Parámetros e ids, nunca archivos, contraseñas ni tokens: un archivo es una ruta **relativa** a `IMPORT_FILES_DIR` (sin `..`, y el worker comprueba que la ruta resuelta quede adentro); una URL no puede llevar credenciales, parámetros ni fragmento (una URL firmada pondría un secreto en Redis) y el host se valida contra la lista al procesar. `parseJobPayload` es estricto (todos los campos, sin extras, versión `v: 1`) y se usa al encolar **y** al procesar: lo que llega de Redis no se da por bueno. Los valores por defecto que dependen de la fecha (el ancla del simulado, la semana) se fijan al encolar, así un reintento al día siguiente hace lo mismo.

**Idempotencia y entrega al menos una vez.** Encolar el mismo id devuelve el job existente; el mismo id con otros datos es un error (`JobConflictError`), no se ignora. Los terminados quedan 7 días (fallidos, 30) para consultarlos. Un job puede ejecutarse más de una vez (reintento, worker caído cuyo bloqueo vence y otro lo retoma): las importaciones son idempotentes (lo ya escrito cuenta como repetido) y los planes usan la clave por usuario y semana.

**Reintentos.** `JOBS_ATTEMPTS` (3) con espera exponencial desde `JOBS_BACKOFF_MS`. Una importación que termina `FAILED` hace fallar el intento y anota su ejecución en el progreso del job; el reintento **la reanuda** desde su posición confirmada si la fuente se puede repetir (ADR 0019) y, si no, importa todo de nuevo. Datos inválidos, destino no permitido (producción, base remota sin `IMPORT_ALLOW_REMOTE`), host no permitido o archivo inexistente fallan **sin reintentar** (`UnrecoverableError`). Lo que queda en Redis y en los logs es siempre un mensaje saneado.

**Planes programados.** `generateScheduled` crea un **borrador**: no activa ni reemplaza planes del usuario. Si la semana no tiene necesidades no guarda un plan vacío. Un rechazo esperable del planificador (4xx) se cuenta por código; un error inesperado de un usuario no frena a los demás pero hace fallar el intento para reintentarlo (los ya generados se repiten, no se duplican).

**Operación manual.** `npm.cmd run jobs -- enqueue|status|counts`. Ningún endpoint HTTP encola ni consulta jobs. Si Redis no responde, el comando falla en segundos con código 1 y no imprime un resultado: nunca informa un encolado que no ocurrió.

## Alternativas consideradas

- **Worker dentro del proceso HTTP:** mezcla escalado y apagado, y en Vercel la función se congela entre pedidos.
- **Una sola cola:** una importación larga retrasaría los planes; con dos colas cada una tiene su concurrencia.
- **Ids aleatorios:** encolar dos veces por error duplicaría el trabajo; el id por ejecución lógica lo evita desde la cola.
- **Encolar el archivo o la URL firmada:** Redis guardaría contenido de terceros o un secreto.
- **Un job hijo por usuario para los planes:** más paralelismo, pero más piezas; con un job por semana alcanza para el volumen actual y el fan-out queda como mejora.

## Consecuencias

Los jobs corren en local con Compose y dos comandos, sin cron ni servicios pagos. P8-02 agrega la programación (zona argentina, sin doble programación), la observabilidad, el reintento manual de fallidos agotados, las imágenes y la diferencia entre worker persistente y job finito en Cloud Run. Una ejecución de importación cuyo worker muere queda `RUNNING` en `ImportRun`; el job se retoma, pero marcar esas ejecuciones colgadas queda para P8-02.
