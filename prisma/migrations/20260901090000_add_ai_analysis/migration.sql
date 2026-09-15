-- CreateEnum
CREATE TYPE "AIRecommendation" AS ENUM ('APPROVE', 'CONDITIONAL_APPROVAL', 'REQUEST_MORE_EVIDENCE', 'REJECT');

-- CreateTable
CREATE TABLE "ai_analyses" (
    "id" TEXT NOT NULL,
    "changeRequestId" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL,
    "affectedAreas" JSONB NOT NULL,
    "riskFactors" JSONB NOT NULL,
    "missingEvidence" JSONB NOT NULL,
    "recommendation" "AIRecommendation" NOT NULL,
    "providerModel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_analyses_changeRequestId_idx" ON "ai_analyses"("changeRequestId");

-- CreateIndex
CREATE INDEX "ai_analyses_createdAt_idx" ON "ai_analyses"("createdAt");

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "change_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
