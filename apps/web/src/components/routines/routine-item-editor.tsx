'use client';

import type {
  CanonicalSummaryDto,
  MeasurementUnit,
  RoutineDto,
  RoutineItemDto,
  RoutineItemFieldsRequest,
} from '@tusofertas/shared';
import { useId, useState, type FormEvent } from 'react';
import { useCanonicalDetail } from '../../lib/account/queries';
import {
  apiFieldErrors,
  FREQUENCY_PRESETS,
  formatFrequency,
  parseBrandList,
  parseQuantityInput,
  toInputQuantity,
  type FieldErrors,
} from '../../lib/account/quantities';
import { formatQuantity } from '../../lib/format';
import { describedBy, FieldError, FormAlert, QuantityFields } from '../account/form-parts';

type FrequencyChoice = 'inherit' | 'custom' | `${number}`;

const VISIBLE_FIELDS = [
  'quantity', 'unit', 'frequencyDays', 'anchorDate', 'preferredProductId', 'allowSubstitutes', 'preferredBrands', 'excludedBrands',
] as const;

function initialFrequency(item: RoutineItemDto | undefined): FrequencyChoice {
  if (!item || item.schedule.inherited) return 'inherit';
  return FREQUENCY_PRESETS.some((preset) => preset.days === item.schedule.frequencyDays)
    ? `${item.schedule.frequencyDays}`
    : 'custom';
}

/**
 * Alta y edición de una necesidad: cantidad por compra, unidad y frecuencia a la vista;
 * presentación preferida, marcas y reemplazos en una sección plegada para no abrumar.
 * Las reglas finales (dimensión, preferido válido, marcas solapadas) las decide la API
 * y sus errores se muestran junto al campo que nombran.
 */
