'use client';

import type { CanonicalProductDto, InventoryItemDto, RoutineDto, RoutineItemDto } from '@tusofertas/shared';
import Link from 'next/link';
import { useId, useState, type FormEvent } from 'react';
import {
  useAddRoutineItem,
  useCreateRoutine,
  useDeleteRoutine,
  useDeleteRoutineItem,
  useInventory,
  useRoutines,
  useUpdateRoutine,
  useUpdateRoutineItem,
} from '../../lib/account/queries';
import {
  apiFieldErrors,
  FREQUENCY_PRESETS,
  formatCalendarDate,
  formatFrequency,
  type FieldErrors,
} from '../../lib/account/quantities';
import { formatQuantity } from '../../lib/format';
import { CanonicalPicker } from '../account/canonical-picker';
import { ConfirmDelete, describedBy, FieldError, FormAlert } from '../account/form-parts';
import { EmptyState, ErrorState, LoadingState } from '../common/states';
import { RoutineItemEditor } from './routine-item-editor';

export const DEFAULT_ROUTINE_NAME = 'Compras habituales';

export function RoutinesView() {
  const routines = useRoutines();
  const inventory = useInventory();
  const createRoutine = useCreateRoutine();

  const stock = new Map((inventory.data?.items ?? []).map((entry) => [entry.canonicalProduct.id, entry]));

  return (
    <div className="account-page">
      <p className="eyebrow"><span className="status-dot" /> MIS COMPRAS</p>
      <h1 className="page-title">Lo que comprás habitualmente</h1>
      <p className="page-lead">
        Cargá cuánto comprás de cada cosa y cada cuánto. Con esto y lo que tenés en{' '}
        <Link className="text-link" href="/mi-despensa">tu despensa</Link> vamos a armar tu plan de compra
        (todavía no está disponible).
      </p>

      {routines.isPending && <LoadingState label="Cargando tus compras…" />}
      {routines.isError && <ErrorState message={routines.error.message} onRetry={() => routines.refetch()} />}
      {routines.data && routines.data.items.length === 0 && (
        <EmptyState title="Todavía no cargaste tu compra habitual">
          <p>Empezá una lista y agregá los productos que comprás seguido.</p>
          <FormAlert message={createRoutine.isError ? createRoutine.error.message : null} />
          <button
            type="button"
            className="primary-button"
            disabled={createRoutine.isPending}
            onClick={() => createRoutine.mutate({ name: DEFAULT_ROUTINE_NAME })}
          >
            {createRoutine.isPending ? 'Creando…' : 'Empezar mi lista'}
          </button>
        </EmptyState>
      )}
      {routines.data?.items.map((routine) => (
        <RoutineSection key={routine.id} routine={routine} stock={stock} />
      ))}
      {routines.data && routines.data.items.length > 0 && <NewRoutineForm />}
    </div>
  );
}

function RoutineSection({ routine, stock }: { routine: RoutineDto; stock: Map<string, InventoryItemDto> }) {
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<CanonicalProductDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const deleteRoutine = useDeleteRoutine();
  const addItem = useAddRoutineItem();
  const headingId = useId();
  const count = routine.items.length;

  return (
    <section className="routine-card surface" aria-labelledby={headingId}>
      <header className="routine-header">
        <div>
          <h2 id={headingId}>{routine.name}</h2>
          <p className="muted">
            {formatFrequency(routine.frequencyDays)}, contando desde el {formatCalendarDate(routine.anchorDate)} ·{' '}
            {count === 1 ? '1 producto' : `${count} productos`}
          </p>
        </div>
        {!editing && (
          <div className="row-actions">
            <button type="button" className="link-button" onClick={() => setEditing(true)}>Editar lista</button>
            <ConfirmDelete
              label="Eliminar lista"
              question={<>¿Eliminar <strong>{routine.name}</strong>{count > 0 ? ` y sus ${count} productos` : ''}? Tu despensa no cambia.</>}
              pending={deleteRoutine.isPending}
              onConfirm={() => deleteRoutine.mutate(routine.id)}
            />
          </div>
        )}
      </header>
      {deleteRoutine.isError && <FormAlert message={deleteRoutine.error.message} />}
      {editing && <RoutineSettingsForm routine={routine} onDone={() => setEditing(false)} />}

      {count === 0 ? (
        <p className="muted routine-empty">Esta lista todavía no tiene productos.</p>
      ) : (
        <ul className="need-list">
          {routine.items.map((item) => (
            <NeedRow key={item.id} routine={routine} item={item} stock={stock.get(item.canonicalProduct.id)} />
          ))}
        </ul>
      )}

      <div className="add-need">
        <h3 className="subsection-title">Agregar un producto</h3>
        {notice && <p className="success-note" role="status">{notice}</p>}
        {picked ? (
          <div className="add-need-editor">
            <p className="picked-name">{picked.name}</p>
            <RoutineItemEditor
              key={picked.id}
              canonical={picked}
              routine={routine}
              submitLabel="Agregar a la lista"
              onCancel={() => setPicked(null)}
              onSubmit={async (body) => {
                await addItem.mutateAsync({ routineId: routine.id, body: { canonicalProductId: picked.id, ...body } });
                setNotice(`Agregaste ${picked.name}.`);
                setPicked(null);
              }}
            />
          </div>
        ) : (
          <CanonicalPicker
            label="Buscá un producto"
            takenIds={routine.items.map((item) => item.canonicalProduct.id)}
            takenLabel="ya está en esta lista"
            onPick={(canonical) => {
              setNotice(null);
              setPicked(canonical);
            }}
          />
        )}
      </div>
    </section>
  );
}

