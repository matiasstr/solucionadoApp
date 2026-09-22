import { Injectable } from '@nestjs/common';
import { DEFAULT_PAGE_LIMIT, keysetFilter, toPage } from '../../../common/pagination';
import type { KeysetCursor, PageResult } from '../../../common/pagination';
import { PrismaService } from '../../../database/prisma.service';
import { toAmountString } from '../../catalog/infrastructure/decimal-mapper';
import type { DecimalLike } from '../../catalog/infrastructure/decimal-mapper';
import { validatePromotionRule } from '../domain/promotion-rule';
import type { DiscountCapPeriod, PaymentMethod, PromotionRule, PromotionType } from '../domain/promotion.types';

/** Escalas de las columnas: porcentaje Decimal(5,2); importes Decimal(14,2). */
const PERCENTAGE_SCALE = 2;
const MONEY_SCALE = 2;

export interface PromotionInput extends Omit<PromotionRule, 'id'> {
  /** Id estable provisto por el seed o el importador. */
  readonly id: string;
}

export interface PromotionSearchQuery {
  readonly storeId?: string;
  readonly chainId?: string;
  readonly productId?: string;
  readonly canonicalProductId?: string;
  /** Solo promociones vigentes en ese instante. */
  readonly activeAt?: Date;
  readonly type?: PromotionType;
  readonly limit?: number;
  readonly cursor?: KeysetCursor | null;
}

export interface ActivePromotionsQuery {
  readonly instant: Date;
  readonly storeIds?: readonly string[];
  readonly chainIds?: readonly string[];
  readonly productIds?: readonly string[];
  readonly canonicalProductIds?: readonly string[];
}

interface PromotionRow {
  id: string;
  name: string;
  type: string;
  storeId: string | null;
  chainId: string | null;
  productId: string | null;
  canonicalProductId: string | null;
  discountPercentage: DecimalLike | null;
  fixedPrice: DecimalLike | null;
  requiredQuantity: number | null;
  paymentMethod: string | null;
  bank: string | null;
  membershipProgram: string | null;
  minimumSpend: DecimalLike | null;
  discountCap: DecimalLike | null;
  capPeriod: string | null;
  eligibleWeekdays: number[];
  isStackable: boolean;
  terms: string | null;
  source: string;
  externalId: string | null;
  validFrom: Date;
  validUntil: Date;
}

const toRule = (row: PromotionRow): PromotionRule => ({
  id: row.id,
  name: row.name,
  type: row.type as PromotionType,
  storeId: row.storeId,
  chainId: row.chainId,
  productId: row.productId,
  canonicalProductId: row.canonicalProductId,
  discountPercentage: row.discountPercentage ? toAmountString(row.discountPercentage, PERCENTAGE_SCALE) : null,
  fixedPrice: row.fixedPrice ? toAmountString(row.fixedPrice, MONEY_SCALE) : null,
  requiredQuantity: row.requiredQuantity,
  paymentMethod: row.paymentMethod as PaymentMethod | null,
  bank: row.bank,
  membershipProgram: row.membershipProgram,
  minimumSpend: row.minimumSpend ? toAmountString(row.minimumSpend, MONEY_SCALE) : null,
  discountCap: row.discountCap ? toAmountString(row.discountCap, MONEY_SCALE) : null,
  capPeriod: row.capPeriod as DiscountCapPeriod | null,
  eligibleWeekdays: row.eligibleWeekdays,
  isStackable: row.isStackable,
  terms: row.terms,
  source: row.source,
  externalId: row.externalId,
  validFrom: row.validFrom,
  validUntil: row.validUntil,
});

const toData = (input: PromotionInput) => ({
  name: input.name,
  type: input.type,
  storeId: input.storeId,
  chainId: input.chainId,
  productId: input.productId,
  canonicalProductId: input.canonicalProductId,
  discountPercentage: input.discountPercentage,
  fixedPrice: input.fixedPrice,
  requiredQuantity: input.requiredQuantity,
  paymentMethod: input.paymentMethod,
  bank: input.bank,
  membershipProgram: input.membershipProgram,
  minimumSpend: input.minimumSpend,
  discountCap: input.discountCap,
  capPeriod: input.capPeriod,
  eligibleWeekdays: [...input.eligibleWeekdays],
  isStackable: input.isStackable,
  terms: input.terms,
  source: input.source,
  externalId: input.externalId,
  validFrom: input.validFrom,
  validUntil: input.validUntil,
});

/**
 * Promociones persistidas. La regla se valida en el dominio antes de escribir:
 * la base tiene los mismos CHECK, pero un error de aplicación debe nombrar el campo.
 */
@Injectable()
export class PromotionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<PromotionRule | null> {
    const row = await this.prisma.promotion.findUnique({ where: { id } });
    return row ? toRule(row) : null;
  }

  /** Promociones vigentes que alcanzan a esos comercios y productos. */
  async findActiveFor(query: ActivePromotionsQuery): Promise<PromotionRule[]> {
    const commercial = [
      ...(query.storeIds?.length ? [{ storeId: { in: [...query.storeIds] } }] : []),
      ...(query.chainIds?.length ? [{ chainId: { in: [...query.chainIds] } }] : []),
    ];
    // Sin alcance de producto, la promoción cubre todo el comercio.
    const product = [
      { productId: null, canonicalProductId: null },
      ...(query.productIds?.length ? [{ productId: { in: [...query.productIds] } }] : []),
      ...(query.canonicalProductIds?.length
        ? [{ canonicalProductId: { in: [...query.canonicalProductIds] } }]
        : []),
    ];
    const rows = await this.prisma.promotion.findMany({
      where: {
        validFrom: { lte: query.instant },
        validUntil: { gt: query.instant },
        ...(commercial.length ? { OR: commercial } : {}),
        AND: [{ OR: product }],
      },
      orderBy: [{ validUntil: 'asc' }, { id: 'asc' }],
      take: 200,
    });
    return rows.map(toRule);
  }

  /** Listado paginado con orden estable `(validUntil, id)`: primero lo que vence antes. */
  async search(query: PromotionSearchQuery): Promise<PageResult<PromotionRule>> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await this.prisma.promotion.findMany({
      where: {
        ...(query.storeId ? { storeId: query.storeId } : {}),
        ...(query.chainId ? { chainId: query.chainId } : {}),
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.canonicalProductId ? { canonicalProductId: query.canonicalProductId } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.activeAt ? { validFrom: { lte: query.activeAt }, validUntil: { gt: query.activeAt } } : {}),
        ...keysetFilter('validUntil', query.cursor ?? null),
      },
      orderBy: [{ validUntil: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    return toPage(rows.map(toRule), limit, (rule) => ({ key: rule.validUntil.toISOString(), id: rule.id }));
  }

  async upsert(input: PromotionInput): Promise<PromotionRule> {
    validatePromotionRule(input);
    const data = toData(input);
    const row = await this.prisma.promotion.upsert({
      where: { id: input.id },
      create: { id: input.id, ...data },
      update: data,
    });
    return toRule(row);
  }
}
