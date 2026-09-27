'use client';

import type { CanonicalProductDto, RoutineDto, UserProfile } from '@tusofertas/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth-provider';
import {
  useAddRoutineItem,
  useDeleteRoutineItem,
  useEnsureRoutine,
  useProfile,
  useRoutines,
  useUpdateProfile,
} from '../../lib/account/queries';
import { apiFieldErrors, argentineToday, formatFrequency, type FieldErrors } from '../../lib/account/quantities';
import { formatQuantity } from '../../lib/format';
import { CanonicalPicker } from '../account/canonical-picker';
import { ConfirmDelete, FormAlert } from '../account/form-parts';
import { ErrorState, LoadingState } from '../common/states';
import {
  LocationFields,
  locationFromProfile,
  locationRequest,
  normalizeKm,
  RadiusChoice,
  StoresChoice,
} from '../preferences/preference-fields';
import { DEFAULT_ROUTINE_NAME } from '../routines/routines-view';
import { RoutineItemEditor } from '../routines/routine-item-editor';

const STEPS = ['Tu zona', 'Distancia y sucursales', 'Productos habituales', 'Listo'] as const;
type Step = 1 | 2 | 3 | 4;

const PROFILE_FIELDS = ['city', 'province', 'latitude', 'longitude', 'maxTravelDistanceKm', 'maxStoresPerShoppingPlan'];

/**
 * Paso guardado por cuenta para retomar el onboarding en otra visita. Es solo un número
 * (sin datos personales); lo que la persona cargó vive en la API.
 */
const stepKey = (userId: string) => `tusofertas:onboarding-step:${userId}`;

function readSavedStep(userId: string): Step {
  try {
    const saved = Number(window.localStorage.getItem(stepKey(userId)));
    return saved >= 1 && saved <= 4 ? (saved as Step) : 1;
  } catch {
    return 1;
  }
}

function saveStep(userId: string, step: Step | null) {
  try {
    if (step === null) window.localStorage.removeItem(stepKey(userId));
    else window.localStorage.setItem(stepKey(userId), String(step));
  } catch {
    // Almacenamiento bloqueado: se pierde solo la posibilidad de retomar en el mismo paso.
  }
}

function parseStep(value: string | null): Step | null {
  const step = Number(value);
  return step >= 1 && step <= 4 && Number.isInteger(step) ? (step as Step) : null;
}

/**
 * Onboarding en cuatro pasos. Cada "Continuar" guarda en la API antes de avanzar, así
 * que cerrar la pestaña no pierde nada; el paso actual va en la URL (?paso=) para que
 * "atrás" funcione. Nada de esto bloquea el resto del sitio: se puede omitir o dejar.
 */
export function OnboardingView() {
  const { state } = useAuth();
  const userId = state.status === 'authenticated' ? state.user.id : null;
  const profile = useProfile();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlStep = parseStep(searchParams.get('paso'));
  // Sin ?paso= se retoma donde quedó esta cuenta. PrivateShell monta esta vista solo con
  // sesión, ya en el navegador, así que leer el almacenamiento acá no rompe la hidratación.
  const [resumed] = useState<Step>(() => (userId ? readSavedStep(userId) : 1));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const step: Step = urlStep ?? resumed;

  useEffect(() => {
    if (userId) saveStep(userId, step);
    // Al cambiar de paso (no en la primera carga) el foco va al título nuevo.
    if (moved.current) headingRef.current?.focus();
  }, [step, userId]);

  const goTo = (next: Step) => {
    moved.current = true;
    router.push(`/onboarding?paso=${next}`);
  };

  if (profile.isPending) return <LoadingState label="Cargando tu cuenta…" />;
  if (profile.isError) return <ErrorState message={profile.error.message} onRetry={() => profile.refetch()} />;

  return (
    <div className="account-page onboarding">
      <p className="eyebrow"><span className="status-dot" /> CONFIGURAR TU CUENTA</p>
      <h1 className="page-title">Armemos tu compra habitual</h1>
      {profile.data.onboardingCompletedAt ? (
        <p className="page-lead">Ya completaste esta configuración. Podés revisarla cuando quieras.</p>
      ) : (
        <p className="page-lead">
          Son cuatro pasos y podés omitir cualquiera. Lo que cargues se guarda al continuar.{' '}
          <Link className="text-link" href="/inicio">Terminar más tarde</Link>
        </p>
      )}

      <ol className="onboarding-steps" aria-label="Pasos">
        {STEPS.map((label, index) => {
          const number = (index + 1) as Step;
          return (
            <li key={label} className={number === step ? 'is-current' : number < step ? 'is-done' : ''} aria-current={number === step ? 'step' : undefined}>
              <span className="step-index" aria-hidden="true">{number}</span>
              <span className="step-label">{label}</span>
            </li>
          );
        })}
      </ol>

      <section className="onboarding-card surface" aria-labelledby="onboarding-step-title">
        <h2 id="onboarding-step-title" ref={headingRef} tabIndex={-1} className="onboarding-step-title">
          <span className="visually-hidden">Paso {step} de 4: </span>{STEPS[step - 1]}
        </h2>
        {step === 1 && <LocationStep key="1" profile={profile.data} onNext={() => goTo(2)} />}
        {step === 2 && <TravelStep key="2" profile={profile.data} onBack={() => goTo(1)} onNext={() => goTo(3)} />}
        {step === 3 && <ProductsStep onBack={() => goTo(2)} onNext={() => goTo(4)} />}
        {step === 4 && (
          <FinishStep
            profile={profile.data}
            onBack={() => goTo(3)}
            onDone={() => {
              if (userId) saveStep(userId, null);
              router.push('/mis-compras');
            }}
          />
        )}
      </section>
    </div>
  );
}

