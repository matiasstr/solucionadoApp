/**
 * Importador de promociones (P7-01, ADR 0018). Una promoción solo se vincula con
 * sucursales, cadenas y productos que ya existen: nunca los crea. La regla se
 * valida con el dominio de promociones antes de escribir y el reingreso actualiza
 * la misma fila (id estable por fuente + id externo).
 */
import { normalizeName } from '../../catalog/domain/naming';
import { PromotionValidationError } from '../../promotions/domain/promotion-rule';
import type { PromotionInput } from '../../promotions/infrastructure/promotion.repository';
import { runBatches } from '../domain/batching';
import { normalizePromotionRecord } from '../domain/import-normalizer';
import type { ImportRunSummary, NormalizedPromotion, Rejection } from '../domain/import.types';
import { ImportRun, importId } from './import-run';
import type { PromotionImportGateway, PromotionProvider, PromotionScope } from './ports';
import type { ImportOptions } from './price-importer';

export class PromotionImporter {
  constructor(private readonly gateway: PromotionImportGateway) {}

  async run(provider: PromotionProvider, options: ImportOptions = {}): Promise<ImportRunSummary> {
    const now = options.now ?? new Date();
    const run = new ImportRun('promotions', provider.source, now, options.runId);
    let failure: unknown = null;
    try {
      const stats = await runBatches(this.normalized(provider, run), { batchSize: options.batchSize ?? 200, concurrency: 1 }, {
        prepare: async (batch) => ({
          batch,
          scope: await this.gateway.resolvePromotionScope(provider.source, {
            storeExternalIds: batch.flatMap((promotion) => (promotion.storeExternalId ? [promotion.storeExternalId] : [])),
            chains: batch.flatMap((promotion) => (promotion.chain ? [promotion.chain] : [])),
            productExternalIds: batch.flatMap((promotion) => (promotion.productExternalId ? [promotion.productExternalId] : [])),
            productEans: batch.flatMap((promotion) => (promotion.productEan ? [promotion.productEan] : [])),
            canonicalNames: batch.flatMap((promotion) => (promotion.canonicalName ? [promotion.canonicalName] : [])),
          }),
        }),
        persist: async ({ batch, scope }) => {
          for (const promotion of batch) {
            const input = this.toInput(provider.source, promotion, scope);
            if ('reason' in input) {
              run.reject(input);
              continue;
            }
            try {
              const result = await this.gateway.upsertPromotion(input);
              if (result === 'created') run.created += 1;
              else run.updated += 1;
            } catch (error: unknown) {
              if (!(error instanceof PromotionValidationError)) throw error;
              run.reject({ position: promotion.position, reason: 'PROMOTION_INVALID', detail: `${error.code}: ${error.message}`, ref: promotion.externalId });
            }
          }
        },
      });
      run.batches = stats.batches;
    } catch (error: unknown) {
      failure = error;
    }
    return run.summary(failure, new Date());
  }

  private async *normalized(provider: PromotionProvider, run: ImportRun): AsyncGenerator<NormalizedPromotion> {
    let position = 0;
    for await (const item of provider.records()) {
      position += 1;
      run.read += 1;
      if (item.kind === 'unparsable') {
        run.reject({ position, reason: 'UNPARSABLE', detail: item.detail, ref: null });
        continue;
      }
      const result = normalizePromotionRecord(item, position, { separator: provider.decimalSeparator });
      if (!result.ok) run.reject(result.rejection);
      else yield result.value;
    }
  }

  /** Traduce referencias externas a ids; lo que no existe se rechaza, no se inventa. */
  private toInput(source: string, promotion: NormalizedPromotion, scope: PromotionScope): PromotionInput | Rejection {
    const rejection = (reason: Rejection['reason'], detail: string): Rejection => ({ position: promotion.position, reason, detail, ref: promotion.externalId });
    const storeId = promotion.storeExternalId ? scope.stores.get(promotion.storeExternalId) : null;
    if (storeId === undefined) return rejection('STORE_UNKNOWN', 'La sucursal no existe en esta fuente.');
    const chainId = promotion.chain ? scope.chains.get(promotion.chain) : null;
    if (chainId === undefined) return rejection('CHAIN_UNKNOWN', 'La cadena no existe.');
    const productId = promotion.productExternalId
      ? scope.productsByExternalId.get(promotion.productExternalId)
      : promotion.productEan
        ? scope.productsByEan.get(promotion.productEan)
        : null;
    if (productId === undefined) return rejection('PRODUCT_UNKNOWN', 'El producto no existe.');
    const canonicalProductId = promotion.canonicalName ? scope.canonicals.get(normalizeName(promotion.canonicalName, 200)) : null;
    if (canonicalProductId === undefined) return rejection('CANONICAL_UNKNOWN', 'El producto genérico no existe.');

    return {
      id: importId('promotion', source, promotion.externalId),
      name: promotion.name,
      type: promotion.type,
      storeId,
      chainId,
      productId,
      canonicalProductId,
      discountPercentage: promotion.discountPercentage,
      fixedPrice: promotion.fixedPrice,
      requiredQuantity: promotion.requiredQuantity,
      paymentMethod: promotion.paymentMethod,
      bank: promotion.bank,
      membershipProgram: promotion.membershipProgram,
      minimumSpend: promotion.minimumSpend,
      discountCap: promotion.discountCap,
      capPeriod: promotion.capPeriod,
      eligibleWeekdays: promotion.eligibleWeekdays,
      isStackable: false,
      terms: promotion.terms,
      source,
      externalId: promotion.externalId,
      validFrom: promotion.validFrom,
      validUntil: promotion.validUntil,
    };
  }
}
