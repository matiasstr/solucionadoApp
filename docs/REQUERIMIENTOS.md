Quiero que construyas una aplicación web full-stack para Argentina orientada a comparar precios de alimentos y optimizar las compras habituales de los usuarios.

El objetivo del proyecto es crear una plataforma útil en producción y al mismo tiempo suficientemente sólida a nivel técnico como para formar parte de un portfolio profesional.

## 1. Concepto general

La aplicación debe permitir:

* Buscar alimentos y productos de supermercado.
* Comparar el precio del mismo producto entre distintas cadenas y sucursales.
* Mostrar precio por kg, litro, unidad o 100 g cuando corresponda.
* Consultar promociones.
* Consultar historial de precios.
* Detectar si una oferta realmente representa un precio bajo comparado con su historial.
* Crear una cuenta de usuario simple.
* Guardar compras habituales.
* Crear cronogramas de compra semanales.
* Recomendar dónde y cuándo comprar cada producto para minimizar el gasto.
* Calcular cuánto dinero ahorra el usuario siguiendo las recomendaciones.

El proyecto está pensado inicialmente para Argentina.

La principal fuente futura de precios será información pública como SEPA / Precios Claros, pero la arquitectura debe desacoplar completamente las fuentes externas del dominio para poder agregar otras fuentes posteriormente.

No quiero hardcodear la aplicación específicamente alrededor de SEPA.

---

# 2. Stack

Quiero utilizar:

Frontend:

* Next.js
* TypeScript
* App Router
* TailwindCSS
* TanStack Query

Backend:

* NestJS
* TypeScript
* Arquitectura modular
* Clean Architecture / Hexagonal Architecture donde tenga sentido
* SOLID
* DDD liviano, sin sobreingeniería

Database:

* PostgreSQL
* Prisma ORM
* PostGIS preparado para búsquedas geográficas

Infraestructura futura:

* Redis
* BullMQ
* Docker
* Cloud Run
* Cloud Run Jobs

Autenticación:

* Email + password inicialmente
* JWT access token + refresh token
* Passwords con bcrypt o argon2

Para desarrollo local:

* Docker Compose
* PostgreSQL
* Redis

Crear el proyecto como monorepo.

Podemos utilizar:

apps/
web/
api/

packages/
shared/
ui/
config/

---

# 3. Arquitectura general

La arquitectura conceptual debe ser:

External price sources
↓
Importers / adapters
↓
Normalization layer
↓
Products / Stores / Prices
↓
PostgreSQL
↓
NestJS API
↓
Next.js

Además:

PriceImporter
PromotionImporter
ProductNormalizer

deben ser abstracciones/interfaces para poder agregar diferentes proveedores.

Ejemplo:

interface PriceProvider {
fetchPrices(): Promise<RawPrice[]>;
}

Luego podrían existir:

SepaPriceProvider
CarrefourPriceProvider
CotoPriceProvider

Sin modificar el dominio principal.

---

# 4. Entidades principales

Diseñar correctamente las relaciones.

## User

Campos aproximados:

id
email
passwordHash
createdAt
updatedAt

Preferencias:

maxTravelDistanceKm
maxStoresPerShoppingPlan
latitude
longitude

La ubicación debe ser opcional.

---

## Product

Debe representar un producto concreto.

Ejemplo:

Coca-Cola Zero 2.25 L

Campos:

id
ean
name
normalizedName
brand
categoryId
quantity
unit
imageUrl
createdAt
updatedAt

EAN puede ser nullable porque algunos productos frescos no tienen código de barras.

---

## CanonicalProduct

Necesitamos un concepto superior para poder comparar productos equivalentes.

Ejemplo:

CanonicalProduct:
"Pechuga de pollo"

Products relacionados:

* Pechuga fresca
* Suprema de pollo
* Pechuga congelada
* Pechuga en bandeja

Campos:

id
name
categoryId
defaultUnit

Product debe poder apuntar opcionalmente a CanonicalProduct.

---

## Category

Ejemplos:

Carnes
Lácteos
Bebidas
Almacén
Frutas
Verduras
Limpieza

Campos:

id
name
parentId

Permitir subcategorías.

---

## StoreChain

Ejemplos:

Carrefour
Coto
Jumbo
Vea
Disco

Campos:

id
name
logoUrl

---

## Store

Representa una sucursal.

Campos:

id
chainId
name
address
city
province
latitude
longitude

Preparar ubicación para PostGIS.

---

## ProductPrice

Campos:

id
productId
storeId
price
unitPrice
unitPriceUnit
source
observedAt

