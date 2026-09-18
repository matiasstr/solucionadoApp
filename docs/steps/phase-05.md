# Fase 5 — Planificador determinista

Leer modelo de dominio y ADRs de unidades, dinero, ubicación y promociones antes de tocar el algoritmo. Estado inicial: PENDIENTE. Esta fase depende del motor de promociones simples probado en P2-03; no posponer esos cálculos hasta fase 10.

## P5-01 — Necesidades y candidatos

**Dependencias:** P4-02 y P2-03. **Módulos:** `shopping-plans/domain` y `application`; repositorios de rutinas/inventario/precios/promociones; contratos de entrada/salida del cálculo.

**Implementación:**

1. Fijar ventana del plan y zona `America/Argentina/Buenos_Aires`. Contar ocurrencias desde `anchorDate` cada `frequencyDays` entre las fechas inclusivas del plan, multiplicando cantidad por ocurrencia según DOMAIN/ADR 0002. Consolidar items del mismo canónico compatibles y restar inventario una sola vez. Resultado mínimo cero; registrar antigüedad del inventario.
2. Obtener precios recientes y promociones vigentes para fechas candidatas. No predecir precios futuros como hechos: mostrar qué precio observado se usa como estimación y sus fechas.
3. Respetar unidades, preferencias, marcas excluidas, sustituciones y paquetes completos. Un producto preferido con sustituciones deshabilitadas debe mantenerse exacto.
4. Limitar tiendas por radio real con PostGIS cuando existen coordenadas. Si solo hay localidad, documentar selección aproximada y la imposibilidad de garantizar radio/distancia; la UI debe advertir esa incertidumbre.
5. Definir candidatos y recorte determinista con límites configurables (tiendas, productos, fechas). Conservar razones de exclusión y necesidades sin precio/stock conocido. No inventar disponibilidad.

**Validación:** tests de 5 kg requeridos − 2 kg existentes = 3 kg; inventario mayor que necesidad; frecuencias quincenales/ventanas parciales; dos rutinas con el mismo canónico sin restar dos veces; paquetes con excedente; unidades incompatibles; preferido sin sustituto; precio stale y falta de ubicación.

**Done:** generador de necesidades y candidatos puro/determinista con entradas y salidas trazables. Guardar checkpoint.

## P5-02 — Optimización y costos explicables

**Dependencia:** P5-01. **Módulos:** `ShoppingPlanOptimizer`, cálculo de promociones, política de penalidades, DTO del resultado y tests unitarios/propiedades pequeñas.

**Implementación:**

1. Definir objetivo monetario: `effectiveCostARS = productCostAfterDiscountsARS + storeVisitPenaltyARS × visits + distancePenaltyARSPerKm × modeledDistanceKm`. Las penalidades son importes en ARS; productos y descuentos no se cuentan dos veces.
2. Contar visitas por sucursal/fecha y estimar ida/vuelta desde origen para cada visita según ADR 0004. No afirmar que se calculó una ruta óptima ni combustible real.
3. Resolver exactamente sobre candidatos acotados cuando el tamaño lo permite, respetando máximo de sucursales, fechas y promociones. Considerar que una misma sucursal puede implicar más de una visita si se programan días distintos.
4. Fijar presupuesto de operaciones/tiempo y fallback determinista que conserve restricciones. Devolver `EXACT_BOUNDED` o `HEURISTIC`, recortes aplicados y limitaciones. Desempates estables; no prometer el óptimo global sobre tiendas no evaluadas.
5. Calcular base habitual y costo optimizado sobre las **mismas necesidades, cantidades de envases, cobertura y horizonte**. Aplicar ADR 0004: base inicial de canasta elegible en una sola sucursal con cobertura completa, registrando `baselineMethod` y observaciones usadas. Si no existe, documentar otro método antes de implementarlo; sin comparación válida no mostrar ahorro. Separar gasto en productos, penalidades y objetivo efectivo; ahorro de productos no equivale a ahorro efectivo. Si faltan items, marcar plan parcial y no comparar contra una base completa.
6. Emitir razones de elección, alternativas y condiciones de promoción. Para precios bancarios todavía no implementados, excluir el beneficio del cálculo.

**Validación:** 5 kg a $8.000 vs $7.000/kg elige la segunda tienda sin restricciones; segunda tienda que ahorra $500 pero suma $1.000 de penalidad se rechaza; una sola tienda obligatoria; distancias; grupos 2×1; cantidades impares; igualdad de costos; sin candidatos; límite de ejecución/fallback. Contrastar algoritmo con enumeración exhaustiva independiente en canastas pequeñas, incluyendo límites de tiendas. Verificar precisión y no sumar descuentos dos veces.

**Done:** algoritmo testeado, complejidad/recorte documentados y límites visibles en resultado. Guardar checkpoint antes de implementar UI.

## P5-03 — Plan persistido y cronograma

**Dependencia:** P5-02. **Módulos/rutas:** persistencia shopping-plans, `POST /shopping-plans/generate`, `GET /shopping-plans`, `GET /shopping-plans/:id`; `/plan-semanal`. Añadir endpoint de cambio de estado solo con contrato y validación de transiciones explícitos.

**Implementación:** guardar snapshot de cantidades/precios/promociones/base/penalidades y versión del algoritmo; precios posteriores no reescriben el plan pasado. Validar DRAFT/ACTIVE/COMPLETED/EXPIRED y ownership. Cronograma por día y sucursal, totales, motivos, excedentes, items sin resolver y fecha de estimación. Generar no descuenta inventario ni prueba una compra; completar tampoco demuestra ahorro real por sí solo. Reintentos de generación deben evitar duplicados accidentales mediante clave idempotente o mecanismo equivalente.

**Validación:** integración de generación/lectura, aislamiento entre usuarios, snapshot estable tras cambiar precios, promociones válidas en fecha recomendada, plan parcial explícito y reintento. E2E rutina → despensa → generar → cronograma → recarga con mismo resultado.

**Done de fase:** usuario obtiene una recomendación explicable y guardada; ahorro etiquetado “estimado”. Actualizar README/ROADMAP/CONTINUAR; siguiente P6-01.
