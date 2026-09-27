'use client';

import type { CanonicalSummaryDto, InventoryItemDto, MeasurementUnit } from '@tusofertas/shared';
import Link from 'next/link';
import { useId, useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/api';
import {
  useAddInventoryItem,
  useDeleteInventoryItem,
  useInventory,
  useUpdateInventoryItem,
} from '../../lib/account/queries';
import { apiFieldErrors, parseQuantityInput, toInputQuantity, type FieldErrors } from '../../lib/account/quantities';
import { formatQuantity } from '../../lib/format';
import { CanonicalPicker } from '../account/canonical-picker';
import { ConfirmDelete, FormAlert, QuantityFields } from '../account/form-parts';
import { EmptyState, ErrorState, LoadingState } from '../common/states';

const updatedFormat = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'America/Argentina/Buenos_Aires',
});

/**
 * Despensa: un saldo aproximado por necesidad. No hay lotes ni vencimientos ni consumo
 * automático, y así se dice: la persona actualiza el número cuando quiere.
 */
export function InventoryView() {
  const inventory = useInventory();
  const addItem = useAddInventoryItem();
  const [picked, setPicked] = useState<CanonicalSummaryDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const items = inventory.data?.items ?? [];

  return (
    <div className="account-page">
      <p className="eyebrow"><span className="status-dot" /> MI DESPENSA</p>
      <h1 className="page-title">Lo que tenés en casa</h1>
      <p className="page-lead">
        Un saldo aproximado de cada producto. Lo usamos para no sugerirte comprar lo que ya tenés.
        No se descuenta solo: actualizalo cuando quieras.
      </p>

      {inventory.isPending && <LoadingState label="Cargando tu despensa…" />}
      {inventory.isError && <ErrorState message={inventory.error.message} onRetry={() => inventory.refetch()} />}
      {inventory.data && items.length === 0 && (
        <EmptyState title="Tu despensa está vacía">
          <p>Agregá lo que ya tenés, o seguí sin cargar nada: no es obligatorio.</p>
        </EmptyState>
      )}
      {items.length > 0 && (
        <ul className="need-list stock-list surface">
          {items.map((item) => <StockRow key={item.id} item={item} />)}
        </ul>
      )}

      {inventory.data && (
        <section className="add-need surface stock-add" aria-labelledby="stock-add-title">
          <h2 id="stock-add-title" className="subsection-title">Agregar a la despensa</h2>
          {notice && <p className="success-note" role="status">{notice}</p>}
          {picked ? (
            <div className="add-need-editor">
              <p className="picked-name">{picked.name}</p>
              <StockForm
                key={picked.id}
                canonical={picked}
                submitLabel="Agregar a la despensa"
                onCancel={() => setPicked(null)}
                onSubmit={async (body) => {
                  await addItem.mutateAsync({ canonicalProductId: picked.id, ...body });
                  setNotice(`Agregaste ${picked.name} a tu despensa.`);
                  setPicked(null);
                }}
              />
            </div>
          ) : (
            <CanonicalPicker
              label="Buscá un producto"
              takenIds={items.map((item) => item.canonicalProduct.id)}
              takenLabel="ya está en tu despensa: editalo en la lista"
              onPick={(canonical) => {
                setNotice(null);
                setPicked(canonical);
              }}
            />
          )}
        </section>
      )}
      <p className="muted page-foot">
        ¿Qué comprás seguido? Cargalo en <Link className="text-link" href="/mis-compras">Mis compras</Link>.
      </p>
    </div>
  );
}

function StockRow({ item }: { item: InventoryItemDto }) {
  const [editing, setEditing] = useState(false);
  const updateItem = useUpdateInventoryItem();
  const deleteItem = useDeleteInventoryItem();

  return (
    <li className="need-row">
      <div className="need-summary">
        <div className="need-main">
          <h3>{item.canonicalProduct.name}</h3>
          <p className="need-quantity">{formatQuantity(item.quantity, item.unit)}</p>
          <p className="muted">Actualizado el {updatedFormat.format(new Date(item.updatedAt))}</p>
        </div>
        {!editing && (
          <div className="row-actions">
            <button type="button" className="link-button" onClick={() => setEditing(true)} aria-label={`Editar ${item.canonicalProduct.name}`}>
              Editar
            </button>
            <ConfirmDelete
              label="Eliminar"
              question={<>¿Sacar <strong>{item.canonicalProduct.name}</strong> de tu despensa?</>}
              pending={deleteItem.isPending}
              onConfirm={() => deleteItem.mutate(item.id)}
            />
          </div>
        )}
      </div>
      {deleteItem.isError && <FormAlert message={deleteItem.error.message} />}
      {editing && (
        <StockForm
          canonical={item.canonicalProduct}
          initial={item}
          submitLabel="Guardar"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            await updateItem.mutateAsync({ id: item.id, body });
            setEditing(false);
          }}
        />
      )}
    </li>
  );
}

function StockForm({
  canonical,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  canonical: CanonicalSummaryDto;
  initial?: InventoryItemDto;
  submitLabel: string;
  onSubmit(body: { quantity: string; unit: MeasurementUnit }): Promise<unknown>;
  onCancel(): void;
}) {
  const id = useId();
  const [quantity, setQuantity] = useState(initial ? toInputQuantity(initial.quantity) : '');
  const [unit, setUnit] = useState<MeasurementUnit>(initial?.unit ?? canonical.defaultUnit);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFormError(null);
    const parsed = parseQuantityInput(quantity, { allowZero: true });
    if (!parsed) {
      setErrors({ quantity: 'Escribí una cantidad, por ejemplo 2 o 1,5. Cero también vale.' });
      document.getElementById(`${id}-quantity`)?.focus();
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await onSubmit({ quantity: parsed, unit });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVENTORY_DUPLICATE') {
        setFormError(`${canonical.name} ya está en tu despensa. Cancelá y editá la cantidad en la lista.`);
      } else {
        const mapped = apiFieldErrors(error, ['quantity', 'unit']);
        setErrors(mapped.fields);
        setFormError(mapped.general);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="item-editor" noValidate onSubmit={submit} aria-busy={pending}>
      <FormAlert message={formError} />
      <QuantityFields
        idPrefix={id}
        label={`Cuánto ${canonical.name.toLowerCase()} tenés`}
        baseUnit={canonical.defaultUnit}
        quantity={quantity}
        unit={unit}
        onQuantityChange={(value) => {
          setQuantity(value);
          setErrors({});
        }}
        onUnitChange={(value) => {
          setUnit(value);
          setErrors({});
        }}
        error={errors.quantity ?? errors.unit}
        autoFocus
      />
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={pending}>{pending ? 'Guardando…' : submitLabel}</button>
        <button type="button" className="secondary-button" onClick={onCancel} disabled={pending}>Cancelar</button>
      </div>
    </form>
  );
}
