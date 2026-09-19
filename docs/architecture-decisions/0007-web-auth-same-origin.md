# ADR 0007 — Web y API en el mismo origen; sesión en el frontend

Estado: aceptado. Fecha: 2026-09-18.

## Contexto

La cookie de refresh es `SameSite=Lax` (ADR 0003). En desarrollo la web corre en `127.0.0.1:3000` y la API en `:3001`; `localhost` y `127.0.0.1` son *sites* distintos, y en producción web y API pueden estar en dominios diferentes. Una cookie Lax no viaja en `fetch` cross-site.

## Decisión

- Next reescribe `/api/:path*` hacia `API_ORIGIN` (variable solo de servidor; en desarrollo `http://127.0.0.1:3001`). El navegador solo habla con su propio origen: la cookie es first-party y `Origin` coincide con la allowlist. Sin `API_ORIGIN` en producción no hay rewrite y la web informa que el servicio no está disponible, sin inventar datos.
- La API acepta `TRUST_PROXY` (`loopback`, `uniquelocal` o ambos) para tomar la IP del cliente de `X-Forwarded-For` en el rate limit. Next conserva un `X-Forwarded-For` enviado por el cliente: detrás de un edge que lo reescribe (Vercel, Cloud Run) es confiable; en un proxy propio hay que sobrescribirlo antes de Next.
- `AuthProvider` guarda el access token solo en un `ref` de memoria. Todas las renovaciones pasan por una única promesa compartida (`refreshSession`), lo que evita que StrictMode, varios componentes o varios 401 disparen refresh paralelos, que la API trataría como reutilización. Cada petición autenticada reintenta como máximo una vez tras un 401.
- Un indicador sin secretos en `localStorage` (`tusofertas:had-session`) evita pedir refresh a visitantes que nunca iniciaron sesión. No es un token ni autoriza nada; la cookie HttpOnly sigue siendo la fuente.
- Logout, cambio de usuario o refresh rechazado vacían la caché de TanStack Query; las claves privadas incluyen el id de usuario.
- `PrivateShell` solo evita mostrar pantallas sin sesión y redirige a `/login?next=`. La autorización real está en la API. `safeRedirectPath` acepta únicamente rutas internas.
- `/auth/refresh` tiene 6× el límite de login/registro porque corre en cada carga con sesión.

## Consecuencias

El despliegue necesita que la web alcance a la API por servidor (`API_ORIGIN`). El E2E (`npm run test:e2e`, Edge real vía `playwright-core`) verifica registro, recarga con un único refresh, reintento tras 401, logout, refresh rechazado, redirección segura, teclado y móvil.
