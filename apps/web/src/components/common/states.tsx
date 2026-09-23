import type { ReactNode } from 'react';

/**
 * Estados compartidos de las pantallas de datos. Un error nunca deja a la persona
 * sin salida: siempre hay un botón para reintentar sin perder los filtros.
 */

export function LoadingState({ label = 'Buscando precios…' }: { label?: string }) {
  return (
    <p className="data-state" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="data-state data-state-block">
      <p className="data-state-title">{title}</p>
      {children}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="data-state data-state-block" role="alert">
      <p className="data-state-title">No pudimos traer los datos</p>
      <p>{message}</p>
      <button type="button" className="secondary-button" onClick={onRetry}>
        Reintentar
      </button>
    </div>
  );
}

/** El dataset es ficticio y eso se dice en pantalla, no solo en la documentación. */
export function DemoNotice() {
  return (
    <p className="demo-notice">
      <span className="demo-badge">DEMO</span>
      Precios de demostración: son ficticios y no representan ofertas reales de esas cadenas.
    </p>
  );
}

export function StaleBadge({ ageDays }: { ageDays: number }) {
  return (
    <span className="stale-badge" title={`Última observación hace ${ageDays} días`}>
      Desactualizado
    </span>
  );
}
