# Fase 8 — Redis, BullMQ y jobs

Leer arquitectura de ejecución y contratos de importadores/planificador. Estado inicial: PENDIENTE. Cloud Run y Cloud Run Jobs son destino futuro: preparar artefactos e instrucciones no equivale a desplegar servicios ni generar costos externos.

## P8-01 — Workers y ejecución manual

**Dependencias:** P7-02 y P5-03. **Módulos:** JobsModule, productor/consumidor, entrypoint de worker separado y scripts locales.

**Implementación:**

1. Conectar Redis de Compose y BullMQ con configuración validada. Separar el worker del proceso HTTP para controlar escalado y shutdown.
2. Registrar IMPORT_PRICES, IMPORT_PROMOTIONS y GENERATE_WEEKLY_PLANS. Preparar CHECK_PRICE_ALERTS como contrato sin simular alertas implementadas; se completa en fase 9.
3. Jobs invocan los mismos casos de uso ya testeados, no duplican lógica. Payloads pequeños con IDs/cursores; no guardar archivos enteros, contraseñas ni tokens en Redis.
4. CLI manual para encolar/consultar estado; si existe endpoint administrativo, autorización explícita y límites. No exponer importaciones al usuario común.
5. Job IDs idempotentes por ejecución lógica, reintentos/backoff y concurrencia limitada. Asumir entrega al menos una vez: el consumidor debe tolerar ejecución duplicada.

**Validación:** Redis real, ejecutar un job de cada tipo implementado, comprobar estado y datos; caída/reinicio de worker, retry sin duplicación y shutdown que libere conexiones. Errores de Redis no deben producir respuestas de éxito falsas.

**Done:** jobs operativos en local con comandos claros y sin requerir cron cloud. Guardar checkpoint.

## P8-02 — Programación y operación

**Dependencias:** P8-01 y P6-01. **Archivos:** scheduler, métricas/logs, scripts/Compose del worker, runbook y Dockerfiles si todavía no existen.

**Implementación:**

1. Programar importaciones y planes semanales según zona argentina; evitar doble programación al iniciar múltiples réplicas. Explicar límites y qué tareas siguen manuales.
2. Estado observable: último éxito por proveedor, retraso de cola, errores y frescura de precios. Correlación por job/importRun, sin datos personales en logs.
3. Dead-letter o registro explícito de fallo agotado y mecanismo manual de reintento seguro. La generación de planes no debe activar o reemplazar decisiones del usuario sin regla documentada.
4. Preparar imágenes reproducibles con usuario sin privilegios, health/readiness apropiados y secretos externos. Documentar diferencias entre API HTTP, worker persistente y job de duración finita en Cloud Run; no asumir que un worker corre indefinidamente dentro de un servicio HTTP con CPU suspendida.

**Validación:** programación con reloj controlado, múltiples productores, job duplicado, fallo agotado y recuperación; construir contenedores y probar healthchecks si Docker está disponible. Registrar cualquier validación pendiente del entorno.

**Done de fase:** runbook explica arranque, parada, observabilidad y recuperación; ejecución local demostrada. Actualizar README/ROADMAP/CONTINUAR; siguiente P9-01.
