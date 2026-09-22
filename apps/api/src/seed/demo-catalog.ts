/**
 * Dataset DEMO del catálogo (P2-01). Datos ficticios para desarrollo y pruebas.
 *
 * Los nombres de cadena son reales porque el producto compara esas cadenas, pero
 * **las sucursales, los productos, las marcas y todos los precios son inventados**:
 * llevan el sufijo `(DEMO)` y sus observaciones usan `source = 'demo-seed'`.
 * Ningún precio de acá puede presentarse como una consulta real.
 */
import type { BaseUnit, MeasurementUnit, SaleMode } from '../modules/catalog/domain/units';
import type { DiscountCapPeriod, PaymentMethod, PromotionType } from '../modules/promotions/domain/promotion.types';

export const DEMO_SOURCE = 'demo-seed';
export const DEMO_SUFFIX = ' (DEMO)';
/** Hora fija de observación (12:00 UTC ≈ 09:00 en Argentina). */
export const DEMO_OBSERVATION_HOUR_UTC = 12;

export interface DemoCategory {
  readonly slug: string;
  readonly name: string;
  readonly parentSlug?: string;
}

export interface DemoCanonicalProduct {
  readonly key: string;
  readonly name: string;
  readonly categorySlug: string;
  readonly defaultUnit: BaseUnit;
}

export interface DemoProduct {
  readonly key: string;
  readonly name: string;
  readonly canonicalKey: string;
  readonly quantity: string;
  readonly unit: MeasurementUnit;
  readonly brand?: string;
  readonly saleMode?: SaleMode;
  readonly packageCount?: number;
  /** Código interno ficticio (prefijo 29, reservado para uso interno en GS1). */
  readonly eanSeed?: string;
  /** Precio ficticio en centavos de ARS en la fecha ancla, antes del ajuste por cadena. */
  readonly basePriceCents: number;
}

export interface DemoChain {
  readonly key: string;
  readonly name: string;
  /** Nivel de precios de la cadena, en porcentaje del precio base. */
  readonly pricePercent: number;
}

export interface DemoStore {
  readonly key: string;
  readonly chainKey: string;
  readonly name: string;
  readonly address: string;
  readonly city: string;
  readonly province: string;
  /** Sin coordenadas solo hay localidad: no se puede afirmar distancia. */
  readonly latitude?: string;
  readonly longitude?: string;
  /** Ajuste propio de la sucursal, en porcentaje. */
  readonly pricePercent?: number;
  /** Cada cuántos días observa precios (1 = todos los días). */
  readonly observeEveryDays?: number;
  /** Días antes de la fecha ancla en que dejó de informar precios. */
  readonly stopsDaysBeforeAnchor?: number;
}

export const DEMO_CATEGORIES: readonly DemoCategory[] = [
  { slug: 'alimentos', name: 'Alimentos' },
  { slug: 'almacen', name: 'Almacén', parentSlug: 'alimentos' },
  { slug: 'lacteos', name: 'Lácteos', parentSlug: 'alimentos' },
  { slug: 'frutas-y-verduras', name: 'Frutas y verduras', parentSlug: 'alimentos' },
  { slug: 'carnes', name: 'Carnes', parentSlug: 'alimentos' },
  { slug: 'bebidas', name: 'Bebidas' },
  { slug: 'limpieza', name: 'Limpieza' },
];