function StepActions({
  onBack,
  onSkip,
  submitLabel = 'Continuar',
  pending,
}: {
  onBack?(): void;
  onSkip?(): void;
  submitLabel?: string;
  pending: boolean;
}) {
  return (
    <div className="step-actions">
      <button type="submit" className="primary-button" disabled={pending}>{pending ? 'Guardando…' : submitLabel}</button>
      {onSkip && <button type="button" className="link-button" onClick={onSkip} disabled={pending}>Omitir este paso</button>}
      {onBack && <button type="button" className="secondary-button step-back" onClick={onBack} disabled={pending}>Volver</button>}
    </div>
  );
}

function LocationStep({ profile, onNext }: { profile: UserProfile; onNext(): void }) {
  const update = useUpdateProfile();
  const [location, setLocation] = useState(() => locationFromProfile(profile));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  return (
    <form
      noValidate
      aria-busy={update.isPending}
      onSubmit={async (event) => {
        event.preventDefault();
        setFormError(null);
        const request = locationRequest(location);
        if ('errors' in request) return setErrors(request.errors);
        try {
          await update.mutateAsync(request.body);
          onNext();
        } catch (error) {
          const mapped = apiFieldErrors(error, PROFILE_FIELDS);
          setErrors(mapped.fields);
          setFormError(mapped.general);
        }
      }}
    >
      <p className="step-lead">¿Dónde hacés las compras? Con tu localidad ya podemos mostrarte sucursales cercanas.</p>
      <FormAlert message={formError} />
      <LocationFields value={location} onChange={(value) => { setLocation(value); setErrors({}); }} errors={errors} />
      <StepActions pending={update.isPending} onSkip={onNext} />
    </form>
  );
}

function TravelStep({ profile, onBack, onNext }: { profile: UserProfile; onBack(): void; onNext(): void }) {
  const update = useUpdateProfile();
  const [radius, setRadius] = useState(() => normalizeKm(profile.maxTravelDistanceKm));
  const [stores, setStores] = useState(profile.maxStoresPerShoppingPlan);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  return (
    <form
      noValidate
      aria-busy={update.isPending}
      onSubmit={async (event) => {
        event.preventDefault();
        setFormError(null);
        try {
          await update.mutateAsync({ maxTravelDistanceKm: radius, maxStoresPerShoppingPlan: stores });
          onNext();
        } catch (error) {
          const mapped = apiFieldErrors(error, PROFILE_FIELDS);
          setErrors(mapped.fields);
          setFormError(mapped.general);
        }
      }}
    >
      <FormAlert message={formError} />
      <RadiusChoice value={radius} onChange={(value) => { setRadius(value); setErrors({}); }} error={errors.maxTravelDistanceKm} />
      <StoresChoice value={stores} onChange={(value) => { setStores(value); setErrors({}); }} error={errors.maxStoresPerShoppingPlan} />
      <StepActions pending={update.isPending} onBack={onBack} onSkip={onNext} />
    </form>
  );
}

