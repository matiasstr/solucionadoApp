-- P7-01: identidad de productos y sucursales según cada fuente externa (ADR 0018).

-- CreateTable
CREATE TABLE "ExternalProductRef" (
    "id" UUID NOT NULL,
    "source" VARCHAR(80) NOT NULL,
    "externalId" VARCHAR(200) NOT NULL,
    "productId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalProductRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalStoreRef" (
    "id" UUID NOT NULL,
    "source" VARCHAR(80) NOT NULL,
    "externalId" VARCHAR(200) NOT NULL,
    "storeId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalStoreRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalProductRef_productId_idx" ON "ExternalProductRef"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalProductRef_source_externalId_key" ON "ExternalProductRef"("source", "externalId");

-- CreateIndex
CREATE INDEX "ExternalStoreRef_storeId_idx" ON "ExternalStoreRef"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalStoreRef_source_externalId_key" ON "ExternalStoreRef"("source", "externalId");

-- AddForeignKey
ALTER TABLE "ExternalProductRef" ADD CONSTRAINT "ExternalProductRef_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalStoreRef" ADD CONSTRAINT "ExternalStoreRef_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Fuente e identificador externo nunca vacíos: una clave en blanco uniría registros distintos.
ALTER TABLE "ExternalProductRef"
  ADD CONSTRAINT "ExternalProductRef_keys_check" CHECK (length(btrim("source")) > 0 AND length(btrim("externalId")) > 0);
ALTER TABLE "ExternalStoreRef"
  ADD CONSTRAINT "ExternalStoreRef_keys_check" CHECK (length(btrim("source")) > 0 AND length(btrim("externalId")) > 0);
