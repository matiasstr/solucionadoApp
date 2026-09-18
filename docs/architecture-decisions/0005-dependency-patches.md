# ADR 0005 — Parches de dependencias en el bootstrap

Estado: aceptado. Fecha: 2026-09-18.

## Contexto

La primera instalación detectó avisos de npm audit en dependencias transitivas de NestJS, Prisma CLI y concurrently. Actualizar Prisma a otra major o ejecutar `npm audit fix --force` alteraría innecesariamente la arquitectura recién elegida.

## Decisión

Fijar concurrently 9.2.4. Acotar los overrides a las versiones de los paquetes padres: Nest platform-express 11.2.5 usa multer 2.4.0; Prisma config 7.10.0 usa deepmerge-ts 8.0.2; Prisma CLI 7.10.0 usa mysql2 3.24.4.

Multer conserva su major 2. Deepmerge 8 mantiene la función utilizada por Prisma sobre configuración local plana; sus cambios sobre Maps y deepmergeInto no se usan aquí. El schema PostgreSQL no usa mysql2 para conexiones de la aplicación, pero se actualiza la dependencia del CLI igualmente.

## Verificación y mantenimiento

Reejecutar validación/generación Prisma, typecheck, tests y build después de aplicar estos overrides. Guardar el resultado de `npm audit` en CONTINUAR. Retirar cada override cuando el paquete padre incluya la corrección; revisar la compatibilidad al subir Prisma/Nest. Una auditoría sin avisos no sustituye pruebas ni revisión de código.

Referencias: [multer](https://github.com/expressjs/multer/releases), [DeepmergeTS 8](https://github.com/RebeccaStevens/deepmerge-ts/releases), [mysql2](https://github.com/sidorares/node-mysql2/releases), [concurrently](https://github.com/open-cli-tools/concurrently/releases). Las versiones exactas se contrastaron con metadatos del registro npm.
