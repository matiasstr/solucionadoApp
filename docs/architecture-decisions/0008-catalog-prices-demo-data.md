# ADR 0008 — Aritmética decimal propia, precio actual y datos DEMO

Estado: aceptado. Fecha: 2026-09-21. Contexto: P2-01 (catálogo, sucursales, precios históricos, unidades y seed).

## Decisión

**Aritmética decimal en el dominio.** `DecimalValue` (`apps/api/src/modules/catalog/domain/decimal.ts`) representa importes y cantidades como un entero `BigInt` escalado, con redondeo HALF_UP, el mismo criterio que `numeric` en PostgreSQL. El dominio no importa el `Decimal` del cliente Prisma ni agrega una dependencia nueva: mantiene la regla de ADR 0001 (dominio independiente de Prisma y Nest) y evita tocar el lockfile multiplataforma. Los repositorios traducen: escriben cadenas y exponen cadenas con la escala de la columna (`price` 2, `unitPrice` 6, cantidades sin ceros sobrantes).

**Normalización de precios.** `normalizePrice` calcula `unitPrice = price / contenidoEnUnidadBase` y **rechaza** en lugar de corregir en silencio: importes o cantidades no positivos, precios con más de dos decimales (la columna `numeric(14,2)` los redondearía sin avisar), cantidades con más de cuatro decimales, desbordes, dimensiones incompatibles entre producto y canónico, venta por peso con unidad de conteo y precios por unidad que se redondean a cero. `PACKAGED` cotiza el paquete completo; `VARIABLE_WEIGHT`, su base de cotización.

**Precio actual y frescura.** El precio actual de un producto en una sucursal es la observación con `observedAt` más reciente. Desempate determinista: precedencia de fuente configurable (`PRICE_SOURCE_PRECEDENCE`), `ingestedAt` más reciente, nombre de fuente y, por último, id. El umbral de antigüedad es `PRICE_MAX_AGE_DAYS` (7 por defecto): al superarlo la observación se marca `isStale` pero **no se oculta**; viaja con fecha y fuente. La consulta SQL (`DISTINCT ON` por sucursal) ordena igual que la función de dominio, con `array_position` para la precedencia.

**Identidad de las observaciones.** La clave idempotente se deriva de producto, sucursal y día observado, o del identificador del proveedor cuando existe. Un reintento con la misma clave y mismo contenido es `duplicate`; con contenido distinto es `conflict` y no sobrescribe. El trigger `ProductPrice_append_only` rechaza `UPDATE`/`DELETE` con `ERRCODE = restrict_violation` (23001), que Prisma reporta como `P2003`: el mensaje no menciona el trigger, pero la escritura se rechaza igual.

**Datos DEMO.** El seed usa nombres reales de cadenas (Carrefour, Coto, Jumbo, Vea, Disco) porque el producto compara esas cadenas, pero **sucursales, marcas, productos y precios son ficticios**. Se marcan de tres formas: sufijo `(DEMO)` en nombre de producto y sucursal, `source = 'demo-seed'` e `importBatchId = demo-seed:<fecha ancla>`. Los ids son UUID v5 deterministas derivados de una clave estable, así el seed es idempotente sin agregar unicidades artificiales al schema. Los EAN demo usan el prefijo 29, reservado por GS1 para uso interno, con dígito de control válido.

El seed nunca corre en producción ni contra una base remota sin `SEED_ALLOW_REMOTE=true`, y nunca borra datos.

## Alternativas consideradas

- **Usar `Prisma.Decimal` (decimal.js) en el dominio:** menos código, pero acopla el dominio al cliente generado, contra ADR 0001.
- **Agregar `decimal.js` como dependencia:** implica regenerar el lockfile, que hoy tiene entradas de binarios Linux reconstruidas a mano para que compile en Vercel (ver CONTINUAR.md).
- **Deduplicar el seed por nombre normalizado:** frágil y contrario a `docs/DOMAIN.md`, que prohíbe deduplicar productos solo por nombre.
- **Ocultar los precios viejos:** haría desaparecer sucursales sin explicación; se prefiere mostrarlos marcados con su fecha.

## Consecuencias

Los importes nunca pasan por `number` en el backend. Un importador que envíe tres decimales recibe un error explícito en vez de una diferencia silenciosa de centavos. Cambiar el umbral de frescura o la precedencia de fuentes es configuración, no código. El dataset demo es reproducible: misma fecha ancla, mismos ids, mismos precios; correr el seed dos veces no agrega filas. Cuando aparezcan fuentes reales (fase 7) habrá que declarar su precedencia y el conflicto de contenido deberá registrarse en un log operativo.
