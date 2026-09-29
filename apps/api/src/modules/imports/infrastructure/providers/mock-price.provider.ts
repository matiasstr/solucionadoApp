/**
 * Proveedores simulados (P7-01): datos ficticios y reproducibles para probar la
 * importación sin servicios externos. Todo lleva `(MOCK)` en el nombre y la fuente
 * `mock-provider`. Los registros se generan de a uno, cuando se piden: sirve para
 * probar volúmenes grandes sin cargar nada en memoria.
 */
import { stableHash32 } from '../../../../seed/demo-id';
import { argentineDate, shiftDate } from '../../../prices/domain/price-analysis';
import type { PriceProvider, PromotionProvider } from '../../application/ports';
import type { ProviderPriceItem, ProviderPromotionItem, RawPriceRecord } from '../../domain/import.types';

export const MOCK_SOURCE = 'mock-provider';

const yesterday = () => shiftDate(argentineDate(new Date()), -1);

const CHAINS = ['Carrefour', 'Coto', 'Jumbo', 'Vea', 'Disco'];
/** Presentaciones de ejemplo, con el genérico de la demo cuando existe (misma dimensión). */
const PRESENTATIONS = [
  { label: 'arroz 1 kg', quantity: '1', unit: 'kg', saleMode: null, category: 'almacen', canonical: 'Arroz largo fino' },
  { label: 'fideos 500 g', quantity: '500', unit: 'gr', saleMode: null, category: 'almacen', canonical: 'Fideos secos tipo tallarín' },
  { label: 'aceite 1,5 L', quantity: '1,5', unit: 'lt', saleMode: null, category: 'almacen', canonical: 'Aceite de girasol' },
  { label: 'leche 900 ml', quantity: '900', unit: 'ml', saleMode: null, category: 'lacteos', canonical: 'Leche entera' },
  { label: 'huevos x 12', quantity: '12', unit: 'un', saleMode: null, category: 'almacen', canonical: 'Huevos de gallina' },
  { label: 'papa por kg', quantity: '1', unit: 'kg', saleMode: 'pesable', category: 'frutas-y-verduras', canonical: 'Papa' },
  // Sin genérico ni categoría conocida: queda pendiente de revisión y "sin clasificar".
  { label: 'alimento para mascotas 3 kg', quantity: '3', unit: 'kg', saleMode: null, category: 'mascotas', canonical: null },
] as const;

export interface MockPriceOptions {
  readonly seed?: number;
  readonly stores?: number;
  readonly products?: number;
  readonly days?: number;
  /**
   * Día del precio más reciente, `AAAA-MM-DD`. Por defecto **ayer** en Argentina: un día
   * sin hora es el mediodía argentino, y el de hoy puede no haber llegado todavía.
   */
  readonly anchorDate?: string;
  /** Cada cuántos registros uno viene roto (0 = ninguno). */
  readonly corruptEvery?: number;
  /** Cada cuántos productos uno viene sin EAN (0 = todos con EAN). */
  readonly withoutEanEvery?: number;
}