export function RoutineItemEditor({
  canonical,
  routine,
  item,
  submitLabel,
  onSubmit,
  onCancel,
  showAdvanced = true,
}: {
  canonical: CanonicalSummaryDto;
  routine: Pick<RoutineDto, 'frequencyDays' | 'anchorDate'>;
  item?: RoutineItemDto;
  submitLabel: string;
  onSubmit(body: RoutineItemFieldsRequest & { quantity: string; unit: MeasurementUnit }): Promise<unknown>;
  onCancel?(): void;
  showAdvanced?: boolean;
}) {
  const id = useId();
  const [quantity, setQuantity] = useState(item ? toInputQuantity(item.quantity) : '');
  const [unit, setUnit] = useState<MeasurementUnit>(item?.unit ?? canonical.defaultUnit);
  const [frequency, setFrequency] = useState<FrequencyChoice>(initialFrequency(item));
  const [customDays, setCustomDays] = useState(item && initialFrequency(item) === 'custom' ? String(item.schedule.frequencyDays) : '');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [preferredProductId, setPreferredProductId] = useState(item?.preferredProduct?.id ?? '');
  const [allowSubstitutes, setAllowSubstitutes] = useState(item?.allowSubstitutes ?? true);
  const [preferredBrands, setPreferredBrands] = useState(item?.preferredBrands.join(', ') ?? '');
  const [excludedBrands, setExcludedBrands] = useState(item?.excludedBrands.join(', ') ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const detail = useCanonicalDetail(canonical.id, showAdvanced && advancedOpen);

  const clear = (...fields: string[]) =>
    setErrors((current) => (fields.some((field) => current[field]) ? { ...current, ...Object.fromEntries(fields.map((field) => [field, undefined])) } : current));

  function scheduleBody(): Pick<RoutineItemFieldsRequest, 'frequencyDays' | 'anchorDate'> | null {
    if (frequency === 'inherit') {
      // Solo hace falta avisar si el ítem tenía una frecuencia propia.
      return item && !item.schedule.inherited ? { frequencyDays: null, anchorDate: null } : {};
    }
    const days = frequency === 'custom' ? Number(customDays) : Number(frequency);
    if (!Number.isInteger(days) || days < 1 || days > 365) return null;
    // Se conserva el ancla propia si ya la tenía; si no, se alinea con la rutina.
    const anchorDate = item && !item.schedule.inherited ? item.schedule.anchorDate : routine.anchorDate;
    return { frequencyDays: days, anchorDate };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFormError(null);
    const found: FieldErrors = {};
    const parsed = parseQuantityInput(quantity);
    if (!parsed) found.quantity = 'Escribí una cantidad mayor que cero, por ejemplo 1,5.';
    const schedule = scheduleBody();
    if (!schedule) found.frequencyDays = 'La frecuencia es un número de días entre 1 y 365.';
    if (showAdvanced && !allowSubstitutes && !preferredProductId) {
      found.preferredProductId = 'Para no aceptar reemplazos, elegí la presentación que querés.';
      setAdvancedOpen(true);
    }
    setErrors(found);
    if (!parsed || !schedule || found.preferredProductId) {
      // Después del render: la sección plegada puede tener que abrirse primero.
      const first = Object.keys(found)[0];
      requestAnimationFrame(() => document.getElementById(`${id}-${first}`)?.focus());
      return;
    }

    const advanced: RoutineItemFieldsRequest = showAdvanced
      ? {
          preferredProductId: preferredProductId || (item?.preferredProduct ? null : undefined),
          allowSubstitutes,
          preferredBrands: parseBrandList(preferredBrands),
          excludedBrands: parseBrandList(excludedBrands),
        }
      : {};
    if (!item) {
      // En un alta, los valores por defecto no se envían.
      if (advanced.allowSubstitutes === true) delete advanced.allowSubstitutes;
      if (advanced.preferredBrands?.length === 0) delete advanced.preferredBrands;
      if (advanced.excludedBrands?.length === 0) delete advanced.excludedBrands;
    }
    if (advanced.preferredProductId === undefined) delete advanced.preferredProductId;

    setPending(true);
    try {
      await onSubmit({ quantity: parsed, unit, ...schedule, ...advanced });
      if (!item) {
        setQuantity('');
        setFrequency('inherit');
      }
    } catch (error) {
      const mapped = apiFieldErrors(error, VISIBLE_FIELDS);
      setErrors(mapped.fields);
      setFormError(mapped.general);
      if (mapped.fields.preferredProductId || mapped.fields.preferredBrands || mapped.fields.excludedBrands) setAdvancedOpen(true);
    } finally {
      setPending(false);
    }
  }

  const products = detail.data?.products ?? [];
  const inheritLabel = `Igual que la lista (${formatFrequency(routine.frequencyDays).toLowerCase()})`;

  return (
    <form className="item-editor" noValidate onSubmit={submit} aria-busy={pending}>
      <FormAlert message={formError} />
      <QuantityFields
        idPrefix={id}
        label={`Cuánto ${canonical.name.toLowerCase()} comprás cada vez`}
        baseUnit={canonical.defaultUnit}
        quantity={quantity}
        unit={unit}
        onQuantityChange={(value) => {
          setQuantity(value);
          clear('quantity', 'unit');
        }}
        onUnitChange={(value) => {
          setUnit(value);
          clear('quantity', 'unit');
        }}
        error={errors.quantity ?? errors.unit}
        hint="Por compra, no por mes. Usá coma para decimales."
        autoFocus
      />

      <div className="frequency-fields">
        <div className="field">
          <label htmlFor={`${id}-frequencyDays`}>Cada cuánto</label>
          <select
            id={`${id}-frequencyDays`}
            value={frequency}
            onChange={(event) => {
              setFrequency(event.target.value as FrequencyChoice);
              clear('frequencyDays', 'anchorDate');
            }}
            aria-invalid={Boolean(errors.frequencyDays)}
            aria-describedby={describedBy(errors.frequencyDays && `${id}-frequency-error`)}
          >
            <option value="inherit">{inheritLabel}</option>
            {FREQUENCY_PRESETS.map((preset) => <option key={preset.days} value={preset.days}>{preset.label}</option>)}
            <option value="custom">Otra cantidad de días</option>
          </select>
        </div>
        {frequency === 'custom' && (
          <div className="field field-days">
            <label htmlFor={`${id}-customDays`}>Días entre compras</label>
            <input
              id={`${id}-customDays`}
              inputMode="numeric"
              value={customDays}
              onChange={(event) => {
                setCustomDays(event.target.value);
                clear('frequencyDays');
              }}
              aria-invalid={Boolean(errors.frequencyDays)}
            />
          </div>
        )}
        <FieldError id={`${id}-frequency-error`} message={errors.frequencyDays ?? errors.anchorDate} />
      </div>

      {showAdvanced && (
        <details className="item-advanced" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
          <summary>Más opciones: presentación, marcas y reemplazos</summary>
          <div className="item-advanced-body">
            <div className="field">
              <label htmlFor={`${id}-preferredProductId`}>Presentación preferida</label>
              <select
                id={`${id}-preferredProductId`}
                value={preferredProductId}
                onChange={(event) => {
                  setPreferredProductId(event.target.value);
                  clear('preferredProductId', 'allowSubstitutes');
                }}
                aria-invalid={Boolean(errors.preferredProductId)}
                aria-describedby={describedBy(errors.preferredProductId && `${id}-preferred-error`)}
              >
                <option value="">Cualquiera, la que convenga</option>
                {item?.preferredProduct && !products.some((product) => product.id === item.preferredProduct?.id) && (
                  <option value={item.preferredProduct.id}>{item.preferredProduct.name}</option>
                )}
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} ({formatQuantity(product.quantity, product.unit)})
                  </option>
                ))}
              </select>
              {detail.isPending && advancedOpen && <p className="field-hint">Cargando presentaciones…</p>}
              <FieldError id={`${id}-preferred-error`} message={errors.preferredProductId} />
            </div>
            <label className="check-field">
              <input
                type="checkbox"
                checked={allowSubstitutes}
                onChange={(event) => {
                  setAllowSubstitutes(event.target.checked);
                  clear('preferredProductId', 'allowSubstitutes');
                }}
              />
              <span>Acepto otra presentación o marca equivalente si conviene</span>
            </label>
            <div className="field">
              <label htmlFor={`${id}-preferredBrands`}>Marcas que preferís</label>
              <input
                id={`${id}-preferredBrands`}
                value={preferredBrands}
                onChange={(event) => {
                  setPreferredBrands(event.target.value);
                  clear('preferredBrands', 'excludedBrands');
                }}
                placeholder="Separadas por coma"
                aria-invalid={Boolean(errors.preferredBrands)}
                aria-describedby={describedBy(errors.preferredBrands && `${id}-preferredBrands-error`)}
              />
              <FieldError id={`${id}-preferredBrands-error`} message={errors.preferredBrands} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-excludedBrands`}>Marcas que no querés</label>
              <input
                id={`${id}-excludedBrands`}
                value={excludedBrands}
                onChange={(event) => {
                  setExcludedBrands(event.target.value);
                  clear('preferredBrands', 'excludedBrands');
                }}
                placeholder="Separadas por coma"
                aria-invalid={Boolean(errors.excludedBrands)}
                aria-describedby={describedBy(errors.excludedBrands && `${id}-excludedBrands-error`)}
              />
              <FieldError id={`${id}-excludedBrands-error`} message={errors.excludedBrands} />
            </div>
          </div>
        </details>
      )}

      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={pending}>
          {pending ? 'Guardando…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="secondary-button" onClick={onCancel} disabled={pending}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
