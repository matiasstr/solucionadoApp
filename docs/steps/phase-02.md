# Fase 2 — Catálogo, sucursales y precios

**Entrada:** leer CONTINUAR, ROADMAP y decisiones de dominio. Todos los pasos de esta guía empiezan PENDIENTES. Respetar schema existente y agregar migraciones para cambios.

## P2-01 — Datos, normalización y seed

**Dependencia:** P1-02. **Módulos/archivos:** `catalog` (agrupa productos, productos canónicos y categorías), `stores`, `prices`; Prisma seed y utilidades de cantidades/importes compartidas solo cuando sea necesario. Conservar los endpoints originales aunque compartan módulo interno.

**Implementación:**

1. Materializar entidades Category jerárquica, CanonicalProduct, Product, StoreChain, Store y ProductPrice con repositorios concretos y casos de uso pequeños.
2. Product representa una presentación concreta; EAN nullable; vínculo canónico opcional. No equiparar fresco/congelado o marcas distintas como producto exacto.
3. Implementar conversión dimensional kg/g, L/mL y unidades; precio por kg/L/unidad y visualización por 100 g cuando corresponda. Registrar claramente precio de envase vs precio de producto vendido a granel. Evitar convertir masa a volumen sin una regla explícita.
4. Guardar observaciones append-only con fuente, observedAt y clave idempotente. Definir criterio de precio actual por producto/sucursal, desempate y umbral configurable de antigüedad.
5. Crear `db:seed` repetible con Carrefour, Coto, Jumbo, Vea y Disco; sucursales ficticias, productos habituales pedidos, equivalentes, distintas presentaciones y precios de al menos 30 días. Usar una fecha ancla controlable para que las pruebas no caduquen.
6. Marcar todo el dataset como DEMO; nunca atribuir precios ficticios a una consulta real. Seed no elimina datos del usuario ni se ejecuta automáticamente en producción.

**Validación:** tests de PriceNormalizer, conversión de unidades, precisión decimal, envases, granel, cero/negativos e incompatibilidad dimensional. Ejecutar seed dos veces sin duplicación; verificar historial conservado y fuentes/fechas visibles. Integración de consulta espacial y selección de último precio.

**Done:** catálogo demo reproducible y normalización probada; agregar a README ejemplos, `db:seed` y política de frescura. Guardar checkpoint.

## P2-02 — API del catálogo y precios

**Dependencia:** P2-01. **Archivos:** DTOs, controllers, casos de uso y repositorios de módulos anteriores.

**Endpoints:** `GET /products`, `/products/:id`, `/products/:id/prices`; `GET /canonical-products`, `/canonical-products/:id`; `GET /stores`, `/stores/:id`. La historia se implementa en fase 6.

**Implementación:** búsqueda inicial, paginación limitada, filtros válidos y orden estable; precios por sucursal con unidad comparable, fuente y fecha; consultas PostGIS por latitud/longitud/radio. Si no hay coordenadas, permitir localidad sin afirmar distancia exacta. Serializar Decimal y fechas mediante contratos compartidos documentados.

**Validación:** integración de filtros/paginación, producto inexistente, parámetros inválidos, precios ausentes/antiguos, radio en km convertido correctamente a metros y exactitud de agrupación por sucursal. Verificar consultas parametrizadas e índices relevantes.

**Done:** API usable con seed y ejemplos de requests/responses; no exponer entidades Prisma crudas como contrato público. Guardar checkpoint.

## P2-03 — Promociones simples antes del optimizador

**Dependencia:** P2-01. **Módulos:** `promotions/domain`, calculador puro, persistencia, fixtures/seed y tests. Preparar `GET /promotions` si se necesita listar promociones visibles.

**Implementación:**

1. Implementar PERCENTAGE, SECOND_UNIT, TWO_FOR_ONE y FIXED_PRICE con vigencia, alcance producto/canónico/sucursal/cadena y cantidad requerida. Definir prioridad y exclusividad; por defecto no acumular promociones sin una regla explícita.
2. Calcular grupos completos y remanentes: tres unidades en 2×1 pagan dos; descuento de segunda unidad aplica a parejas elegibles. Resolver redondeos de dinero una sola vez según ADR.
3. Para productos envasados, comprar cantidades enteras y mostrar excedente. Para granel, permitir fracciones solo si la presentación lo admite. Rechazar reglas incompletas.
4. Agregar promociones demo activas/futuras/vencidas. BANK_DISCOUNT queda modelado pero **no se aplica** hasta P10-01; no asumir banco o medio de pago del usuario.

**Validación:** tests de tipos, cantidad impar, mínima cantidad, expiración, huso horario argentino, redondeo, conflicto de promociones y límites de aplicación por sucursal/cadena. Ejemplo de precio por envase más promoción que cambia la alternativa más barata.

**Done de fase:** catálogo y promociones simples proporcionan costos deterministas y trazables; tests son reutilizables por fase 5. Actualizar README/ROADMAP/CONTINUAR; siguiente P3-01.
