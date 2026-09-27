'use client';

import type { CanonicalProductDto } from '@tusofertas/shared';
import { useEffect, useId, useState } from 'react';
import { useCanonicalSearch } from '../../lib/account/queries';

const BASE_UNIT_HINT = { KG: 'se carga en kg o g', L: 'se carga en litros o ml', UNIT: 'se carga en unidades' } as const;

/**
 * Buscador de necesidades ("pollo", "arroz"), no de marcas: lo que se guarda es el
 * canónico y la presentación se elige después, si hace falta. Los resultados son
 * botones comunes para que el teclado y los lectores de pantalla no necesiten un combobox.
 */
export function CanonicalPicker({
  label,
  hint,
  onPick,
  takenIds = [],
  takenLabel,
}: {
  label: string;
  hint?: string;
  onPick(canonical: CanonicalProductDto): void;
  /** Canónicos que ya están cargados: se muestran, pero no se pueden volver a elegir. */
  takenIds?: readonly string[];
  takenLabel: string;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setTerm(text), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const search = useCanonicalSearch(term);
  const tooShort = term.trim().length < 2;
  const results = search.data?.items ?? [];

  return (
    <div className="picker">
      <div className="field">
        <label htmlFor={`${id}-search`}>{label}</label>
        <input
          id={`${id}-search`}
          type="search"
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-describedby={`${id}-status`}
          placeholder="Ej.: pollo, arroz, leche"
        />
        {hint && <p className="field-hint">{hint}</p>}
      </div>
      <p id={`${id}-status`} className="picker-status" role="status">
        {tooShort
          ? ''
          : search.isPending
            ? 'Buscando…'
            : search.isError
              ? 'No pudimos buscar. Probá de nuevo en unos segundos.'
              : results.length === 0
                ? 'No encontramos ese producto. Probá con otra palabra.'
                : `${results.length} ${results.length === 1 ? 'resultado' : 'resultados'}`}
      </p>
      {!tooShort && results.length > 0 && (
        <ul className="picker-results" aria-label="Resultados">
          {results.map((canonical) => {
            const taken = takenIds.includes(canonical.id);
            return (
              <li key={canonical.id}>
                <button
                  type="button"
                  className="picker-option"
                  disabled={taken}
                  onClick={() => {
                    onPick(canonical);
                    setText('');
                    setTerm('');
                  }}
                >
                  <span className="picker-option-name">{canonical.name}</span>
                  <span className="picker-option-hint">{taken ? takenLabel : BASE_UNIT_HINT[canonical.defaultUnit]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
