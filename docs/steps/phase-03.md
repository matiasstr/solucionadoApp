# Fase 3 — Búsqueda y comparación

Leer checkpoint y ADRs. Estado inicial de estos pasos: PENDIENTE.

## P3-01 — Consultas de búsqueda y comparación

**Dependencias:** P2-02 y P2-03. **Módulos:** `catalog`, `prices`, `stores` y DTOs/contratos compartidos.

**Endpoints:** extender `GET /products` y `GET /products/:id/prices`; permitir obtener alternativas a través de `GET /canonical-products/:id` o una ruta de precios documentada para el canónico.

**Implementación:**

1. Búsqueda normalizada por nombre/marca/EAN, filtros categoría/cadena/localidad/radio y paginación con orden estable. Limitar longitud de query, tamaño de página y complejidad.
2. Ordenar por precio de presentación, precio por unidad y distancia. No mezclar dimensiones incompatibles ni precios de distintas fechas sin mostrarlo.
3. Distinguir coincidencia exacta de alternativa. Mostrar condiciones y cantidad mínima cuando una promoción altera el precio; mantener precio sin promoción como comparación.
4. Exponer fecha/fuente, vencimiento y estado stale; definir si se excluye un precio antiguo o se muestra como referencia. Para distancia sin coordenadas, devolver valor ausente y explicación utilizable por la UI.
5. Revisar índices y evitar N+1. Guardar formato estable de respuesta en docs/API o documentación generada.

**Validación:** pruebas de tildes, cadenas vacías, EAN, filtros combinados, paginación sin duplicados, orden decimal y precio unitario. Comparar un paquete de 500 g contra uno de 1 kg y comprobar que orden por envase y por kg puede diferir. Tests de exacto/alternativa, promociones condicionales y datos antiguos.

**Done:** API satisface consultas de la UI con datos reales de la DB demo; contratos y límites documentados. Guardar checkpoint.

## P3-02 — Pantallas de consumidor

**Dependencias:** P3-01 y P1-04. **Archivos:** `apps/web` rutas `/`, `/buscar`, `/producto/[id]`, componentes de tarjetas/filtros y queries.

**Implementación:**

1. Landing con “¿Cuánto podés ahorrar esta semana?” y buscador conectado. La comparación pública no exige login.
2. Buscador con query y filtros en URL, debounce/cancelación, estados vacíos/error/carga y botón de reintento; TanStack Query con claves que incluyan filtros.
3. Tarjetas que prioricen precio, unidad, sucursal, distancia conocida y condiciones de oferta. Formato argentino de moneda/fecha; etiqueta DEMO visible mientras corresponda.
4. Ficha con datos del producto, comparación por sucursal y alternativas etiquetadas. El historial gráfico se agrega en P6-02; no mostrar una curva ficticia fuera de los datos de seed identificados.
5. Interfaz mobile-first, teclado, labels, foco visible, contraste y tamaños táctiles. Tratar error de backend y conectividad sin perder filtros.

**Validación:** recorrido buscar → filtrar → ordenar → producto en móvil/escritorio; E2E de comparación exacta/alternativa y orden unitario; verificar URL compartible, volver atrás y datos sin ubicación. Ejecutar lint/typecheck/build del frontend.

**Done de fase:** comparación funcional end-to-end sin requerir una fuente externa. Actualizar README/ROADMAP/CONTINUAR; siguiente P4-01.
