# ADR 0012 — Onboarding y páginas privadas

Estado: aceptado. Fecha: 2026-09-27. Contexto: P4-02 (onboarding, `/mis-compras`, `/mi-despensa` y `/preferencias` en la web, contra la API de P4-01).

## Decisión

**Terminar el onboarding es un campo de `PATCH /users/me`, no un endpoint nuevo.** `onboardingCompleted: true` fija `onboardingCompletedAt` con la hora del servidor. Solo acepta `true` (`false`, `null` u otro tipo es 400): el cliente no elige la fecha ni puede "desmarcarlo". Es idempotente: se aplica con `updateMany … where onboardingCompletedAt IS NULL`, así un reintento o una segunda pestaña conservan la primera fecha. Enviar `onboardingCompletedAt` directamente sigue siendo 400 por `forbidNonWhitelisted`. No hubo migración: la columna existía desde P1-02.

**El progreso vive en la API; el paso, en la URL.** Cada "Continuar" guarda en la API antes de avanzar (zona y distancia en `PATCH /users/me`; productos en la rutina), así que cerrar la pestaña no pierde datos. El paso actual va en `?paso=1..4` para que "atrás" funcione. Para retomar sin `?paso=` se guarda **solo el número de paso** por cuenta en `localStorage` (`tusofertas:onboarding-step:<userId>`): no es un token ni un dato personal, y si el almacenamiento está bloqueado se vuelve al paso 1 sin perder nada de lo guardado.

**Reintentos sin duplicar.** El onboarding usa la primera rutina de la cuenta; la crea recién con el primer producto y, antes de crearla, vuelve a consultar la lista (una respuesta perdida no genera una segunda rutina). Un `409 ROUTINE_ITEM_DUPLICATE` al reintentar un alta se muestra como "ya estaba en tu lista", no como error (ADR 0011). En la despensa, `409 INVENTORY_DUPLICATE` indica editar la fila existente; el buscador además deshabilita los productos ya cargados.

**No bloquea el sitio.** Registrarse lleva a `/onboarding` (antes `/bienvenida`, que ahora redirige ahí), pero todos los pasos se pueden omitir y `/inicio`, `/buscar` y las demás páginas funcionan con el onboarding incompleto; `/inicio` muestra un aviso para continuarlo.

**Ubicación precisa solo por acción explícita.** Nada llama a `navigator.geolocation` al cargar: solo el botón "Usar mi ubicación actual". Las coordenadas se redondean a 4 decimales (unos 10 m) y se pueden quitar. Si se deniega el permiso, se sigue con la localidad.

**Flujo principal corto, opciones avanzadas plegadas.** Cantidad por compra, unidad de la dimensión del canónico y frecuencia (heredar de la lista, presets de 7/14/15/30 días o un número de días) están siempre a la vista. Presentación preferida, "acepto reemplazos" y marcas preferidas/excluidas viven en un `<details>` que se abre solo si hay un error ahí. El onboarding no las muestra. Las reglas finales las decide la API y sus errores (`fields`) se muestran junto al campo que nombran.

**Caché por usuario y limpia al salir.** Las claves de TanStack Query llevan el id del usuario (`['routines', userId]`, `['inventory', userId]`, `['me', userId]`), toda mutación invalida la lista afectada (también si falla: un 409 significa que la lista cambió) y el logout vacía la caché completa (`queryClient.clear()`, ya existente desde P1-04). Editar el perfil actualiza también el usuario de la sesión.

**Borrar pide confirmación sin ventana modal.** El botón se convierte en una pregunta con "Sí, eliminar" y "Cancelar" en el mismo lugar; el foco va a la confirmación y vuelve al botón al cancelar.

## Consecuencias

- El planificador (P5-01) puede asumir que una cuenta tiene preferencias con valores por defecto aunque nunca haya terminado el onboarding: `onboardingCompletedAt` informa, no habilita.
- Si más adelante hace falta retomar el onboarding en otro dispositivo en el paso exacto, se agrega el paso al perfil; hoy se retoma con los datos ya guardados.
- Cualquier nueva pantalla privada debe usar claves con el id del usuario y `authRequest`.
