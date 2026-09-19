# Roadmap de Tus Ofertas

El objetivo es ayudar a una persona en Argentina a gastar menos en sus compras habituales. El flujo central es **rutina → necesidad semanal → inventario → precios y promociones → restricciones → plan → ahorro estimado**.

Este documento conserva el alcance y estado de cada paso. Las instrucciones ejecutables están en `docs/steps/`. El punto exacto para retomar, las verificaciones efectivamente ejecutadas y cualquier bloqueo deben quedar en [CONTINUAR.md](CONTINUAR.md). No hace falta conservar el chat para continuar.

## Cómo trabajar y guardar el avance

1. Leer `CONTINUAR.md`, este archivo, la guía de la fase correspondiente y los documentos de arquitectura. Revisar el estado del repositorio y conservar cambios existentes.
2. Elegir el primer paso pendiente cuyas dependencias estén completas. Explicar brevemente qué se implementará y si cambia una decisión previa.
3. Implementar un paso pequeño de extremo a extremo. Si cambia una decisión, registrar un ADR en `docs/architecture-decisions/`.
4. Ejecutar las verificaciones indicadas. Registrar el comando, el resultado y cualquier verificación que no pudo ejecutarse. Una limitación del entorno no equivale a un test aprobado.
5. Actualizar este archivo, README si cambió la operación y `CONTINUAR.md` **después de cada paso y antes de cerrar la sesión o agotar el contexto**.
6. Al completar **cada paso**, revisar el diff, hacer un commit del paso y ejecutar `git push`, siguiendo el protocolo de publicación de abajo. El usuario autorizó esta secuencia; no pedir confirmación ordinaria para cada commit o push.
7. Al interrumpir un paso, guardar archivos, qué funciona, qué falta, errores reproducibles y el próximo comando. No marcarlo terminado. No esperar al último momento para hacer el checkpoint.

Estados: **PENDIENTE**, **EN CURSO**, **BLOQUEADO**, **COMPLETO**. Un paso solo se cierra como COMPLETO cuando sus entregables y verificaciones necesarias están confirmados y su commit fue publicado. Si la implementación terminó pero falta el push, registrar por separado “implementación verificada; publicación pendiente” y el bloqueo. El estado de una fase depende de todos sus pasos.

## Commit y push después de cada paso

El repositorio usa `origin` → `git@github.com:matiasstr/solucionadoApp.git` y rama `main`. Verificar el estado actual antes de asumir que esas referencias siguen iguales. Esta autorización incluye commits y pushes ordinarios de los pasos; no autoriza `--force`, descartar trabajo ajeno ni reescribir historia.

1. Terminar las verificaciones y actualizar la documentación/checkpoint del paso. Revisar `git status --short`, `git branch --show-current`, `git remote -v`, `git diff --check` y `git diff`. Preservar cambios ajenos y excluir `.env`, secretos, logs y artefactos generados.
2. Preparar únicamente los archivos del paso con `git add -- <rutas revisadas>`. Revisar `git diff --cached --check` y `git diff --cached`; incluir código, tests, lockfile y documentación pertinentes. No usar `git add .` sin revisar todo el árbol.
3. Crear un commit identificable, por ejemplo `git commit -m "feat(P1-01): initialize web and API workspaces"`. Mantener un commit por paso completado; un ajuste posterior puede tener su propio commit, sin reescribir los ya publicados.
4. Si la rama verificada es `main`, ejecutar `git push origin main` y comprobar código de salida y mensaje. Verificar después `git status -sb` y `git rev-parse HEAD`; informar hash y resultado de publicación. Si hay otra rama, inspeccionar su seguimiento antes de publicar; no cambiar ni pisar ramas automáticamente.
5. Si falta el remoto, autenticación, conectividad o el push es rechazado, conservar el commit local y registrar en `CONTINUAR.md` el error sanitizado y el siguiente comando de recuperación. No inventar otro remoto ni forzar el push. Un rechazo por cambios remotos exige inspeccionar e integrar esos cambios sin perder trabajo antes de reintentar.

Las restricciones técnicas de permisos del entorno se gestionan por el mecanismo de aprobación correspondiente, sin convertir la secuencia ordinaria autorizada en preguntas repetidas. El checkpoint puede identificar el último commit publicado de pasos anteriores; el hash del commit actual se informa tras crearlo y se incorpora al siguiente checkpoint, evitando commits recursivos solo para registrar su propio hash.

## Alcance de la primera sesión

