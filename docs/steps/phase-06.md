# Fase 6 — Historial, oportunidades y dashboard

Leer políticas de precios actuales, unidades y ahorro. Estado inicial: PENDIENTE.

## P6-01 — Historial y PriceAnalysisService

**Dependencia:** P2-02. **Módulos:** prices, servicio de análisis puro y contratos. **Endpoint:** `GET /products/:id/price-history?storeId=&from=&to=`.

**Implementación:**

1. Devolver serie por sucursal, fuente y unidad comparable; validar límites de fecha, tamaño máximo y granularidad. No juntar sucursales en una serie como si fueran el mismo precio.
2. Calcular currentPrice, average30Days, lowest30Days y highest30Days. Definir si el promedio usa una observación diaria y cómo trata días sin datos; no sesgarlo por importadores que reportan más veces al día. Publicar cantidad de observaciones/días y período real cubierto.
3. Clasificar NORMAL, EXPENSIVE, GOOD_DEAL e HISTORIC_LOW con umbrales documentados y precedencia estable. El ejemplo de GOOD_DEAL usa menos de 85% del promedio; establecer cantidad mínima de evidencia y estado de información insuficiente.
4. “Mínimo histórico” debe indicar la ventana disponible. No usar la observación actual dentro de una base que vuelva imposible detectar un mínimo nuevo sin documentar la comparación. Datos stale/escasos no justifican etiquetas concluyentes.
5. Separar precio unitario habitual de precio con promociones condicionales y cantidades distintas. Las conclusiones se basan en series comparables.

**Validación:** tests de umbrales exactos, empate de mínimo, observación actual, días faltantes, múltiples precios por día, distinta sucursal/fuente, pocas muestras y precio antiguo. Consultar rangos inclusivos/exclusivos y límites horarios de Argentina con reloj fijo.

**Done:** análisis matemático reproducible con metadatos de calidad, documentación y pruebas. Guardar checkpoint.

## P6-02 — Historial visual y dashboard

**Dependencias:** P6-01 y P5-03. **Rutas:** `/producto/[id]` y `/dashboard`; endpoint privado de resumen si reduce composición excesiva en frontend.

**Implementación:**

1. Gráfico accesible de historial con filtro de sucursal/período, tabla o resumen equivalente y fecha/fuente de datos. Mostrar huecos sin inventar observaciones intermedias.
2. Dashboard con próxima compra, rutinas, oportunidades y ahorro estimado semanal/mensual/acumulado. Definir cómo seleccionar planes para evitar contar borradores, planes reemplazados o períodos superpuestos varias veces.
3. Mantener ahorro registrado separado. Mientras no exista registro de compras/pagos, mostrar que no hay compras registradas y **no** poblar “ahorro real” sumando estimaciones. Si se añade registro manual, documentar importe pagado, base comparable y que es informado por el usuario.
4. Estados sin rutina, sin plan o sin suficientes datos con acciones útiles. Alertas todavía no implementadas no se presentan como enviadas.

**Validación:** comparar resumen con datos persistidos; tests de períodos y duplicación; verificar que generar/completar plan no incrementa ahorro registrado. E2E de historia con filtros y dashboard con estados vacío/parcial/completo; móvil y teclado.

**Done de fase:** usuario entiende evolución del precio y ahorro estimado sin precisión ficticia. Actualizar README/ROADMAP/CONTINUAR; siguiente P7-01.
