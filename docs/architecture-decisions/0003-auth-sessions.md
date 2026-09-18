# ADR 0003 — Autenticación y sesiones

Estado: aceptado para P1-03/P1-04; todavía no implementado.

## Decisión

Email normalizado y password hasheada con Argon2id. Access JWT corto en memoria del cliente, nunca en localStorage. Refresh aleatorio de alta entropía en cookie HttpOnly, Secure en producción y SameSite=Lax con path acotado a `/api/auth`. Guardar solamente hash del refresh y metadatos de sesión en DB.

Rotar refresh de forma transaccional; detectar reutilización y revocar familia. El cliente serializa refresh concurrentes. Agregar logout y vencimiento, limpiar sesión y caché del cliente al salir. Validar Origin en operaciones que usan cookies, política CSRF y allowlist CORS explícita; SameSite por sí solo no sustituye esa validación. Despliegue con web/API del mismo sitio.

Rate limit para login/register/refresh, Helmet y DTO validation. No registrar passwords, tokens, cookies ni ubicación precisa. Consultas de recursos privados se filtran siempre por userId autenticado. Respuestas de perfil excluyen passwordHash y sesiones.

## Verificación necesaria

Registro/login, vencimiento, rotación, replay, carreras, logout, CSRF/CORS, rechazo de usuario ajeno y ausencia de datos sensibles. La existencia del modelo RefreshSession no acredita autenticación implementada.
