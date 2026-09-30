import type { RedisOptions } from 'bullmq';

/**
 * Worker: reconecta sin límite, porque Redis puede reiniciarse y el job sigue en la cola
 * (BullMQ exige `maxRetriesPerRequest: null` en la conexión bloqueante).
 */
export function workerConnection(redisUrl: string, name: string): RedisOptions {
  return { url: redisUrl, connectionName: name, maxRetriesPerRequest: null };
}

/**
 * Comando para encolar o consultar: si Redis no responde falla en segundos, en vez de
 * quedar esperando o informar algo que no pasó.
 */
export function producerConnection(redisUrl: string, name: string): RedisOptions {
  return {
    url: redisUrl,
    connectionName: name,
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (times: number) => (times > 2 ? null : times * 200),
  };
}
