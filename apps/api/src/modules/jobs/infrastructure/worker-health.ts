import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type CheckState = 'up' | 'down';

export interface HealthServerOptions {
  readonly host: string;
  readonly port: number;
  /** `false` mientras el worker se apaga: el orquestador deja de mandarle trabajo. */
  readonly alive: () => boolean;
  /** Redis y la base responden. */
  readonly checks: () => Promise<Readonly<Record<string, CheckState>>>;
}

export interface HealthServer {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Salud del worker (P8-02) para healthchecks de Docker y Cloud Run: `/health` (el proceso
 * vive) y `/ready` (Redis y la base responden). Mismo formato que el API, sin detalles.
 */
export async function startHealthServer(options: HealthServerOptions): Promise<HealthServer> {
  const server = createServer((request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
    };
    if (request.method !== 'GET') return send(405, { status: 'method_not_allowed' });
    if (request.url === '/health') return send(options.alive() ? 200 : 503, { status: options.alive() ? 'ok' : 'stopping', service: 'tusofertas-worker' });
    if (request.url === '/ready') {
      options.checks().then(
        (checks) => {
          const ready = options.alive() && Object.values(checks).every((state) => state === 'up');
          send(ready ? 200 : 503, { status: ready ? 'ok' : 'unavailable', service: 'tusofertas-worker', checks });
        },
        () => send(503, { status: 'unavailable', service: 'tusofertas-worker' }),
      );
      return;
    }
    send(404, { status: 'not_found' });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve());
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
