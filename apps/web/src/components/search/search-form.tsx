'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { EMPTY_FILTERS, MIN_QUERY_LENGTH, toSearchHref } from '../../lib/catalog/filters';

/**
 * Buscador de la portada: no consulta nada, lleva a `/buscar` con el término en
 * la URL. Así el resultado es compartible y el botón "atrás" funciona.
 */
export function SearchForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const inputId = useId();
  const [term, setTerm] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = term.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setError(`Escribí al menos ${MIN_QUERY_LENGTH} letras o un código de barras.`);
      return;
    }
    setError(null);
    router.push(toSearchHref({ ...EMPTY_FILTERS, q }));
  }

  return (
    <form className="search-form" onSubmit={onSubmit} role="search">
      <div className="field">
        <label htmlFor={inputId}>Buscá un producto</label>
        <input
          id={inputId}
          name="q"
          type="search"
          inputMode="search"
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder="Arroz, leche, yerba o un código de barras"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
        />
        {error && (
          <p className="field-error" id={`${inputId}-error`}>
            {error}
          </p>
        )}
      </div>
      <button type="submit" className="primary-button">
        Comparar precios
      </button>
    </form>
  );
}
