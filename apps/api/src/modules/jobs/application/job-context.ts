/** Lo que un handler necesita de su job, sin depender de BullMQ (los tests lo simulan). */
export interface JobContext {
  readonly jobId: string;
  /** 1 en el primer intento. */
  readonly attempt: number;
  /**
   * Instante al que corresponde el job: el programado (si viene de una programación) o el de
   * encolado. Es el mismo en cada reintento, así las fechas relativas no se corren.
   */
  readonly scheduledFor: Date;
  /** Lo que dejó anotado un intento anterior del mismo job. */
  readonly checkpoint: JobCheckpoint | null;
  saveCheckpoint(checkpoint: JobCheckpoint): Promise<void>;
}

export interface JobCheckpoint {
  /**
   * Ejecución de importación del último intento (se anota al empezar): si falló o quedó abierta
   * porque el proceso cayó, el reintento la cierra y la reanuda si la fuente se puede repetir.
   */
  readonly importRunId?: string;
}

/** Falla con mensaje apto para mostrar (sin credenciales ni contenido); se reintenta. */
export class JobFailedError extends Error {
  constructor(message: string) {
    super(message.slice(0, 300));
    this.name = 'JobFailedError';
  }
}

/** Falla que no mejora reintentando: datos inválidos, configuración o destino no permitido. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message.slice(0, 300));
    this.name = 'PermanentJobError';
  }
}
