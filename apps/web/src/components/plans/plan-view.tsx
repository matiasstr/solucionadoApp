'use client';

import type {
  PlanBenefitNoteDto,
  PlanBenefitsSummaryDto,
  PlanLineDto,
  PlanNoticeDto,
  PlanScheduleDayDto,
  PlanScheduleVisitDto,
  ShoppingPlanDto,
  ShoppingPlanStatus,
  ShoppingPlanSummaryDto,
} from '@tusofertas/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { useProfile, useRoutines } from '../../lib/account/queries';
import {
  formatBenefitReason,
  formatCapPeriodKey,
  formatConditions,
  isFixableInPreferences,
} from '../../lib/benefits/format';
import { formatArs, formatDate, formatQuantity } from '../../lib/format';
import { useGeneratePlan, usePlan, usePlans, useUpdatePlanStatus } from '../../lib/plans/queries';
import { DemoNotice, EmptyState, ErrorState, LoadingState } from '../common/states';

// Fechas de calendario (AAAA-MM-DD): se leen al mediodía UTC para que ninguna zona las corra de día.
const calendar = (date: string) => new Date(`${date}T12:00:00.000Z`);
const dayFormat = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const shortFormat = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const timestampFormat = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Buenos_Aires',
});
const kmFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const period = (plan: ShoppingPlanSummaryDto) =>
  `del ${shortFormat.format(calendar(plan.startDate))} al ${shortFormat.format(calendar(plan.endDate))}`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const isPositive = (amount: string) => Number(amount) > 0;

const STATUS_LABEL: Record<ShoppingPlanStatus, string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'En uso',
  COMPLETED: 'Hecho',
  EXPIRED: 'Vencido',
};

const UNFULFILLED_LABEL: Record<string, string> = {
  NO_LOCATION: 'Falta tu zona: cargala en Preferencias para elegir sucursales.',
  NO_STORES_IN_SCOPE: 'No hay sucursales dentro de tu radio.',
  CONFLICTING_EXACT_PRODUCTS: 'Dos listas piden presentaciones distintas y sin reemplazos.',
  PREFERRED_PRODUCT_UNAVAILABLE: 'La presentación que elegiste no está disponible.',
  NO_ELIGIBLE_PRODUCT: 'Ninguna presentación cumple con tus marcas o reemplazos.',
  NO_PRICE_IN_SCOPE: 'No tenemos precios de este producto cerca tuyo.',
  ONLY_STALE_PRICES: 'Los únicos precios que tenemos son viejos.',
  ONLY_IN_TRIMMED_STORES: 'Solo aparece en sucursales que quedaron fuera de las evaluadas.',
  MAX_STORES_LIMIT: 'No entra en tu máximo de sucursales por compra.',
};

/** Plan semanal: generar, ver el cronograma por día y sucursal, y marcar qué se hizo. */
export function PlanView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const plans = usePlans();
  const requested = searchParams.get('plan');
  const selectedId = requested ?? plans.data?.items[0]?.id ?? null;
  const plan = usePlan(selectedId);
  const generate = useGeneratePlan();
  // Se reutiliza si hay que reintentar: si la respuesta se perdió, la API devuelve el plan ya guardado.
  const [attemptKey, setAttemptKey] = useState<string | null>(null);
  const [focusPlan, setFocusPlan] = useState(false);

  async function onGenerate() {
    const key = attemptKey ?? crypto.randomUUID();
    setAttemptKey(key);
    try {
      const created = await generate.mutateAsync({ idempotencyKey: key });
      setAttemptKey(null);
      setFocusPlan(true);
      router.push(`/plan-semanal?plan=${created.id}`);
    } catch (error) {
      // Solo un corte de conexión justifica repetir la misma clave.
      if (!(error instanceof ApiError) || error.code !== 'SERVICE_UNAVAILABLE') setAttemptKey(null);
    }
  }

  const hasPlans = Boolean(plans.data?.items.length);
  return (
    <div className="account-page plan-page">
      <p className="eyebrow"><span className="status-dot" /> PLAN SEMANAL</p>
      <h1 className="page-title">Tu plan de compras</h1>
      <p className="page-lead">
        Armamos la compra de los próximos 7 días con tus productos habituales, lo que tenés en casa y los últimos
        precios observados cerca tuyo. Los importes son una estimación: los precios pueden cambiar.
      </p>

      <div className="plan-generate">
        <button type="button" className="primary-button" onClick={onGenerate} disabled={generate.isPending}>
          {generate.isPending ? 'Armando tu plan…' : hasPlans ? 'Generar de nuevo con precios actuales' : 'Generar mi plan'}
        </button>
        <p className="muted">Generar un plan no descuenta nada de tu despensa ni registra una compra.</p>
        {generate.isError && (
          <p className="form-alert" role="alert">
            {generate.error.message}
            {attemptKey ? ' Podés reintentar: no se va a duplicar.' : ''}
          </p>
        )}
      </div>

      {plans.isPending && <LoadingState label="Cargando tus planes…" />}
      {plans.isError && <ErrorState message={plans.error.message} onRetry={() => plans.refetch()} />}
      {plans.data && !hasPlans && !generate.isPending && <FirstPlanHint />}

      {selectedId && plan.isPending && <LoadingState label="Cargando el plan…" />}
      {plan.isError && (
        plan.error instanceof ApiError && plan.error.status === 404
          ? <EmptyState title="No encontramos ese plan"><Link className="text-link" href="/plan-semanal">Ver tu último plan</Link></EmptyState>
          : <ErrorState message={plan.error.message} onRetry={() => plan.refetch()} />
      )}
      {plan.data && (
        <PlanDetail key={plan.data.id} plan={plan.data} focusOnMount={focusPlan} onFocused={() => setFocusPlan(false)} />
      )}

      {plans.data && plans.data.items.length > 1 && <PlanHistory plans={plans.data.items} selectedId={selectedId} />}
    </div>
  );
}

