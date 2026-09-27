# Instrucciones para Claude

Este repositorio ya tiene implementación y un plan de continuidad. Antes de trabajar:

1. Leer `AGENTS.md` y respetar las reglas del proyecto.
2. Leer `CONTINUAR.md`: contiene el último estado verificado, el próximo paso, comandos y pendientes. Es la fuente de continuidad; no depender del historial del chat.
3. Consultar `ROADMAP.md`, la guía correspondiente en `docs/steps/` y los ADRs (0001–0012) antes de implementar.

Estado al 2026-09-27: **fases 1, 2, 3 y 4 completas** (hasta **P4-02**): catálogo, comercios, historia de precios, seed DEMO, API pública, motor de promociones, búsqueda y comparación (`/buscar`, `/producto/[id]`), API privada `/shopping-routines` + `/inventory` con ownership (ADR 0011) y las pantallas privadas `/onboarding`, `/mis-compras`, `/mi-despensa` y `/preferencias` (ADR 0012). Ver **docs/API.md** (formato estable de las respuestas, incluida la sección privada) y las secciones "Pantallas de comparación" y "Pantallas de cuenta" del README. Próximo paso: **P5-01 — necesidades y candidatos del planificador** (`docs/steps/phase-05.md`). Producción: web https://tusofertas.vercel.app + API https://tusofertas-api.vercel.app + Supabase, desplegadas el 2026-09-24 (ADR 0010; comandos en la sección Deploy de CONTINUAR.md) **sin P4-02**. Producción no tiene dataset DEMO.

Comandos clave (PowerShell, usar `npm.cmd`/`npx.cmd`): `docker compose up -d`, `npm.cmd run db:deploy`, `npm.cmd run db:seed` (dataset DEMO repetible; nunca en producción), `npm.cmd run verify` (sin DB), `npm.cmd run test:db` (integración con PostgreSQL/PostGIS real en una base `*_test` aislada), `npm.cmd run test:e2e` (Edge real: auth, búsqueda y cuenta; requiere `npm.cmd run dev` corriendo y el seed; `E2E_BASE_URL` si la web usa otro puerto). Antes de tocar `apps/web`, leer `apps/web/AGENTS.md` (guías de Next 16 en `node_modules/next/dist/docs/`).

No reiniciar el proyecto ni rehacer pasos completos. Implementar y verificar cada paso. Al cerrar cada paso (y antes de agotar contexto) actualizar **CONTINUAR.md, CLAUDE.md y ROADMAP.md** para que otra IA (Claude o Codex) pueda retomar. El usuario autorizó commit y push por paso completado, sin confirmaciones rutinarias. No usar force push, publicar secretos ni dar por ejecutadas pruebas pendientes. Las restricciones del entorno siguen aplicando.