Crear el diseño persistente y comenzar la fase 1 con el bootstrap del monorepo. Esta sesión abarca **P0-01 y P1-01**. Base de datos operativa, migraciones y autenticación quedan explícitamente para pasos posteriores. El schema inicial documenta el destino y puede existir antes de que sus módulos funcionen.

### P0-01 — Diseño y documentos para continuar

**Dependencia:** ninguna. **Alcance/archivos:** `docs/REQUERIMIENTOS.md`, `docs/ARCHITECTURE.md`, `docs/DOMAIN.md`, `docs/architecture-decisions/`, schema inicial Prisma, `docker-compose.yml`, README, ROADMAP, CONTINUAR y estas guías.

**Instrucciones:** conservar el pedido original; definir monorepo y responsabilidades de módulos, relaciones e invariantes del dominio, estrategia de importadores y límites de implementación; documentar decisiones sobre dinero/unidades/tiempo, sesiones y costo del optimizador. Enumerar riesgos y qué se implementa en cada paso. El diseño debe distinguir modelos previstos de funcionalidades operativas.

**Validación:** revisar cobertura de entidades y diez fases contra REQUERIMIENTOS, consistencia entre schema/ADRs/guías y viabilidad de las dependencias. Validar configuración de Compose con `docker compose config`; Compose ya creado y validado es un entregable inicial, pero la salud real de sus servicios se comprueba en P1-02. En P1-01 validar/generar schema con Prisma, sin afirmar que se aplicó a una base.

**Done:** un modelo que no vio el chat puede identificar qué existe, qué falta, cómo validar y qué paso ejecutar. Revisar estos entregables antes de cambiar el estado a COMPLETO.

| Paso | Entregable | Dependencias | Estado |
| --- | --- | --- | --- |
| P0-01 | Arquitectura, carpetas, dominio, Prisma inicial, Docker Compose, ADRs, riesgos, roadmap y guía de continuidad | — | COMPLETO |
| P1-01 | Bootstrap npm workspaces, Next.js, NestJS, paquetes, Compose y scripts | P0-01 | COMPLETO |
| P1-02 | PostgreSQL/PostGIS, Prisma operativo, migración inicial y comprobación de integridad | P1-01 | COMPLETO |
| P1-03 | Auth backend, sesiones refresh seguras, perfil y tests | P1-02 | COMPLETO |
| P1-04 | Auth frontend y navegación protegida | P1-03 | COMPLETO |
| P2-01 | Catálogo, sucursales, precios históricos, conversión de unidades y seed | P1-02 | PENDIENTE |
| P2-02 | API de productos, canónicos, sucursales y precios actuales | P2-01 | PENDIENTE |
| P2-03 | Motor básico de promociones con tests y datos demo | P2-01 | PENDIENTE |
| P3-01 | Búsqueda y comparación API con filtros y paginación | P2-02, P2-03 | PENDIENTE |
| P3-02 | Landing, buscador y ficha de producto | P3-01, P1-04 | PENDIENTE |
| P4-01 | CRUD de rutinas y despensa con ownership | P1-03, P2-02 | PENDIENTE |
| P4-02 | Onboarding, mis compras, despensa y preferencias | P4-01, P3-02 | PENDIENTE |
| P5-01 | Necesidad semanal y candidatos de compra | P4-02, P2-03 | PENDIENTE |
| P5-02 | Optimizador determinista, límites y pruebas de costo | P5-01 | PENDIENTE |
| P5-03 | Persistencia, cronograma y ahorro estimado del plan | P5-02 | PENDIENTE |
| P6-01 | Historial y análisis de ofertas con calidad de datos | P2-02 | PENDIENTE |
| P6-02 | Gráfico, dashboard y distinción de ahorro estimado/registrado | P6-01, P5-03 | PENDIENTE |
| P7-01 | Puertos de proveedores, normalización e importador mock por lotes | P2-01, P2-03 | PENDIENTE |
| P7-02 | Ejecuciones idempotentes, cuarentena y documentación para proveedores | P7-01 | PENDIENTE |
| P8-01 | Redis, BullMQ, workers y comandos manuales | P7-02, P5-03 | PENDIENTE |
| P8-02 | Programación, recuperación y operación de jobs | P8-01, P6-01 | PENDIENTE |
| P9-01 | Reglas de alertas y notificaciones dentro de la app | P8-02, P6-02 | PENDIENTE |
| P9-02 | UI, preferencias, deduplicación y pruebas de entrega | P9-01 | PENDIENTE |
| P10-01 | Promociones bancarias, medios de pago, topes y elegibilidad | P2-03, P5-03 | PENDIENTE |
| P10-02 | Integración del planificador, UI y validación final del producto | P10-01, P9-02 | PENDIENTE |