function NeedRow({ routine, item, stock }: { routine: RoutineDto; item: RoutineItemDto; stock?: InventoryItemDto }) {
  const [editing, setEditing] = useState(false);
  const updateItem = useUpdateRoutineItem();
  const deleteItem = useDeleteRoutineItem();
  const { schedule } = item;

  return (
    <li className="need-row">
      <div className="need-summary">
        <div className="need-main">
          <h3>{item.canonicalProduct.name}</h3>
          <p className="need-quantity">{formatQuantity(item.quantity, item.unit)} por compra</p>
          <p className="muted">
            {formatFrequency(schedule.frequencyDays)}
            {schedule.inherited ? ' (como la lista)' : `, desde el ${formatCalendarDate(schedule.anchorDate)}`}
          </p>
          {(item.preferredProduct || !item.allowSubstitutes || item.preferredBrands.length > 0 || item.excludedBrands.length > 0) && (
            <p className="muted need-preferences">
              {item.preferredProduct && <>Preferís {item.preferredProduct.name}. </>}
              {!item.allowSubstitutes && <>Sin reemplazos. </>}
              {item.preferredBrands.length > 0 && <>Marcas: {item.preferredBrands.join(', ')}. </>}
              {item.excludedBrands.length > 0 && <>Evitás: {item.excludedBrands.join(', ')}.</>}
            </p>
          )}
          <p className="need-stock">
            {stock
              ? <>En tu despensa: {formatQuantity(stock.quantity, stock.unit)}</>
              : <>Sin cargar en la despensa</>}
          </p>
        </div>
        {!editing && (
          <div className="row-actions">
            <button type="button" className="link-button" onClick={() => setEditing(true)} aria-label={`Editar ${item.canonicalProduct.name}`}>
              Editar
            </button>
            <ConfirmDelete
              label="Eliminar"
              question={<>¿Sacar <strong>{item.canonicalProduct.name}</strong> de {routine.name}?</>}
              pending={deleteItem.isPending}
              onConfirm={() => deleteItem.mutate({ routineId: routine.id, itemId: item.id })}
            />
          </div>
        )}
      </div>
      {deleteItem.isError && <FormAlert message={deleteItem.error.message} />}
      {editing && (
        <RoutineItemEditor
          canonical={item.canonicalProduct}
          routine={routine}
          item={item}
          submitLabel="Guardar cambios"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            await updateItem.mutateAsync({ routineId: routine.id, itemId: item.id, body });
            setEditing(false);
          }}
        />
      )}
    </li>
  );
}

const ROUTINE_FIELDS = ['name', 'frequencyDays', 'anchorDate'] as const;

