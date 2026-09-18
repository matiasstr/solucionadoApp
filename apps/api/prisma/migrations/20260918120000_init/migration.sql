-- Migración inicial P1-02. Generada con `prisma migrate diff --from-empty` y completada
-- a mano con PostGIS, CHECKs, triggers e índices que Prisma no expresa (ver docs/DOMAIN.md).

-- PostGIS debe existir antes de crear columnas geography (también en la base shadow).
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MeasurementUnit" AS ENUM ('KG', 'G', 'L', 'ML', 'UNIT');

-- CreateEnum
CREATE TYPE "BaseUnit" AS ENUM ('KG', 'L', 'UNIT');

-- CreateEnum
CREATE TYPE "SaleMode" AS ENUM ('PACKAGED', 'VARIABLE_WEIGHT');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('PERCENTAGE', 'SECOND_UNIT', 'TWO_FOR_ONE', 'FIXED_PRICE', 'BANK_DISCOUNT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER', 'WALLET');

-- CreateEnum
CREATE TYPE "DiscountCapPeriod" AS ENUM ('PURCHASE', 'WEEK', 'MONTH', 'CAMPAIGN');

-- CreateEnum
CREATE TYPE "ShoppingPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "city" VARCHAR(120),
    "province" VARCHAR(120),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "maxTravelDistanceKm" DECIMAL(7,2) NOT NULL DEFAULT 5,
    "maxStoresPerShoppingPlan" INTEGER DEFAULT 2,
    "storeVisitPenalty" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "distancePenaltyPerKm" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paymentMethods" "PaymentMethod"[] DEFAULT ARRAY[]::"PaymentMethod"[],
    "banks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "membershipPrograms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "onboardingCompletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "familyId" UUID NOT NULL,
    "replacedById" UUID,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "rotatedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "parentId" UUID,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalProduct" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "normalizedName" VARCHAR(200) NOT NULL,
    "categoryId" UUID NOT NULL,
    "defaultUnit" "BaseUnit" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CanonicalProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "ean" VARCHAR(14),
    "name" VARCHAR(240) NOT NULL,
    "normalizedName" VARCHAR(240) NOT NULL,
    "brand" VARCHAR(120),
    "categoryId" UUID NOT NULL,
    "canonicalProductId" UUID,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit" "MeasurementUnit" NOT NULL,
    "saleMode" "SaleMode" NOT NULL DEFAULT 'PACKAGED',
    "packageCount" INTEGER NOT NULL DEFAULT 1,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreChain" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "logoUrl" TEXT,

    CONSTRAINT "StoreChain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" UUID NOT NULL,
    "chainId" UUID NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "address" VARCHAR(240) NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "province" VARCHAR(120) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "location" geography(Point,4326),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPrice" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "unitPrice" DECIMAL(18,6) NOT NULL,
    "unitPriceUnit" "BaseUnit" NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'ARS',
    "source" VARCHAR(80) NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "importBatchId" VARCHAR(120),
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "ingestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" UUID NOT NULL,
    "productId" UUID,
    "canonicalProductId" UUID,
    "storeId" UUID,
    "chainId" UUID,
    "name" VARCHAR(200) NOT NULL,
    "type" "PromotionType" NOT NULL,
    "discountPercentage" DECIMAL(5,2),
    "fixedPrice" DECIMAL(14,2),
    "requiredQuantity" INTEGER,
    "paymentMethod" "PaymentMethod",
    "bank" VARCHAR(120),
    "membershipProgram" VARCHAR(120),
    "minimumSpend" DECIMAL(14,2),
    "discountCap" DECIMAL(14,2),
    "capPeriod" "DiscountCapPeriod",
    "eligibleWeekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "isStackable" BOOLEAN NOT NULL DEFAULT false,
    "terms" TEXT,
    "source" VARCHAR(80) NOT NULL,
    "externalId" VARCHAR(200),
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validUntil" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingRoutine" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "frequencyDays" INTEGER NOT NULL DEFAULT 7,
    "anchorDate" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShoppingRoutine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingRoutineItem" (
    "id" UUID NOT NULL,
    "routineId" UUID NOT NULL,
    "canonicalProductId" UUID NOT NULL,
    "preferredProductId" UUID,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit" "BaseUnit" NOT NULL,
    "frequencyDays" INTEGER,
    "anchorDate" DATE,
    "allowSubstitutes" BOOLEAN NOT NULL DEFAULT true,
    "preferredBrands" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludedBrands" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShoppingRoutineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserInventory" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "canonicalProductId" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit" "BaseUnit" NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingPlan" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "estimatedRegularCost" DECIMAL(14,2) NOT NULL,
    "optimizedCost" DECIMAL(14,2) NOT NULL,
    "estimatedSavings" DECIMAL(14,2) NOT NULL,
    "storeVisitPenaltyCost" DECIMAL(14,2) NOT NULL,
    "distancePenaltyCost" DECIMAL(14,2) NOT NULL,
    "effectiveCost" DECIMAL(14,2) NOT NULL,
    "totalDistanceKm" DECIMAL(10,3),
    "currency" CHAR(3) NOT NULL DEFAULT 'ARS',
    "status" "ShoppingPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "optimizerVersion" VARCHAR(80) NOT NULL,
    "baselineMethod" VARCHAR(80) NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "unfulfilledNeeds" JSONB NOT NULL DEFAULT '[]',
    "generatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ShoppingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingPlanItem" (
    "id" UUID NOT NULL,
    "shoppingPlanId" UUID NOT NULL,
    "canonicalProductId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "productPriceId" UUID NOT NULL,
    "promotionId" UUID,
    "neededQuantity" DECIMAL(14,4) NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit" "BaseUnit" NOT NULL,
    "packageCount" INTEGER,
    "price" DECIMAL(14,2) NOT NULL,
    "estimatedRegularPrice" DECIMAL(14,2) NOT NULL,
    "estimatedSavings" DECIMAL(14,2) NOT NULL,
    "recommendedDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "ShoppingPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_replacedById_key" ON "RefreshSession"("replacedById");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_expiresAt_idx" ON "RefreshSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "RefreshSession_familyId_idx" ON "RefreshSession"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE INDEX "CanonicalProduct_categoryId_idx" ON "CanonicalProduct"("categoryId");

-- CreateIndex
CREATE INDEX "CanonicalProduct_normalizedName_idx" ON "CanonicalProduct"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Product_ean_key" ON "Product"("ean");

-- CreateIndex
CREATE INDEX "Product_normalizedName_idx" ON "Product"("normalizedName");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_canonicalProductId_idx" ON "Product"("canonicalProductId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreChain_name_key" ON "StoreChain"("name");

-- CreateIndex
CREATE INDEX "Store_chainId_idx" ON "Store"("chainId");

-- CreateIndex
CREATE INDEX "Store_province_city_idx" ON "Store"("province", "city");

-- CreateIndex
CREATE INDEX "ProductPrice_productId_storeId_observedAt_idx" ON "ProductPrice"("productId", "storeId", "observedAt" DESC);

-- CreateIndex
CREATE INDEX "ProductPrice_storeId_observedAt_idx" ON "ProductPrice"("storeId", "observedAt" DESC);

-- CreateIndex
CREATE INDEX "ProductPrice_importBatchId_idx" ON "ProductPrice"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPrice_source_idempotencyKey_key" ON "ProductPrice"("source", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Promotion_productId_validUntil_idx" ON "Promotion"("productId", "validUntil");

-- CreateIndex
CREATE INDEX "Promotion_canonicalProductId_validUntil_idx" ON "Promotion"("canonicalProductId", "validUntil");

-- CreateIndex
CREATE INDEX "Promotion_storeId_validFrom_validUntil_idx" ON "Promotion"("storeId", "validFrom", "validUntil");

-- CreateIndex
CREATE INDEX "Promotion_chainId_validFrom_validUntil_idx" ON "Promotion"("chainId", "validFrom", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_source_externalId_key" ON "Promotion"("source", "externalId");

-- CreateIndex
CREATE INDEX "ShoppingRoutine_userId_idx" ON "ShoppingRoutine"("userId");

-- CreateIndex
CREATE INDEX "ShoppingRoutineItem_canonicalProductId_idx" ON "ShoppingRoutineItem"("canonicalProductId");

-- CreateIndex
CREATE INDEX "ShoppingRoutineItem_preferredProductId_idx" ON "ShoppingRoutineItem"("preferredProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ShoppingRoutineItem_routineId_canonicalProductId_key" ON "ShoppingRoutineItem"("routineId", "canonicalProductId");

-- CreateIndex
CREATE INDEX "UserInventory_canonicalProductId_idx" ON "UserInventory"("canonicalProductId");

-- CreateIndex
CREATE UNIQUE INDEX "UserInventory_userId_canonicalProductId_key" ON "UserInventory"("userId", "canonicalProductId");

-- CreateIndex
CREATE INDEX "ShoppingPlan_userId_startDate_idx" ON "ShoppingPlan"("userId", "startDate" DESC);

-- CreateIndex
CREATE INDEX "ShoppingPlan_status_endDate_idx" ON "ShoppingPlan"("status", "endDate");

-- CreateIndex
CREATE INDEX "ShoppingPlanItem_shoppingPlanId_recommendedDate_idx" ON "ShoppingPlanItem"("shoppingPlanId", "recommendedDate");

-- CreateIndex
CREATE INDEX "ShoppingPlanItem_canonicalProductId_idx" ON "ShoppingPlanItem"("canonicalProductId");

-- CreateIndex
CREATE INDEX "ShoppingPlanItem_productId_idx" ON "ShoppingPlanItem"("productId");

-- CreateIndex
CREATE INDEX "ShoppingPlanItem_storeId_idx" ON "ShoppingPlanItem"("storeId");

-- CreateIndex
CREATE INDEX "ShoppingPlanItem_productPriceId_idx" ON "ShoppingPlanItem"("productPriceId");

-- CreateIndex
CREATE INDEX "ShoppingPlanItem_promotionId_idx" ON "ShoppingPlanItem"("promotionId");

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "RefreshSession"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalProduct" ADD CONSTRAINT "CanonicalProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "StoreChain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "StoreChain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingRoutine" ADD CONSTRAINT "ShoppingRoutine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingRoutineItem" ADD CONSTRAINT "ShoppingRoutineItem_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "ShoppingRoutine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingRoutineItem" ADD CONSTRAINT "ShoppingRoutineItem_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingRoutineItem" ADD CONSTRAINT "ShoppingRoutineItem_preferredProductId_fkey" FOREIGN KEY ("preferredProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInventory" ADD CONSTRAINT "UserInventory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInventory" ADD CONSTRAINT "UserInventory_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingPlan" ADD CONSTRAINT "ShoppingPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingPlanItem" ADD CONSTRAINT "ShoppingPlanItem_shoppingPlanId_fkey" FOREIGN KEY ("shoppingPlanId") REFERENCES "ShoppingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingPlanItem" ADD CONSTRAINT "ShoppingPlanItem_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingPlanItem" ADD CONSTRAINT "ShoppingPlanItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingPlanItem" ADD CONSTRAINT "ShoppingPlanItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingPlanItem" ADD CONSTRAINT "ShoppingPlanItem_productPriceId_fkey" FOREIGN KEY ("productPriceId") REFERENCES "ProductPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingPlanItem" ADD CONSTRAINT "ShoppingPlanItem_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Integridad adicional (docs/DOMAIN.md, "Integridad pendiente de implementación").
-- Prisma no representa CHECKs, triggers ni índices por expresión; se mantienen aquí.
-- ============================================================================

-- Helper inmutable para CHECK: días ISO 1..7 sin duplicados.
CREATE FUNCTION "tusofertas_valid_iso_weekdays"(days INTEGER[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT days <@ ARRAY[1,2,3,4,5,6,7]
     AND cardinality(days) = (SELECT count(DISTINCT d) FROM unnest(days) AS d)
     AND array_position(days, NULL) IS NULL;
$$;

-- User: email normalizado y único sin distinguir mayúsculas.
ALTER TABLE "User"
  ADD CONSTRAINT "User_email_normalized_check" CHECK ("email" = lower(btrim("email")) AND "email" <> ''),
  ADD CONSTRAINT "User_coordinates_check" CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL)
    OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL
        AND "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
  ),
  ADD CONSTRAINT "User_maxTravelDistanceKm_check" CHECK ("maxTravelDistanceKm" > 0),
  ADD CONSTRAINT "User_maxStoresPerShoppingPlan_check" CHECK ("maxStoresPerShoppingPlan" IS NULL OR "maxStoresPerShoppingPlan" > 0),
  ADD CONSTRAINT "User_penalties_check" CHECK ("storeVisitPenalty" >= 0 AND "distancePenaltyPerKm" >= 0);
CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower("email"));

-- RefreshSession
ALTER TABLE "RefreshSession"
  ADD CONSTRAINT "RefreshSession_expiresAt_check" CHECK ("expiresAt" > "createdAt"),
  ADD CONSTRAINT "RefreshSession_replacedById_check" CHECK ("replacedById" IS NULL OR "replacedById" <> "id");

-- Category: sin autorreferencia directa (ciclos largos: aplicación transaccional).
ALTER TABLE "Category"
  ADD CONSTRAINT "Category_parent_not_self_check" CHECK ("parentId" IS NULL OR "parentId" <> "id");

-- Product: EAN opcional (solo dígitos, 8-14), contenido y envases positivos.
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_ean_format_check" CHECK ("ean" IS NULL OR "ean" ~ '^[0-9]{8,14}$'),
  ADD CONSTRAINT "Product_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "Product_packageCount_check" CHECK ("packageCount" > 0);

-- Store: coordenadas completas/válidas; location derivada siempre de longitud/latitud.
ALTER TABLE "Store"
  ADD CONSTRAINT "Store_coordinates_check" CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL)
    OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL
        AND "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
  );

CREATE FUNCTION "tusofertas_store_sync_location"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- ST_MakePoint recibe (longitud, latitud). Escrituras directas a location se ignoran.
  IF NEW."latitude" IS NULL OR NEW."longitude" IS NULL THEN
    NEW."location" := NULL;
  ELSE
    NEW."location" := ST_SetSRID(ST_MakePoint(NEW."longitude"::double precision, NEW."latitude"::double precision), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Store_sync_location"
  BEFORE INSERT OR UPDATE ON "Store"
  FOR EACH ROW EXECUTE FUNCTION "tusofertas_store_sync_location"();

CREATE INDEX "Store_location_gist_idx" ON "Store" USING GIST ("location");

-- ProductPrice: observaciones positivas en ARS e historial append-only.
ALTER TABLE "ProductPrice"
  ADD CONSTRAINT "ProductPrice_price_check" CHECK ("price" > 0 AND "unitPrice" > 0),
  ADD CONSTRAINT "ProductPrice_currency_check" CHECK ("currency" = 'ARS'),
  ADD CONSTRAINT "ProductPrice_source_check" CHECK (btrim("source") <> '' AND btrim("idempotencyKey") <> '');

CREATE FUNCTION "tusofertas_reject_price_history_change"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ProductPrice es append-only: % no permitido', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "ProductPrice_append_only"
  BEFORE UPDATE OR DELETE ON "ProductPrice"
  FOR EACH ROW EXECUTE FUNCTION "tusofertas_reject_price_history_change"();

-- Promotion: alcance, vigencia y campos coherentes con el tipo.
ALTER TABLE "Promotion"
  ADD CONSTRAINT "Promotion_commercial_scope_check" CHECK (num_nonnulls("storeId", "chainId") = 1),
  ADD CONSTRAINT "Promotion_product_scope_check" CHECK (num_nonnulls("productId", "canonicalProductId") <= 1),
  ADD CONSTRAINT "Promotion_validity_check" CHECK ("validUntil" > "validFrom"),
  ADD CONSTRAINT "Promotion_discountPercentage_check" CHECK ("discountPercentage" IS NULL OR ("discountPercentage" > 0 AND "discountPercentage" <= 100)),
  ADD CONSTRAINT "Promotion_amounts_check" CHECK (
    ("fixedPrice" IS NULL OR "fixedPrice" > 0)
    AND ("requiredQuantity" IS NULL OR "requiredQuantity" > 0)
    AND ("minimumSpend" IS NULL OR "minimumSpend" > 0)
    AND ("discountCap" IS NULL OR "discountCap" > 0)
  ),
  ADD CONSTRAINT "Promotion_cap_period_check" CHECK (("discountCap" IS NULL) = ("capPeriod" IS NULL)),
  ADD CONSTRAINT "Promotion_weekdays_check" CHECK ("tusofertas_valid_iso_weekdays"("eligibleWeekdays")),
  ADD CONSTRAINT "Promotion_type_fields_check" CHECK (
    CASE "type"
      WHEN 'PERCENTAGE' THEN "discountPercentage" IS NOT NULL AND "fixedPrice" IS NULL
      WHEN 'SECOND_UNIT' THEN "discountPercentage" IS NOT NULL AND "fixedPrice" IS NULL
      WHEN 'TWO_FOR_ONE' THEN "discountPercentage" IS NULL AND "fixedPrice" IS NULL
      WHEN 'FIXED_PRICE' THEN "fixedPrice" IS NOT NULL AND "discountPercentage" IS NULL
      WHEN 'BANK_DISCOUNT' THEN "discountPercentage" IS NOT NULL AND "fixedPrice" IS NULL
        AND ("bank" IS NOT NULL OR "paymentMethod" IS NOT NULL)
    END
  );

-- Rutinas e inventario
ALTER TABLE "ShoppingRoutine"
  ADD CONSTRAINT "ShoppingRoutine_frequencyDays_check" CHECK ("frequencyDays" > 0);

ALTER TABLE "ShoppingRoutineItem"
  ADD CONSTRAINT "ShoppingRoutineItem_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "ShoppingRoutineItem_frequencyDays_check" CHECK ("frequencyDays" IS NULL OR "frequencyDays" > 0),
  ADD CONSTRAINT "ShoppingRoutineItem_schedule_override_check" CHECK (("frequencyDays" IS NULL) = ("anchorDate" IS NULL)),
  ADD CONSTRAINT "ShoppingRoutineItem_substitutes_check" CHECK ("allowSubstitutes" OR "preferredProductId" IS NOT NULL),
  ADD CONSTRAINT "ShoppingRoutineItem_brands_check" CHECK (NOT ("preferredBrands" && "excludedBrands"));

ALTER TABLE "UserInventory"
  ADD CONSTRAINT "UserInventory_quantity_check" CHECK ("quantity" >= 0);

-- Planes: fechas ordenadas, importes no negativos y sumas coherentes.
ALTER TABLE "ShoppingPlan"
  ADD CONSTRAINT "ShoppingPlan_dates_check" CHECK ("endDate" >= "startDate"),
  ADD CONSTRAINT "ShoppingPlan_currency_check" CHECK ("currency" = 'ARS'),
  ADD CONSTRAINT "ShoppingPlan_amounts_check" CHECK (
    "estimatedRegularCost" >= 0 AND "optimizedCost" >= 0
    AND "storeVisitPenaltyCost" >= 0 AND "distancePenaltyCost" >= 0
    AND ("totalDistanceKm" IS NULL OR "totalDistanceKm" >= 0)
  ),
  ADD CONSTRAINT "ShoppingPlan_effectiveCost_check" CHECK ("effectiveCost" = "optimizedCost" + "storeVisitPenaltyCost" + "distancePenaltyCost"),
  ADD CONSTRAINT "ShoppingPlan_estimatedSavings_check" CHECK ("estimatedSavings" = "estimatedRegularCost" - "optimizedCost");

ALTER TABLE "ShoppingPlanItem"
  ADD CONSTRAINT "ShoppingPlanItem_quantities_check" CHECK ("neededQuantity" > 0 AND "quantity" >= "neededQuantity"),
  ADD CONSTRAINT "ShoppingPlanItem_packageCount_check" CHECK ("packageCount" IS NULL OR "packageCount" > 0),
  ADD CONSTRAINT "ShoppingPlanItem_amounts_check" CHECK ("price" >= 0 AND "estimatedRegularPrice" >= 0);