function ProductsStep({ onBack, onNext }: { onBack(): void; onNext(): void }) {
  const routines = useRoutines();
  const ensureRoutine = useEnsureRoutine();
  const addItem = useAddRoutineItem();
  const deleteItem = useDeleteRoutineItem();
  const [picked, setPicked] = useState<CanonicalProductDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (routines.isPending) return <LoadingState label="Cargando tu lista…" />;
  if (routines.isError) return <ErrorState message={routines.error.message} onRetry={() => routines.refetch()} />;

  // La lista del onboarding es la primera rutina; se crea recién con el primer producto.
  const routine: RoutineDto | undefined = routines.data.items[0];
  const schedule = routine ?? { frequencyDays: 7, anchorDate: argentineToday() };
  const items = routine?.items ?? [];

  return (
    <div>
      <p className="step-lead">
        ¿Qué comprás seguido? Buscalo, decinos cuánto llevás cada vez y cada cuánto. La marca y los reemplazos
        se ajustan después en <Link className="text-link" href="/mis-compras">Mis compras</Link>.
      </p>
      {items.length > 0 && (
        <ul className="need-list onboarding-needs" aria-label="Productos cargados">
          {items.map((item) => (
            <li key={item.id} className="need-row">
              <div className="need-summary">
                <div className="need-main">
                  <h3>{item.canonicalProduct.name}</h3>
                  <p className="need-quantity">
                    {formatQuantity(item.quantity, item.unit)} por compra · {formatFrequency(item.schedule.frequencyDays).toLowerCase()}
                  </p>
                </div>
                <div className="row-actions">
                  <ConfirmDelete
                    label="Eliminar"
                    question={<>¿Sacar <strong>{item.canonicalProduct.name}</strong>?</>}
                    pending={deleteItem.isPending}
                    onConfirm={() => deleteItem.mutate({ routineId: item.routineId, itemId: item.id })}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {notice && <p className="success-note" role="status">{notice}</p>}
      {picked ? (
        <div className="add-need-editor">
          <p className="picked-name">{picked.name}</p>
          <RoutineItemEditor
            key={picked.id}
            canonical={picked}
            routine={schedule}
            showAdvanced={false}
            submitLabel="Agregar"
            onCancel={() => setPicked(null)}
            onSubmit={async (body) => {
              const target = routine ?? (await ensureRoutine.mutateAsync(DEFAULT_ROUTINE_NAME));
              try {
                await addItem.mutateAsync({ routineId: target.id, body: { canonicalProductId: picked.id, ...body } });
                setNotice(`Agregaste ${picked.name}.`);
              } catch (error) {
                // Un reintento de algo que ya se guardó no es un error: ya está en la lista.
                if (!(error instanceof ApiError && error.code === 'ROUTINE_ITEM_DUPLICATE')) throw error;
                setNotice(`${picked.name} ya estaba en tu lista.`);
              }
              setPicked(null);
            }}
          />
        </div>
      ) : (
        <CanonicalPicker
          label="Buscá un producto habitual"
          takenIds={items.map((item) => item.canonicalProduct.id)}
          takenLabel="ya está en tu lista"
          onPick={(canonical) => {
            setNotice(null);
            setPicked(canonical);
          }}
        />
      )}
      <form noValidate onSubmit={(event) => { event.preventDefault(); onNext(); }}>
        <StepActions
          pending={false}
          onBack={onBack}
          submitLabel={items.length > 0 ? 'Continuar' : 'Continuar sin productos'}
        />
      </form>
    </div>
  );
}

function FinishStep({ profile, onBack, onDone }: { profile: UserProfile; onBack(): void; onDone(): void }) {
  const update = useUpdateProfile();
  const routines = useRoutines();
  const count = routines.data?.items.reduce((total, routine) => total + routine.items.length, 0) ?? 0;
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      noValidate
      aria-busy={update.isPending}
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        try {
          await update.mutateAsync({ onboardingCompleted: true });
          onDone();
        } catch (caught) {
          setError(apiFieldErrors(caught, []).general);
        }
      }}
    >
      <FormAlert message={error} />
      <dl className="account-list onboarding-summary">
        <div><dt>Zona</dt><dd>{profile.city ? `${profile.city}, ${profile.province}` : 'Sin cargar'}</dd></div>
        <div><dt>Ubicación exacta</dt><dd>{profile.latitude ? 'Compartida' : 'No compartida'}</dd></div>
        <div><dt>Distancia máxima</dt><dd>{normalizeKm(profile.maxTravelDistanceKm).replace('.', ',')} km</dd></div>
        <div><dt>Sucursales por compra</dt><dd>{profile.maxStoresPerShoppingPlan ?? 'Sin límite'}</dd></div>
        <div><dt>Productos habituales</dt><dd>{routines.isPending ? '…' : count}</dd></div>
      </dl>
      <p className="step-lead">
        Si ya tenés algo en casa, cargalo en <Link className="text-link" href="/mi-despensa">tu despensa</Link> para
        no comprarlo de más. Todo se puede cambiar después.
      </p>
      <StepActions pending={update.isPending} onBack={onBack} submitLabel="Terminar" />
    </form>
  );
}
