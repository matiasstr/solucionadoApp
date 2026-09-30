-- P8-02: hora del último avance de una ejecución de importación. Una ejecución RUNNING
-- sin avance durante un rato es un proceso caído; las existentes toman la hora actual.
-- AlterTable
ALTER TABLE "ImportRun" ADD COLUMN     "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
