/** Lo que un handler necesita de su job, sin depender de BullMQ (los tests lo simulan). */
export interface JobContext {
  readonly jobId: string;
  /** 1 en el primer intento. */
  readonly attempt: number;
  /** Lo que dejó anotado un intento anterior del mismo job. */
  readonly checkpoint: JobCheckpoint | null;
  saveCheckpoint(checkpoint: JobCheckpoint): Promise<void>;
}

export interface JobCheckpoint {
  /** Ejecución de importación que falló: el reintento la reanuda si la fuente se puede repetir. */
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
