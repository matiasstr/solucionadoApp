import type { LoggerService } from '@nestjs/common';

type LogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal';
type LogSink = (entry: string) => void;

const sensitiveKey = /authorization|cookie|password|secret|token|credential/i;

function sanitize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) return { error: 'Error' };
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveKey.test(key) ? '[REDACTED]' : sanitize(entry, seen),
    ]),
  );
}

/** Use operational messages only; never pass requests, headers, or user input. */
export class JsonLogger implements LoggerService {
  constructor(private readonly sink: LogSink = (entry) => process.stdout.write(`${entry}\n`)) {}

  log(message: unknown): void {
    this.write('log', message);
  }

  error(message: unknown): void {
    // Nest may supply an error's message and stack as positional arguments.
    this.write('error', typeof message === 'string' ? 'Application error' : message);
  }

  warn(message: unknown): void {
    this.write('warn', message);
  }

  debug(message: unknown): void {
    this.write('debug', message);
  }

  verbose(message: unknown): void {
    this.write('verbose', message);
  }

  fatal(message: unknown): void {
    this.write('fatal', typeof message === 'string' ? 'Application failure' : message);
  }

  private write(level: LogLevel, message: unknown): void {
    this.sink(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: 'tusofertas-api',
        message: sanitize(message),
      }),
    );
  }
}
