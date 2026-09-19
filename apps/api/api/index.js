// Adaptador serverless para Vercel (proyecto tusofertas-api, ADR 0008). Reutiliza la misma
// app Nest que `npm start`: se construye una vez por instancia y atiende con su Express.
// Requiere `npm run db:generate && npm run build` antes (dist/). Localmente usar `npm run dev`.
const { createApp } = require('../dist/bootstrap');
const { JsonLogger } = require('../dist/common/json-logger');
const { validateEnvironment } = require('../dist/config/environment');

const logger = new JsonLogger();
let server;

function getServer() {
  server ??= (async () => {
    const app = await createApp(validateEnvironment(process.env), logger);
    await app.init();
    return app.getHttpAdapter().getInstance();
  })().catch((error) => {
    server = undefined;
    throw error;
  });
  return server;
}

module.exports = async function handler(request, response) {
  try {
    const express = await getServer();
    express(request, response);
  } catch {
    // Sin detalles: la configuración puede contener secretos.
    logger.error({ event: 'startup_failed', message: 'Revisá las variables de entorno del proyecto.' });
    response.statusCode = 503;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ statusCode: 503, error: 'SERVICE_UNAVAILABLE', message: 'Servicio no disponible.' }));
  }
};
