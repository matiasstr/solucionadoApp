# Fase 7 — Arquitectura de importadores

Leer ADR de límites de dominio y schema de observaciones. Estado inicial: PENDIENTE. Esta fase entrega infraestructura extensible y mock operativo; conectar SEPA requiere verificar su fuente/contrato actual y constituye un paso posterior explícito, no un supuesto de esta guía.

## P7-01 — Puertos y pipeline por lotes

**Dependencias:** P2-01 y P2-03. **Módulos:** `imports/domain`, `imports/application`, `imports/infrastructure/providers`; normalización de productos/precios/promociones y CLI de importación. Las clases PriceImporter/PromotionImporter conservan sus nombres dentro de `imports`.

**Implementación:**

1. Crear interfaces PriceProvider, PromotionProvider, PriceImporter, PromotionImporter y ProductNormalizer con DTOs de entrada independientes de SEPA y Prisma. Ingesta mediante AsyncIterable o streams con backpressure.
2. Crear MockPriceProvider y MockPromotionProvider reproducibles; reutilizar contratos de normalización de fase 2, sin duplicar reglas de unidades/dinero.
3. Pipeline download → decompress → stream → parse → normalize → batch → database por componentes cuando aplique. Tamaño de lote y concurrencia configurables; no leer archivos completos en RAM.
4. Resolver identidad por identificadores externos/fuente y EAN validado; no fusionar productos distintos solo porque nombres se parecen. Canonicalización dudosa se deja pendiente o marcada para revisión.
5. Registrar fuente, fecha observada e identificador original. Diferenciar fecha de importación de fecha del precio. Preservar observaciones viejas y hacer idempotente el reingreso de la misma.

**Validación:** importación mock end-to-end, normalización coherente, backpressure y memoria acotada con entrada grande sintética generada en streaming; fallo a mitad de lote, registros corruptos, producto sin EAN y precio con coma decimal. Test de proveedor alternativo sin modificar dominio.

**Done:** comando manual documentado importa a DB sin depender de jobs ni servicios externos. Guardar checkpoint.

## P7-02 — Trazabilidad y reintentos

**Dependencia:** P7-01. **Archivos:** persistencia de ImportRun/quarantined records si se requiere, migraciones, métricas/resumen y documentación del contrato de proveedor.

**Implementación:**

1. Ejecución con ID, proveedor, timestamps, estado, contadores insertados/omitidos/rechazados y error sanitizado; lotes con transacciones pequeñas.
2. Idempotencia estable por fuente/registro/fecha, reintentos limitados y reanudación con cursor/checkpoint cuando la fuente lo permita. No afirmar reanudación si el stream real no puede reproducirse.
3. Cuarentena de registros inválidos con motivo y payload mínimo no sensible; fallo parcial no se comunica como éxito total.
4. Documentar cómo añadir proveedor, esquema de entrada, licencias/condiciones a verificar, límites de descarga/descompresión y protección contra archivos enormes. Configurar endpoints permitidos, no aceptar una URL arbitraria desde usuarios públicos.

**Validación:** misma importación dos veces no duplica precios; reinicio tras fallo, colisión de identidad, registros fuera de orden, duplicados y reporte de cuarentena. Verificar que importación no elimina historial ni modifica snapshot de planes.

**Done de fase:** contrato de nuevo proveedor claro, ingestión mock segura y recuperable. Actualizar README/ROADMAP/CONTINUAR; siguiente P8-01.
