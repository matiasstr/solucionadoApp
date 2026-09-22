/**
 * Seed DEMO repetible (P2-01). Escribe catálogo, sucursales e historia de precios
 * ficticia usando los mismos repositorios y el mismo normalizador que la API.
 *
 * Idempotente: las entidades usan ids deterministas (UUID v5) y las observaciones
 * una clave `demo:producto:sucursal:día`, así que correrlo dos veces con la misma
 * fecha ancla no duplica nada ni reescribe historia. Nunca borra datos.
 */
import type { PrismaService } from '../database/prisma.service';
import { CanonicalProductRepository } from '../modules/catalog/infrastructure/canonical-product.repository';
import { CategoryRepository } from '../modules/catalog/infrastructure/category.repository';
import { ProductRepository } from '../modules/catalog/infrastructure/product.repository';
import { normalizePrice } from '../modules/prices/domain/price-normalizer';
import { ProductPriceRepository } from '../modules/prices/infrastructure/product-price.repository';
import type { PriceObservationInput } from '../modules/prices/infrastructure/product-price.repository';
import { PromotionRepository } from '../modules/promotions/infrastructure/promotion.repository';
import { StoreRepository } from '../modules/stores/infrastructure/store.repository';
import {
  DEMO_CANONICAL_PRODUCTS,
  DEMO_CATEGORIES,
  DEMO_CHAINS,
  DEMO_OBSERVATION_HOUR_UTC,
  DEMO_PRODUCTS,
  DEMO_PROMOTIONS,
  DEMO_SOURCE,
  DEMO_STORES,
  DEMO_SUFFIX,
  demoEan,
} from './demo-catalog';
import type { DemoProduct, DemoStore } from './demo-catalog';
import { demoId, stableHash32 } from './demo-id';

export const DEFAULT_HISTORY_DAYS = 31;
const MS_PER_DAY = 86_400_000;
const INSERT_BATCH_SIZE = 1_000;
/** Una de cada once combinaciones producto/sucursal no se vende ahí. */
const MISSING_PRODUCT_MODULUS = 11;

export const demoCategoryId = (slug: string): string => demoId('category', slug);
export const demoCanonicalProductId = (key: string): string => demoId('canonical-product', key);
export const demoProductId = (key: string): string => demoId('product', key);
export const demoChainId = (key: string): string => demoId('store-chain', key);
export const demoStoreId = (key: string): string => demoId('store', key);
export const demoPromotionId = (key: string): string => demoId('promotion', key);

export interface SeedOptions {
  /** Día del precio más reciente; controlable para que las pruebas no caduquen. */
  readonly anchorDate?: Date;
  readonly historyDays?: number;
}

export interface SeedSummary {
  readonly anchorDate: string;
  readonly historyDays: number;
  readonly categories: number;
  readonly canonicalProducts: number;
  readonly products: number;
  readonly chains: number;
  readonly stores: number;
  readonly promotions: number;
  readonly observationsGenerated: number;
  readonly observationsInserted: number;
  readonly source: string;
  readonly importBatchId: string;
}

/** Mediodía UTC del día indicado: hora fija para que la historia sea reproducible. */
function observationInstant(anchor: Date, dayOffset: number): Date {
  const day = new Date(anchor.getTime() - dayOffset * MS_PER_DAY);
  return new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), DEMO_OBSERVATION_HOUR_UTC, 0, 0, 0),
  );
}

const dateKey = (instant: Date): string => instant.toISOString().slice(0, 10);

