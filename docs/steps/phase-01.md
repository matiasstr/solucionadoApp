# Fase 1 — Fundaciones y autenticación

Leer primero `../../CONTINUAR.md`, `../../ROADMAP.md`, `../ARCHITECTURE.md`, `../DOMAIN.md` y `../architecture-decisions/`. `../REQUERIMIENTOS.md` conserva el pedido original. Esta fase tiene cuatro pasos; tener Next y Nest compilando **no** completa autenticación ni la fase.

**Cierre obligatorio de cada paso:** después de validar y actualizar docs/checkpoint, revisar `git status` y diffs, crear un commit que identifique el ID del paso y hacer `git push origin main`, conforme al protocolo de ROADMAP. El usuario autorizó commit/push sin confirmaciones ordinarias. No usar force; si falta remoto, acceso o se rechaza la publicación, conservar el commit y registrar el bloqueo. No agrupar todos los pasos de esta fase en un único commit al final.

## P1-01 — Monorepo y aplicaciones ejecutables

**Dependencia:** P0-01. **Estado inicial:** EN CURSO; consultar ROADMAP para el estado actualizado.

**Alcance y archivos:** raíz `package.json`, lockfile, `.gitignore`, `.env.example`, configuración de Node/TypeScript/lint, `docker-compose.yml` o el nombre de Compose elegido, `apps/web`, `apps/api`, `packages/shared`, `packages/ui`, `packages/config`. Usar Nest 11 según ADR 0001 y conservar la resolución del lockfile.

**Implementación:**

1. Usar npm workspaces y Node 22.18+; en PowerShell invocar `npm.cmd`. Declarar engines y scripts de desarrollo, typecheck, lint, test y build, con versiones compatibles fijadas por el lockfile.
2. Levantar Next.js 16 con App Router, TypeScript strict, Tailwind y el proveedor de TanStack Query. Crear una landing inicial en español rioplatense, mobile-first, sin presentar funcionalidades futuras como operativas.
3. Levantar NestJS modular con configuración validada al inicio, CORS por allowlist, Helmet, DTO validation global, errores centralizados y logging estructurado sin datos sensibles. Crear healthcheck de proceso; separar disponibilidad del proceso y conectividad real a DB/Redis cuando se implementen.
4. Compartir únicamente contratos puros en `packages/shared`; evitar importar Prisma/Nest al navegador. Mantener `packages/ui` y `packages/config` pequeños y útiles.
5. Preparar PostgreSQL 17 + PostGIS 3.5 y Redis 7.4 en Compose con volúmenes y healthchecks. Limitar puertos locales a loopback; documentar que las credenciales de ejemplo son de desarrollo.
6. Conservar el schema Prisma 7 inicial, validar el schema y generar el cliente sin requerir DB. Documentar que migración y acceso operativo a DB se validan en P1-02.

**Validación:** instalar desde lockfile con `npm.cmd ci` si ya existe; ejecutar `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test` y `npm.cmd run build`. Ejecutar Prisma validate/generate usando los scripts declarados. Validar Compose con `docker compose config`. Iniciar web/API y comprobar landing y endpoint health documentado. Si falta Docker o un comando no puede correr, anotarlo literalmente; no declarar servicios verificados. No crear tests que solo repitan archivos de configuración.

**Done:** aplicaciones y scripts ejecutables comprobados; comandos y requisitos locales descritos; estado real de Docker explícito. Guardar resultados y próximo comando en CONTINUAR. **No incluye** auth ni migraciones aplicadas.

## P1-02 — Prisma, migraciones y PostGIS

**Dependencia:** P1-01. **Alcance:** `apps/api/prisma/`, configuración Prisma, módulo de base de datos en API, scripts `db:generate`/`db:migrate` y validación de integración. Usar las ubicaciones existentes si difieren.

**Implementación:**

1. Revisar schema y ADRs antes de migrar. Resolver cómo Prisma 7 recibe la URL y utiliza su adaptador PostgreSQL; generar el cliente sin filtrar secretos al frontend.
2. Generar una migración inicial revisable a partir del schema propuesto, con extensión PostGIS, columnas `geography` e índice espacial GiST. Completar constraints mediante SQL cuando Prisma no los pueda expresar. Usar SQL parametrizado encapsulado para consultas espaciales no soportadas directamente por Prisma.
3. Agregar los constraints de `docs/DOMAIN.md`: cantidades/precios positivos e inventario no negativo, coordenadas completas/válidas, fechas ordenadas, email único sin distinguir mayúsculas, relaciones y unicidad/idempotencia de observaciones. Proteger historial append-only con permisos o trigger y sincronizar `geography` con longitud/latitud. No imponer EAN obligatorio ni unicidad incorrecta sobre valores nulos.
4. Inyectar un servicio DB con cierre limpio. Agregar readiness de DB; su fallo no debe simular una respuesta healthy.
5. Documentar migración dev y deploy, generación del cliente y cómo recrear una base **de prueba** aislada. No borrar volúmenes ni bases existentes sin necesidad/autorización.

