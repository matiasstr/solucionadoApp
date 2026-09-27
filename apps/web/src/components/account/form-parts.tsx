'use client';

import type { BaseUnit, MeasurementUnit } from '@tusofertas/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { UNIT_OPTION_LABEL, unitsFor } from '../../lib/account/quantities';

/** Mensaje de error de un campo, enlazado con `aria-describedby`. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} className="field-error">{message}</p>;
}

export const describedBy = (...ids: (string | false | null | undefined)[]): string | undefined =>
  ids.filter(Boolean).join(' ') || undefined;

/** Error general de un formulario: recibe el foco para que se anuncie. */
export function FormAlert({ message }: { message: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);
  if (!message) return null;
  return <div ref={ref} tabIndex={-1} role="alert" className="form-alert">{message}</div>;
}

/** Cantidad + unidad de la dimensión del canónico. Siempre viajan juntas a la API. */
export function QuantityFields({
  idPrefix,
  label,
  baseUnit,
  quantity,
  unit,
  onQuantityChange,
  onUnitChange,
  error,
  hint,
  autoFocus = false,
}: {
  idPrefix: string;
  label: string;
  baseUnit: BaseUnit;
  quantity: string;
  unit: MeasurementUnit;
  onQuantityChange(value: string): void;
  onUnitChange(value: MeasurementUnit): void;
  error?: string;
  hint?: string;
  /** Al elegir un producto el botón que tenía el foco desaparece: el foco pasa a la cantidad. */
  autoFocus?: boolean;
}) {
  const units = unitsFor(baseUnit);
  const errorId = `${idPrefix}-quantity-error`;
  const hintId = `${idPrefix}-quantity-hint`;
  return (
    <div className="quantity-fields">
      <div className="field">
        <label htmlFor={`${idPrefix}-quantity`}>{label}</label>
        <input
          id={`${idPrefix}-quantity`}
          name="quantity"
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          value={quantity}
          onChange={(event) => onQuantityChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy(error && errorId, hint && hintId)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-unit`}>Unidad</label>
        <select
          id={`${idPrefix}-unit`}
          name="unit"
          value={unit}
          onChange={(event) => onUnitChange(event.target.value as MeasurementUnit)}
          disabled={units.length === 1}
        >
          {units.map((option) => <option key={option} value={option}>{UNIT_OPTION_LABEL[option]}</option>)}
        </select>
      </div>
      {hint && <p id={hintId} className="field-hint quantity-hint">{hint}</p>}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

/**
 * Borrado en dos pasos sin ventana modal: el botón se convierte en una pregunta con
 * "Sí, eliminar" y "Cancelar". Cancelar devuelve el foco al botón original.
 */
export function ConfirmDelete({
  label,
  question,
  onConfirm,
  pending,
}: {
  label: string;
  question: ReactNode;
  onConfirm(): void;
  pending: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [returnFocus, setReturnFocus] = useState(false);

  useEffect(() => {
    if (asking) confirmRef.current?.focus();
    else if (returnFocus) triggerRef.current?.focus();
  }, [asking, returnFocus]);

  if (!asking) {
    return (
      <button ref={triggerRef} type="button" className="danger-link" onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="confirm-delete" role="group" aria-label="Confirmar eliminación">
      <p>{question}</p>
      <div className="confirm-actions">
        <button ref={confirmRef} type="button" className="danger-button" onClick={onConfirm} disabled={pending}>
          {pending ? 'Eliminando…' : 'Sí, eliminar'}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setReturnFocus(true);
            setAsking(false);
          }}
          disabled={pending}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
