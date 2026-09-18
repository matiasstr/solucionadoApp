import type { PropsWithChildren } from 'react';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand" aria-label="Tus Ofertas">
      <span className="brand-icon" aria-hidden="true">↓</span>
      {!compact && <span>tus<span className="brand-accent">ofertas</span></span>}
    </span>
  );
}

export function Surface({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return <div className={`surface ${className}`}>{children}</div>;
}
