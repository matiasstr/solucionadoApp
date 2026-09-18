# Fase 9 — Alertas y notificaciones

Leer reglas de análisis, ownership y jobs. Estado inicial: PENDIENTE. El primer canal es dentro de la aplicación; email/push requieren proveedor, configuración y consentimiento explícitos antes de entregar mensajes reales.

## P9-01 — Reglas y bandeja persistida

**Dependencias:** P8-02 y P6-02. **Módulos:** `alerts`, `notifications`, CHECK_PRICE_ALERTS, modelos Prisma/migraciones y contratos.

**Endpoints propuestos:** `GET/POST /alerts`, `PATCH/DELETE /alerts/:id`; `GET /notifications`, `PATCH /notifications/:id/read`. Confirmar contrato antes de implementar y documentar cualquier ajuste.

**Implementación:**

1. Suscripción por producto/canónico con precio objetivo o oportunidad histórica, radio/preferencias y estado activo. Validar moneda/unidad y límites de reglas por usuario.
2. Evaluar con precios frescos y evidencia suficiente; una alerta por alternativa debe decirlo y respetar preferencias. No notificar precios vencidos ni promociones inelegibles.
3. Crear notificación interna con snapshot de motivo, fuente, precio, fecha y enlace. Deduplicar por regla/evento/ventana; cooldown configurable y restricción única resistente a concurrencia.
4. Ownership en reglas y notificaciones. Usuarios pueden pausar/borrar reglas; jobs leen estado vigente antes de enviar.

**Validación:** cruce de umbral, nuevo mínimo, pocos datos, precio stale, sustituto no permitido, regla pausada, job duplicado y usuarios distintos. Verificar que dos workers no crean dos avisos iguales.

**Done:** job crea avisos internos reales y seguros, con API y persistencia testeadas. Guardar checkpoint.

## P9-02 — UX de alertas y preferencias

**Dependencia:** P9-01. **Rutas/componentes:** creación desde `/producto/[id]` y buscador; bandeja/resumen en `/dashboard`, administración de reglas y preferencias.

**Implementación:** mostrar alertas activas, motivo de aviso y fecha del precio; permitir marcar leído, pausar y eliminar. Manejar ausencia de datos recientes y oportunidad expirada. No afirmar “te enviamos un email” si solo existe notificación interna. Preparar interfaz de canal para futuras integraciones sin simular envíos.

**Validación:** E2E crear regla → importar precio que cruza umbral → ejecutar job → aviso → marcar leído; recarga conserva estado. Probar revocar regla antes de entrega y verificar aislamiento de usuarios. Revisar ruido/cooldown y accesibilidad.

**Done de fase:** notificaciones útiles y controlables; documentación define canal implementado y límites. Actualizar README/ROADMAP/CONTINUAR; siguiente P10-01.
