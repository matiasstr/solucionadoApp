# Fase 10 — Bancos, medios de pago y cierre funcional

Leer calculador básico P2-03, algoritmo P5-02 y ADRs de dinero/fechas. Estado inicial: PENDIENTE. Esta fase extiende promociones existentes; no reescribe su cálculo sin conservar los tests.

## P10-01 — Elegibilidad y beneficios avanzados

**Dependencias:** P2-03 y P5-03. **Módulos:** promociones, preferencias de medios de pago, calculador de beneficios, migraciones y contratos de importación.

**Implementación:**

1. Modelar banco, medio de pago, días válidos, compra mínima, porcentaje/monto, tope de reintegro y período de aplicación. Distinguir descuento inmediato de reintegro posterior, con fecha/plazo cuando esté informado.
2. Guardar solo preferencias declaradas; no pedir número de tarjeta, CVV ni credenciales bancarias. Elegibilidad desconocida no es beneficio confirmado.
3. Reglas explícitas de acumulación, exclusividad y orden de cálculo. Topes compartidos entre productos/visitas no se aplican de nuevo por cada ítem.
4. Para topes mensuales ya consumidos fuera de la app, admitir consumo informado o marcarlo desconocido. No prometer el reintegro completo cuando no se conoce saldo disponible del beneficio.
5. Extender DTOs/proveedores con condiciones y procedencia. Mantener promociones antiguas interpretables y snapshots de planes sin recalcularlos retroactivamente.

**Validación:** topes por compra/semana/mes, múltiples items/visitas, mínimo, día de semana, vigencia horaria, banco incorrecto, medio inelegible, reintegro diferido, acumulación prohibida y redondeo. Tests de un mismo tope compartido por varias promociones/reglas según su contrato.

**Done:** motor explica beneficio aplicable, condicionado y no elegible con cálculo reproducible. Guardar checkpoint.

## P10-02 — Planificación y experiencia completa

**Dependencias:** P10-01 y P9-02. **Módulos/rutas:** optimizador, comparador, cronograma, dashboard y preferencias. Actualizar endpoints de promociones y preferencias según contrato documentado.

**Implementación:**

1. Incluir medio/día y topes compartidos en candidatos y evaluación. Un descuento dependiente del total de la canasta requiere evaluar canasta; no basta elegir cada item más barato aisladamente.
2. Revalidar límites computacionales: mantener búsqueda exacta acotada cuando sea viable y fallback explícito. Mostrar criterios usados y qué condiciones dependen de información que el usuario debe confirmar.
3. UI distingue total a pagar hoy, reintegro estimado y costo después del reintegro; solo comparar escenarios equivalentes. No sumar reintegro estimado a ahorro registrado.
4. Actualizar onboarding/preferencias, tarjetas, plan, ofertas y alertas para explicar banco, día, mínimo y tope de forma legible. Evitar que condiciones importantes queden ocultas.
5. Revisar README final, diagrama de arquitectura, catálogo de endpoints, ADRs, runbook y limitaciones. Identificar explícitamente demo, conectores realmente implementados y despliegues todavía pendientes.

**Validación:** todos los tests de promociones/optimizador, enumeración independiente en casos pequeños con topes, E2E registro → rutina → inventario → comparación → plan → historial → alerta. Ejecutar typecheck/lint/test/build completos y migraciones en DB nueva. Verificar ownership, CSRF, no exposición de secretos, accesibilidad móvil y tiempos de respuesta con dataset representativo. No afirmar escala de producción basándose únicamente en seed pequeño.

**Done de fase:** las diez fases funcionales están demostradas con datos demo y documentación reproducible. Integrar un proveedor real o desplegar infraestructura puede seguir pendiente y debe figurar como trabajo separado; no marcarlo hecho por tener adaptadores o Dockerfiles. Actualizar ROADMAP/README/CONTINUAR con evidencia y próximos pasos concretos.
