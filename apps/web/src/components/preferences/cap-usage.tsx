'use client';

import type { BenefitUsageEntryDto, PromotionDto } from '@tusofertas/shared';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { formatCapPeriodKey, formatConditions } from '../../lib/benefits/format';
import { capKeyOf, hasTrackableCap, useBenefitUsage, useConditionedPromotions, useForgetUsage, useInformUsage } from '../../lib/benefits/queries';
import { formatArs } from '../../lib/format';
import { describedBy, FieldError } from '../account/form-parts';
import { ErrorState, LoadingState } from '../common/states';

/**
 * Lo ya usado de cada tope fuera de la app (P10-02, `PUT /benefit-usage`). Sin ese dato el
 * saldo es desconocido y el beneficio queda condicionado: nunca prometemos el reintegro completo.
 */

interface CapGroup {
  key: string;
  promotions: PromotionDto[];
  limit: string;
  capPeriod: 'WEEK' | 'MONTH' | 'CAMPAIGN';
}

/** Día argentino (AAAA-MM-DD): el período de un tope se cuenta en hora argentina, como la API. */
function argentineToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(now);
}

/** Semana ISO del día (misma regla que `isoWeekKey` de la API). */
function isoWeekKey(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(year, month - 1, day));
  const weekday = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
  const weekYear = utc.getUTCFullYear();
  const week = Math.ceil(((utc.getTime() - Date.UTC(weekYear, 0, 1)) / 86_400_000 + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

function currentPeriodKey(capPeriod: CapGroup['capPeriod'], today: string): string {
  if (capPeriod === 'WEEK') return isoWeekKey(today);
  if (capPeriod === 'MONTH') return today.slice(0, 7);
  return 'CAMPAIGN';
}

/** Importe con coma o punto decimal y sin separador de miles; acepta cero. */
function parseAmount(text: string): string | null {
  const value = text.trim().replace(/\s|\$/g, '');
  if (!/^\d{1,12}([.,]\d{1,2})?$/.test(value)) return null;
  return Number(value.replace(',', '.')).toFixed(2);
}

export function CapUsageSection() {
  const promotions = useConditionedPromotions();
  const usage = useBenefitUsage();
  const groups = useMemo(() => {
    const byKey = new Map<string, CapGroup>();
    for (const promotion of (promotions.data ?? []).filter(hasTrackableCap)) {
      const key = capKeyOf(promotion);
      const group = byKey.get(key);
      if (group) group.promotions.push(promotion);
      else {
        byKey.set(key, {
          key,
          promotions: [promotion],
          limit: promotion.conditions.discountCap as string,
          capPeriod: promotion.conditions.capPeriod as CapGroup['capPeriod'],
        });
      }
    }
    return [...byKey.values()].sort((a, b) => a.promotions[0]!.name.localeCompare(b.promotions[0]!.name, 'es'));
  }, [promotions.data]);

  return (
    <section className="preferences-form surface cap-usage" aria-labelledby="cap-usage-title" id="topes-usados">
      <div>
        <h2 id="cap-usage-title" className="subsection-title">Topes de beneficios ya usados</h2>
        <p className="field-hint">
          Algunos bancos ponen un tope por semana o por mes. Si ya compraste con ese beneficio en otro lado, contanos cuánto
          usaste: sin ese dato el beneficio figura como condicionado y no lo sumamos.
        </p>
      </div>
      {(promotions.isPending || usage.isPending) && <LoadingState label="Cargando los topes…" />}
      {promotions.isError && <ErrorState message={promotions.error.message} onRetry={() => promotions.refetch()} />}
      {usage.isError && <ErrorState message={usage.error.message} onRetry={() => usage.refetch()} />}
      {promotions.data && usage.data && !groups.length && (
        <p className="muted">Ahora no hay promociones vigentes con tope por semana o por mes.</p>
      )}
      {promotions.data && usage.data && groups.length > 0 && (
        <ul className="cap-usage-list">
          {groups.map((group) => <CapUsageRow key={group.key} group={group} entries={usage.data.items} />)}
        </ul>
      )}
    </section>
  );
}

function CapUsageRow({ group, entries }: { group: CapGroup; entries: BenefitUsageEntryDto[] }) {
  const id = useId();
  const inform = useInformUsage();
  const forget = useForgetUsage();
  const periodKey = currentPeriodKey(group.capPeriod, argentineToday());
  const entry = entries.find((item) => item.capKey === group.key && item.periodKey === periodKey) ?? null;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const promotion = group.promotions[0] as PromotionDto;
  const period = formatCapPeriodKey(periodKey);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(null);
    const consumed = parseAmount(draft);
    if (consumed === null) return setError('Escribí un importe, por ejemplo 2000 o 1500,50.');
    if (Number(consumed) > Number(group.limit)) return setError(`No puede ser más que el tope (${formatArs(group.limit)}).`);
    setError(null);
    try {
      const result = await inform.mutateAsync({ promotionId: promotion.id, body: { consumed } });
      setDraft('');
      setSaved(`Guardado: te quedan ${formatArs(result.remaining)} de este tope.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No pudimos guardar.');
    }
  }

  async function unknown() {
    setSaved(null);
    setError(null);
    try {
      await forget.mutateAsync(promotion.id);
      setSaved('Listo: queda como no informado.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No pudimos borrar.');
    }
  }

  const pending = inform.isPending || forget.isPending;
  return (
    <li className="cap-usage-row">
      <p className="cap-usage-name">{group.promotions.map((item) => item.name).join(' · ')}</p>
      <p className="benefit-conditions">
        {formatConditions({
          type: promotion.type,
          discountPercentage: promotion.discountPercentage,
          discountAmount: promotion.discountAmount,
          paymentMethod: promotion.conditions.paymentMethod,
          bank: promotion.conditions.bank,
          membershipProgram: promotion.conditions.membershipProgram,
          eligibleWeekdays: promotion.conditions.eligibleWeekdays,
          minimumSpend: promotion.conditions.minimumSpend,
          discountCap: promotion.conditions.discountCap,
          capPeriod: promotion.conditions.capPeriod,
          timing: promotion.benefit.timing,
          refundDelayDays: promotion.benefit.refundDelayDays,
          stackable: promotion.stackable,
        })}
        {group.promotions.length > 1 && ' · tope compartido entre estas promociones'}
      </p>
      <p className="cap-usage-status">
        {entry
          ? <>{period}: informaste {formatArs(entry.consumed)} usados de {formatArs(group.limit)}.</>
          : <>{period}: no informado. Los beneficios con este tope quedan condicionados.</>}
      </p>
      <form className="cap-usage-form" noValidate onSubmit={submit} aria-busy={pending}>
        <div className="field">
          <label htmlFor={`${id}-amount`}>Ya usé en {period.toLowerCase()} ($)</label>
          <input
            id={`${id}-amount`}
            inputMode="decimal"
            autoComplete="off"
            value={draft}
            placeholder={entry ? entry.consumed.replace('.', ',') : '0'}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(error && `${id}-error`)}
            onChange={(event) => { setDraft(event.target.value); setError(null); }}
          />
        </div>
        <button type="submit" className="secondary-button" disabled={pending}>Guardar</button>
        {entry && (
          <button type="button" className="text-button" disabled={pending} onClick={unknown}>
            No sé cuánto usé
          </button>
        )}
      </form>
      <FieldError id={`${id}-error`} message={error ?? undefined} />
      <p className="success-note" role="status">{saved ?? ''}</p>
    </li>
  );
}
