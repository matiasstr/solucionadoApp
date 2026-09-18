# Fase 4 — Compras habituales e inventario

Leer checkpoint, schema y política de auth. Estado inicial: PENDIENTE.

## P4-01 — API privada de rutinas y despensa

**Dependencias:** P1-03 y P2-02. **Módulos:** `routines`, `inventory`, `users`; migraciones necesarias y tests de integración. El módulo interno `routines` conserva los endpoints públicos `/shopping-routines`.

**Endpoints:** `GET/POST /shopping-routines`, `GET/PATCH/DELETE /shopping-routines/:id`; `POST /shopping-routines/:id/items`, `PATCH/DELETE /shopping-routines/:id/items/:itemId`; `GET/POST /inventory`, `PATCH/DELETE /inventory/:id`; preferencias en `PATCH /users/me`.

**Implementación:**

1. CRUD de rutinas con nombre/frecuencia y items con canónico, preferido opcional, cantidad/unidad, frecuencia, sustitución y marcas preferidas/excluidas. Validar que producto preferido corresponda al canónico y sea obligatorio si `allowSubstitutes=false`; una rutina admite un item por canónico y una marca no puede estar a la vez preferida y excluida.
2. Aplicar DOMAIN/ADR 0002: `frequencyDays` y `anchorDate`, cantidad por ocurrencia y fechas del plan inclusivas. Semanal son 7 días; cada 15 días son 15. El item hereda ambos campos de la rutina o reemplaza ambos juntos. El mes calendario queda para una decisión futura, sin aproximarlo automáticamente a 30 días. El cálculo de necesidad se implementa en P5-01.
3. Inventario por usuario/canónico con cantidad no negativa y unidad compatible; normalizar unidades y evitar duplicados. Registrar fecha de actualización; no asumir consumo automático entre registros.
4. Aplicar ownership en repositorio/caso de uso para todas las operaciones, incluso items anidados. Una rutina ajena y una inexistente deben comportarse sin revelar datos privados.
5. Validar máximo de tiendas, radio y ubicación; “sin límite” debe tener representación inequívoca, separada del límite técnico de candidatos de fase 5.

**Validación:** tests CRUD, unidades inválidas, marcas incompatibles, producto preferido inválido, inventario negativo y duplicados. Dos usuarios verifican que ninguno puede listar/leer/modificar/borrar rutina, item o inventario ajeno; probar item propio bajo rutina ajena y viceversa.

**Done:** API privada completa y contratos documentados; migraciones reproducibles. Guardar checkpoint.

## P4-02 — Onboarding y páginas privadas

**Dependencias:** P4-01 y P3-02. **Rutas:** `/onboarding`, `/mis-compras`, `/mi-despensa`; panel simple de preferencias asociado al perfil.

**Implementación:**

1. Onboarding de localidad, radio 2/5/10/20 km, máximo 1/2/3/sin límite y productos habituales. Coordenadas precisas opcionales; no pedir geolocalización antes de una acción del usuario.
2. Buscador canónico para cantidades, unidades y frecuencia; preferido/marcas/sustituciones accesibles sin abrumar el flujo principal.
3. CRUD de rutinas e inventario conectado a la API, con confirmación adecuada para borrar, errores de validación comprensibles y caché invalidada correctamente.
4. Persistir progreso para retomar onboarding y evitar duplicar items al reintentar. No bloquear el uso público por onboarding incompleto.

**Validación:** onboarding completo y reanudado; 5 kg de pechuga semanal + 2 kg en despensa; edición y eliminación; localización omitida; usuario sin rutina. E2E con reload confirma persistencia; verificar teclado/móvil y limpieza de caché al logout.

**Done de fase:** necesidades y existencias pueden cargarse sin mocks de frontend. Actualizar README/ROADMAP/CONTINUAR; siguiente P5-01.
