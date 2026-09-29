/**
 * Candidatos de compra (P5-01, ADR 0013): qué presentación, en qué sucursal y a
 * qué costo estimado por fecha puede cubrir cada necesidad.
 *
 * - Una presentación entra si comparte dimensión con la necesidad, está activa,
 *   respeta "sin reemplazos" y no es de una marca excluida.
 * - El precio es la última observación de esa sucursal y se informa como
 *   estimación con su fecha y fuente. Un precio viejo se descarta con su motivo:
 *   no prueba que el producto siga disponible.
 * - Se compran envases enteros (el excedente queda a la vista) y cada fecha se
 *   cobra con `priceLine`, que aplica como máximo una promoción comprobable.
 * - El recorte es determinista y cada descarte queda registrado. Una necesidad sin
 *   ofertas se conserva con el motivo; no se inventa disponibilidad.
 *
 * Función pura: no conoce la base, el reloj ni la configuración.
 */
import { DecimalValue } from '../../catalog/domain/decimal';
import type { ProductRecord } from '../../catalog/domain/catalog-records';
import { normalizeName } from '../../catalog/domain/naming';
import { planPurchase } from '../../catalog/domain/packaging';
import { dimensionOf, toBaseQuantity } from '../../catalog/domain/units';
import { freshnessOf } from '../../prices/domain/price-freshness';
import type { CurrentPriceRecord } from '../../prices/domain/price-records';
import { priceLine } from '../../promotions/domain/promotion-calculator';
import { matchesTarget } from '../../promotions/domain/promotion-eligibility';
import type { PromotionRule } from '../../promotions/domain/promotion.types';
import { compareText } from './needs';
import { argentineNoon } from './plan-calendar';
import type {
  CandidateExclusion,
  CandidateExclusionReason,
  CandidateOffer,
  CandidatesInput,
  CandidatesResult,
  CandidateStoreInput,
  CandidateStoreSummary,
  NeedCandidates,
  PlanNeed,
  PlanWarning,
  UnresolvedReason,
} from './planner.types';

const MONEY_SCALE = 2;
const QUANTITY_SCALE = 4;

const money = (value: string): DecimalValue => DecimalValue.parse(value);

interface Draft {
  readonly need: PlanNeed;
  readonly offers: CandidateOffer[];
  readonly exclusions: CandidateExclusion[];
  reason: UnresolvedReason | null;
}

function assertLimits(input: CandidatesInput): void {
  for (const [name, value] of Object.entries(input.limits)) {
    if (!Number.isInteger(value) || value < 1) throw new RangeError(`Límite de candidatos inválido: ${name}.`);
  }
}

function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const group = groups.get(key(value)) ?? [];
    group.push(value);
    groups.set(key(value), group);
  }
  return groups;
}

/** Motivo por el que la presentación entera no sirve para esta necesidad, o null. */
function productExclusion(product: ProductRecord, need: PlanNeed): CandidateExclusionReason | null {
  if (dimensionOf(product.unit) !== dimensionOf(need.unit)) return 'UNIT_MISMATCH';
  if (!product.isActive) return 'PRODUCT_INACTIVE';
  if (!need.constraints.allowSubstitutes && product.id !== need.constraints.requiredProductId) {
    return 'SUBSTITUTION_NOT_ALLOWED';
  }
  const excluded = new Set(need.constraints.excludedBrands.map((brand) => normalizeName(brand)));
  if (product.brand && excluded.has(normalizeName(product.brand))) return 'BRAND_EXCLUDED';
  return null;
}

