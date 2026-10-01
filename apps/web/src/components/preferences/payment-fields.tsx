'use client';

import type { PaymentMethod, UpdateProfileRequest, UserProfile } from '@tusofertas/shared';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { PAYMENT_METHOD_LABEL } from '../../lib/benefits/format';
import { useConditionedPromotions } from '../../lib/benefits/queries';
import { describedBy, FieldError } from '../account/form-parts';

/**
 * Medios de pago, bancos y membresías declarados (P10-02, ADR 0023). Solo se guarda lo que la
 * persona declara: nunca número de tarjeta, CVV ni credenciales. Lo no declarado deja los
 * beneficios como condicionados (se muestran y no se suman).
 */

export interface PaymentValue {
  paymentMethods: PaymentMethod[];
  banks: string[];
  membershipPrograms: string[];
}

export const paymentFromProfile = (profile: UserProfile): PaymentValue => ({
  paymentMethods: [...profile.paymentMethods],
  banks: [...profile.banks],
  membershipPrograms: [...profile.membershipPrograms],
});

export const paymentRequest = (value: PaymentValue): UpdateProfileRequest => ({
  paymentMethods: value.paymentMethods,
  banks: value.banks,
  membershipPrograms: value.membershipPrograms,
});

const METHODS: PaymentMethod[] = ['DEBIT_CARD', 'CREDIT_CARD', 'WALLET', 'TRANSFER', 'CASH'];
const MAX_NAMES = 20;
const MAX_NAME_LENGTH = 120;

/** Para comparar nombres sin mayúsculas, tildes ni espacios, como la API. */
const nameKey = (name: string) => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, '').toLowerCase();

export function PaymentFields({
  value,
  onChange,
  errors,
}: {
  value: PaymentValue;
  onChange(value: PaymentValue): void;
  errors: Partial<Record<string, string>>;
}) {
  const promotions = useConditionedPromotions();
  const suggestions = useMemo(() => {
    const banks = new Set<string>();
    const memberships = new Set<string>();
    for (const promotion of promotions.data ?? []) {
      if (promotion.conditions.bank) banks.add(promotion.conditions.bank);
      if (promotion.conditions.membershipProgram) memberships.add(promotion.conditions.membershipProgram);
    }
    const sorted = (names: Set<string>) => [...names].sort((a, b) => a.localeCompare(b, 'es'));
    return { banks: sorted(banks), memberships: sorted(memberships) };
  }, [promotions.data]);

  return (
    <div className="payment-fields">
      <PaymentMethodsChoice
        value={value.paymentMethods}
        onChange={(paymentMethods) => onChange({ ...value, paymentMethods })}
        error={errors.paymentMethods}
      />
      <NameListField
        label="Bancos y billeteras"
        hint="Los que usás para pagar, por ejemplo el banco de tu tarjeta de débito."
        addLabel="Agregar banco"
        values={value.banks}
        suggestions={suggestions.banks}
        onChange={(banks) => onChange({ ...value, banks })}
        error={errors.banks}
      />
      <NameListField
        label="Programas de socios"
        hint="Clubes o membresías de comercios, si tenés alguno."
        addLabel="Agregar programa"
        values={value.membershipPrograms}
        suggestions={suggestions.memberships}
        onChange={(membershipPrograms) => onChange({ ...value, membershipPrograms })}
        error={errors.membershipPrograms}
      />
    </div>
  );
}

function PaymentMethodsChoice({ value, onChange, error }: { value: PaymentMethod[]; onChange(value: PaymentMethod[]): void; error?: string }) {
  const id = useId();
  const toggle = (method: PaymentMethod) =>
    onChange(value.includes(method) ? value.filter((entry) => entry !== method) : METHODS.filter((entry) => entry === method || value.includes(entry)));
  return (
    <fieldset className="choice-group" aria-describedby={describedBy(`${id}-hint`, error && `${id}-error`)}>
      <legend>¿Con qué pagás?</legend>
      <p id={`${id}-hint`} className="field-hint">Marcá todos los que uses. Si no marcás ninguno, no sabemos cuáles te corresponden.</p>
      <div className="choice-options">
        {METHODS.map((method) => (
          <label key={method} className="choice-option">
            <input type="checkbox" checked={value.includes(method)} onChange={() => toggle(method)} />
            <span>{PAYMENT_METHOD_LABEL[method]}</span>
          </label>
        ))}
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </fieldset>
  );
}

/** Lista de nombres con alta y baja de a uno; las sugerencias salen de las promociones vigentes. */
function NameListField({
  label,
  hint,
  addLabel,
  values,
  suggestions,
  onChange,
  error,
}: {
  label: string;
  hint: string;
  addLabel: string;
  values: string[];
  suggestions: string[];
  onChange(values: string[]): void;
  error?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const available = suggestions.filter((name) => !values.some((value) => nameKey(value) === nameKey(name)));

  function add() {
    const name = draft.trim();
    if (!name) return setProblem('Escribí un nombre.');
    if (name.length > MAX_NAME_LENGTH) return setProblem(`Como máximo ${MAX_NAME_LENGTH} caracteres.`);
    if (values.some((value) => nameKey(value) === nameKey(name))) return setProblem('Ya está en la lista.');
    if (values.length >= MAX_NAMES) return setProblem(`Como máximo ${MAX_NAMES}.`);
    setProblem(null);
    setDraft('');
    onChange([...values, name]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter agrega el nombre en lugar de enviar todo el formulario.
    if (event.key === 'Enter') {
      event.preventDefault();
      add();
    }
  }

  const message = problem ?? error;
  return (
    <div className="field name-list-field">
      <label htmlFor={`${id}-input`}>{label}</label>
      <p id={`${id}-hint`} className="field-hint">{hint}</p>
      {values.length > 0 && (
        <ul className="name-list" aria-label={`${label} cargados`}>
          {values.map((value) => (
            <li key={value}>
              <span>{value}</span>
              <button type="button" className="text-button" onClick={() => onChange(values.filter((entry) => entry !== value))}>
                Quitar<span className="sr-only"> {value}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="name-list-add">
        <input
          id={`${id}-input`}
          list={available.length ? `${id}-suggestions` : undefined}
          value={draft}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="off"
          aria-invalid={message ? true : undefined}
          aria-describedby={describedBy(`${id}-hint`, message && `${id}-error`)}
          onChange={(event) => { setDraft(event.target.value); setProblem(null); }}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="secondary-button" onClick={add}>{addLabel}</button>
      </div>
      {available.length > 0 && (
        <datalist id={`${id}-suggestions`}>
          {available.map((name) => <option key={name} value={name} />)}
        </datalist>
      )}
      <FieldError id={`${id}-error`} message={message ?? undefined} />
    </div>
  );
}