## Las diez fases

| Fase | Resultado visible al completarla | Guía |
| --- | --- | --- |
| 1. Fundaciones y autenticación | Desarrollo local reproducible y registro/login funcionales | [phase-01](docs/steps/phase-01.md) |
| 2. Catálogo y datos | Productos, equivalentes, sucursales, precios y promociones básicas demo | [phase-02](docs/steps/phase-02.md) |
| 3. Comparador | Buscar y comparar precios exactos y alternativas en móvil | [phase-03](docs/steps/phase-03.md) |
| 4. Hábitos e inventario | Registrar necesidades, existencias y preferencias | [phase-04](docs/steps/phase-04.md) |
| 5. Planificador | Cronograma semanal determinista con costos explicables | [phase-05](docs/steps/phase-05.md) |
| 6. Historial y oportunidades | Ofertas basadas en historial y dashboard de ahorro | [phase-06](docs/steps/phase-06.md) |
| 7. Importadores | Incorporación de fuentes sin acoplarlas al dominio | [phase-07](docs/steps/phase-07.md) |
| 8. Jobs | Procesamiento asíncrono operable con BullMQ | [phase-08](docs/steps/phase-08.md) |
| 9. Alertas | Notificaciones útiles con preferencias y deduplicación | [phase-09](docs/steps/phase-09.md) |
| 10. Bancos y promociones avanzadas | Recomendaciones según condiciones y medios de pago | [phase-10](docs/steps/phase-10.md) |

Las fases se implementan en este orden para entregar incrementos verificables. Algunas dependencias técnicas permiten trabajo independiente; eso no habilita a declarar completas las fases previas. Las promociones simples se adelantan a P2-03 porque el optimizador de fase 5 las necesita; reglas bancarias y de medios de pago conservan su lugar en fase 10.

## Reglas que ningún paso debe romper

- TypeScript estricto; módulos pequeños; `domain/application/infrastructure/presentation` donde aporten claridad. Las interfaces de proveedores no dependen de SEPA.
- Importes y cantidades persistidos como Decimal según ADR 0002, transportados como strings; conversiones dimensionales explícitas. No usar aritmética binaria de `number` para importes finales. UI `es-AR`/ARS.
- El historial agrega observaciones; no sobrescribe precios anteriores. Cada precio tiene fuente, fecha observada y calidad/frescura. Los datos demo se identifican como ficticios.
- Producto exacto y sustituto tienen etiquetas distintas. Las restricciones de marca y sustitución del usuario se respetan.
- `effectiveCostARS = productsTotalAfterDiscountsARS + storeVisitPenaltyARS × numberOfVisits + distancePenaltyARSPerKm × modeledDistanceKm`. No multiplicar precios por penalizaciones de unidades incompatibles. Documentar cómo se estiman visitas y distancia; no prometer rutas ni gasto real de combustible.
- Un resultado exacto solo es óptimo sobre el conjunto acotado de candidatos evaluados. El recorte y cualquier fallback heurístico deben informarse; nunca afirmar un óptimo global que no se calculó.
- Los ahorros del plan son estimaciones con una base comparable y fija. Ahorro registrado requiere evidencia de compra; no surge automáticamente al crear o completar un plan.
- Access JWT de corta vida en memoria del frontend; refresh en cookie HttpOnly, almacenado hasheado en backend, con rotación, detección de reutilización y protección CSRF. Nunca guardar tokens en localStorage ni logs.
- Toda consulta o mutación de recursos privados filtra por usuario autenticado; IDs enviados por el cliente no determinan ownership.
- Sin ubicación precisa no se inventan distancias. Sin información suficiente no se inventan precios, disponibilidad, elegibilidad o ahorro.

## Checkpoint mínimo obligatorio

Al actualizar `CONTINUAR.md`, dejar: fecha, paso activo, pasos verificados, archivos tocados, comandos ejecutados y resultados, bloqueos, siguiente paso exacto y criterios pendientes. Registrar también rama/remoto, último commit publicado conocido y cualquier commit local cuyo push quede pendiente. Si el árbol de trabajo contiene cambios de otra sesión, describirlos y preservarlos. No incluir credenciales, tokens ni valores privados de `.env`.