NO actualizar simplemente el precio anterior.

Guardar histórico.

Ejemplo:

Producto A
Sucursal X
01/09 -> 5000
02/09 -> 4900
03/09 -> 5200

Esto permitirá posteriormente analizar evolución.

---

## Promotion

Campos:

id
productId nullable
canonicalProductId nullable
storeId nullable
chainId nullable

type

discountPercentage nullable
fixedPrice nullable
requiredQuantity nullable

paymentMethod nullable
bank nullable

validFrom
validUntil

Tipos posibles:

PERCENTAGE
SECOND_UNIT
TWO_FOR_ONE
FIXED_PRICE
BANK_DISCOUNT

---

# 5. Perfil de compras del usuario

Una de las features principales será:

"Mis compras habituales"

Crear:

ShoppingRoutine

id
userId
name
frequency
createdAt
updatedAt

Ejemplo:

"Compra semanal"

---

ShoppingRoutineItem

id
routineId
canonicalProductId
preferredProductId nullable

quantity
unit

frequency

allowSubstitutes boolean

preferredBrands
excludedBrands

Ejemplo:

Pechuga de pollo
5 kg
cada semana

Carne picada
1 kg
cada semana

Leche
6 litros
cada semana

Yerba
1 kg
cada 15 días

---

# 6. Inventario doméstico

Agregar una funcionalidad simple para registrar cuánto producto tiene actualmente el usuario.

UserInventory

id
userId
canonicalProductId
quantity
unit
updatedAt

Ejemplo:

Pechuga:
2 kg

Consumo semanal:
5 kg

El sistema debería determinar que necesita comprar aproximadamente:

3 kg

No tiene que ser extremadamente preciso inicialmente.

---

# 7. Planificador de compras

Esta es una de las features más importantes.

Crear:

ShoppingPlan

id
userId
startDate
endDate

estimatedRegularCost
optimizedCost
estimatedSavings

status

createdAt

Estados:

DRAFT
ACTIVE
COMPLETED
EXPIRED

---

ShoppingPlanItem

id
shoppingPlanId

canonicalProductId
productId
storeId

quantity
unit

price
estimatedRegularPrice
estimatedSavings

recommendedDate

promotionId nullable

reason

---

# 8. Algoritmo del planificador

Inicialmente NO usar inteligencia artificial.

Crear un algoritmo determinístico.

Debe:

1. Obtener productos habituales del usuario.
2. Calcular cuánto necesita según la frecuencia.
3. Restar inventario actual.
4. Obtener precios disponibles.
5. Obtener promociones.
6. Normalizar precios por unidad.
7. Encontrar tiendas dentro del radio máximo configurado.
8. Buscar la combinación con menor costo.
9. Respetar maxStoresPerShoppingPlan.
10. Generar un cronograma semanal.

Ejemplo:

Usuario compra:

5 kg pechuga
1 kg carne picada
6 litros leche

Resultado:

Lunes:
Carrefour

* 5 kg pechuga

Miércoles:
Coto

* carne picada
* leche

Mostrar:

Costo habitual estimado:
$58.000

Costo optimizado:
$48.500

Ahorro:
$9.500

---

# 9. Evitar recomendaciones absurdas

El sistema NO debería mandar al usuario a 5 supermercados para ahorrar $500.

Crear concepto:

effectiveCost

Considerar:

productCost
discounts
numberOfStores
distance

Inicialmente podemos utilizar una penalización configurable.

Ejemplo conceptual:

effectiveCost =
productsTotal

* storeVisitPenalty
* distancePenalty

NO necesitamos calcular combustible real todavía.

Configuración del usuario:

maxStoresPerShoppingPlan

Ejemplo:

2

maxTravelDistanceKm

Ejemplo:

5 km

---

# 10. Comparador de precios

Crear endpoint y UI para buscar:

"Coca Cola Zero"

Resultados:

Coca-Cola Zero 2.25L

Carrefour
$3200
$1422 / litro

Coto
$3450
$1533 / litro

Jumbo
$3100
$1377 / litro

Ordenar por:

precio
precio por unidad
distancia

---

# 11. Comparación de productos equivalentes

CanonicalProduct debe permitir comparar alternativas.

Ejemplo:

"Pechuga de pollo"

Puede comparar:

Pechuga fresca
Suprema de pollo
Pechuga congelada

Pero debe quedar claro para el usuario cuándo se trata del producto exacto y cuándo de un sustituto.

Mostrar etiquetas como:

Producto exacto

o:

Alternativa

---

# 12. Historial de precios

Crear endpoint:

GET /products/:id/price-history

Filtros:

