# Instrucciones para Claude

Este repositorio ya tiene implementación y un plan de continuidad. Antes de trabajar:

1. Leer `AGENTS.md` y respetar las reglas del proyecto.
2. Leer `CONTINUAR.md`: contiene el último estado verificado, el próximo paso, comandos y pendientes. Es la fuente de continuidad; no depender del historial del chat.
3. Consultar `ROADMAP.md`, la guía correspondiente en `docs/steps/` y los ADRs (0001–0008) antes de implementar.

Estado al 2026-09-21: **fase 1 completa (P0-01, P1-01 a P1-04), P2-01 y P2-02** (catálogo, comercios, historia de precios, conversión de unidades y seed DEMO; API pública de productos, canónicos, sucursales y precios actuales. Ver ADR 0008 y la sección "API de catálogo y precios" del README). Próximo paso: **P2-03 — Motor básico de promociones con tests y datos demo**. Web publicada en https://tusofertas.vercel.app (sin API todavía; el despliegue de la API está bloqueado esperando que el usuario acepte los términos del Marketplace de Vercel para Supabase; ver sección Deploy de CONTINUAR.md).

Comandos clave (PowerShell, usar `npm.cmd`/`npx.cmd`): `docker compose up -d`, `npm.cmd run db:deploy`, `npm.cmd run db:seed` (dataset DEMO repetible; nunca en producción), `npm.cmd run verify` (sin DB), `npm.cmd run test:db` (integración con PostgreSQL/PostGIS real en una base `*_test` aislada), `npm.cmd run test:e2e` (Edge real; requiere `npm.cmd run dev` corriendo). Antes de tocar `apps/web`, leer `apps/web/AGENTS.md` (guías de Next 16 en `node_modules/next/dist/docs/`).

No reiniciar el proyecto ni rehacer pasos completos. Implementar y verificar cada paso. Al cerrar cada paso (y antes de agotar contexto) actualizar **CONTINUAR.md, CLAUDE.md y ROADMAP.md** para que otra IA (Claude o Codex) pueda retomar. El usuario autorizó commit y push por paso completado, sin confirmaciones rutinarias. No usar force push, publicar secretos ni dar por ejecutadas pruebas pendientes. Las restricciones del entorno siguen aplicando.
