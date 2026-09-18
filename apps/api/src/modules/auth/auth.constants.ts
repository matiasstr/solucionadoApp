/** Cookie HttpOnly del refresh token; su path la limita a las rutas de auth. */
export const REFRESH_COOKIE = 'tusofertas_refresh';
export const REFRESH_COOKIE_PATH = '/api/auth';
/** Header anti-CSRF: obliga a un preflight CORS en pedidos cross-origin (ver ADR 0003). */
export const CSRF_HEADER = 'X-Requested-With';
export const CSRF_HEADER_VALUE = 'tusofertas-web';
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
