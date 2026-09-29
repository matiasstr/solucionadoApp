/**
 * Acceso a la base de los importadores (P7-01, ADR 0018). Resuelve identidades en
 * este orden y nunca por nombre parecido:
 *
 * 1. Vínculo `(fuente, id externo)` ya guardado.
 * 2. EAN válido de un producto existente, si el contenido coincide; si no, es una
 *    colisión de identidad y el registro se rechaza.
 * 3. Si no hay ninguno, crea la sucursal o el producto con un id estable y guarda
 *    el vínculo. El genérico se vincula solo con nombre normalizado **exacto** y
 *    misma dimensión; si no, el producto queda pendiente de revisión.
 *
 * Las resoluciones se guardan en memoria durante la ejecución.
 */
import type { CanonicalProductRecord, ProductRecord } from '../../catalog/domain/catalog-records';
import { CatalogValidationError } from '../../catalog/domain/catalog.errors';
import { DecimalValue } from '../../catalog/domain/decimal';
import { normalizeName } from '../../catalog/domain/naming';
import { baseUnitOf, toBaseQuantity } from '../../catalog/domain/units';
import type { BaseUnit } from '../../catalog/domain/units';
import { CanonicalProductRepository } from '../../catalog/infrastructure/canonical-product.repository';
import { CategoryRepository } from '../../catalog/infrastructure/category.repository';
import { ProductRepository } from '../../catalog/infrastructure/product.repository';
import type { PrismaService } from '../../../database/prisma.service';
import { ProductPriceRepository } from '../../prices/infrastructure/product-price.repository';
import type { PriceObservationInput } from '../../prices/infrastructure/product-price.repository';
import { PromotionRepository } from '../../promotions/infrastructure/promotion.repository';
import type { PromotionInput } from '../../promotions/infrastructure/promotion.repository';
import { StoreRepository } from '../../stores/infrastructure/store.repository';
import { importId } from '../application/import-run';
import type {
  PersistResult,
  PriceImportGateway,
  PromotionImportGateway,
  PromotionScope,
  PromotionScopeQuery,
  Resolution,
  ResolvedProduct,
} from '../application/ports';
import type { NormalizedProduct, NormalizedStore } from '../domain/import.types';

/** Categoría de los productos cuya categoría de origen no existe: quedan para revisión. */
const FALLBACK_CATEGORY = { slug: 'sin-clasificar', name: 'Sin clasificar' };

const cacheKey = (source: string, externalId: string) => `${source}|${externalId}`;

/** Misma presentación: modalidad, dimensión y contenido en unidad base. */
function sameContent(existing: ProductRecord, incoming: NormalizedProduct): boolean {
  return (
    existing.saleMode === incoming.saleMode &&
    baseUnitOf(existing.unit) === baseUnitOf(incoming.unit) &&
    toBaseQuantity(DecimalValue.parse(existing.quantity), existing.unit).equals(
      toBaseQuantity(DecimalValue.parse(incoming.quantity), incoming.unit),
    )
  );
}

export class PrismaImportGateway implements PriceImportGateway, PromotionImportGateway {
  private readonly products: ProductRepository;
  private readonly canonicals: CanonicalProductRepository;
  private readonly categories: CategoryRepository;
  private readonly stores: StoreRepository;
  private readonly prices: ProductPriceRepository;
  private readonly promotions: PromotionRepository;
  private readonly storeCache = new Map<string, Resolution<string>>();
  private readonly productCache = new Map<string, Resolution<ResolvedProduct>>();
  private readonly chainIds = new Map<string, string>();
  private readonly categoryIds = new Map<string, string | null>();
  private readonly canonicalUnits = new Map<string, BaseUnit>();

  constructor(private readonly prisma: PrismaService) {
    this.products = new ProductRepository(prisma);
    this.canonicals = new CanonicalProductRepository(prisma);
    this.categories = new CategoryRepository(prisma);
    this.stores = new StoreRepository(prisma);
    this.prices = new ProductPriceRepository(prisma);
    this.promotions = new PromotionRepository(prisma);
  }

  /** Lo recién creado se informa una sola vez; las lecturas siguientes lo devuelven como existente. */
  private take<T>(cache: Map<string, Resolution<T>>, key: string): Resolution<T> {
    const resolution = cache.get(key) as Resolution<T>;
    if (resolution.ok && resolution.created) cache.set(key, { ...resolution, created: false });
    return resolution;
  }

