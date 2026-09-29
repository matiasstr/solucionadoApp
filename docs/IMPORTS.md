# Importar precios y promociones

Guía para agregar una fuente de datos a Tus Ofertas. Decisiones en [ADR 0018](architecture-decisions/0018-import-pipeline.md) (contratos, identidad, lotes) y [ADR 0019](architecture-decisions/0019-import-runs-recovery.md) (ejecuciones, cuarentena, reintentos, reanudación, descargas).

## Antes de conectar una fuente real

Verificar y dejar escrito, para cada fuente:

- **Licencia y condiciones de uso**: si se permite almacenar, mostrar y comparar sus precios; atribución requerida; frecuencia de consulta permitida.
- **Contrato actual**: formato, codificación, separador decimal, zona horaria de las fechas, qué identificador estable tienen sucursales, productos y observaciones. No asumir el de una versión anterior: los portales cambian.
- **Volumen y límites**: tamaño típico y máximo del archivo, compresión, cantidad de registros.
- **Host de descarga**: se agrega a `IMPORT_ALLOWED_HOSTS` (configuración del servidor). Nunca se descarga una URL que envíe un usuario: la API no expone ningún endpoint de importación.

Ningún dato de una fuente real se muestra como "oferta verificada": sigue la política de frescura y procedencia de [ADR 0008](architecture-decisions/0008-catalog-prices-demo-data.md).

## Contrato de un proveedor

Un proveedor implementa `PriceProvider` o `PromotionProvider` (`apps/api/src/modules/imports/application/ports.ts`):

| Campo | Qué es |
| --- | --- |
| `source` | Nombre estable de la fuente (`[a-z0-9._-]`, hasta 80). Forma parte de la identidad de todo lo que trae: **no cambiarlo** después de la primera importación |
| `decimalSeparator` | `','` o `'.'`. Con coma, el punto solo puede agrupar miles de a tres (`1.234,56`); algo ambiguo como `1.23` se rechaza |
| `replayable` | `true` solo si volver a llamar a `records()` entrega exactamente la misma secuencia (archivo local, generador con semilla). Habilita reanudar por posición. Una descarga que puede cambiar entre intentos es `false` |
| `records()` | `AsyncIterable` de registros crudos, **de a uno**: no cargar el archivo en memoria. Una línea que no se puede leer se entrega como `{ kind: 'unparsable', detail }` y la importación sigue |

El proveedor **no normaliza**: entrega texto tal como viene. La normalización (decimales, EAN, unidades, fechas, coordenadas) es común a todas las fuentes y está probada en `import-normalizer.ts`.

## Esquema JSON Lines

El proveedor genérico (`--provider=jsonl`) lee una observación por línea, en archivo local o descarga, opcionalmente `.gz`:

```json
{
  "recordId": "opcional-id-de-la-observacion",
  "store": { "externalId": "suc-123", "chain": "Coto", "name": "Coto Centro", "address": "Av. Siempreviva 742", "city": "Morón", "province": "Buenos Aires", "latitude": "-34.65", "longitude": "-58.61" },
  "product": { "externalId": "7790000000000", "ean": "7790000000000", "name": "Arroz largo fino 1 kg", "brand": "Marca", "quantity": "1", "unit": "kg", "saleMode": "PACKAGED", "packageCount": 1, "categorySlug": "almacen", "canonicalName": "Arroz largo fino" },
  "price": "1.234,56",
  "observedAt": "2026-09-28T09:00:00-03:00"
}
```

- Importes, cantidades y coordenadas van **como texto**: un número JSON ya perdió su formato y puede cambiar centavos.
- `observedAt`: ISO 8601 con zona, o `AAAA-MM-DD` (se toma el mediodía argentino). Sin zona es ambiguo y se rechaza; más de 5 minutos en el futuro también.
- `unit`: `KG`, `G`, `L`, `ML`, `UNIT` o alias comunes (`kg`, `gr`, `lt`, `cc`, `un`, …). `saleMode`: `PACKAGED` (por defecto) o `VARIABLE_WEIGHT` (`pesable`, `granel`).
- `recordId`, si existe, define la clave idempotente de la observación; si no, se usa producto + sucursal + día.
- `canonicalName` vincula con un genérico del catálogo solo si coincide **exacto** (normalizado) y con la misma dimensión; si no, el producto queda pendiente de revisión.

## Identidad y repetidos

- Sucursal y producto se identifican por `(source, externalId)` en `ExternalStoreRef`/`ExternalProductRef`. Un EAN con dígito de control válido se vincula con el producto existente solo si la presentación coincide; si no, `EAN_CONTENT_MISMATCH`. Nunca se fusiona por nombre.
- Si la fuente cambia el contenido de un producto ya vinculado (mismo id externo, otro tamaño), se rechaza (`CONTENT_CHANGED`): otro contenido es otro producto.
- La misma observación otra vez es `duplicate`; con otro precio, `conflict`. Ninguna se sobrescribe: la historia es append-only.

## Ejecución, cuarentena y recuperación

```text
npm.cmd run import -- --provider=jsonl --file=precios.jsonl.gz --source=mi-fuente --decimal=,
npm.cmd run import -- --provider=jsonl --url=https://datos.example.gob.ar/precios.jsonl.gz --source=mi-fuente
npm.cmd run import -- --report=<id de ejecución>
npm.cmd run import -- --provider=jsonl --file=precios.jsonl.gz --source=mi-fuente --resume=<id de ejecución fallida>
```

- Cada ejecución queda en `ImportRun` (estado, contadores, reintentos, posición confirmada, error saneado) y cada rechazo en `QuarantinedRecord` con posición, motivo e identificadores externos, **nunca** el registro completo.
- Estados: `COMPLETED`, `COMPLETED_WITH_REJECTIONS` (hubo rechazos o conflictos: no es un éxito total) y `FAILED`.
- Un lote que falla se reintenta hasta `--max-retries` veces (2 por defecto) con espera creciente; es seguro porque escribir un lote es idempotente.
- `--resume` retoma una ejecución `FAILED` desde su **posición confirmada sin huecos**, solo si la fuente es `replayable`. Si no lo es, volver a importar completa: los repetidos no se duplican.

## Límites

| Límite | Valor |
| --- | --- |
| Lote | 1 a 1.000 registros (500 por defecto): un lote de precios es un solo `INSERT` |
| Concurrencia de escritura | 1 a 16 lotes (2 por defecto); la resolución de identidades es en serie |
| Línea | 64 KB; una más larga es ilegible y se descarta |
| Archivo | 1 GB descomprimido: protege contra bombas de compresión; por encima se corta la ejecución |
| Descarga | Solo hosts de `IMPORT_ALLOWED_HOSTS`, HTTPS (HTTP solo en la máquina local), sin credenciales en la URL, sin redirecciones, 5 minutos de tiempo máximo y `Content-Length` declarado dentro del límite |
| Base | El comando no corre en producción ni contra una base remota sin `IMPORT_ALLOW_REMOTE=true` |

## Agregar una fuente paso a paso

1. Verificar licencia, contrato y host (sección de arriba) y documentarlos en un ADR.
2. Si el formato es JSON Lines, alcanza con `--provider=jsonl`. Si no, implementar un `PriceProvider` en `imports/infrastructure/providers/` que lea en streaming y entregue registros crudos; no tocar el dominio ni los importadores.
3. Agregar el host a `IMPORT_ALLOWED_HOSTS`.
4. Probar con un archivo chico: `--report` debe mostrar rechazos entendibles y cero conflictos inesperados.
5. Tests del proveedor (lectura por trozos, líneas rotas, límites) y un test de integración con una muestra anonimizada.
