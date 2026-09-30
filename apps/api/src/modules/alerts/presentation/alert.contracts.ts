import type { Prisma } from '../../../generated/prisma/client';
import { toAmountString, toQuantityString } from '../../catalog/infrastructure/decimal-mapper';
import type { BaseUnit } from '../../catalog/domain/units';
import type { AlertOutcome } from '../domain/alert-evaluation';
import type { AlertCondition } from '../domain/alert-rules';

/** Alerta de precio tal como la ve su dueño (P9-01, docs/API.md). */
export interface PriceAlertDto {
  readonly id: string;
  readonly canonicalProduct: { readonly id: string; readonly name: string; readonly defaultUnit: BaseUnit };
  /** Presentación preferida; `null` = cualquiera del genérico. */
  readonly product: { readonly id: string; readonly name: string; readonly brand: string | null } | null;
  readonly allowSubstitutes: boolean;
  readonly excludedBrands: readonly string[];
  readonly condition: AlertCondition;
  /** Solo en `TARGET_PRICE`: precio por unidad base del genérico. */
  readonly target: { readonly unitPrice: string; readonly unit: BaseUnit; readonly currency: 'ARS' } | null;
  /** `null` = el radio de las preferencias. */
  readonly radiusKm: string | null;
  readonly active: boolean;
  readonly status: {
    readonly lastEvaluatedAt: string | null;
    /** Resultado de la última evaluación (`NO_FRESH_PRICES`, `NOTIFIED`, …); `null` si nunca se evaluó. */
    readonly lastOutcome: AlertOutcome | null;
    readonly lastNotifiedAt: string | null;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PriceAlertListDto {
  readonly items: PriceAlertDto[];
  /** Máximo de alertas por persona. */
  readonly limit: number;
}

export interface NotificationDto {
  readonly id: string;
  readonly kind: 'PRICE_ALERT';
  /** `null` si la alerta que lo originó se borró. */
  readonly ruleId: string | null;
  readonly title: string;
  readonly message: string;
  /** Ruta de la web (producto del aviso). */
  readonly link: string;
  /** Snapshot: motivo, producto, sucursal, precio, fuente y fecha al momento del aviso. */
  readonly data: unknown;
  readonly readAt: string | null;
  readonly createdAt: string;
}

export interface NotificationPageDto {
  readonly items: NotificationDto[];
  readonly page: { readonly limit: number; readonly nextCursor: string | null };
  readonly unreadCount: number;
}

export const alertInclude = {
  canonicalProduct: { select: { id: true, name: true, defaultUnit: true } },
  product: { select: { id: true, name: true, brand: true } },
} satisfies Prisma.PriceAlertRuleInclude;

export type AlertRow = Prisma.PriceAlertRuleGetPayload<{ include: typeof alertInclude }>;
type NotificationRow = Prisma.NotificationGetPayload<object>;

export function toPriceAlertDto(row: AlertRow): PriceAlertDto {
  return {
    id: row.id,
    canonicalProduct: row.canonicalProduct,
    product: row.product,
    allowSubstitutes: row.allowSubstitutes,
    excludedBrands: row.excludedBrands,
    condition: row.condition,
    target:
      row.targetUnitPrice !== null && row.targetUnit !== null
        ? { unitPrice: toAmountString(row.targetUnitPrice, 2), unit: row.targetUnit, currency: 'ARS' }
        : null,
    radiusKm: row.radiusKm === null ? null : toQuantityString(row.radiusKm),
    active: row.active,
    status: {
      lastEvaluatedAt: row.lastEvaluatedAt?.toISOString() ?? null,
      lastOutcome: (row.lastOutcome as AlertOutcome | null) ?? null,
      lastNotifiedAt: row.lastNotifiedAt?.toISOString() ?? null,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toNotificationDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    kind: row.kind,
    ruleId: row.ruleId,
    title: row.title,
    message: row.message,
    link: row.link,
    data: row.snapshot,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