  async resolveStores(source: string, stores: readonly NormalizedStore[]): Promise<Map<string, Resolution<string>>> {
    const missing = stores.filter((store) => !this.storeCache.has(cacheKey(source, store.externalId)));
    if (missing.length) {
      const links = new Map(
        (await this.prisma.externalStoreRef.findMany({
          where: { source, externalId: { in: missing.map((store) => store.externalId) } },
          select: { externalId: true, storeId: true },
        })).map((link) => [link.externalId, link.storeId]),
      );
      for (const store of missing) {
        const key = cacheKey(source, store.externalId);
        const linked = links.get(store.externalId);
        if (linked) {
          this.storeCache.set(key, { ok: true, value: linked, created: false });
          continue;
        }
        try {
          const id = importId('store', source, store.externalId);
          await this.stores.upsert({
            id,
            chainId: await this.chainId(store.chain),
            name: store.name,
            address: store.address,
            city: store.city,
            province: store.province,
            latitude: store.latitude,
            longitude: store.longitude,
          });
          await this.prisma.externalStoreRef.createMany({ data: [{ source, externalId: store.externalId, storeId: id }], skipDuplicates: true });
          this.storeCache.set(key, { ok: true, value: id, created: true });
        } catch (error: unknown) {
          if (!(error instanceof CatalogValidationError)) throw error;
          this.storeCache.set(key, { ok: false, reason: 'STORE_INVALID', detail: `${error.code}: ${error.message}` });
        }
      }
    }
    return new Map(stores.map((store) => [store.externalId, this.take(this.storeCache, cacheKey(source, store.externalId))]));
  }

  /** Cadena por nombre exacto (es única); si no existe se crea con un id estable. */
  private async chainId(name: string): Promise<string> {
    const cached = this.chainIds.get(name);
    if (cached) return cached;
    const existing = await this.prisma.storeChain.findUnique({ where: { name }, select: { id: true } });
    const id = existing?.id ?? (await this.stores.upsertChain({ id: importId('chain', 'name', normalizeName(name)), name })).id;
    this.chainIds.set(name, id);
    return id;
  }

  private async categoryId(slug: string | null): Promise<string> {
    if (slug && !this.categoryIds.has(slug)) this.categoryIds.set(slug, (await this.categories.findBySlug(slug))?.id ?? null);
    const found = slug ? this.categoryIds.get(slug) : null;
    if (found) return found;
    if (!this.categoryIds.has(FALLBACK_CATEGORY.slug)) {
      const fallback = (await this.categories.findBySlug(FALLBACK_CATEGORY.slug))
        ?? (await this.categories.upsert({ id: importId('category', 'fallback', FALLBACK_CATEGORY.slug), ...FALLBACK_CATEGORY }));
      this.categoryIds.set(FALLBACK_CATEGORY.slug, fallback.id);
    }
    return this.categoryIds.get(FALLBACK_CATEGORY.slug) as string;
  }

  private async resolvedFrom(product: ProductRecord, pendingCanonical: boolean): Promise<ResolvedProduct> {
    let canonicalUnit: BaseUnit | null = null;
    if (product.canonicalProductId) {
      if (!this.canonicalUnits.has(product.canonicalProductId)) {
        const canonical = await this.canonicals.findById(product.canonicalProductId);
        if (canonical) this.canonicalUnits.set(canonical.id, canonical.defaultUnit);
      }
      canonicalUnit = this.canonicalUnits.get(product.canonicalProductId) ?? null;
    }
    return { id: product.id, quantity: product.quantity, unit: product.unit, saleMode: product.saleMode, canonicalUnit, pendingCanonical };
  }