function buildOffer(
  input: CandidatesInput,
  dates: readonly string[],
  need: PlanNeed,
  product: ProductRecord,
  store: CandidateStoreInput,
  price: CurrentPriceRecord,
  ageDays: number,
): CandidateOffer {
  const unitContent = toBaseQuantity(DecimalValue.parse(product.quantity), product.unit);
  const purchase = planPurchase({
    neededQuantity: need.netQuantity,
    packageQuantity: unitContent.toTrimmedString(),
    saleMode: product.saleMode,
  });
  const target = {
    storeId: store.id,
    chainId: store.chainId,
    productId: product.id,
    canonicalProductId: product.canonicalProductId,
  };
  // Solo las reglas que alcanzan a este producto en esta sucursal: el resto no explica nada.
  const rules = input.promotions
    .filter((rule: PromotionRule) => matchesTarget(rule, target))
    .sort((a, b) => compareText(a.id, b.id));
  const line = { unitPrice: price.price, quantity: purchase.units, saleMode: product.saleMode };

  let regularTotal = '';
  const dateOptions = dates.map((date) => {
    const charge = priceLine(line, rules, { target, instant: argentineNoon(date) });
    regularTotal = charge.regularTotal;
    return {
      date,
      total: charge.total,
      discount: charge.discount,
      appliedPromotionId: charge.appliedPromotionId,
      promotions: charge.evaluations.map((evaluation) => ({
        promotionId: evaluation.promotionId,
        name: evaluation.name,
        applied: evaluation.applied,
        skipReason: evaluation.skipReason,
      })),
    };
  });
  const bestTotal = dateOptions.reduce(
    (best, option) => (money(option.total).compare(best) < 0 ? money(option.total) : best),
    money(dateOptions[0]?.total ?? regularTotal),
  );

  const preferredBrands = new Set(need.constraints.preferredBrands.map((brand) => normalizeName(brand)));
  const exact =
    product.id === need.constraints.requiredProductId || need.constraints.preferredProductIds.includes(product.id);
  return {
    id: `${product.id}:${store.id}`,
    productId: product.id,
    productName: product.name,
    brand: product.brand,
    storeId: store.id,
    storeName: store.name,
    chainId: store.chainId,
    chainName: store.chainName,
    distanceMeters: store.distanceMeters,
    matchType: exact ? 'EXACT' : 'ALTERNATIVE',
    preferredBrand: Boolean(product.brand && preferredBrands.has(normalizeName(product.brand))),
    purchase: {
      saleMode: product.saleMode,
      units: purchase.units,
      unitContent: unitContent.toTrimmedString(QUANTITY_SCALE),
      purchasedQuantity: purchase.purchasedQuantity,
      surplus: purchase.surplus,
      quantityIsEstimate: product.saleMode === 'VARIABLE_WEIGHT',
    },
    priceBasis: {
      basis: 'LATEST_OBSERVATION',
      observationId: price.id,
      price: price.price,
      unitPrice: price.unitPrice,
      unitPriceUnit: price.unitPriceUnit,
      currency: price.currency,
      source: price.source,
      observedAt: price.observedAt.toISOString(),
      ageDays,
    },
    regularTotal,
    bestTotal: bestTotal.toFixed(MONEY_SCALE),
    bestDates: dateOptions.filter((option) => money(option.total).equals(bestTotal)).map((option) => option.date),
    dateOptions,
  };
}

