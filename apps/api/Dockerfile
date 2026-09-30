# syntax=docker/dockerfile:1
# Imágenes del API HTTP, del worker de jobs y de la migración (P8-02, ADR 0021).
# Contexto: la raíz del repo (npm workspaces con un solo lockfile).
#
#   docker build -f apps/api/Dockerfile --target api -t tusofertas-api .
#   docker build -f apps/api/Dockerfile --target worker -t tusofertas-worker .
#   docker build -f apps/api/Dockerfile --target migrate -t tusofertas-migrate .
#
# Los secretos (DATABASE_URL, JWT_ACCESS_SECRET, REDIS_URL) llegan como variables al correr el
# contenedor, nunca en la imagen. Las migraciones se aplican una vez, con la imagen `migrate`,
# antes de actualizar API y worker: ninguna réplica migra al arrancar.
ARG NODE_VERSION=22.18.0

FROM node:${NODE_VERSION}-bookworm-slim AS manifests
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/

FROM manifests AS build
RUN npm ci --workspace=@tusofertas/api --include=dev
COPY packages/config/tsconfig.base.json packages/config/
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/api/src apps/api/src
RUN npm run db:generate --workspace=@tusofertas/api && npm run build --workspace=@tusofertas/api

FROM manifests AS production-deps
# Sin dev ni opcionales: el CLI de Prisma, TypeScript y Prisma Studio entran como peers opcionales
# de @prisma/client (`devOptional` en el lockfile) y en runtime no hacen falta: el cliente ya está
# generado dentro de dist. También se omite msgpackr-extract (acelerador nativo de BullMQ; sin él
# usa la versión en JavaScript).
RUN npm ci --workspace=@tusofertas/api --omit=dev --omit=optional && npm cache clean --force && mkdir -p apps/api/node_modules

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-deps /app/node_modules node_modules
COPY --from=production-deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/package.json apps/api/
WORKDIR /app/apps/api
# Usuario sin privilegios de la imagen oficial; el código es de root y solo lectura para él.
USER node

FROM runtime AS api
ENV HOST=0.0.0.0 PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]

FROM runtime AS worker
ENV WORKER_HEALTH_PORT=3002 WORKER_HEALTH_HOST=0.0.0.0
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.WORKER_HEALTH_PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Persistente; para una tarea finita (Cloud Run Job): `node dist/worker.js --until-idle`.
CMD ["node", "dist/worker.js"]

FROM build AS migrate
WORKDIR /app/apps/api
USER node
CMD ["npx", "prisma", "migrate", "deploy"]
