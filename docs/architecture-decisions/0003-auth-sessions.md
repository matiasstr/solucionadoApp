# ADR 0003 — Autenticación y sesiones

Estado: aceptado. Backend implementado en P1-03 (2026-09-18); frontend pendiente (P1-04).

## Decisión

Email normalizado y password hasheada con Argon2id. Access JWT corto en memoria del cliente, nunca en localStorage. Refresh aleatorio de alta entropía en cookie HttpOnly, Secure en producción y SameSite=Lax con path acotado a `/api/auth`. Guardar solamente hash del refresh y metadatos de sesión en DB.

Rotar refresh de forma transaccional; detectar reutilización y revocar familia. El cliente serializa refresh concurrentes. Agregar logout y vencimiento, limpiar sesión y caché del cliente al salir. Validar Origin en operaciones que usan cookies, política CSRF y allowlist CORS explícita; SameSite por sí solo no sustituye esa validación. Despliegue con web/API del mismo sitio.

Rate limit para login/register/refresh, Helmet y DTO validation. No registrar passwords, tokens, cookies ni ubicación precisa. Consultas de recursos privados se filtran siempre por userId autenticado. Respuestas de perfil excluyen passwordHash y sesiones.

## Verificación necesaria

Registro/login, vencimiento, rotación, replay, carreras, logout, CSRF/CORS, rechazo de usuario ajeno y ausencia de datos sensibles. La existencia del modelo RefreshSession no acredita autenticación implementada.

## Implementación P1-03 (2026-09-18)

- Endpoints bajo `/api`: `POST /auth/register` (201), `POST /auth/login` (200), `POST /auth/refresh` (200), `POST /auth/logout` (204), `GET /users/me`, `PATCH /users/me`. Respuesta de sesión: `{ accessToken, tokenType: "Bearer", expiresIn, user }`; el refresh viaja solo en la cookie.
- Argon2id con m=19456 KiB, t=2, p=1. Política de contraseña por longitud: 10 a 128 caracteres. Login con email inexistente verifica contra un hash descartable para no revelar existencia por tiempo; el error es idéntico.
- Access JWT HS256 (`JWT_ACCESS_SECRET` ≥ 32 caracteres; producción rechaza el valor de ejemplo), `typ=access`, `sub`=UUID, issuer/audience configurables, 900 s por defecto. Se verifica solo HS256.
- Refresh: 32 bytes aleatorios (base64url), guardado como SHA-256. Cookie `tusofertas_refresh`: HttpOnly, SameSite=Lax, Path=/api/auth, Secure en producción, expiración de 30 días renovada en cada rotación.
- Rotación: `UPDATE` condicional (rotatedAt/revokedAt nulos y vigente) dentro de una transacción; solo un pedido puede consumir un token. **Política de concurrencia estricta**: presentar un token ya rotado —incluido un segundo refresh simultáneo— revoca toda la familia. El cliente (P1-04) debe serializar los refresh (una sola promesa en vuelo).
- CSRF en todas las rutas `/auth`: Origin (o Referer) exacto de `CORS_ORIGINS` **y** header `X-Requested-With: tusofertas-web`; si falta, 403 `CSRF_REJECTED`. El header obliga a un preflight CORS cross-origin; SameSite=Lax es defensa adicional.
- Rate limit por IP (`@nestjs/throttler`, `AUTH_RATE_LIMIT_PER_MINUTE`, 10 por ruta y minuto). Almacenamiento en memoria: válido para una instancia; con varias réplicas, pasar a Redis. Detrás de un proxy habrá que configurar `trust proxy` para que la IP sea la del cliente.
- Perfil: DTO con whitelist; email, passwordHash, id y campos desconocidos devuelven 400 con `fields`. Latitud y longitud se envían juntas (o ambas null). Decimales como string.
