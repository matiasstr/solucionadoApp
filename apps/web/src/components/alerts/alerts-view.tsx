'use client';

import type { NotificationDto, PriceAlertDto } from '@tusofertas/shared';
import { Surface } from '@tusofertas/ui';
import Link from 'next/link';
import { useState } from 'react';
import { daysSince, describeAlert, describeScope, OUTCOME_LABEL } from '../../lib/alerts/format';
import { useAlerts, useDeleteAlert, useMarkNotificationRead, useNotifications, useUpdateAlert } from '../../lib/alerts/queries';
import { formatArs, formatDate, formatDistance, formatUnitPrice } from '../../lib/format';
import { FormAlert } from '../account/form-parts';
import { EmptyState, ErrorState, LoadingState, StaleBadge } from '../common/states';

/** Un precio de un aviso con más de estos días ya puede haber cambiado. */
const MAY_HAVE_CHANGED_DAYS = 2;
const dateTime = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Alertas y avisos (P9-02): la bandeja con lo que avisamos y las alertas que la persona
 * administra. El único canal es esta pantalla (y el resumen): no se simula un email.
 */
export function AlertsView() {
  return (
    <div className="account-page alerts-page">
      <p className="eyebrow"><span className="status-dot" /> ALERTAS</p>
      <h1 className="page-title">Alertas de precio</h1>
      <p className="page-lead">
        Te avisamos acá cuando un producto que seguís llega a tu precio o está más barato que de costumbre cerca tuyo.
        Revisamos las alertas cuando procesamos precios nuevos; no enviamos emails ni mensajes al celular.
      </p>
      <Inbox />
      <Rules />
    </div>
  );
}

function Inbox() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const notifications = useNotifications(unreadOnly);
  const markRead = useMarkNotificationRead();
  const items = notifications.data?.pages.flatMap((page) => page.items) ?? [];
  const unreadCount = notifications.data?.pages[0]?.unreadCount ?? 0;
  return (
    <section className="alerts-section" aria-labelledby="inbox-title">
      <div className="alerts-section-head">
        <h2 id="inbox-title">Avisos {unreadCount > 0 && <span className="count-badge">{unreadCount} sin leer</span>}</h2>
        <label className="check-field">
          <input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />
          <span>Solo sin leer</span>
        </label>
      </div>
      {notifications.isPending && <LoadingState label="Cargando tus avisos…" />}
      {notifications.isError && <ErrorState message={notifications.error.message} onRetry={() => void notifications.refetch()} />}
      {notifications.isSuccess && items.length === 0 && (
        <EmptyState title={unreadOnly ? 'No tenés avisos sin leer' : 'Todavía no hay avisos'}>
          <p>Cuando una alerta se cumpla, el aviso va a aparecer acá y en tu resumen.</p>
        </EmptyState>
      )}
      {markRead.isError && <FormAlert message={markRead.error.message} />}
      {items.length > 0 && (
        <ul className="notification-list" aria-live="polite">
          {items.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onRead={() => markRead.mutate(notification.id)}
              busy={markRead.isPending && markRead.variables === notification.id}
            />
          ))}
        </ul>
      )}
      {notifications.hasNextPage && (
        <button type="button" className="secondary-button" onClick={() => void notifications.fetchNextPage()} disabled={notifications.isFetchingNextPage}>
          {notifications.isFetchingNextPage ? 'Cargando…' : 'Ver avisos anteriores'}
        </button>
      )}
    </section>
  );
}

function NotificationItem({ notification, onRead, busy }: { notification: NotificationDto; onRead(): void; busy: boolean }) {
  const { data } = notification;
  const age = daysSince(data.observedAt);
  const distance = formatDistance(data.store.distanceMeters);
  const unread = notification.readAt === null;
  return (
    <li className={unread ? 'notification-item is-unread' : 'notification-item'}>
      <div className="notification-head">
        <p className="notification-title">
          {unread && <span className="new-badge">Nuevo</span>}
          {notification.title}
        </p>
        <time className="muted" dateTime={notification.createdAt}>{dateTime.format(new Date(notification.createdAt))}</time>
      </div>
      <p className="notification-price">
        <strong>{formatArs(data.price)}</strong> · {formatUnitPrice(data.unitPrice, data.unitPriceUnit)} · {data.store.name.replace(/ \(DEMO\)$/, '')}
        {distance ? ` (${distance})` : ''}
      </p>
      <p className="notification-message">{notification.message}</p>
      {age >= MAY_HAVE_CHANGED_DAYS && (
        <p className="field-hint">
          Precio del {formatDate(data.observedAt)}: puede haber cambiado. {age > 7 && <StaleBadge ageDays={age} />}
        </p>
      )}
      <div className="notification-actions">
        <Link className="text-link" href={notification.link}>Ver el producto y sus precios actuales</Link>
        {unread && (
          <button type="button" className="secondary-button" onClick={onRead} disabled={busy}>
            {busy ? 'Marcando…' : 'Marcar como leído'}
          </button>
        )}
      </div>
    </li>
  );
}