/** Ofertas y descartes de una necesidad, antes del recorte por sucursal. */
function draftNeed(
  input: CandidatesInput,
  dates: readonly string[],
  need: PlanNeed,
  productsByCanonical: Map<string, ProductRecord[]>,
  pricesByProduct: Map<string, CurrentPriceRecord[]>,
  storesById: Map<string, CandidateStoreInput>,
): Draft {
  const draft: Draft = { need, offers: [], exclusions: [], reason: null };
  if (need.status === 'CONFLICT') {
    draft.reason = 'CONFLICTING_EXACT_PRODUCTS';
    return draft;
  }
  if (input.scope.origin === 'NONE') {
    draft.reason = 'NO_LOCATION';
    return draft;
  }
  if (!storesById.size) {
    draft.reason = 'NO_STORES_IN_SCOPE';
    return draft;
  }

  let eligible = 0;
  let stale = 0;
  for (const product of productsByCanonical.get(need.canonicalProductId) ?? []) {
    const excluded = productExclusion(product, need);
    if (excluded) {
      draft.exclusions.push({ productId: product.id, storeId: null, reason: excluded });
      continue;
    }
    eligible += 1;
    const prices = pricesByProduct.get(product.id) ?? [];
    if (!prices.length) {
      draft.exclusions.push({ productId: product.id, storeId: null, reason: 'NO_PRICE_IN_SCOPE' });
      continue;
    }
    for (const price of prices) {
      const store = storesById.get(price.storeId);
      if (!store) continue;
      const freshness = freshnessOf(price.observedAt, input.now, input.maxAgeDays);
      if (freshness.isStale) {
        stale += 1;
        draft.exclusions.push({ productId: product.id, storeId: store.id, reason: 'PRICE_STALE', ageDays: freshness.ageDays });
        continue;
      }
      draft.offers.push(buildOffer(input, dates, need, product, store, price, freshness.ageDays));
    }
  }

  if (!draft.offers.length) {
    const required = need.constraints.requiredProductId;
    const requiredEligible = required !== null && eligible > 0;
    draft.reason = required !== null && !requiredEligible
      ? 'PREFERRED_PRODUCT_UNAVAILABLE'
      : eligible === 0
        ? 'NO_ELIGIBLE_PRODUCT'
        : stale > 0
          ? 'ONLY_STALE_PRICES'
          : 'NO_PRICE_IN_SCOPE';
  }
  return draft;
}

/**
 * Orden del recorte de sucursales: las que cubren más necesidades, luego la
 * canasta cubierta más barata, luego la más cercana (sin distancia al final) y
 * el id. Comparar importes solo entre igual cobertura evita premiar a la sucursal
 * que parece barata porque vende menos cosas.
 */
function rankStores(drafts: readonly Draft[], storesById: Map<string, CandidateStoreInput>): CandidateStoreSummary[] {
  const coverage = new Map<string, { count: number; total: DecimalValue }>();
  for (const draft of drafts) {
    const cheapestByStore = new Map<string, DecimalValue>();
    for (const offer of draft.offers) {
      const current = cheapestByStore.get(offer.storeId);
      const total = money(offer.bestTotal);
      if (!current || total.compare(current) < 0) cheapestByStore.set(offer.storeId, total);
    }
    for (const [storeId, total] of cheapestByStore) {
      const entry = coverage.get(storeId) ?? { count: 0, total: DecimalValue.zero(MONEY_SCALE) };
      coverage.set(storeId, { count: entry.count + 1, total: entry.total.add(total) });
    }
  }
  const summaries: CandidateStoreSummary[] = [];
  for (const [storeId, entry] of coverage) {
    const store = storesById.get(storeId);
    if (store) summaries.push({ ...store, coverage: entry.count, cheapestCoveredTotal: entry.total.toFixed(MONEY_SCALE) });
  }
  return summaries.sort(
    (a, b) =>
      b.coverage - a.coverage ||
      money(a.cheapestCoveredTotal).compare(money(b.cheapestCoveredTotal)) ||
      (a.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.distanceMeters ?? Number.POSITIVE_INFINITY) ||
      compareText(a.id, b.id),
  );
}

/** Más barata primero; ante igual costo, la presentación preferida y la marca preferida. */
function compareOffers(a: CandidateOffer, b: CandidateOffer): number {
  return (
    money(a.bestTotal).compare(money(b.bestTotal)) ||
    Number(b.matchType === 'EXACT') - Number(a.matchType === 'EXACT') ||
    Number(b.preferredBrand) - Number(a.preferredBrand) ||
    compareText(a.storeId, b.storeId) ||
    compareText(a.productId, b.productId)
  );
}

