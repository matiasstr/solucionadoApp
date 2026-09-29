-- P5-03: planes guardados. Idempotencia de la generación y snapshot del resultado del optimizador.

-- AlterTable
ALTER TABLE "ShoppingPlan" ADD COLUMN     "idempotencyKey" VARCHAR(80),
ADD COLUMN     "resultSnapshot" JSONB NOT NULL DEFAULT '{}';

-- CreateIndex
CREATE UNIQUE INDEX "ShoppingPlan_userId_idempotencyKey_key" ON "ShoppingPlan"("userId", "idempotencyKey");

-- La clave la genera el cliente (UUID u otro token opaco); nunca es un dato personal.
ALTER TABLE "ShoppingPlan"
  ADD CONSTRAINT "ShoppingPlan_idempotencyKey_check" CHECK ("idempotencyKey" IS NULL OR "idempotencyKey" ~ '^[A-Za-z0-9_-]{8,80}$');