const centsToAmount = (cents: number): string =>
  `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

/**
 * Precio ficticio determinista: nivel de la cadena y de la sucursal, una tendencia
 * suave (los días anteriores valen un poco menos) y una variación acotada estable.
 * Todo en centavos enteros: no hay aritmética binaria sobre importes.
 */
function demoPriceCents(product: DemoProduct, store: DemoStore, chainPercent: number, dayOffset: number): number {
  const drift = (stableHash32(`${product.key}|${store.key}|${dayOffset}`) % 61) - 30;
  let cents = Math.round((product.basePriceCents * chainPercent) / 100);
  cents = Math.round((cents * (store.pricePercent ?? 100)) / 100);
  cents = Math.round((cents * (1000 - dayOffset * 2)) / 1000);
  cents = Math.round((cents * (1000 + drift)) / 1000);
  return Math.max(cents, 100);
}

function sellsProduct(store: DemoStore, product: DemoProduct): boolean {
  return stableHash32(`${store.key}|${product.key}`) % MISSING_PRODUCT_MODULUS !== 0;
}

function observesOn(store: DemoStore, dayOffset: number): boolean {
  if ((store.stopsDaysBeforeAnchor ?? 0) > dayOffset) return false;
  const every = store.observeEveryDays ?? 1;
  return every <= 1 || dayOffset % every === 0;
}

export async function seedDemoCatalog(prisma: PrismaService, options: SeedOptions = {}): Promise<SeedSummary> {
  const historyDays = options.historyDays ?? DEFAULT_HISTORY_DAYS;
  if (!Number.isInteger(historyDays) || historyDays < 1 || historyDays > 400) {
    throw new RangeError('historyDays debe ser un entero entre 1 y 400.');
  }
  const anchor = observationInstant(options.anchorDate ?? new Date(), 0);
  const importBatchId = `${DEMO_SOURCE}:${dateKey(anchor)}`;

  const categories = new CategoryRepository(prisma);
  const canonicalProducts = new CanonicalProductRepository(prisma);
  const products = new ProductRepository(prisma);
  const stores = new StoreRepository(prisma);
  const prices = new ProductPriceRepository(prisma);

  // Las madres van primero: DEMO_CATEGORIES ya está ordenado de raíz a hoja.
  for (const category of DEMO_CATEGORIES) {
    await categories.upsert({
      id: demoCategoryId(category.slug),
      name: category.name,
      slug: category.slug,
      parentId: category.parentSlug ? demoCategoryId(category.parentSlug) : null,
    });
  }

  for (const canonical of DEMO_CANONICAL_PRODUCTS) {
    await canonicalProducts.upsert({
      id: demoCanonicalProductId(canonical.key),
      name: canonical.name,
      categoryId: demoCategoryId(canonical.categorySlug),
      defaultUnit: canonical.defaultUnit,
    });
  }

  const canonicalByKey = new Map(DEMO_CANONICAL_PRODUCTS.map((canonical) => [canonical.key, canonical]));
  for (const product of DEMO_PRODUCTS) {
    const canonical = canonicalByKey.get(product.canonicalKey);
    if (!canonical) throw new Error(`El producto demo ${product.key} referencia un canónico inexistente.`);
    await products.upsert({
      id: demoProductId(product.key),
      name: `${product.name}${DEMO_SUFFIX}`,
      brand: product.brand ?? null,
      ean: product.eanSeed ? demoEan(product.eanSeed) : null,
      categoryId: demoCategoryId(canonical.categorySlug),
      canonicalProductId: demoCanonicalProductId(product.canonicalKey),
      quantity: product.quantity,
      unit: product.unit,
      saleMode: product.saleMode ?? 'PACKAGED',
      packageCount: product.packageCount ?? 1,
    });
  }

  for (const chain of DEMO_CHAINS) {
    await stores.upsertChain({ id: demoChainId(chain.key), name: chain.name });
  }

  const chainByKey = new Map(DEMO_CHAINS.map((chain) => [chain.key, chain]));
  for (const store of DEMO_STORES) {
    if (!chainByKey.has(store.chainKey)) throw new Error(`La sucursal demo ${store.key} referencia una cadena inexistente.`);
    await stores.upsert({
      id: demoStoreId(store.key),
      chainId: demoChainId(store.chainKey),
      name: `${store.name}${DEMO_SUFFIX}`,
      address: store.address,
      city: store.city,
      province: store.province,
      latitude: store.latitude ?? null,
      longitude: store.longitude ?? null,
    });
  }

  // Promociones demo: activas, futuras y vencidas, con vigencia relativa al ancla.
  const promotions = new PromotionRepository(prisma);
  for (const promotion of DEMO_PROMOTIONS) {
    await promotions.upsert({
      id: demoPromotionId(promotion.key),
      name: `${promotion.name}${DEMO_SUFFIX}`,
      type: promotion.type,
      storeId: promotion.storeKey ? demoStoreId(promotion.storeKey) : null,
      chainId: promotion.chainKey ? demoChainId(promotion.chainKey) : null,
      productId: promotion.productKey ? demoProductId(promotion.productKey) : null,
      canonicalProductId: promotion.canonicalKey ? demoCanonicalProductId(promotion.canonicalKey) : null,
      discountPercentage: promotion.discountPercentage ?? null,
      fixedPrice: promotion.fixedPrice ?? null,
      requiredQuantity: promotion.requiredQuantity ?? null,
      paymentMethod: promotion.paymentMethod ?? null,
      bank: promotion.bank ?? null,
      membershipProgram: promotion.membershipProgram ?? null,
      minimumSpend: promotion.minimumSpend ?? null,
      discountCap: promotion.discountCap ?? null,
      capPeriod: promotion.capPeriod ?? null,
      eligibleWeekdays: promotion.eligibleWeekdays ?? [],
      isStackable: false,
      terms: promotion.terms ?? null,
      source: DEMO_SOURCE,
      externalId: promotion.key,
      validFrom: observationInstant(anchor, -promotion.validFromDays),
      validUntil: observationInstant(anchor, -promotion.validUntilDays),
    });
  }

  const observations: PriceObservationInput[] = [];
  for (const store of DEMO_STORES) {
    const chain = chainByKey.get(store.chainKey);
    if (!chain) continue;
    for (const product of DEMO_PRODUCTS) {
      if (!sellsProduct(store, product)) continue;
      const canonical = canonicalByKey.get(product.canonicalKey);
      for (let dayOffset = 0; dayOffset < historyDays; dayOffset += 1) {
        if (!observesOn(store, dayOffset)) continue;
        const observedAt = observationInstant(anchor, dayOffset);
        const normalized = normalizePrice({
          price: centsToAmount(demoPriceCents(product, store, chain.pricePercent, dayOffset)),
          quantity: product.quantity,
          unit: product.unit,
          saleMode: product.saleMode ?? 'PACKAGED',
          canonicalUnit: canonical?.defaultUnit ?? null,
        });
        observations.push({
          productId: demoProductId(product.key),
          storeId: demoStoreId(store.key),
          price: normalized.price,
          unitPrice: normalized.unitPrice,
          unitPriceUnit: normalized.unitPriceUnit,
          source: DEMO_SOURCE,
          idempotencyKey: `demo:${product.key}:${store.key}:${dateKey(observedAt)}`,
          importBatchId,
          observedAt,
        });
      }
    }
  }

  let inserted = 0;
  for (let start = 0; start < observations.length; start += INSERT_BATCH_SIZE) {
    inserted += await prices.recordMany(observations.slice(start, start + INSERT_BATCH_SIZE));
  }

  return {
    anchorDate: dateKey(anchor),
    historyDays,
    categories: DEMO_CATEGORIES.length,
    canonicalProducts: DEMO_CANONICAL_PRODUCTS.length,
    products: DEMO_PRODUCTS.length,
    chains: DEMO_CHAINS.length,
    stores: DEMO_STORES.length,
    promotions: DEMO_PROMOTIONS.length,
    observationsGenerated: observations.length,
    observationsInserted: inserted,
    source: DEMO_SOURCE,
    importBatchId,
  };
}