storeId
from
to

Debe permitir mostrar posteriormente un gráfico.

Calcular:

currentPrice
average30Days
lowest30Days
highest30Days

Ejemplo:

Precio actual:
$8400/kg

Promedio 30 días:
$7500/kg

Mínimo:
$6800/kg

Mostrar posteriormente:

"El precio actual está 12% por encima del promedio de los últimos 30 días."

---

# 13. Ofertas reales

Crear un servicio:

PriceAnalysisService

Capaz de determinar si un precio es históricamente atractivo.

Ejemplo:

currentPrice < average30Days * 0.85

Entonces:

GOOD_DEAL

Otros estados:

NORMAL
EXPENSIVE
GOOD_DEAL
HISTORIC_LOW

No usar IA para esto.

Debe ser cálculo basado en datos.

---

# 14. Dashboard del usuario

Crear una página:

/dashboard

Debe mostrar:

Ahorro esta semana
Ahorro este mes
Ahorro histórico

Próxima compra recomendada

Productos habituales

Alertas

Últimas oportunidades detectadas

Ejemplo:

TU AHORRO

Esta semana:
$12.430

Este mes:
$38.220

---

# 15. Onboarding

Después del registro:

Paso 1:

Ubicación

Permitir:

Ciudad / localidad

y opcionalmente ubicación precisa posteriormente.

---

Paso 2:

Distancia máxima

2 km
5 km
10 km
20 km

---

Paso 3:

Cantidad máxima de supermercados

1
2
3
Sin límite

---

Paso 4:

Compras habituales

Buscador:

"Pechuga"

Seleccionar:

Pechuga de pollo

Cantidad:

5

Unidad:

kg

Frecuencia:

semanal

Botón:

* Agregar producto

---

# 16. API inicial

Crear endpoints similares a:

AUTH

POST /auth/register
POST /auth/login
POST /auth/refresh

---

PRODUCTS

GET /products
GET /products/:id
GET /products/:id/prices
GET /products/:id/price-history

GET /canonical-products
GET /canonical-products/:id

---

STORES

GET /stores
GET /stores/:id

Filtros:

latitude
longitude
radius

---

USER

GET /users/me
PATCH /users/me

---

SHOPPING ROUTINES

GET /shopping-routines
POST /shopping-routines

GET /shopping-routines/:id
PATCH /shopping-routines/:id
DELETE /shopping-routines/:id

POST /shopping-routines/:id/items
PATCH /shopping-routines/:id/items/:itemId
DELETE /shopping-routines/:id/items/:itemId

---

INVENTORY

GET /inventory
POST /inventory
PATCH /inventory/:id
DELETE /inventory/:id

---

SHOPPING PLAN

POST /shopping-plans/generate

GET /shopping-plans

GET /shopping-plans/:id

---

# 17. Frontend inicial

Crear las páginas:

/

Landing page.

Mostrar:

"¿Cuánto podés ahorrar esta semana?"

Buscador principal.

---

/buscar

Buscador y comparación.

---

/producto/[id]

Información del producto.

Precios.

Sucursales.

Precio por unidad.

Historial.

---

/login

---

/register

---

/onboarding

---

/dashboard

---

/mis-compras

CRUD de compras habituales.

---

/mi-despensa

Inventario.

---

/plan-semanal

Cronograma optimizado.

---

# 18. UI / UX

Quiero una interfaz moderna, simple y rápida.

Mobile-first.

Estética limpia.

Evitar dashboards empresariales genéricos.

Tiene que sentirse como una app orientada a consumidores.

Priorizar:

precio
ahorro
distancia
oferta

Utilizar componentes claros.

Ejemplo de tarjeta:

Pechuga de pollo

Carrefour Haedo

$7.200 / kg

↓ 14% vs promedio

A 1.8 km

BUENA OFERTA

---

# 19. Datos mock

Inicialmente crear seeds realistas.

Cadenas:

Carrefour
Coto
Jumbo
Vea
Disco

Sucursales ficticias pero estructuralmente realistas.

Productos:

Pechuga de pollo
Carne picada
Leche
Yerba
Arroz
Fideos
Huevos
Café
Aceite
Coca-Cola

Crear múltiples precios históricos.

Crear promociones.

Quiero poder probar completamente la aplicación sin tener SEPA conectado todavía.

---

# 20. Importadores

Crear una arquitectura preparada para datos externos.

Crear:

PriceProvider

PromotionProvider

Interfaces similares a:

interface PriceProvider {
getPrices(): AsyncIterable<RawPrice>;
}

Crear inicialmente:

MockPriceProvider