function RoutineSettingsForm({ routine, onDone }: { routine: RoutineDto; onDone(): void }) {
  const id = useId();
  const updateRoutine = useUpdateRoutine();
  const [name, setName] = useState(routine.name);
  const [frequencyDays, setFrequencyDays] = useState(String(routine.frequencyDays));
  const [anchorDate, setAnchorDate] = useState(routine.anchorDate);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const isPreset = FREQUENCY_PRESETS.some((preset) => String(preset.days) === frequencyDays);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const found: FieldErrors = {};
    const days = Number(frequencyDays);
    if (!name.trim()) found.name = 'Poné un nombre a la lista.';
    if (!Number.isInteger(days) || days < 1 || days > 365) found.frequencyDays = 'La frecuencia es un número de días entre 1 y 365.';
    if (!anchorDate) found.anchorDate = 'Elegí una fecha.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      await updateRoutine.mutateAsync({ routineId: routine.id, body: { name: name.trim(), frequencyDays: days, anchorDate } });
      onDone();
    } catch (error) {
      const mapped = apiFieldErrors(error, ROUTINE_FIELDS);
      setErrors(mapped.fields);
      setFormError(mapped.general);
    }
  }

  return (
    <form className="routine-settings" noValidate onSubmit={submit} aria-busy={updateRoutine.isPending}>
      <FormAlert message={formError} />
      <div className="field">
        <label htmlFor={`${id}-name`}>Nombre de la lista</label>
        <input id={`${id}-name`} value={name} maxLength={120} onChange={(event) => setName(event.target.value)}
          aria-invalid={Boolean(errors.name)} aria-describedby={describedBy(errors.name && `${id}-name-error`)} />
        <FieldError id={`${id}-name-error`} message={errors.name} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-frequency`}>Cada cuánto hacés esta compra</label>
        <select id={`${id}-frequency`} value={isPreset ? frequencyDays : 'custom'}
          onChange={(event) => setFrequencyDays(event.target.value === 'custom' ? '' : event.target.value)}>
          {FREQUENCY_PRESETS.map((preset) => <option key={preset.days} value={preset.days}>{preset.label}</option>)}
          <option value="custom">Otra cantidad de días</option>
        </select>
      </div>
      {!isPreset && (
        <div className="field field-days">
          <label htmlFor={`${id}-days`}>Días entre compras</label>
          <input id={`${id}-days`} inputMode="numeric" value={frequencyDays} onChange={(event) => setFrequencyDays(event.target.value)}
            aria-invalid={Boolean(errors.frequencyDays)} aria-describedby={describedBy(errors.frequencyDays && `${id}-days-error`)} />
        </div>
      )}
      <FieldError id={`${id}-days-error`} message={errors.frequencyDays} />
      <div className="field">
        <label htmlFor={`${id}-anchor`}>Contando desde</label>
        <input id={`${id}-anchor`} type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)}
          aria-invalid={Boolean(errors.anchorDate)} aria-describedby={describedBy(`${id}-anchor-hint`, errors.anchorDate && `${id}-anchor-error`)} />
        <p id={`${id}-anchor-hint`} className="field-hint">Un día en que hiciste (o vas a hacer) esta compra.</p>
        <FieldError id={`${id}-anchor-error`} message={errors.anchorDate} />
      </div>
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={updateRoutine.isPending}>
          {updateRoutine.isPending ? 'Guardando…' : 'Guardar lista'}
        </button>
        <button type="button" className="secondary-button" onClick={onDone} disabled={updateRoutine.isPending}>Cancelar</button>
      </div>
    </form>
  );
}

function NewRoutineForm() {
  const id = useId();
  const createRoutine = useCreateRoutine();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <p className="new-routine">
        <button type="button" className="secondary-button" onClick={() => setOpen(true)}>Crear otra lista</button>
        <span className="muted"> Por ejemplo, una compra mensual de limpieza.</span>
      </p>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return setError('Poné un nombre a la lista.');
    try {
      await createRoutine.mutateAsync({ name: name.trim() });
      setName('');
      setError(null);
      setOpen(false);
    } catch (caught) {
      setError(apiFieldErrors(caught, []).general);
    }
  }

  return (
    <form className="new-routine-form surface" noValidate onSubmit={submit}>
      <div className="field">
        <label htmlFor={`${id}-name`}>Nombre de la nueva lista</label>
        <input id={`${id}-name`} value={name} maxLength={120} autoFocus onChange={(event) => setName(event.target.value)}
          aria-invalid={Boolean(error)} aria-describedby={describedBy(error && `${id}-error`)} />
        <FieldError id={`${id}-error`} message={error ?? undefined} />
        <p className="field-hint">Empieza semanal; después podés cambiar la frecuencia.</p>
      </div>
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={createRoutine.isPending}>
          {createRoutine.isPending ? 'Creando…' : 'Crear lista'}
        </button>
        <button type="button" className="secondary-button" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </form>
  );
}