function Rules() {
  const alerts = useAlerts();
  return (
    <section className="alerts-section" aria-labelledby="rules-title">
      <div className="alerts-section-head">
        <h2 id="rules-title">Tus alertas</h2>
        {alerts.data && <p className="muted">{alerts.data.items.length} de {alerts.data.limit}</p>}
      </div>
      {alerts.isPending && <LoadingState label="Cargando tus alertas…" />}
      {alerts.isError && <ErrorState message={alerts.error.message} onRetry={() => void alerts.refetch()} />}
      {alerts.isSuccess && alerts.data.items.length === 0 && (
        <EmptyState title="Todavía no creaste alertas">
          <p>
            Buscá un producto y usá <strong>Avisame cuando baje</strong> en su ficha. <Link className="text-link" href="/buscar">Buscar productos</Link>
          </p>
        </EmptyState>
      )}
      {alerts.isSuccess && alerts.data.items.length > 0 && (
        <ul className="alert-rule-list">
          {alerts.data.items.map((alert) => <RuleItem key={alert.id} alert={alert} />)}
        </ul>
      )}
    </section>
  );
}

function RuleItem({ alert }: { alert: PriceAlertDto }) {
  const update = useUpdateAlert();
  const remove = useDeleteAlert();
  const [confirming, setConfirming] = useState(false);
  const outcome = alert.status.lastOutcome;
  const error = update.error ?? remove.error;
  return (
    <li className={alert.active ? 'alert-rule' : 'alert-rule is-paused'}>
      <Surface className="alert-rule-card">
        <div className="alert-rule-head">
          <p className="alert-rule-title">{describeAlert(alert)}</p>
          <span className={alert.active ? 'plan-status plan-status-active' : 'plan-status'}>{alert.active ? 'Activa' : 'Pausada'}</span>
        </div>
        <p className="muted">
          {describeScope(alert)}
          {alert.excludedBrands.length > 0 && ` · sin ${alert.excludedBrands.join(', ')}`}
          {alert.radiusKm && ` · hasta ${alert.radiusKm.replace('.', ',')} km`}
        </p>
        <p className="alert-rule-status">
          {!alert.active
            ? 'No la revisamos mientras esté pausada.'
            : outcome === null
              ? 'Todavía no la revisamos.'
              : `${OUTCOME_LABEL[outcome]} · revisada el ${dateTime.format(new Date(alert.status.lastEvaluatedAt ?? alert.updatedAt))}`}
          {outcome === 'NO_LOCATION' && alert.active && <> · <Link className="text-link" href="/preferencias">Cargar mi zona</Link></>}
        </p>
        {alert.status.lastNotifiedAt && <p className="muted">Último aviso: {dateTime.format(new Date(alert.status.lastNotifiedAt))}</p>}
        <FormAlert message={error ? error.message : null} />
        <div className="alert-rule-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={update.isPending}
            onClick={() => update.mutate({ alertId: alert.id, body: { active: !alert.active } })}
          >
            {alert.active ? 'Pausar' : 'Reanudar'}
          </button>
          {!confirming ? (
            <button type="button" className="secondary-button" onClick={() => setConfirming(true)}>Borrar</button>
          ) : (
            <span className="confirm-inline" role="group" aria-label="Confirmar borrado">
              <span>¿Borrar esta alerta? Los avisos que ya te llegaron quedan en la bandeja.</span>
              <button type="button" className="secondary-button danger-button" disabled={remove.isPending} onClick={() => remove.mutate(alert.id)}>
                {remove.isPending ? 'Borrando…' : 'Sí, borrar'}
              </button>
              <button type="button" className="secondary-button" onClick={() => setConfirming(false)}>Cancelar</button>
            </span>
          )}
          <Link className="text-link" href={alert.product ? `/producto/${alert.product.id}` : `/buscar?q=${encodeURIComponent(alert.canonicalProduct.name)}`}>
            Ver precios
          </Link>
        </div>
      </Surface>
    </li>
  );
}
