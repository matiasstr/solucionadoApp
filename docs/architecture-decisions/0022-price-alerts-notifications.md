# ADR 0022 — Alertas de precio y bandeja de avisos

Estado: aceptado. Fecha: 2026-09-30. Contexto: P9-01 (abre la fase 9). Usa ADR 0008 (frescura), 0011 (ownership), 0016 (análisis de precios), 0020 y 0021 (jobs).

## Decisión

**Regla sobre un genérico.** Una alerta (`PriceAlertRule`) vigila un genérico (`canonicalProductId`), con presentación preferida opcional, `allowSubstitutes` y marcas excluidas, como un ítem de rutina: sin reemplazos solo cuenta la preferida; con reemplazos, cualquier presentación activa del genérico salvo las marcas excluidas (que no se aplican a la preferida, elegida a propósito). Hasta 20 por persona, con el límite resistente a altas simultáneas (bloqueo de la fila del usuario).

**Tres condiciones.** `TARGET_PRICE`: el precio **por unidad base del genérico** (KG, L o UNIT) llega al objetivo o baja de él; es lo que hace comparables dos presentaciones, y un objetivo en otra unidad se rechaza (`UNIT_DIMENSION_MISMATCH`). `HISTORIC_LOW` y `GOOD_DEAL` usan la clasificación del análisis de P6-01 (mínimo de la ventana; menos del 85 % del promedio o mínimo). Solo pesos: la base guarda `currency` con un `CHECK` a `ARS`.

**Evidencia.** Se evalúa la última observación de cada presentación en las sucursales de la zona (coordenadas y radio de la alerta o de las preferencias, o la localidad; hasta 20 sucursales), con `CurrentPriceAnalysis`, el mismo servicio que ahora usa el dashboard para sus oportunidades. Solo precios **frescos**; las oportunidades además exigen 7 días con dato (`INSUFFICIENT_DATA` si no). Se usan **precios observados sin promociones**: así una alerta nunca se dispara por una promoción que puede no aplicarle a la persona (banco, tarjeta, cantidad). Entre varios candidatos gana el menor precio por unidad; ante empate, la preferida y la sucursal más cercana. Si gana otra presentación, el aviso dice que es una alternativa.

**Cuándo avisa (sin ruido).** Disparo por flanco: avisa cuando la condición empieza a cumplirse y otra vez solo si el precio **mejora** (`notifiedUnitPrice`); si con datos frescos deja de cumplirse, se vuelve a habilitar. Sin datos frescos no se cambia nada (no se sabe). Además, `ALERT_COOLDOWN_HOURS` (24) entre dos avisos de la misma regla. Editar la regla la vuelve a habilitar.

**Seguro ante concurrencia y cambios.** La evaluación no escribe. Cada resultado se aplica en una transacción que **bloquea la regla** (`SELECT … FOR UPDATE`) y decide con el estado vigente: pausada → no avisa; borrada → nada; editada después de evaluar (`revision` distinta) → no aplica la evaluación vieja. El aviso se inserta con `ON CONFLICT DO NOTHING` sobre un índice único `(ruleId, eventKey)`, donde `eventKey` identifica la observación (producto, sucursal, fuente, fecha y precio): aunque dos procesos decidieran avisar a la vez, la misma observación no genera dos avisos. Probado con tres evaluaciones simultáneas y con el estado de la regla borrado a mano.

**Aviso interno con snapshot.** `Notification` guarda título, mensaje en español con importes en pesos, enlace a `/producto/:id` y un snapshot (motivo, producto, alternativa o no, sucursal y distancia, precio, precio por unidad, fuente, fecha observada, objetivo y análisis): un precio nuevo no cambia un aviso emitido. Borrar la alerta deja sus avisos con `ruleId: null`. Solo existe el canal dentro de la app: no hay email ni push, y ningún texto dice que se envió algo afuera.

**API y job.** `GET/POST /alerts`, `PATCH/DELETE /alerts/:id`, `GET /notifications` (cursor, `unread`, `unreadCount`) y `PATCH /notifications/:id/read` (idempotente), con ownership como rutinas y planes (ajeno = `404`). La evaluación la hace el job `CHECK_PRICE_ALERTS` (cola `alerts` del worker; payload `{ v, userId }`, reemplaza el contrato de P8-01 que nunca se había encolado), a mano o programado; `now` es el instante del job. `status.lastOutcome` explica la última evaluación para la pantalla de P9-02.

## Interfaz (P9-02)

Crear desde la ficha (`#crear-alerta`, "Avisame cuando baje") o desde "Avisame si baja" en cada resultado del buscador (link aparte de la tarjeta: un link dentro de otro no es válido). El precio objetivo se escribe por kilo, litro o unidad y la pantalla muestra el equivalente del envase (no para productos por peso ni envases de exactamente 1 unidad base). Por defecto la alerta acepta alternativas equivalentes; "Solo esta presentación" la limita. `/alertas` muestra la bandeja (nuevos, marcar leído, avisos anteriores, un aviso con precio de hace más de dos días dice que puede haber cambiado) y las alertas con su última revisión en palabras (`lastOutcome`), pausar, reanudar y borrar con confirmación en el lugar. El menú privado muestra los no leídos y el resumen los últimos tres. Los textos dicen que los avisos aparecen en la app y que no se envían emails ni mensajes; no prometen cada cuánto se revisa, porque depende de cuándo corre el job (y en producción todavía no hay worker).

## Alternativas consideradas

- **Objetivo por paquete:** natural para una sola presentación, pero no compara 500 g con 1 kg; la web puede mostrar la conversión.
- **Evaluar con promociones:** más avisos, pero exige conocer medios de pago y condiciones de cada persona para no avisar de algo que no le aplica; queda para cuando las promociones bancarias se apliquen (fase 10).
- **Avisar en cada evaluación que se cumple:** ruido diario con un precio estable.
- **Ventanas de tiempo fijas para deduplicar:** un aviso podría repetirse justo al cruzar el borde de la ventana; la observación como clave no.
- **Evaluar al importar cada precio:** acopla el importador a las alertas; un job programado alcanza y se puede correr después de cada importación.

## Consecuencias

Las alertas funcionan en local con el worker (y el job se puede programar, por ejemplo cada hora). En producción el API ya permite administrarlas, pero **no hay worker desplegado**: las reglas no se evalúan hasta desplegarlo (ADR 0021). P9-02 agrega la interfaz (crear desde producto y buscador, bandeja en el dashboard, pausar y borrar) sobre este contrato.