  async resolveProducts(source: string, incoming: readonly NormalizedProduct[]): Promise<Map<string, Resolution<ResolvedProduct>>> {
    const missing = incoming.filter((product) => !this.productCache.has(cacheKey(source, product.externalId)));
    if (missing.length) {
      const links = new Map(
        (await this.prisma.externalProductRef.findMany({
          where: { source, externalId: { in: missing.map((product) => product.externalId) } },
          select: { externalId: true, productId: true },
        })).map((link) => [link.externalId, link.productId]),
      );
      const linked = new Map((await this.products.findManyByIds([...new Set(links.values())])).map((product) => [product.id, product]));
      const byEan = new Map(
        (await this.products.findByEans(missing.flatMap((product) => (product.ean && !links.has(product.externalId) ? [product.ean] : []))))
          .map((product) => [product.ean as string, product]),
      );
      const canonicalByName = new Map<string, CanonicalProductRecord>(
        (await this.canonicals.findByNormalizedNames(missing.flatMap((product) => (product.canonicalName ? [product.canonicalName] : []))))
          .map((canonical) => [canonical.normalizedName, canonical]),
      );
      for (const canonical of canonicalByName.values()) this.canonicalUnits.set(canonical.id, canonical.defaultUnit);

      // En serie: dos registros con el mismo EAN en el lote ven el producto que creó el primero.
      for (const product of missing) {
        const key = cacheKey(source, product.externalId);
        const existing = linked.get(links.get(product.externalId) ?? '');
        if (existing) {
          // Otro contenido con el mismo id externo es otro producto (docs/DOMAIN.md): no se reinterpreta.
          this.productCache.set(
            key,
            sameContent(existing, product)
              ? { ok: true, value: await this.resolvedFrom(existing, false), created: false }
              : { ok: false, reason: 'CONTENT_CHANGED', detail: 'La fuente cambió el contenido o la modalidad de un producto ya importado.' },
          );
          continue;
        }
        const sameEan = product.ean ? byEan.get(product.ean) : undefined;
        if (sameEan) {
          if (!sameContent(sameEan, product)) {
            this.productCache.set(key, {
              ok: false,
              reason: 'EAN_CONTENT_MISMATCH',
              detail: 'El EAN ya pertenece a otra presentación (distinto contenido o modalidad): no se fusionan.',
            });
            continue;
          }
          await this.link(source, product.externalId, sameEan.id);
          this.productCache.set(key, { ok: true, value: await this.resolvedFrom(sameEan, false), created: false });
          continue;
        }
        try {
          const canonical = product.canonicalName ? canonicalByName.get(normalizeName(product.canonicalName, 200)) : undefined;
          const canonicalProductId = canonical && canonical.defaultUnit === baseUnitOf(product.unit) ? canonical.id : null;
          const created = await this.products.upsert({
            id: importId('product', source, product.externalId),
            name: product.name,
            categoryId: await this.categoryId(product.categorySlug),
            quantity: product.quantity,
            unit: product.unit,
            ean: product.ean,
            brand: product.brand,
            canonicalProductId,
            saleMode: product.saleMode,
            packageCount: product.packageCount,
          });
          await this.link(source, product.externalId, created.id);
          if (created.ean) byEan.set(created.ean, created);
          this.productCache.set(key, { ok: true, value: await this.resolvedFrom(created, canonicalProductId === null), created: true });
        } catch (error: unknown) {
          if (!(error instanceof CatalogValidationError)) throw error;
          this.productCache.set(key, { ok: false, reason: 'PRODUCT_INVALID', detail: `${error.code}: ${error.message}` });
        }
      }
    }
    return new Map(incoming.map((product) => [product.externalId, this.take(this.productCache, cacheKey(source, product.externalId))]));
  }

  private async link(source: string, externalId: string, productId: string): Promise<void> {
    await this.prisma.externalProductRef.createMany({ data: [{ source, externalId, productId }], skipDuplicates: true });
  }

  persistPrices(inputs: readonly PriceObservationInput[]): Promise<PersistResult> {
    return this.prices.recordBatch(inputs);
  }

  async resolvePromotionScope(source: string, query: PromotionScopeQuery): Promise<PromotionScope> {
    const [stores, chains, productRefs, productsByEan, canonicals] = await Promise.all([
      query.storeExternalIds.length
        ? this.prisma.externalStoreRef.findMany({ where: { source, externalId: { in: [...query.storeExternalIds] } }, select: { externalId: true, storeId: true } })
        : [],
      query.chains.length ? this.prisma.storeChain.findMany({ where: { name: { in: [...query.chains] } }, select: { id: true, name: true } }) : [],
      query.productExternalIds.length
        ? this.prisma.externalProductRef.findMany({ where: { source, externalId: { in: [...query.productExternalIds] } }, select: { externalId: true, productId: true } })
        : [],
      this.products.findByEans(query.productEans),
      this.canonicals.findByNormalizedNames(query.canonicalNames),
    ]);
    return {
      stores: new Map(stores.map((store) => [store.externalId, store.storeId])),
      chains: new Map(chains.map((chain) => [chain.name, chain.id])),
      productsByExternalId: new Map(productRefs.map((ref) => [ref.externalId, ref.productId])),
      productsByEan: new Map(productsByEan.map((product) => [product.ean as string, product.id])),
      canonicals: new Map(canonicals.map((canonical) => [canonical.normalizedName, canonical.id])),
    };
  }

  async upsertPromotion(input: PromotionInput): Promise<'created' | 'updated'> {
    // La unicidad real es (fuente, id externo): se respeta el id que ya tuviera esa promoción.
    const existing = input.externalId
      ? await this.prisma.promotion.findUnique({ where: { source_externalId: { source: input.source, externalId: input.externalId } }, select: { id: true } })
      : null;
    await this.promotions.upsert({ ...input, id: existing?.id ?? input.id });
    return existing ? 'updated' : 'created';
  }
}
