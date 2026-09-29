# ADR 0017 — Dashboard: ahorro estimado sin duplicar y oportunidades

Estado: aceptado. Fecha: 2026-09-29. Contexto: P6-02 (cierra la fase 6). Usa ADR 0004 (ahorro honesto), 0015 (estados de planes) y 0016 (análisis de precios).

## Decisión

**Un endpoint privado de resumen.** `GET /dashboard` compone en el servidor la próxima compra, las rutinas, el ahorro estimado y las oportunidades: armarlo en la web exigiría bajar todos los planes y el historial de cada producto. Filtra todo por el usuario del token y responde `Cache-Control: no-store`.

**Qué planes cuentan para el ahorro estimado** (`selectPlansForSavings`, función pura):

- Solo los que la persona eligió seguir: `COMPLETED` siempre y `ACTIVE` mientras su ventana siga abierta. Un `DRAFT`, un plan reemplazado (vuelto a borrador al activar otro) o un `ACTIVE` que venció sin completarse no suman.
- Si dos elegibles se superponen en fechas, cuenta **uno**: el completado antes que el activo y, entre iguales, el generado más recientemente (la versión vigente de ese período).
- Semana (ISO, lunes a domingo), mes calendario y acumulado se asignan por la **fecha de inicio** del plan, en calendario argentino: cada plan cae en un solo período.
- Un plan sin base comparable (`baselineMethod = 'NONE'`) no suma y se informa aparte (`plansWithoutBaseline`); uno con ahorro negativo resta, porque eso fue lo estimado.

**Ahorro registrado: no existe.** No hay registro de compras ni pagos, así que la respuesta trae `registered: { available: false, message }` y la pantalla lo dice. Completar un plan no crea ahorro registrado ni convierte el estimado en real.

**Próxima compra.** Del plan `ACTIVE` vigente; si no hay, del `DRAFT` vigente más nuevo (marcado como borrador). Es el primer día del plan con compras desde hoy; si todos pasaron, el último con `dateHasPassed: true`.

**Oportunidades.** Productos de las rutinas del usuario con las mismas reglas del plan: sin reemplazos solo la presentación elegida, marcas excluidas afuera, solo presentaciones activas. En las sucursales de su zona (hasta 20: las más cercanas con coordenadas o las de su localidad), se analiza cada serie con ADR 0016 y se muestran solo `HISTORIC_LOW` y `GOOD_DEAL` (nunca un precio viejo ni con pocos datos), primero los mínimos y después la mayor rebaja, hasta 10. Sin rutinas, sin zona o sin sucursales se informa el motivo.

**Web.** `/dashboard` ("Resumen" en la barra). `/producto/[id]` suma el historial: una sucursal a la vez (selector con la etiqueta de cada una), período de 30, 90 o 180 días, sucursal y período en la URL (`sucursal`, `periodo`), gráfico SVG propio que une solo días consecutivos (un hueco corta la línea, un día aislado es un punto), línea de promedio, título y descripción accesibles, tabla equivalente y la etiqueta explicada con sus números. Sin dependencias nuevas: el lockfile tiene entradas de binarios reconstruidas a mano (ver CONTINUAR, Deploy).

## Alternativas consideradas

- **Sumar el ahorro de todos los planes generados:** contaría varias veces la misma semana.
- **Contar planes activos vencidos:** no sabemos si se siguieron; completarlos es la acción que lo dice.
- **Asignar el ahorro a los días de la ventana:** un plan que cruza fin de mes quedaría partido en dos meses con importes prorrateados que nadie calculó.
- **Librería de gráficos:** agrega peso y toca el lockfile; un SVG simple alcanza para una serie diaria.

## Consecuencias

El resumen se puede recalcular siempre igual desde los planes guardados. Cuando exista registro de compras (evolución futura), el ahorro registrado tendrá su propio cálculo con importe pagado y base comparable declarada, sin mezclarse con este.