export const DEMO_CANONICAL_PRODUCTS: readonly DemoCanonicalProduct[] = [
  { key: 'arroz-largo-fino', name: 'Arroz largo fino', categorySlug: 'almacen', defaultUnit: 'KG' },
  { key: 'fideos-secos', name: 'Fideos secos tipo tallarín', categorySlug: 'almacen', defaultUnit: 'KG' },
  { key: 'aceite-girasol', name: 'Aceite de girasol', categorySlug: 'almacen', defaultUnit: 'L' },
  { key: 'azucar', name: 'Azúcar común tipo A', categorySlug: 'almacen', defaultUnit: 'KG' },
  { key: 'yerba-mate', name: 'Yerba mate con palo', categorySlug: 'almacen', defaultUnit: 'KG' },
  { key: 'harina-000', name: 'Harina de trigo 000', categorySlug: 'almacen', defaultUnit: 'KG' },
  { key: 'huevos', name: 'Huevos de gallina', categorySlug: 'almacen', defaultUnit: 'UNIT' },
  { key: 'leche-entera', name: 'Leche entera', categorySlug: 'lacteos', defaultUnit: 'L' },
  { key: 'queso-cremoso', name: 'Queso cremoso', categorySlug: 'lacteos', defaultUnit: 'KG' },
  { key: 'manteca', name: 'Manteca', categorySlug: 'lacteos', defaultUnit: 'KG' },
  { key: 'banana', name: 'Banana', categorySlug: 'frutas-y-verduras', defaultUnit: 'KG' },
  { key: 'papa', name: 'Papa', categorySlug: 'frutas-y-verduras', defaultUnit: 'KG' },
  { key: 'pollo-entero', name: 'Pollo entero fresco', categorySlug: 'carnes', defaultUnit: 'KG' },
  { key: 'gaseosa-cola', name: 'Gaseosa cola', categorySlug: 'bebidas', defaultUnit: 'L' },
  { key: 'agua-mineral', name: 'Agua mineral sin gas', categorySlug: 'bebidas', defaultUnit: 'L' },
  { key: 'detergente', name: 'Detergente para vajilla', categorySlug: 'limpieza', defaultUnit: 'L' },
  { key: 'lavandina', name: 'Lavandina', categorySlug: 'limpieza', defaultUnit: 'L' },
  { key: 'papel-higienico', name: 'Papel higiénico doble hoja', categorySlug: 'limpieza', defaultUnit: 'UNIT' },
];

