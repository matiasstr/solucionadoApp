-- CreateEnum
CREATE TYPE "BenefitTiming" AS ENUM ('IMMEDIATE', 'REFUND');

-- AlterTable
ALTER TABLE "Promotion" ADD COLUMN     "benefitTiming" "BenefitTiming" NOT NULL DEFAULT 'IMMEDIATE',
ADD COLUMN     "capGroup" VARCHAR(120),
ADD COLUMN     "discountAmount" DECIMAL(14,2),
ADD COLUMN     "refundDelayDays" INTEGER;

-- CreateTable
CREATE TABLE "BenefitCapUsage" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "capKey" VARCHAR(160) NOT NULL,
    "periodKey" VARCHAR(20) NOT NULL,
    "consumed" DECIMAL(14,2) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BenefitCapUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BenefitCapUsage_userId_capKey_periodKey_key" ON "BenefitCapUsage"("userId", "capKey", "periodKey");

-- AddForeignKey
ALTER TABLE "BenefitCapUsage" ADD CONSTRAINT "BenefitCapUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Reglas de beneficios de pago (P10-01, ADR 0023). Las promociones existentes las cumplen:
-- ninguna tiene monto, todas son inmediatas y sin grupo de tope.
ALTER TABLE "Promotion" DROP CONSTRAINT "Promotion_type_fields_check";
ALTER TABLE "Promotion"
  -- Un descuento bancario es por porcentaje **o** por monto; los demás tipos no llevan monto.
  ADD CONSTRAINT "Promotion_type_fields_check" CHECK (
    CASE "type"
      WHEN 'PERCENTAGE' THEN "discountPercentage" IS NOT NULL AND "fixedPrice" IS NULL AND "discountAmount" IS NULL
      WHEN 'SECOND_UNIT' THEN "discountPercentage" IS NOT NULL AND "fixedPrice" IS NULL AND "discountAmount" IS NULL
      WHEN 'TWO_FOR_ONE' THEN "discountPercentage" IS NULL AND "fixedPrice" IS NULL AND "discountAmount" IS NULL
      WHEN 'FIXED_PRICE' THEN "fixedPrice" IS NOT NULL AND "discountPercentage" IS NULL AND "discountAmount" IS NULL
      WHEN 'BANK_DISCOUNT' THEN num_nonnulls("discountPercentage", "discountAmount") = 1 AND "fixedPrice" IS NULL
        AND ("bank" IS NOT NULL OR "paymentMethod" IS NOT NULL)
    END
  ),
  ADD CONSTRAINT "Promotion_discountAmount_check" CHECK ("discountAmount" IS NULL OR "discountAmount" > 0),
  -- El reintegro es un beneficio de pago; su plazo, de 1 a 180 días, solo existe si es reintegro.
  ADD CONSTRAINT "Promotion_refund_check" CHECK (
    ("benefitTiming" = 'IMMEDIATE' AND "refundDelayDays" IS NULL)
    OR ("benefitTiming" = 'REFUND' AND "type" = 'BANK_DISCOUNT' AND ("refundDelayDays" IS NULL OR "refundDelayDays" BETWEEN 1 AND 180))
  ),
  -- Compartir un tope exige tenerlo.
  ADD CONSTRAINT "Promotion_cap_group_check" CHECK ("capGroup" IS NULL OR ("discountCap" IS NOT NULL AND char_length("capGroup") > 0));

ALTER TABLE "BenefitCapUsage"
  ADD CONSTRAINT "BenefitCapUsage_consumed_check" CHECK ("consumed" >= 0),
  ADD CONSTRAINT "BenefitCapUsage_keys_check" CHECK (char_length("capKey") > 0 AND char_length("periodKey") > 0);
