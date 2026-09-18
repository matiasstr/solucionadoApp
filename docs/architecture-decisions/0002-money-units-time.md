# ADR 0002 — Dinero, unidades, historia y calendario

Estado: aceptado. Fecha: 2026-09-17.

## Decisión

Persistir dinero y cantidades con Decimal y transportar sus representaciones como strings. Usar ARS inicialmente. Comparar KG, L o UNIT después de convertir G/ML dentro de su dimensión; 100 g es una presentación de un precio por KG. No convertir masa en volumen sin datos físicos explícitos.

Modelar tamaño de envase separado de la cantidad necesaria y distinguir venta por peso. Comprar envases enteros cuando corresponda. Observaciones de precio se insertan con identidad de origen y no sustituyen las anteriores. El precio actual es la última observación válida para producto/sucursal/fuente según precedencia explícita; no mezclar sucursales al analizar historia.

Persistir instantes UTC con zona y fechas de calendario sin hora donde corresponda. Semanas y horarios de compra se interpretan en `America/Argentina/Buenos_Aires`. Frecuencia por intervalo en días y fecha ancla: 15 días no equivale a dos semanas y un mes calendario requiere decisión futura.

## Consecuencias

Rounding monetario se aplica al total facturable; cálculos intermedios preservan precisión. Los tests cubren envases, unidades incompatibles, historia duplicada y límites de fecha. La normalización no se confía al frontend.
