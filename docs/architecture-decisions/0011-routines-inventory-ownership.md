# ADR 0011 — Rutinas, despensa y ownership

Estado: aceptado. Fecha: 2026-09-23. Contexto: P4-01 (API privada de rutinas y despensa). El número 0010 queda reservado para el despliegue de la API con Supabase (ver CONTINUAR.md).

## Decisión

**Ownership en cada consulta, no en un chequeo previo.** `RoutinesService` e `InventoryService` filtran por el `userId` del token en toda lectura y mutación (`findFirst`/`updateMany`/`deleteMany` con `userId`, y `routine: { userId }` para los ítems). Un ítem se busca por `id` **y** `routineId` **y** dueño de la rutina: un ítem propio bajo la URL de una rutina ajena, o uno ajeno bajo una propia, es 404. Ajeno e inexistente devuelven **el mismo cuerpo**; el UUID no es permiso ni se confirma que exista.

**Cantidades en la unidad del canónico.** La API acepta cualquier unidad de la misma dimensión (`500 G` para un canónico en KG) y guarda la unidad base (`0.5 KG`) sin redondear (`toCanonicalQuantity`, `catalog/domain/need-quantity.ts`). Lo que no entra en `numeric(14,4)` se rechaza (`0,05 g` son `0,00005 kg`). Otra dimensión es `UNIT_DIMENSION_MISMATCH`. La necesidad es estrictamente positiva; el inventario admite cero y nunca negativos.

**Frecuencia.** Intervalo de 1 a 365 días y ancla `AAAA-MM-DD` que debe ser un día real (`2026-02-30` se rechaza en vez de desplazarse). El ancla por defecto de una rutina es **hoy en `America/Argentina/Buenos_Aires`**, no en UTC. El ítem hereda ambos valores o reemplaza ambos: en un PATCH se envían juntos (`null` + `null` vuelve a heredar), y mandar solo uno es `SCHEDULE_OVERRIDE_INCOMPLETE`. El mes calendario sigue sin modelarse (ADR 0002).

**El canónico identifica al ítem.** No se puede cambiar por PATCH (se borra y se agrega otro); la unicidad `(routineId, canonicalProductId)` de la base resuelve las altas simultáneas y responde 409 `ROUTINE_ITEM_DUPLICATE`. En la despensa, `(userId, canonicalProductId)` da 409 `INVENTORY_DUPLICATE`: el cliente actualiza la fila existente en vez de crear otra.

**Reglas sobre el estado resultante.** En un PATCH, "sin sustitutos exige preferido" y "marcas preferidas y excluidas disjuntas" se evalúan sobre la combinación final, no solo sobre lo enviado. Las marcas se recortan y se deduplican sin distinguir mayúsculas ni tildes, y esa misma comparación decide el solapamiento (`Arcor` y `ARCOR` son la misma marca; el `CHECK` SQL solo compara texto exacto). El preferido debe pertenecer al canónico, compartir dimensión y estar activo **cuando se elige**; uno que se desactivó después no bloquea editar la cantidad.

**Límites.** 20 rutinas por usuario y 100 ítems por rutina, contados dentro de una transacción que bloquea la fila del usuario o de la rutina (`SELECT … FOR UPDATE`): altas simultáneas no superan el límite. La despensa queda acotada por el catálogo (una fila por canónico).

**Preferencias.** Siguen en `PATCH /users/me`. `maxStoresPerShoppingPlan: null` es "sin límite" y cero es inválido; es una preferencia del usuario, independiente del límite técnico de candidatos del optimizador (fase 5). `maxTravelDistanceKm` va de 0,1 a 100 km, el mismo rango que `radiusKm` en la API pública. Ciudad y provincia se envían y se borran juntas, como latitud y longitud. Las columnas no nulas rechazan `null` con 400 (antes llegaba a la base y era 500).

**Sin capas vacías.** Son CRUD con reglas puras en `routines/domain/routine-rules.ts`; los servicios usan Prisma directamente, como `UsersService`. No se agregó migración: el schema de P1-02 ya tenía las tablas, la unicidad y los `CHECK`.

## Consecuencias

- La web (P4-02) puede reintentar un alta sin duplicar: un 409 indica que la fila ya existe y hay que editarla.
- El planificador (P5-01) lee cantidades ya normalizadas y `schedule` resuelto, sin volver a convertir unidades.
- Si aparece un caso real de "mes calendario", se modela como otro tipo de frecuencia; no se reinterpreta `frequencyDays`.