function FirstPlanHint() {
  const routines = useRoutines();
  const profile = useProfile();
  const needs = routines.data?.items.reduce((total, routine) => total + routine.items.length, 0);
  const hasLocation = Boolean(profile.data && (profile.data.latitude || profile.data.city));
  return (
    <EmptyState title="Todavía no generaste un plan">
      <p>Para que el plan tenga sentido necesitamos dos cosas:</p>
      <ul className="plan-checklist">
        <li className={needs ? 'is-done' : undefined}>
          {needs ? '✓ ' : ''}Tus productos habituales{' '}
          {!needs && <Link className="text-link" href="/mis-compras">Cargarlos</Link>}
        </li>
        <li className={hasLocation ? 'is-done' : undefined}>
          {hasLocation ? '✓ ' : ''}Tu zona, para elegir sucursales cerca{' '}
          {!hasLocation && <Link className="text-link" href="/preferencias">Cargarla</Link>}
        </li>
      </ul>
    </EmptyState>
  );
}

function PlanDetail({ plan, focusOnMount, onFocused }: { plan: ShoppingPlanDto; focusOnMount: boolean; onFocused: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const updateStatus = useUpdatePlanStatus();
  const lines = plan.schedule.flatMap((day) => day.visits.flatMap((visit) => visit.lines));
  const isDemo = lines.some((line) => line.priceSource === 'demo-seed');

  useEffect(() => {
    if (!focusOnMount) return;
    heading.current?.focus();
    onFocused();
  }, [focusOnMount, onFocused]);

  return (
    <section className="plan-detail" aria-labelledby="plan-title">
      <div className="plan-header">
        <div>
          <h2 id="plan-title" ref={heading} tabIndex={-1} className="plan-title">
            Plan {period(plan)}
          </h2>
          <p className="muted">
            Generado el {timestampFormat.format(new Date(plan.generatedAt))}
            {plan.prices && <> · precios observados entre el {formatDate(plan.prices.oldestObservedAt)} y el {formatDate(plan.prices.newestObservedAt)}</>}
          </p>
        </div>
        <span className={`plan-status plan-status-${plan.status.toLowerCase()}`}>{STATUS_LABEL[plan.status]}</span>
      </div>

      {isDemo && <DemoNotice />}
      <PlanTotals plan={plan} />
      <PlanActions plan={plan} pending={updateStatus.isPending} error={updateStatus.error?.message ?? null}
        onChange={(status) => updateStatus.mutate({ planId: plan.id, body: { status } })} />

      {plan.schedule.length > 0 && (
        <div className="plan-schedule">
          <h3 className="subsection-title">Cuándo y dónde comprar</h3>
          {plan.schedule.map((day) => <ScheduleDay key={day.date} day={day} />)}
        </div>
      )}

      {plan.unfulfilled.length > 0 && (
        <div className="plan-block plan-missing">
          <h3 className="subsection-title">No pudimos incluir</h3>
          <ul className="plan-notes">
            {plan.unfulfilled.map((need) => (
              <li key={need.canonicalProductId}>
                <strong>{need.canonicalName}</strong> ({formatQuantity(need.netQuantity, need.unit)}):{' '}
                {UNFULFILLED_LABEL[need.reason] ?? 'No encontramos una opción.'}
                {need.reason === 'NO_LOCATION' && <> <Link className="text-link" href="/preferencias">Ir a Preferencias</Link></>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.coveredByInventory.length > 0 && (
        <div className="plan-block">
          <h3 className="subsection-title">No hace falta comprar</h3>
          <ul className="plan-notes">
            {plan.coveredByInventory.map((need) => (
              <li key={need.canonicalProductId}>
                <strong>{need.canonicalName}</strong>: lo que tenés en la despensa alcanza para{' '}
                {formatQuantity(need.grossQuantity, need.unit)}.
              </li>
            ))}
          </ul>
        </div>
      )}

      <Notices title="Tené en cuenta" notices={[...plan.warnings, ...plan.limitations]} />

      {plan.benefits && plan.lineCount > 0 && <BenefitCriteria benefits={plan.benefits} schedule={plan.schedule} />}

      {plan.needs.length > 0 && (
        <details className="plan-block plan-how">
          <summary>Cómo calculamos cuánto comprar</summary>
          <ul className="plan-notes">
            {plan.needs.map((need) => (
              <li key={need.canonicalProductId}>
                <strong>{need.canonicalName}</strong>:{' '}
                {need.sources.map((source) => `${formatQuantity(source.quantity, need.unit)} de "${source.routineName}" (${plural(source.occurrences.length, 'vez', 'veces')} en el período)`).join(' + ')}
                {need.inventorySubtracted && isPositive(need.inventorySubtracted) && <> − {formatQuantity(need.inventorySubtracted, need.unit)} de tu despensa</>}
                {' '}= <strong>{formatQuantity(need.netQuantity, need.unit)}</strong>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function PlanTotals({ plan }: { plan: ShoppingPlanDto }) {
  const { totals, savings } = plan;
  const penalties = Number(totals.storeVisitPenaltyCost) + Number(totals.distancePenaltyCost);
  const saved = savings ? Number(savings.estimatedSavings) : 0;
  const hasRefund = isPositive(totals.refundEstimated);
  const hasPayment = isPositive(totals.paymentDiscount);
  return (
    <div className="plan-totals surface">
      <dl className="plan-figures">
        <div>
          <dt>{hasPayment || hasRefund ? 'Pagás en las cajas' : 'Productos'}</dt>
          <dd className="plan-figure-main">{formatArs(totals.payToday)}</dd>
        </div>
        {hasRefund && (
          <div className="plan-refund">
            <dt>Reintegro estimado</dt>
            <dd className="plan-figure-main">{formatArs(totals.refundEstimated)}</dd>
          </div>
        )}
        {hasRefund && (
          <div>
            <dt>Costo después del reintegro</dt>
            <dd>{formatArs(totals.costAfterRefund)}</dd>
          </div>
        )}
        {savings && saved > 0 && (
          <div className="plan-savings">
            <dt>Ahorro estimado</dt>
            <dd className="plan-figure-main">{formatArs(savings.estimatedSavings)}</dd>
          </div>
        )}
        <div>
          <dt>Visitas</dt>
          <dd>{plural(totals.visitCount, 'visita', 'visitas')} · {plural(totals.storeCount, 'sucursal', 'sucursales')}</dd>
        </div>
        {totals.totalDistanceKm && (
          <div>
            <dt>Recorrido estimado</dt>
            <dd>{kmFormat.format(Number(totals.totalDistanceKm))} km ida y vuelta</dd>
          </div>
        )}
      </dl>
      {hasRefund && (
        <p className="muted plan-savings-note">
          El reintegro lo devuelve el banco o la billetera después de la compra: no baja lo que pagás en la caja y no lo
          contamos como ahorro.
        </p>
      )}
      {savings && saved > 0 && (
        <p className="muted plan-savings-note">
          Frente a comprar todo en {savings.baselineStoreName} a precio regular ({formatArs(savings.baselineProductCost)}).
          {isPositive(totals.promotionDiscount) && <> Incluye {formatArs(totals.promotionDiscount)} de promociones.</>}
          {hasPayment && <> Incluye {formatArs(totals.paymentDiscount)} de descuentos por medio de pago en la caja.</>}
          {' '}Es una estimación con los últimos precios observados, no un ahorro confirmado.
        </p>
      )}
      {savings && saved <= 0 && (
        <p className="muted plan-savings-note">
          {saved === 0
            ? `Comprar todo en ${savings.baselineStoreName} a precio regular cuesta lo mismo en productos.`
            : `Cuesta ${formatArs(String(-saved))} más en productos que comprar todo en ${savings.baselineStoreName}, a cambio de menos visitas, menos distancia o un reintegro.`}
        </p>
      )}
      {!savings && plan.lineCount > 0 && (
        <p className="muted plan-savings-note">No mostramos ahorro: ninguna sucursal tiene todo lo del plan para comparar.</p>
      )}
      {isPositive(totals.conditionalAmount) && (
        <p className="plan-conditional-note">
          Podrías ahorrar hasta {formatArs(totals.conditionalAmount)} más con beneficios que dependen de datos que no
          informaste. No está sumado.{' '}
          <Link className="text-link" href="/preferencias#medios-de-pago">Completar en Preferencias</Link>
        </p>
      )}
      {penalties > 0 && (
        <p className="muted plan-savings-note">
          Para elegir tuvimos en cuenta {formatArs(String(penalties))} de costo de conveniencia (visitas y distancia según tus
          preferencias). No es dinero que pagás.
        </p>
      )}
    </div>
  );
}

function PlanActions({ plan, pending, error, onChange }: {
  plan: ShoppingPlanDto;
  pending: boolean;
  error: string | null;
  onChange: (status: 'ACTIVE' | 'COMPLETED') => void;
}) {
  if (plan.coverage === 'EMPTY' || plan.lineCount === 0) return null;
  return (
    <div className="plan-actions">
      {plan.status === 'DRAFT' && (
        <button type="button" className="secondary-button" disabled={pending} onClick={() => onChange('ACTIVE')}>
          Usar este plan
        </button>
      )}
      {(plan.status === 'DRAFT' || plan.status === 'ACTIVE') && (
        <button type="button" className="secondary-button" disabled={pending} onClick={() => onChange('COMPLETED')}>
          Ya hice esta compra
        </button>
      )}
      <p className="muted" role="status">
        {plan.status === 'ACTIVE' && 'Este es tu plan en uso para estos días. '}
        {plan.status === 'COMPLETED' && plan.completedAt && `Marcado como hecho el ${formatDate(plan.completedAt)}. `}
        {plan.status === 'EXPIRED' && 'Este plan ya venció: generá uno nuevo. '}
        {(plan.status === 'DRAFT' || plan.status === 'ACTIVE') && 'Marcarlo como hecho no descuenta tu despensa ni confirma el ahorro.'}
      </p>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

function ScheduleDay({ day }: { day: PlanScheduleDayDto }) {
  return (
    <div className="plan-day">
      <h4 className="plan-day-title">{capitalize(dayFormat.format(calendar(day.date)))}</h4>
      {day.visits.map((visit) => (
        <div key={visit.storeId} className="plan-visit surface">
          <div className="plan-visit-header">
            <div>
              <p className="plan-store">{visit.storeName}</p>
              <p className="muted">
                {visit.chainName}
                {visit.roundTripKm && <> · {kmFormat.format(Number(visit.roundTripKm))} km ida y vuelta</>}
              </p>
            </div>
            <p className="plan-visit-subtotal">{formatArs(visit.payToday)}</p>
          </div>
          <ul className="plan-lines">
            {visit.lines.map((line) => <PlanLine key={line.id} line={line} />)}
          </ul>
          <VisitPayment visit={visit} />
        </div>
      ))}
    </div>
  );
}

const NOTE_STATUS_LABEL: Record<PlanBenefitNoteDto['status'], string> = {
  CONDITIONAL: 'Depende de un dato tuyo',
  NOT_ELIGIBLE: 'No corresponde',
  NOT_CHOSEN: 'No elegido',
};

/** Pago de la visita: subtotal, beneficio aplicado con sus condiciones y lo que no se sumó. */
function VisitPayment({ visit }: { visit: PlanScheduleVisitDto }) {
  const { payment, benefitNotes } = visit;
  const conditional = benefitNotes.filter((note) => note.status === 'CONDITIONAL');
  const others = benefitNotes.filter((note) => note.status !== 'CONDITIONAL');
  if (!payment && !benefitNotes.length) return null;
  return (
    <div className="plan-payment">
      {payment && (
        <dl className="plan-payment-figures">
          <div>
            <dt>Productos</dt>
            <dd>{formatArs(visit.subtotal)}</dd>
          </div>
          {payment.timing === 'IMMEDIATE' && (
            <div>
              <dt>Descuento en la caja</dt>
              <dd>− {formatArs(visit.paymentDiscount)}</dd>
            </div>
          )}
          <div className="plan-payment-total">
            <dt>Pagás en la caja</dt>
            <dd>{formatArs(visit.payToday)}</dd>
          </div>
          {payment.timing === 'REFUND' && (
            <div>
              <dt>Reintegro estimado{payment.refundDelayDays ? ` (en ${payment.refundDelayDays} días)` : ''}</dt>
              <dd>{formatArs(visit.refundEstimated)}</dd>
            </div>
          )}
        </dl>
      )}
      {payment && (
        <div className="payment-applied">
          <p>
            <span className="benefit-badge">PAGO</span> <strong>{payment.name}</strong>
          </p>
          <p className="benefit-conditions">
            {formatConditions(payment.conditions)}
            {payment.cap && payment.cap.remaining !== null && !payment.cap.periodKey.startsWith('purchase:') && (
              <> · saldo del tope ({formatCapPeriodKey(payment.cap.periodKey).toLowerCase()}) antes de esta compra: {formatArs(payment.cap.remaining)}</>
            )}
          </p>
        </div>
      )}
      {conditional.length > 0 && (
        <ul className="plan-benefit-notes">
          {conditional.map((note) => <BenefitNote key={`${note.promotionId}-${note.canonicalProductId ?? ''}`} note={note} />)}
        </ul>
      )}
      {others.length > 0 && (
        <details className="plan-alternatives">
          <summary>Otros beneficios en esta compra ({others.length})</summary>
          <ul className="plan-benefit-notes">
            {others.map((note) => <BenefitNote key={`${note.promotionId}-${note.canonicalProductId ?? ''}`} note={note} />)}
          </ul>
        </details>
      )}
    </div>
  );
}

function BenefitNote({ note }: { note: PlanBenefitNoteDto }) {
  const reason = formatBenefitReason(note.reason);
  return (
    <li className={`plan-benefit-note is-${note.status.toLowerCase()}`}>
      <p>
        <strong>{NOTE_STATUS_LABEL[note.status]}:</strong> {note.name}
        {note.amount && isPositive(note.amount) && <> (hasta {formatArs(note.amount)})</>}
      </p>
      <p className="muted">{formatConditions(note.conditions)}</p>
      {reason && (
        <p className="muted">
          {reason}
          {isFixableInPreferences(note.reason) && (
            <> <Link className="text-link" href="/preferencias#medios-de-pago">Informarlo</Link></>
          )}
        </p>
      )}
    </li>
  );
}

/** Con qué se evaluaron los beneficios: lo declarado, los topes y los criterios, tal como los manda la API. */
function BenefitCriteria({ benefits, schedule }: { benefits: PlanBenefitsSummaryDto; schedule: PlanScheduleDayDto[] }) {
  // Cada tope se nombra con las promociones del plan que lo usan; uno por compra, con su visita.
  const visits = schedule.flatMap((day) => day.visits.map((visit) => ({ date: day.date, visit })));
  const namesByCap = new Map<string, Set<string>>();
  for (const { visit } of visits) {
    const sources = [
      ...(visit.payment?.cap ? [{ key: visit.payment.cap.key, name: visit.payment.name }] : []),
      ...visit.benefitNotes.flatMap((note) => (note.cap ? [{ key: note.cap.key, name: note.name }] : [])),
    ];
    for (const source of sources) namesByCap.set(source.key, (namesByCap.get(source.key) ?? new Set()).add(source.name));
  }
  const purchaseLabel = (periodKey: string): string => {
    const [date, storeId] = periodKey.slice('purchase:'.length).split('|');
    const found = visits.find((entry) => entry.date === date && entry.visit.storeId === storeId);
    return found ? `la compra del ${shortFormat.format(calendar(found.date))} en ${found.visit.storeName}` : 'esa compra';
  };
  return (
    <details className="plan-block plan-benefit-criteria">
      <summary>Cómo tuvimos en cuenta tus medios de pago</summary>
      <ul className="plan-notes">
        {benefits.criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}
      </ul>
      {benefits.caps.length > 0 && (
        <>
          <h4 className="plan-day-title">Topes que usa este plan</h4>
          <ul className="plan-notes">
            {benefits.caps.map((cap) => {
              const names = [...(namesByCap.get(cap.key) ?? [])].join(' · ') || 'Beneficio con tope';
              if (cap.periodKey.startsWith('purchase:')) {
                return (
                  <li key={`${cap.key}-${cap.periodKey}`}>
                    <strong>{names}</strong>: tope de {formatArs(cap.limit)} por compra; en {purchaseLabel(cap.periodKey)} usa{' '}
                    {formatArs(cap.usedHere)}.
                  </li>
                );
              }
              return (
                <li key={`${cap.key}-${cap.periodKey}`}>
                  <strong>{names}</strong> ({formatCapPeriodKey(cap.periodKey).toLowerCase()}): tope de {formatArs(cap.limit)}; este plan
                  usa {formatArs(cap.usedHere)}
                  {cap.consumedOutside === null
                    ? ' y no informaste cuánto usaste fuera de la app.'
                    : ` y ya usaste ${formatArs(cap.consumedOutside)} fuera de la app.`}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="muted">
        <Link className="text-link" href="/preferencias#medios-de-pago">Cambiar medios de pago y topes usados</Link>
      </p>
    </details>
  );
}

function quantityText(line: PlanLineDto): string {
  if (line.quantityIsEstimate) return `Unos ${formatQuantity(line.quantity, line.unit)} (se pesa en la caja)`;
  const packages = line.packageCount ?? 1;
  return `${plural(packages, 'envase', 'envases')} · ${formatQuantity(line.quantity, line.unit)} en total`;
}

function PlanLine({ line }: { line: PlanLineDto }) {
  return (
    <li className="plan-line">
      <div className="plan-line-main">
        <p className="plan-line-name">{line.canonicalName}</p>
        <p className="plan-line-product">
          {line.productName}
          {line.matchType === 'EXACT' && <span className="match-badge match-exact">Tu elección</span>}
        </p>
        <p className="plan-line-quantity">{quantityText(line)}</p>
        {isPositive(line.surplus) && (
          <p className="muted">Te sobran {formatQuantity(line.surplus, line.unit)} por el tamaño del envase.</p>
        )}
        <p className="plan-line-reason">{line.reason}</p>
        {line.alternatives.length > 0 && (
          <details className="plan-alternatives">
            <summary>Otras opciones</summary>
            <ul>
              {line.alternatives.map((alternative) => (
                <li key={`${alternative.offerId}-${alternative.date}`}>
                  {alternative.productName} en {alternative.storeName} ({shortFormat.format(calendar(alternative.date))}):{' '}
                  {formatArs(alternative.total)}
                  {Number(alternative.difference) > 0 && <> · {formatArs(alternative.difference)} más</>}
                  {Number(alternative.difference) < 0 && <> · {formatArs(String(-Number(alternative.difference)))} menos</>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <div className="plan-line-prices">
        <p className="plan-line-price">{formatArs(line.price)}</p>
        {isPositive(line.discount) && <p className="plan-line-regular"><s>{formatArs(line.regularPrice)}</s></p>}
        {line.promotion && <p className="promotion-chip"><span>PROMO</span>{line.promotion.name}</p>}
        <p className="muted">Precio del {formatDate(line.priceObservedAt)}</p>
      </div>
    </li>
  );
}

function Notices({ title, notices }: { title: string; notices: PlanNoticeDto[] }) {
  if (!notices.length) return null;
  return (
    <div className="plan-block plan-notices">
      <h3 className="subsection-title">{title}</h3>
      <ul className="plan-notes">
        {notices.map((notice) => <li key={notice.code}>{notice.message}</li>)}
      </ul>
    </div>
  );
}

function PlanHistory({ plans, selectedId }: { plans: ShoppingPlanSummaryDto[]; selectedId: string | null }) {
  return (
    <section className="plan-history" aria-labelledby="plan-history-title">
      <h2 id="plan-history-title" className="subsection-title">Planes anteriores</h2>
      <ul className="plan-history-list">
        {plans.map((entry) => (
          <li key={entry.id}>
            <Link
              className="plan-history-link"
              href={`/plan-semanal?plan=${entry.id}`}
              aria-current={entry.id === selectedId ? 'page' : undefined}
            >
              <span>Plan {period(entry)}</span>
              <span className="muted">
                {STATUS_LABEL[entry.status]} · {formatArs(entry.optimizedCost)}
                {entry.refundEstimated && isPositive(entry.refundEstimated) && <> + reintegro de {formatArs(entry.refundEstimated)}</>}
                {' '}· generado el{' '}
                {timestampFormat.format(new Date(entry.generatedAt))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
