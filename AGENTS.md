# Trabajo en TusOfertas

## Continuidad obligatoria

1. Leer `CONTINUAR.md` y `ROADMAP.md` antes de editar.
2. Consultar `docs/steps/phase-XX.md`, `docs/ARCHITECTURE.md`, `docs/DOMAIN.md` y ADRs aplicables.
3. Elegir el primer paso pendiente cuyas dependencias estén resueltas. Explicar brevemente el alcance y revisar decisiones anteriores.
4. Implementar una porción acotada, comprobarla y corregir errores.
5. Guardar un checkpoint en `CONTINUAR.md` al cerrar cada paso y antes de terminar o cambiar de contexto. Actualizar ROADMAP y README cuando corresponda.
6. Dejar tareas siguientes con archivos, comandos, resultados esperados y criterios de cierre. No depender de la conversación anterior.
7. El usuario autorizó commit y push al completar cada paso: revisar diff, excluir secretos/generados, hacer un commit identificando el paso y `git push origin main` (o la rama de trabajo si cambia). No pedir confirmaciones ordinarias. No usar force push; ante rechazo, revisar y resolver conservando cambios. Registrar fallos externos y no afirmar que hubo push si falló.

## Criterios técnicos

- TypeScript strict; evitar `any`. Dominio independiente de Nest, Prisma, Next y proveedores externos.
- Monolito modular; no crear microservicios ni capas vacías para CRUD sencillo.
- Dinero con decimal; cantidades y unidades explícitas; fechas persistidas en UTC y calendario de Argentina en la presentación.
- Historial de precios inmutable; distinguir producto exacto, alternativa, dato ficticio y precio desactualizado.
- Optimizador determinista. Penalizaciones monetarias sumadas al costo, separadas del ahorro estimado.
- Nunca asumir que una promoción bancaria aplica al usuario o que una oferta tendrá validez futura.
- Configuración por entorno; nunca subir secretos, guardar contraseñas/tokens en logs ni exponer datos privados en DTOs.
- Autenticación, promociones, conversiones, análisis y optimización requieren pruebas de comportamiento.
- Decisiones ambiguas: elegir la opción más simple que preserve el producto y escribir un ADR en `docs/architecture-decisions/`.

## Entorno y alcance

- Raíz del repositorio: la carpeta que contiene este archivo (`solucionadoApp`).
- Windows PowerShell: usar `npm.cmd` / `npx.cmd` si la política bloquea `.ps1`.
- No sobrescribir modificaciones ajenas. No borrar volúmenes Docker ni resetear Git para arreglar problemas.
- No completar las diez fases de una vez. Guardar avances verificables por paso.
- No inventar resultados de tests ni considerar una configuración de infraestructura como infraestructura probada.
