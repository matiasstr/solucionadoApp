-- P7-02: ejecuciones de importación y cuarentena de registros rechazados (ADR 0019).

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('PRICES', 'PROMOTIONS');

-- CreateEnum
CREATE TYPE "ImportRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'COMPLETED_WITH_REJECTIONS', 'FAILED');

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "source" VARCHAR(80) NOT NULL,
    "status" "ImportRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),
    "read" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "storesCreated" INTEGER NOT NULL DEFAULT 0,
    "productsCreated" INTEGER NOT NULL DEFAULT 0,
    "productsPendingCanonical" INTEGER NOT NULL DEFAULT 0,
    "eansDiscarded" INTEGER NOT NULL DEFAULT 0,
    "batches" INTEGER NOT NULL DEFAULT 0,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "committedPosition" INTEGER NOT NULL DEFAULT 0,
    "resumedFromId" UUID,
    "error" VARCHAR(300),

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuarantinedRecord" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "reason" VARCHAR(40) NOT NULL,
    "detail" VARCHAR(300) NOT NULL,
    "ref" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuarantinedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportRun_source_startedAt_idx" ON "ImportRun"("source", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "ImportRun_status_idx" ON "ImportRun"("status");

-- CreateIndex
CREATE INDEX "QuarantinedRecord_runId_position_idx" ON "QuarantinedRecord"("runId", "position");

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_resumedFromId_fkey" FOREIGN KEY ("resumedFromId") REFERENCES "ImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuarantinedRecord" ADD CONSTRAINT "QuarantinedRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ImportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Contadores nunca negativos y posición de reanudación coherente.
ALTER TABLE "ImportRun"
  ADD CONSTRAINT "ImportRun_counters_check" CHECK (
    "read" >= 0 AND "created" >= 0 AND "duplicates" >= 0 AND "conflicts" >= 0 AND "updated" >= 0 AND "rejected" >= 0
    AND "storesCreated" >= 0 AND "productsCreated" >= 0 AND "productsPendingCanonical" >= 0 AND "eansDiscarded" >= 0
    AND "batches" >= 0 AND "retries" >= 0 AND "committedPosition" >= 0
  ),
  ADD CONSTRAINT "ImportRun_finished_check" CHECK (("status" = 'RUNNING') = ("finishedAt" IS NULL));
ALTER TABLE "QuarantinedRecord"
  ADD CONSTRAINT "QuarantinedRecord_position_check" CHECK ("position" > 0);
