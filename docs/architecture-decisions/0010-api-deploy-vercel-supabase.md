# ADR 0010 — Despliegue de la API en Vercel con Supabase

Estado: aceptado. Fecha: 2026-09-24. Contexto: publicar la API Nest y la base para que la web en producción tenga auth y rutas privadas, en plan gratuito.

## Decisión

**Vercel + Supabase por la integración del Marketplace.** Proyecto `tusofertas-api` (root `apps/api`, región `gru1`) con la base `tusofertas-db` (Supabase, PostgreSQL con PostGIS) conectada por `vercel integration add supabase`. La integración inyecta `POSTGRES_URL` (pooler en modo transacción), `POSTGRES_URL_NON_POOLING` (sesión) y otras variables; las credenciales nunca se copian a la máquina ni al repositorio.

**Migraciones en el build, solo en producción.** `apps/api/vercel.json` usa `node scripts/vercel-build.cjs`: `prisma generate`, `prisma migrate deploy` con `POSTGRES_URL_NON_POOLING` cuando `VERCEL_ENV=production` y compilación. Aplicar dos veces es un no-op. El dataset DEMO **nunca** se carga en producción: el catálogo arranca vacío hasta tener importadores (fase 7).

**URL en runtime.** El adaptador `api/index.js` usa `DATABASE_URL` si existe y, si no, `POSTGRES_URL` (`api/_database-url.js`; el `_` evita que Vercel lo publique como función). El pooler en modo transacción sirve para funciones efímeras; las transacciones interactivas (`SELECT … FOR UPDATE`) usan una sola conexión y siguen funcionando.

**TLS verificado.** `pg` 8 interpreta `sslmode=require` como `verify-full`, y la CA de Supabase no está en el almacén de Node. En lugar de desactivar la verificación, se incluye la CA pública del proyecto (`apps/api/certs/supabase-ca.crt`, "Supabase Root 2021 CA", vence en 2031) y la URL pasa a `sslmode=verify-full&sslrootcert=…`. Sin el archivo, el arranque falla: no hay degradación silenciosa. Las migraciones usan la URL de la integración sin cambios (el motor de Prisma maneja TLS por su cuenta).

**`jsonwebtoken` en vez de `@nestjs/jwt`.** `@nestjs/jwt` 12 se publica solo como ES Module; Node 22.18 local permite `require()` de ESM, pero el cargador de funciones de Vercel no (`ERR_REQUIRE_ESM`). `AccessTokenService` usa directamente `jsonwebtoken` 9.0.3, la misma biblioteca que envolvía: tokens, algoritmo HS256, issuer, audience y expiración idénticos. El resto de dependencias de runtime son CommonJS (revisado al desplegar). Antes de sumar una dependencia de runtime, confirmar que no sea solo ESM.

## Consecuencias

- La web usa `API_ORIGIN=https://tusofertas-api.vercel.app` (rewrite same-origin, ADR 0007): el navegador solo habla con `tusofertas.vercel.app`.
- Si la CA de Supabase se rota, hay que reemplazar `certs/supabase-ca.crt` (panel → Project Settings → Database → SSL Configuration).
- **Pendiente:** `TRUST_PROXY` no admite el proxy de Vercel, así que el rate limit de auth ve la IP del proxy y cuenta a todos los usuarios de una instancia juntos. Además es memoria por instancia (ADR 0003). Se resuelve con una opción explícita para Vercel o con Redis (P8).
