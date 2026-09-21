import { Injectable } from '@nestjs/common';
import { CatalogValidationError } from '../../catalog/domain/catalog.errors';
import { CanonicalProductRepository } from '../../catalog/infrastructure/canonical-product.repository';
import { ProductRepository } from '../../catalog/infrastructure/product.repository';
import { buildIdempotencyKey } from '../domain/price-identity';
import { normalizePrice } from '../domain/price-normalizer';
import { ProductPriceRepository } from '../infrastructure/product-price.repository';
import type { RecordObservationResult } from '../infrastructure/product-price.repository';

export interface RecordPriceObservationInput {
  readonly productId: string;
  readonly storeId: string;
  /** Importe observado tal como lo informa la fuente. */
  readonly price: string;
  readonly source: string;
  readonly observedAt: Date;
  /** Identificador del proveedor; sin él la clave se arma con producto, sucursal y día. */
  readonly externalId?: string | null;
  readonly importBatchId?: string | null;
}

/**
 * Registra una observación de precio: normaliza contra la presentación del producto
 * y la agrega al historial. Nunca actualiza una observación anterior.
 */
@Injectable()
export class RecordPriceObservationUseCase {
  constructor(
    private readonly products: ProductRepository,
    private readonly canonicalProducts: CanonicalProductRepository,
    private readonly prices: ProductPriceRepository,
  ) {}

  async execute(input: RecordPriceObservationInput): Promise<RecordObservationResult> {
    const product = await this.products.findById(input.productId);
    if (!product) {
      throw new CatalogValidationError('PRODUCT_NOT_FOUND', 'El producto no existe.', ['productId']);
    }
    const canonical = product.canonicalProductId
      ? await this.canonicalProducts.findById(product.canonicalProductId)
      : null;

    const normalized = normalizePrice({
      price: input.price,
      quantity: product.quantity,
      unit: product.unit,
      saleMode: product.saleMode,
      canonicalUnit: canonical?.defaultUnit ?? null,
    });

    return this.prices.record({
      productId: product.id,
      storeId: input.storeId,
      price: normalized.price,
      unitPrice: normalized.unitPrice,
      unitPriceUnit: normalized.unitPriceUnit,
      source: input.source,
      idempotencyKey: buildIdempotencyKey({
        productKey: product.id,
        storeKey: input.storeId,
        observedAt: input.observedAt,
        externalId: input.externalId,
      }),
      importBatchId: input.importBatchId ?? null,
      observedAt: input.observedAt,
    });
  }
}