**Validación:** `docker compose up -d`, healthchecks, Prisma validate/generate, aplicar migraciones en una base nueva, comprobar extensión e índice espacial, leer/escribir una entidad y volver a aplicar migraciones sin cambios inesperados. Test de integración con PostgreSQL/PostGIS real para constraints y geometría; no sustituirlo por un mock. Ejecutar typecheck y build de API.

**Done:** base inicial reproducible y SQL versionado; cliente funciona y migraciones verificadas. Registrar versiones, nombre de migración y comandos; no guardar URLs con contraseña.

## P1-03 — Auth backend y perfil

**Dependencia:** P1-02. **Archivos/módulos:** `apps/api/src/modules/auth`, `users`, infraestructura de sesiones, DTOs, guards y tests. Crear migración de sesiones si falta en el schema inicial.

**Endpoints:** `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`; `GET /users/me`, `PATCH /users/me`. Preservar el prefijo de API que el proyecto haya definido y documentarlo.

**Implementación:**

1. Normalizar email, validar entradas, imponer política de password razonable y hashear con Argon2id según ADR 0003. Resolver carreras de registro por constraint único. No retornar passwordHash ni sesiones.
2. Emitir access JWT corto validando firma, expiración, issuer/audience definidos; usuario siempre desde el token validado.
3. Refresh aleatorio de alta entropía en cookie HttpOnly, Secure en producción, `SameSite=Lax` y path `/api/auth`, con web/API del mismo sitio según ADR 0003. Persistir solo hash, familia/sesión, expiración, revocación y vínculo de rotación. Un despliegue con requisitos diferentes debe actualizar ese ADR antes de cambiar la política.
4. Rotar refresh de forma atómica. Reutilización de un token rotado revoca la familia. Logout revoca y elimina cookie con los mismos atributos. Documentar tratamiento de refresh concurrentes y evitar que el cliente dispare rotaciones paralelas.
5. Agregar protección CSRF explícita a rutas que usan cookies: validar Origin permitido y estrategia de token/header según ADR. SameSite y CORS por sí solos no sustituyen esa decisión. Configurar credenciales sin wildcard de origen.
6. Rate limit de registro/login/refresh, errores de credenciales uniformes y redacción de Authorization, cookies, passwords y tokens en logs.
7. Perfil permite preferencias válidas: distancia, máximo de tiendas, ciudad y coordenadas opcionales. El usuario no puede modificar identidad, hashes ni campos administrativos por mass assignment.

**Validación:** tests de registro/login, email repetido concurrente, hash seguro, credenciales inválidas, JWT inválido/expirado, acceso sin sesión, rotación, replay, logout, expiración y refresh simultáneo según política. Test de CSRF/Origin y atributos de cookie; comprobar que respuestas/logs no contienen secretos. Integración contra DB real para atomicidad y ownership del perfil. Ejecutar lint, typecheck y tests de API.

**Done:** endpoints documentados, flujos seguros demostrados y configuración de claves validada. Ni tokens ni contraseñas reales en fixtures o documentación.

## P1-04 — Auth frontend

**Dependencia:** P1-03. **Archivos:** rutas `/login`, `/register`, cliente HTTP, proveedor auth, componentes de formularios y límites de navegación privada en `apps/web`.

**Implementación:**

1. Crear formularios accesibles con validación, estados de espera/error y redirecciones internas seguras. Conectar a API real.
2. Mantener access token solo en memoria; recuperar sesión mediante refresh con `credentials: include` al iniciar. Implementar una única promesa de refresh compartida y como máximo un reintento de la petición original.
3. Manejar expiración/logout limpiando estado privado y caché TanStack Query; no compartir datos entre usuarios. Proteger navegación privada y recordar que la autorización real sigue en backend.
4. Tras registro dirigir al onboarding pendiente con una pantalla honesta hasta P4-02. No inventar rutinas ni mostrar dashboard funcional todavía.

**Validación:** flujo integrado registro → sesión → recarga → refresh → logout; sesión expirada y refresh rechazado; comprobar ausencia de tokens en local/sessionStorage y URLs. Verificar formularios con teclado y en móvil. Ejecutar build, lint, typecheck y un E2E auth significativo contra la API.

**Done de fase:** usuario puede registrarse, iniciar/cerrar sesión y recuperar sesión con seguridad; DB y apps tienen arranque reproducible. Actualizar README, ROADMAP y CONTINUAR con P2-01 como siguiente paso.