/** EAN-13 válido con prefijo 28 (uso interno GS1). */
export function mockEan(index: number): string {
  const body = `28${String(index).padStart(10, '0')}`;
  const sum = [...body].reduce((total, digit, position) => total + Number(digit) * (position % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** Centavos a texto argentino: `123456` → `1.234,56`. */
export function formatCommaDecimal(cents: number): string {
  const integer = String(Math.trunc(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${integer},${String(cents % 100).padStart(2, '0')}`;
}

export class MockPriceProvider implements PriceProvider {
  readonly source = MOCK_SOURCE;
  readonly decimalSeparator = ',' as const;
  private readonly options: Required<MockPriceOptions>;

  constructor(options: MockPriceOptions = {}) {
    this.options = {
      seed: options.seed ?? 1,
      stores: options.stores ?? 5,
      products: options.products ?? 20,
      days: options.days ?? 7,
      anchorDate: options.anchorDate ?? yesterday(),
      corruptEvery: options.corruptEvery ?? 0,
      withoutEanEvery: options.withoutEanEvery ?? 0,
    };
  }

  /** Del día más viejo al más nuevo, sucursal por sucursal, producto por producto. */
  async *records(): AsyncGenerator<ProviderPriceItem> {
    const { seed, stores, products, days, anchorDate, corruptEvery } = this.options;
    let position = 0;
    for (let day = days - 1; day >= 0; day -= 1) {
      const date = shiftDate(anchorDate, -day);
      for (let store = 0; store < stores; store += 1) {
        for (let product = 0; product < products; product += 1) {
          position += 1;
          const record = this.record(seed, store, product, date);
          yield corruptEvery > 0 && position % corruptEvery === 0 ? this.corrupt(record, position / corruptEvery) : record;
        }
      }
    }
  }

  private record(seed: number, store: number, product: number, date: string): RawPriceRecord {
    const presentation = PRESENTATIONS[product % PRESENTATIONS.length] as (typeof PRESENTATIONS)[number];
    const withoutEan = this.options.withoutEanEvery > 0 && product % this.options.withoutEanEvery === 0;
    const cents = 50_000 + (stableHash32(`${seed}|${store}|${product}|${date}`) % 900_000);
    return {
      kind: 'price',
      recordId: null,
      store: {
        externalId: `mock-store-${store}`,
        chain: CHAINS[store % CHAINS.length] as string,
        name: `Sucursal Mock ${store} (MOCK)`,
        address: `Calle Simulada ${100 + store}`,
        city: 'Ciudad Autónoma de Buenos Aires',
        province: 'Ciudad Autónoma de Buenos Aires',
        latitude: (-34.58 - (store % 10) * 0.005).toFixed(6),
        longitude: (-58.42 - (store % 7) * 0.005).toFixed(6),
      },
      product: {
        externalId: `mock-prod-${product}`,
        ean: withoutEan ? null : mockEan(product),
        name: `Producto mock ${product}: ${presentation.label} (MOCK)`,
        brand: 'Marca Simulada',
        quantity: presentation.quantity,
        unit: presentation.unit,
        saleMode: presentation.saleMode,
        categorySlug: presentation.category,
        canonicalName: presentation.canonical,
      },
      price: formatCommaDecimal(cents),
      observedAt: date,
    };
  }

  /** Cinco formas de romper un registro, en rotación. */
  private corrupt(record: RawPriceRecord, round: number): RawPriceRecord {
    switch (round % 5) {
      case 0:
        return { ...record, price: 'abc' };
      case 1:
        return { ...record, price: '-10,00' };
      case 2:
        return { ...record, product: { ...record.product, unit: 'XX' } };
      case 3:
        return { ...record, store: { ...record.store, name: ' ' } };
      default:
        return { ...record, observedAt: '2026-02-30' };
    }
  }
}

export class MockPromotionProvider implements PromotionProvider {
  readonly source = MOCK_SOURCE;
  readonly decimalSeparator = ',' as const;

  constructor(private readonly anchorDate: string = yesterday()) {}

  async *records(): AsyncGenerator<ProviderPromotionItem> {
    const from = shiftDate(this.anchorDate, -1);
    const until = shiftDate(this.anchorDate, 7);
    const base = { kind: 'promotion' as const, validFrom: from, validUntil: until };
    yield { ...base, externalId: 'mock-promo-1', name: 'Arroz mock con 10% (MOCK)', type: 'PERCENTAGE', chain: 'Coto', productExternalId: 'mock-prod-0', discountPercentage: '10,00' };
    yield { ...base, externalId: 'mock-promo-2', name: 'Fideos mock 2x1 (MOCK)', type: 'TWO_FOR_ONE', storeExternalId: 'mock-store-1', productExternalId: 'mock-prod-1' };
    yield { ...base, externalId: 'mock-promo-3', name: 'Aceite mock a precio fijo llevando 2 (MOCK)', type: 'FIXED_PRICE', storeExternalId: 'mock-store-0', productExternalId: 'mock-prod-2', fixedPrice: '999,99', requiredQuantity: 2 };
    // Inválida: un porcentaje mayor que 100 no se guarda.
    yield { ...base, externalId: 'mock-promo-4', name: 'Descuento imposible (MOCK)', type: 'PERCENTAGE', chain: 'Vea', discountPercentage: '150,00' };
    // Sucursal que esta fuente no conoce: no se inventa.
    yield { ...base, externalId: 'mock-promo-5', name: 'Sucursal inexistente (MOCK)', type: 'PERCENTAGE', storeExternalId: 'mock-store-9999', discountPercentage: '5,00' };
    yield {
      ...base,
      externalId: 'mock-promo-6',
      name: '20% con tarjeta del Banco Simulado (MOCK)',
      type: 'BANK_DISCOUNT',
      chain: 'Carrefour',
      discountPercentage: '20,00',
      paymentMethod: 'CREDIT_CARD',
      bank: 'Banco Simulado',
      discountCap: '3.000,00',
      capPeriod: 'PURCHASE',
    };
  }
}
