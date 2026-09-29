'use client';

import type { DashboardDto, OpportunityDto, SavingsBucketDto } from '@tusofertas/shared';
import { Surface } from '@tusofertas/ui';
import Link from 'next/link';
import { useDashboard } from '../../lib/dashboard/queries';
import { formatArs, formatDistance, formatUnitPrice } from '../../lib/format';
import { ErrorState, LoadingState } from '../common/states';

// Fechas de calendario: se leen al mediodía UTC para que ninguna zona las corra de día.
const calendar = (date: string) => new Date(`${date}T12:00:00.000Z`);
const dayFormat = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const shortFormat = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const percentFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Resumen privado (P6-02): próxima compra, ahorro **estimado** sin contar dos veces el
 * mismo período, oportunidades en los productos habituales y compras habituales.
 * No hay registro de compras: el ahorro real no se completa con estimaciones.
 */
export function DashboardView() {
  const dashboard = useDashboard();
  return (
    <div className="account-page dashboard-page">
      <p className="eyebrow"><span className="status-dot" /> RESUMEN</p>
      <h1 className="page-title">Tu semana de compras</h1>
      <p className="page-lead">
        Qué te toca comprar, cuánto estimamos que ahorrás siguiendo tus planes y qué productos habituales están más
        baratos que de costumbre cerca tuyo.
      </p>
      {dashboard.isPending && <LoadingState label="Cargando tu resumen…" />}
      {dashboard.isError && <ErrorState message={dashboard.error.message} onRetry={() => void dashboard.refetch()} />}
      {dashboard.data && (
        <div className="dashboard-grid">
          <NextPurchase data={dashboard.data} />
          <Savings data={dashboard.data} />
          <Opportunities data={dashboard.data} />
          <Surface className="account-card">
            <h2>Tus compras habituales</h2>
            <p className="account-figure">
              {dashboard.data.routines.itemCount === 0
                ? 'Todavía no cargaste productos'
                : `${plural(dashboard.data.routines.itemCount, 'producto', 'productos')} en ${plural(dashboard.data.routines.routineCount, 'lista', 'listas')}`}
            </p>
            <Link className="text-link" href="/mis-compras">
              {dashboard.data.routines.itemCount ? 'Ver y editar' : 'Cargar lo que comprás'}
            </Link>
          </Surface>
        </div>
      )}
    </div>
  );
}

function NextPurchase({ data }: { data: DashboardDto }) {
  const next = data.nextPurchase;
  return (
    <Surface className="account-card dashboard-next">
      <h2>Próxima compra</h2>
      {!next ? (
        <>
          <p className="muted">No tenés un plan para estos días.</p>
          <p className="account-card-foot"><Link className="primary-link" href="/plan-semanal">Generar mi plan</Link></p>
        </>
      ) : (
        <>
          <p className="account-figure">{capitalize(dayFormat.format(calendar(next.date)))}</p>
          {next.dateHasPassed && (
            <p className="field-error">Los días previstos de este plan ya pasaron: generá uno nuevo con precios actuales.</p>
          )}
          <ul className="dashboard-visits">
            {next.visits.map((visit) => (
              <li key={visit.storeId}>
                <span>{visit.storeName.replace(/ \(DEMO\)$/, '')} · {plural(visit.lineCount, 'producto', 'productos')}</span>
                <strong>{formatArs(visit.subtotal)}</strong>
              </li>
            ))}
          </ul>
          <p className="muted">
            {next.status === 'ACTIVE' ? 'De tu plan en uso' : 'De tu último plan (borrador: todavía no lo elegiste)'} del{' '}
            {shortFormat.format(calendar(next.startDate))} al {shortFormat.format(calendar(next.endDate))}.
          </p>
          <p className="account-card-foot">
            <Link className="text-link" href={`/plan-semanal?plan=${next.planId}`}>Ver el plan completo</Link>
          </p>
        </>
      )}
    </Surface>
  );
}