export const DEMO_PRODUCTS: readonly DemoProduct[] = [
  // Misma necesidad con presentaciones distintas: el precio por KG las hace comparables.
  { key: 'arroz-pampa-1kg', name: 'Arroz largo fino Pampa 1 kg', canonicalKey: 'arroz-largo-fino', brand: 'Pampa', quantity: '1', unit: 'KG', eanSeed: '290000000001', basePriceCents: 129000 },
  { key: 'arroz-pampa-500g', name: 'Arroz largo fino Pampa 500 g', canonicalKey: 'arroz-largo-fino', brand: 'Pampa', quantity: '500', unit: 'G', eanSeed: '290000000002', basePriceCents: 72000 },
  { key: 'arroz-delsur-1kg', name: 'Arroz largo fino Del Sur 1 kg', canonicalKey: 'arroz-largo-fino', brand: 'Del Sur', quantity: '1', unit: 'KG', eanSeed: '290000000003', basePriceCents: 118000 },
  { key: 'fideos-pampa-500g', name: 'Fideos tallarín Pampa 500 g', canonicalKey: 'fideos-secos', brand: 'Pampa', quantity: '500', unit: 'G', eanSeed: '290000000004', basePriceCents: 145000 },
  { key: 'fideos-delsur-500g', name: 'Fideos tallarín Del Sur 500 g', canonicalKey: 'fideos-secos', brand: 'Del Sur', quantity: '500', unit: 'G', eanSeed: '290000000005', basePriceCents: 132000 },
  { key: 'aceite-delsur-900ml', name: 'Aceite de girasol Del Sur 900 ml', canonicalKey: 'aceite-girasol', brand: 'Del Sur', quantity: '900', unit: 'ML', eanSeed: '290000000006', basePriceCents: 289000 },
  { key: 'aceite-delsur-15l', name: 'Aceite de girasol Del Sur 1,5 L', canonicalKey: 'aceite-girasol', brand: 'Del Sur', quantity: '1.5', unit: 'L', eanSeed: '290000000007', basePriceCents: 459000 },
  { key: 'azucar-pampa-1kg', name: 'Azúcar Pampa 1 kg', canonicalKey: 'azucar', brand: 'Pampa', quantity: '1', unit: 'KG', eanSeed: '290000000008', basePriceCents: 135000 },
  { key: 'yerba-nuestra-500g', name: 'Yerba mate Nuestra Tierra 500 g', canonicalKey: 'yerba-mate', brand: 'Nuestra Tierra', quantity: '500', unit: 'G', eanSeed: '290000000009', basePriceCents: 345000 },
  { key: 'yerba-nuestra-1kg', name: 'Yerba mate Nuestra Tierra 1 kg', canonicalKey: 'yerba-mate', brand: 'Nuestra Tierra', quantity: '1', unit: 'KG', eanSeed: '290000000010', basePriceCents: 629000 },
  { key: 'harina-pampa-1kg', name: 'Harina 000 Pampa 1 kg', canonicalKey: 'harina-000', brand: 'Pampa', quantity: '1', unit: 'KG', eanSeed: '290000000011', basePriceCents: 98000 },
  // Docena de huevos: quantity=12 UNIT y packageCount=1 (un solo envase).
  { key: 'huevos-serrana-docena', name: 'Huevos color Granja Serrana docena', canonicalKey: 'huevos', brand: 'Granja Serrana', quantity: '12', unit: 'UNIT', eanSeed: '290000000012', basePriceCents: 389000 },
  { key: 'huevos-serrana-media', name: 'Huevos color Granja Serrana media docena', canonicalKey: 'huevos', brand: 'Granja Serrana', quantity: '6', unit: 'UNIT', eanSeed: '290000000013', basePriceCents: 209000 },
  { key: 'leche-vallealto-sachet', name: 'Leche entera Valle Alto sachet 1 L', canonicalKey: 'leche-entera', brand: 'Valle Alto', quantity: '1', unit: 'L', eanSeed: '290000000014', basePriceCents: 129000 },
  { key: 'leche-vallealto-botella', name: 'Leche entera Valle Alto botella 1 L', canonicalKey: 'leche-entera', brand: 'Valle Alto', quantity: '1', unit: 'L', eanSeed: '290000000015', basePriceCents: 149000 },
  // Venta por peso: quantity/unit es la base de cotización (1 KG), no lo que se compra.
  { key: 'queso-cremoso-granel', name: 'Queso cremoso por kg', canonicalKey: 'queso-cremoso', quantity: '1', unit: 'KG', saleMode: 'VARIABLE_WEIGHT', basePriceCents: 890000 },
  { key: 'manteca-vallealto-200g', name: 'Manteca Valle Alto 200 g', canonicalKey: 'manteca', brand: 'Valle Alto', quantity: '200', unit: 'G', eanSeed: '290000000016', basePriceCents: 219000 },
  { key: 'banana-granel', name: 'Banana por kg', canonicalKey: 'banana', quantity: '1', unit: 'KG', saleMode: 'VARIABLE_WEIGHT', basePriceCents: 189000 },
  { key: 'papa-granel', name: 'Papa por kg', canonicalKey: 'papa', quantity: '1', unit: 'KG', saleMode: 'VARIABLE_WEIGHT', basePriceCents: 99000 },
  { key: 'papa-bolsa-2kg', name: 'Papa lavada bolsa 2 kg', canonicalKey: 'papa', quantity: '2', unit: 'KG', eanSeed: '290000000017', basePriceCents: 179000 },
  { key: 'pollo-entero-granel', name: 'Pollo entero fresco por kg', canonicalKey: 'pollo-entero', quantity: '1', unit: 'KG', saleMode: 'VARIABLE_WEIGHT', basePriceCents: 329000 },
  { key: 'gaseosa-cola-225', name: 'Gaseosa cola Del Plata 2,25 L', canonicalKey: 'gaseosa-cola', brand: 'Del Plata', quantity: '2.25', unit: 'L', eanSeed: '290000000018', basePriceCents: 259000 },
  // Pack de 6 botellas de 2,25 L: quantity es el contenido total (13,5 L), no se multiplica de nuevo.
  { key: 'gaseosa-cola-pack6', name: 'Gaseosa cola Del Plata pack 6 x 2,25 L', canonicalKey: 'gaseosa-cola', brand: 'Del Plata', quantity: '13.5', unit: 'L', packageCount: 6, eanSeed: '290000000019', basePriceCents: 1390000 },
  { key: 'agua-serrana-2l', name: 'Agua mineral Sierra Clara 2 L', canonicalKey: 'agua-mineral', brand: 'Sierra Clara', quantity: '2', unit: 'L', eanSeed: '290000000020', basePriceCents: 119000 },
  { key: 'agua-serrana-pack6', name: 'Agua mineral Sierra Clara pack 6 x 1,5 L', canonicalKey: 'agua-mineral', brand: 'Sierra Clara', quantity: '9', unit: 'L', packageCount: 6, eanSeed: '290000000021', basePriceCents: 489000 },
  { key: 'detergente-brillo-750ml', name: 'Detergente Brillo Total 750 ml', canonicalKey: 'detergente', brand: 'Brillo Total', quantity: '750', unit: 'ML', eanSeed: '290000000022', basePriceCents: 199000 },
  { key: 'lavandina-brillo-1l', name: 'Lavandina Brillo Total 1 L', canonicalKey: 'lavandina', brand: 'Brillo Total', quantity: '1', unit: 'L', eanSeed: '290000000023', basePriceCents: 89000 },
  { key: 'papel-suave-4u', name: 'Papel higiénico Suave Hogar 4 rollos', canonicalKey: 'papel-higienico', brand: 'Suave Hogar', quantity: '4', unit: 'UNIT', eanSeed: '290000000024', basePriceCents: 329000 },
];

