import { createApp } from './bootstrap';
import { JsonLogger } from './common/json-logger';
import { validateEnvironment } from './config/environment';

const logger = new JsonLogger();

async function bootstrap(): Promise<void> {
  const config = validateEnvironment(process.env);
  const app = await createApp(config, logger);
  await app.listen(config.port, config.host);
  logger.log({ event: 'listening', host: config.host, port: config.port });
}

void bootstrap().catch(() => {
  logger.error({ event: 'startup_failed', message: 'Revisá la configuración y la disponibilidad del puerto.' });
  process.exitCode = 1;
});
