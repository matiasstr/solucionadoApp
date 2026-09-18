# ADR 0006 — Acceso a base de datos, PostGIS e integridad en SQL

Estado: aceptado. Fecha: 2026-09-18.

## Contexto

Prisma 7 no incluye driver propio: requiere un adaptador y recibe la URL en `prisma.config.ts` (CLI) o en el constructor (runtime). Varias reglas de `docs/DOMAIN.md` no se expresan en el schema Prisma.

## Decisión

- Runtime con `@prisma/adapter-pg` (pool `pg`, máximo 10 conexiones, timeout de conexión 3 s). `PrismaService` es global, conecta de forma diferida y se desconecta en `onModuleDestroy`. `DATABASE_URL` es obligatoria y se valida como URL `postgres(ql)://`; los errores solo nombran la variable.
- `GET /api/health` es liveness y no toca la DB. `GET /api/health/ready` ejecuta `SELECT 1` con tope de 2 s y responde 503 sin detalles de conexión si falla.
- La migración inicial instala PostGIS con `CREATE EXTENSION IF NOT EXISTS` antes de crear `geography`. `Store.location` se deriva siempre por trigger `BEFORE INSERT OR UPDATE` desde longitud/latitud (escrituras directas se sobrescriben). El índice GiST se declara también en el schema (`type: Gist`) para evitar drift.
- CHECKs, índice único `lower(email)` y el trigger append-only de `ProductPrice` (rechaza UPDATE/DELETE con SQLSTATE 23001) viven solo en SQL de migraciones. Cambiarlos exige una migración nueva.
- Reglas que requieren consultar otras filas (preferido del mismo canónico, ciclos de categorías, dimensiones compatibles, coherencia precio/producto/sucursal en líneas del plan) quedan en dominio/servicios.
- Las pruebas de integración usan una base `*_test` recreada por `npm run test:db`; nunca la de desarrollo ni mocks.

## Consecuencias

`prisma migrate diff --from-config-datasource --to-schema` debe dar vacío después de aplicar migraciones (se verifica en `test:db`); Prisma ignora `spatial_ref_sys`, los CHECKs, triggers e índices por expresión. Corregir un precio histórico requerirá un mecanismo explícito (nueva observación o función administrativa) diseñado antes de importar fuentes reales.