function SavingsFigure({ label, bucket }: { label: string; bucket: SavingsBucketDto }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <span className="dashboard-amount">{formatArs(bucket.amount)}</span>
        <span className="muted"> {bucket.plans ? plural(bucket.plans, 'plan', 'planes') : 'sin planes'}</span>
      </dd>
    </div>
  );
}

function Savings({ data }: { data: DashboardDto }) {
  const { estimated, registered } = data.savings;
  return (
    <Surface className="account-card dashboard-savings">
      <h2>Ahorro estimado</h2>
      <dl className="dashboard-figures">
        <SavingsFigure label="Esta semana" bucket={estimated.week} />
        <SavingsFigure label="Este mes" bucket={estimated.month} />
        <SavingsFigure label="Acumulado" bucket={estimated.total} />
      </dl>
      <p className="muted">
        Contamos un plan por período: el que usaste o marcaste como hecho. Los borradores y los planes reemplazados no suman.
        Es la diferencia estimada frente a comprar todo en una sola sucursal a precio regular.
        {estimated.plansWithoutBaseline > 0 &&
          ` ${plural(estimated.plansWithoutBaseline, 'plan no suma', 'planes no suman')} porque no hubo con qué comparar.`}
      </p>
      <p className="dashboard-registered"><strong>Ahorro registrado:</strong> {registered.message}</p>
    </Surface>
  );
}

const OPPORTUNITY_LABEL: Record<OpportunityDto['classification'], string> = {
  HISTORIC_LOW: 'El más bajo en 30 días',
  GOOD_DEAL: 'Buena oferta',
};

function Opportunities({ data }: { data: DashboardDto }) {
  const { items, unavailableReason } = data.opportunities;
  return (
    <Surface className="account-card dashboard-opportunities">
      <h2>Oportunidades en tus productos</h2>
      {unavailableReason === 'NO_ROUTINES' && (
        <p className="muted">Cargá tus productos habituales para ver cuándo están más baratos. <Link className="text-link" href="/mis-compras">Cargarlos</Link></p>
      )}
      {unavailableReason === 'NO_LOCATION' && (
        <p className="muted">Necesitamos tu zona para mirar precios cerca tuyo. <Link className="text-link" href="/preferencias">Cargarla</Link></p>
      )}
      {unavailableReason === 'NO_STORES_IN_SCOPE' && (
        <p className="muted">No hay sucursales dentro de tu zona. Probá ampliar la distancia en <Link className="text-link" href="/preferencias">Preferencias</Link>.</p>
      )}
      {!unavailableReason && items.length === 0 && (
        <p className="muted">Hoy ningún producto habitual está notablemente más barato que su promedio en las sucursales cercanas.</p>
      )}
      {items.length > 0 && (
        <ul className="dashboard-opportunity-list">
          {items.map((item) => {
            const below = percentFormat.format((1 - Number(item.ratioToAverage)) * 100);
            const distance = formatDistance(item.store.distanceMeters);
            return (
              <li key={`${item.productId}-${item.store.id}`}>
                <Link className="dashboard-opportunity" href={`/producto/${item.productId}?sucursal=${item.store.id}`}>
                  <span className="history-badge">{OPPORTUNITY_LABEL[item.classification]}</span>
                  <span className="dashboard-opportunity-name">{item.productName}</span>
                  <span className="muted">
                    {item.store.chainName} · {item.store.name.replace(/ \(DEMO\)$/, '')}{distance ? ` · ${distance}` : ''}
                  </span>
                  <span>
                    <strong>{formatUnitPrice(item.unitPrice, item.unitPriceUnit)}</strong>
                    <span className="muted"> · {below}% menos que su promedio de 30 días</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted dashboard-note">Comparamos el último precio de cada sucursal con sus 30 días anteriores; los precios viejos o con pocos datos no se muestran.</p>
    </Surface>
  );
}
