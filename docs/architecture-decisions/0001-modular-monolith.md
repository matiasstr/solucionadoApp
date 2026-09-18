# ADR 0001 — Monorepo y monolito modular

Estado: aceptado. Fecha: 2026-09-17.

## Contexto

Aplicación nueva, un equipo pequeño y dominio centrado en compras. El entorno tiene Node 22.18 y npm; no existe código previo.

## Decisión

Usar npm workspaces, Next App Router, NestJS y PostgreSQL/PostGIS. Separar dominio/aplicación/adaptadores donde existan reglas; CRUD sencillo conserva estructura compacta. `packages/shared` contiene contratos seguros de transporte, no entidades Prisma. Usar Node 22.18 o compatible posterior, Next 16, Nest 11 y Prisma 7 estables y fijar resolución en lockfile; evitar prereleases aunque aparezcan bajo `latest`.

## Consecuencias

Un despliegue de API y una DB simplifican transacciones. Jobs pueden ejecutarse separados posteriormente sin dividir el dominio en microservicios. No incorporar Nx/Turborepo hasta necesitar su costo operativo. Revisar Node y parches de seguridad antes del despliegue.