export const DEMO_CHAINS: readonly DemoChain[] = [
  { key: 'carrefour', name: 'Carrefour', pricePercent: 100 },
  { key: 'coto', name: 'Coto', pricePercent: 103 },
  { key: 'jumbo', name: 'Jumbo', pricePercent: 108 },
  { key: 'vea', name: 'Vea', pricePercent: 97 },
  { key: 'disco', name: 'Disco', pricePercent: 105 },
];

export const DEMO_STORES: readonly DemoStore[] = [
  { key: 'carrefour-almagro', chainKey: 'carrefour', name: 'Carrefour Almagro', address: 'Av. Corrientes 4200', city: 'Ciudad Autónoma de Buenos Aires', province: 'Ciudad Autónoma de Buenos Aires', latitude: '-34.603700', longitude: '-58.420600' },
  { key: 'carrefour-san-martin', chainKey: 'carrefour', name: 'Carrefour San Martín', address: 'Av. San Martín 2100', city: 'San Martín', province: 'Buenos Aires', latitude: '-34.572200', longitude: '-58.537500', pricePercent: 101 },
  { key: 'coto-caballito', chainKey: 'coto', name: 'Coto Caballito', address: 'Av. Rivadavia 5100', city: 'Ciudad Autónoma de Buenos Aires', province: 'Ciudad Autónoma de Buenos Aires', latitude: '-34.618700', longitude: '-58.440700' },
  { key: 'coto-lanus', chainKey: 'coto', name: 'Coto Lanús', address: 'Av. Hipólito Yrigoyen 4300', city: 'Lanús', province: 'Buenos Aires', latitude: '-34.706100', longitude: '-58.392800', pricePercent: 99 },
  { key: 'jumbo-palermo', chainKey: 'jumbo', name: 'Jumbo Palermo', address: 'Av. Bullrich 345', city: 'Ciudad Autónoma de Buenos Aires', province: 'Ciudad Autónoma de Buenos Aires', latitude: '-34.576600', longitude: '-58.418900' },
  { key: 'jumbo-vicente-lopez', chainKey: 'jumbo', name: 'Jumbo Vicente López', address: 'Av. del Libertador 1200', city: 'Vicente López', province: 'Buenos Aires', latitude: '-34.527100', longitude: '-58.478400' },
  // Observa precios día por medio: la observación más reciente puede no ser de hoy.
  { key: 'vea-flores', chainKey: 'vea', name: 'Vea Flores', address: 'Av. Rivadavia 6900', city: 'Ciudad Autónoma de Buenos Aires', province: 'Ciudad Autónoma de Buenos Aires', latitude: '-34.628000', longitude: '-58.464000', observeEveryDays: 2 },
  // Sin coordenadas: solo localidad, no habilita informar distancia.
  { key: 'vea-moron', chainKey: 'vea', name: 'Vea Morón', address: 'Av. Rivadavia 18000', city: 'Morón', province: 'Buenos Aires', pricePercent: 98 },
  // Dejó de informar hace 12 días: sirve para ver precios desactualizados.
  { key: 'disco-belgrano', chainKey: 'disco', name: 'Disco Belgrano', address: 'Av. Cabildo 1800', city: 'Ciudad Autónoma de Buenos Aires', province: 'Ciudad Autónoma de Buenos Aires', latitude: '-34.562600', longitude: '-58.456000', stopsDaysBeforeAnchor: 12 },
  { key: 'disco-villa-urquiza', chainKey: 'disco', name: 'Disco Villa Urquiza', address: 'Av. Triunvirato 4500', city: 'Ciudad Autónoma de Buenos Aires', province: 'Ciudad Autónoma de Buenos Aires', latitude: '-34.574500', longitude: '-58.491300' },
];