Posteriormente se implementará:

SepaPriceProvider

El procesamiento debe ser streaming o por batches.

NO cargar archivos gigantes enteros en RAM.

Crear pipeline conceptual:

download
→ decompress
→ stream
→ parse
→ normalize
→ batch
→ database

---

# 21. Jobs

Preparar módulo:

JobsModule

Futuros jobs:

IMPORT_PRICES
IMPORT_PROMOTIONS
GENERATE_WEEKLY_PLANS
CHECK_PRICE_ALERTS

Inicialmente pueden ejecutarse manualmente.

Posteriormente usar BullMQ.

---

# 22. Testing

Agregar tests donde tenga sentido.

Especialmente:

PriceNormalizer

PriceAnalysisService

ShoppingPlanOptimizer

unit conversion

promotion calculations

Ejemplo:

5 kg pechuga

Store A:
$8000/kg

Store B:
$7000/kg

El algoritmo debe seleccionar Store B si no existen otras restricciones.

Agregar también casos donde visitar una segunda tienda NO justifique el ahorro debido a la penalización configurada.

---

# 23. Código

Quiero:

TypeScript strict.

No utilizar any salvo casos extremadamente justificados.

DTO validation con class-validator.

Errores centralizados.

Logging estructurado.

Config mediante variables de entorno.

Separación clara entre:

domain
application
infrastructure
presentation

cuando tenga sentido.

No quiero sobreingeniería.

Priorizar legibilidad y mantenibilidad.

---

# 24. Seguridad

Implementar:

password hashing seguro

JWT

refresh tokens

rate limiting preparado

validation

sanitización

CORS configurable

Helmet en NestJS

No guardar información sensible en logs.

---

# 25. README

Crear un README profesional explicando:

Problema que resuelve.

Arquitectura.

Stack.

Cómo correr localmente.

Cómo ejecutar migrations.

Cómo ejecutar seeds.

Estructura del repositorio.

Decisiones técnicas.

Roadmap.

Agregar un diagrama Mermaid similar a:

Price Sources
↓
Importers
↓
Normalizer
↓
PostgreSQL
↓
NestJS
↓
Next.js

---

# 26. Roadmap

Dividir implementación en fases.

PHASE 1

Monorepo
Docker
Postgres
Prisma
NestJS
Next.js
Auth

PHASE 2

Products
CanonicalProducts
Stores
Prices
Seed

PHASE 3

Search
Price comparison
Unit price comparison

PHASE 4

User shopping routines
Inventory

PHASE 5

Shopping plan optimizer

PHASE 6

Price history
Deal detection

PHASE 7

External price importer architecture

PHASE 8

Redis / BullMQ / jobs

PHASE 9

Alerts / notifications

PHASE 10

Promotions / banks / payment methods

---

# 27. Forma de trabajo

IMPORTANTE:

No intentes implementar todo en una única respuesta.

Primero:

1. Analizá los requerimientos.
2. Proponé la arquitectura definitiva.
3. Definí la estructura del monorepo.
4. Definí el modelo de datos.
5. Identificá decisiones técnicas importantes.
6. Identificá riesgos.
7. Creá un ROADMAP.md.

Luego empezá con PHASE 1.

Antes de implementar una fase:

* explicar brevemente qué se va a hacer;
* revisar si afecta decisiones anteriores;
* implementar;
* ejecutar tests;
* corregir errores;
* actualizar README/ROADMAP.

No dejar pseudocódigo si puede implementarse realmente.

No crear archivos gigantes.

Preferir módulos pequeños y responsabilidades claras.

Cuando encuentres una decisión ambigua, elegí la alternativa más simple y documentá la decisión en:

docs/architecture-decisions/

usando ADRs simples.

---

# 28. Prioridad del producto

Recordá que el núcleo del producto NO es solamente:

"comparar precios".

El núcleo es:

"Ayudar a una persona a gastar menos dinero en sus compras habituales."

Por lo tanto la aplicación debe evolucionar hacia este flujo:

Compras habituales
↓
Necesidades de esta semana
↓
Precios actuales
↓
Promociones
↓
Distancia
↓
Restricciones del usuario
↓
Optimización
↓
Cronograma semanal
↓
Ahorro estimado

Tomá este flujo como principal criterio arquitectónico durante todo el desarrollo.

Comenzá analizando el proyecto y creando únicamente:

* arquitectura propuesta;
* estructura de carpetas;
* modelo de dominio;
* modelo inicial de Prisma;
* docker-compose;
* ROADMAP.md;
* README inicial.

Después continuá con PHASE 1.