function trimNeed(draft: Draft, keptStores: ReadonlySet<string>, maxOffersPerStore: number): NeedCandidates {
  const exclusions = [...draft.exclusions];
  const offers: CandidateOffer[] = [];
  for (const [storeId, storeOffers] of groupBy(draft.offers, (offer) => offer.storeId)) {
    if (!keptStores.has(storeId)) {
      for (const offer of storeOffers) exclusions.push({ productId: offer.productId, storeId, reason: 'STORE_LIMIT' });
      continue;
    }
    const ranked = [...storeOffers].sort(compareOffers);
    const kept = ranked.slice(0, maxOffersPerStore);
    // La presentación preferida se conserva aunque sea más cara: el optimizador decide.
    const exact = ranked.find((offer) => offer.matchType === 'EXACT');
    if (exact && !kept.includes(exact)) kept.push(exact);
    for (const offer of ranked) {
      if (kept.includes(offer)) offers.push(offer);
      else exclusions.push({ productId: offer.productId, storeId, reason: 'OFFER_LIMIT' });
    }
  }
  exclusions.sort(
    (a, b) =>
      compareText(a.productId, b.productId) ||
      compareText(a.storeId ?? '', b.storeId ?? '') ||
      compareText(a.reason, b.reason),
  );
  const reason = draft.reason ?? (offers.length ? null : 'ONLY_IN_TRIMMED_STORES');
  return {
    canonicalProductId: draft.need.canonicalProductId,
    offers: offers.sort(compareOffers),
    exclusions,
    unresolvedReason: reason,
  };
}

function warningsFor(input: CandidatesInput, trimmedDates: number, trimmedStores: number): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  if (input.scope.origin === 'NONE') {
    warnings.push({
      code: 'LOCATION_MISSING',
      message: 'Sin ubicación no se pueden elegir sucursales: cargá tu zona en Preferencias.',
    });
  }
  if (input.scope.origin === 'LOCALITY') {
    warnings.push({
      code: 'LOCATION_APPROXIMATE',
      message: 'Solo conocemos tu localidad: las sucursales son de esa ciudad y no podemos garantizar radio ni distancia.',
    });
  }
  for (const need of input.needs) {
    if (need.inventory && !need.inventory.applied) {
      warnings.push({
        code: 'INVENTORY_UNIT_MISMATCH',
        message: `La despensa de ${need.canonicalName} está en otra unidad y no se descontó.`,
      });
    }
  }
  if (trimmedStores) {
    warnings.push({
      code: 'STORES_TRIMMED',
      message: `Se evaluaron las ${input.limits.maxStores} sucursales con más cobertura; ${trimmedStores} quedaron afuera.`,
    });
  }
  if (trimmedDates) {
    warnings.push({
      code: 'DATES_TRIMMED',
      message: `Se evaluaron los primeros ${input.limits.maxDates} días del plan para comprar.`,
    });
  }
  return warnings;
}

export function buildCandidates(input: CandidatesInput): CandidatesResult {
  assertLimits(input);
  if (!input.dates.length) throw new RangeError('El plan necesita al menos una fecha de compra.');
  const evaluated = input.dates.slice(0, input.limits.maxDates);
  const trimmedDates = input.dates.slice(input.limits.maxDates);
  const storesById = new Map(
    input.scope.origin === 'NONE' ? [] : input.stores.map((store) => [store.id, store] as const),
  );
  const productsByCanonical = groupBy(
    [...input.products].sort((a, b) => compareText(a.id, b.id)),
    (product) => product.canonicalProductId ?? '',
  );
  const pricesByProduct = groupBy(
    input.prices.filter((price) => storesById.has(price.storeId)).sort((a, b) => compareText(a.storeId, b.storeId)),
    (price) => price.productId,
  );

  const drafts = input.needs
    .filter((need) => need.status !== 'COVERED_BY_INVENTORY')
    .map((need) => draftNeed(input, evaluated, need, productsByCanonical, pricesByProduct, storesById));

  const ranked = rankStores(drafts, storesById);
  const kept = ranked.slice(0, input.limits.maxStores);
  const trimmed = ranked.slice(input.limits.maxStores);
  const keptIds = new Set(kept.map((store) => store.id));

  return {
    dates: { evaluated, trimmed: trimmedDates },
    stores: { kept, trimmed },
    needs: drafts.map((draft) => trimNeed(draft, keptIds, input.limits.maxOffersPerStore)),
    warnings: warningsFor(input, trimmedDates.length, trimmed.length),
  };
}