/** Dígito de control EAN-13 sobre los 12 dígitos informados. */
export function eanCheckDigit(body: string): string {
  if (!/^\d{12}$/.test(body)) throw new RangeError('El cuerpo del EAN-13 debe tener 12 dígitos.');
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(body[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

export const demoEan = (body: string): string => `${body}${eanCheckDigit(body)}`;

/**
 * Promociones DEMO (P2-03): activas, futuras y vencidas. Las condiciones son
 * ficticias igual que los precios. Las vigencias se expresan en días respecto de
 * la fecha ancla (negativo = antes), para que el dataset no caduque.
 */
export interface DemoPromotion {
  readonly key: string;
  readonly name: string;
  readonly type: PromotionType;
  /** Alcance comercial: una sucursal o una cadena, nunca las dos. */
  readonly storeKey?: string;
  readonly chainKey?: string;
  /** Alcance de producto: como máximo uno; ninguno alcanza a todo el comercio. */
  readonly productKey?: string;
  readonly canonicalKey?: string;
  readonly discountPercentage?: string;
  readonly fixedPrice?: string;
  readonly requiredQuantity?: number;
  readonly paymentMethod?: PaymentMethod;
  readonly bank?: string;
  readonly membershipProgram?: string;
  readonly minimumSpend?: string;
  readonly discountCap?: string;
  readonly capPeriod?: DiscountCapPeriod;
  readonly eligibleWeekdays?: readonly number[];
  readonly terms?: string;
  /** Inicio de la vigencia, en días desde el ancla (negativo = pasado). */
  readonly validFromDays: number;
  /** Fin exclusivo de la vigencia, en días desde el ancla. */
  readonly validUntilDays: number;
}

export const DEMO_PROMOTIONS: readonly DemoPromotion[] = [
  { key: 'carrefour-arroz-20', name: 'Arroz Pampa 1 kg con 20% de descuento', type: 'PERCENTAGE', storeKey: 'carrefour-almagro', productKey: 'arroz-pampa-1kg', discountPercentage: '20.00', validFromDays: -3, validUntilDays: 5 },
  { key: 'coto-fideos-2x1', name: 'Fideos Pampa 500 g 2x1', type: 'TWO_FOR_ONE', chainKey: 'coto', productKey: 'fideos-pampa-500g', validFromDays: -1, validUntilDays: 6 },
  { key: 'jumbo-leche-segunda-50', name: 'Leche Valle Alto sachet: segunda unidad al 50%', type: 'SECOND_UNIT', chainKey: 'jumbo', productKey: 'leche-vallealto-sachet', discountPercentage: '50.00', validFromDays: 0, validUntilDays: 7 },
  // Precio final por unidad al llevar 2 o más.
  { key: 'disco-yerba-fija', name: 'Yerba Nuestra Tierra 500 g a precio fijo llevando 2', type: 'FIXED_PRICE', storeKey: 'disco-villa-urquiza', productKey: 'yerba-nuestra-500g', fixedPrice: '2990.00', requiredQuantity: 2, validFromDays: -2, validUntilDays: 10 },
  // Solo los martes (ISO 2): sirve para probar el calendario argentino.
  { key: 'vea-detergente-martes', name: 'Detergente con 15% los martes', type: 'PERCENTAGE', chainKey: 'vea', canonicalKey: 'detergente', discountPercentage: '15.00', eligibleWeekdays: [2], validFromDays: -5, validUntilDays: 20 },
  // Alcanza a todo el comercio, con mínimo de compra: no se aplica sin conocer el subtotal.
  { key: 'disco-belgrano-minimo', name: '10% en toda la sucursal comprando más de $20.000', type: 'PERCENTAGE', storeKey: 'disco-belgrano', discountPercentage: '10.00', minimumSpend: '20000.00', validFromDays: -3, validUntilDays: 9 },
  // Modelada pero nunca aplicada automáticamente: depende del banco del usuario (P10-01).
  { key: 'carrefour-banco-25', name: '25% con tarjeta de crédito del Banco Demo', type: 'BANK_DISCOUNT', chainKey: 'carrefour', discountPercentage: '25.00', paymentMethod: 'CREDIT_CARD', bank: 'Banco Demo', discountCap: '5000.00', capPeriod: 'PURCHASE', terms: 'Tope de $5.000 por compra. Condiciones ficticias.', validFromDays: -2, validUntilDays: 10 },
  { key: 'coto-aceite-futura', name: 'Aceite Del Sur 900 ml con 30% (próximamente)', type: 'PERCENTAGE', chainKey: 'coto', productKey: 'aceite-delsur-900ml', discountPercentage: '30.00', validFromDays: 10, validUntilDays: 20 },
  { key: 'jumbo-gaseosa-vencida', name: 'Gaseosa Del Plata 2,25 L con 25% (vencida)', type: 'PERCENTAGE', chainKey: 'jumbo', productKey: 'gaseosa-cola-225', discountPercentage: '25.00', validFromDays: -40, validUntilDays: -10 },
];
