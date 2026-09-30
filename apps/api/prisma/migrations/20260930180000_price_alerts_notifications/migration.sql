-- CreateEnum
CREATE TYPE "AlertCondition" AS ENUM ('TARGET_PRICE', 'HISTORIC_LOW', 'GOOD_DEAL');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('PRICE_ALERT');

-- CreateTable
CREATE TABLE "PriceAlertRule" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "canonicalProductId" UUID NOT NULL,
    "productId" UUID,
    "allowSubstitutes" BOOLEAN NOT NULL DEFAULT true,
    "excludedBrands" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "condition" "AlertCondition" NOT NULL,
    "targetUnitPrice" DECIMAL(18,6),
    "targetUnit" "BaseUnit",
    "currency" CHAR(3) NOT NULL DEFAULT 'ARS',
    "radiusKm" DECIMAL(7,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "notifiedUnitPrice" DECIMAL(18,6),
    "lastNotifiedAt" TIMESTAMPTZ(3),
    "lastEvaluatedAt" TIMESTAMPTZ(3),
    "lastOutcome" VARCHAR(40),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PriceAlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "ruleId" UUID,
    "kind" "NotificationKind" NOT NULL,
    "eventKey" VARCHAR(200) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "message" VARCHAR(400) NOT NULL,
    "link" VARCHAR(200) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceAlertRule_userId_createdAt_idx" ON "PriceAlertRule"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PriceAlertRule_active_userId_idx" ON "PriceAlertRule"("active", "userId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_id_idx" ON "Notification"("userId", "createdAt" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_ruleId_eventKey_key" ON "Notification"("ruleId", "eventKey");

-- AddForeignKey
ALTER TABLE "PriceAlertRule" ADD CONSTRAINT "PriceAlertRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlertRule" ADD CONSTRAINT "PriceAlertRule_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlertRule" ADD CONSTRAINT "PriceAlertRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "PriceAlertRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Reglas que Prisma no expresa (P9-01, ADR 0022).
ALTER TABLE "PriceAlertRule"
  ADD CONSTRAINT "PriceAlertRule_currency_check" CHECK ("currency" = 'ARS'),
  -- El precio objetivo existe si y solo si la condición es TARGET_PRICE.
  ADD CONSTRAINT "PriceAlertRule_target_check" CHECK (
    ("condition" = 'TARGET_PRICE' AND "targetUnitPrice" IS NOT NULL AND "targetUnit" IS NOT NULL)
    OR ("condition" <> 'TARGET_PRICE' AND "targetUnitPrice" IS NULL AND "targetUnit" IS NULL)
  ),
  ADD CONSTRAINT "PriceAlertRule_target_positive_check" CHECK ("targetUnitPrice" IS NULL OR "targetUnitPrice" > 0),
  ADD CONSTRAINT "PriceAlertRule_radius_check" CHECK ("radiusKm" IS NULL OR ("radiusKm" >= 0.1 AND "radiusKm" <= 100)),
  -- Sin reemplazos hay que saber qué presentación vigilar.
  ADD CONSTRAINT "PriceAlertRule_substitutes_check" CHECK ("allowSubstitutes" OR "productId" IS NOT NULL),
  ADD CONSTRAINT "PriceAlertRule_brands_check" CHECK (cardinality("excludedBrands") <= 20),
  ADD CONSTRAINT "PriceAlertRule_revision_check" CHECK ("revision" >= 0),
  ADD CONSTRAINT "PriceAlertRule_notified_check" CHECK ("notifiedUnitPrice" IS NULL OR "notifiedUnitPrice" > 0);

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_event_check" CHECK (char_length("eventKey") > 0);
