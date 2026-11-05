-- In-house UX Director: ready status, rubric scores, drop counts and durable analysis steps.
ALTER TYPE "ReportStatus" ADD VALUE 'ready';

ALTER TABLE "reports" ADD COLUMN "sessionsIncluded" INTEGER,
ADD COLUMN "droppedFindings" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "droppedRecommendations" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "report_findings" ADD COLUMN "confidenceScore" INTEGER,
ADD COLUMN "recommendationScore" INTEGER,
ADD COLUMN "scoreBreakdown" JSONB;

CREATE TABLE "analysis_steps" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "attemptKey" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "leaseUntil" TIMESTAMP(3),
    "inputDigest" TEXT,
    "output" JSONB,
    "model" TEXT,
    "usage" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_steps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "analysis_steps_runId_kind_attemptKey_key" ON "analysis_steps"("runId", "kind", "attemptKey");
CREATE INDEX "analysis_steps_reportId_idx" ON "analysis_steps"("reportId");
CREATE INDEX "analysis_steps_status_leaseUntil_idx" ON "analysis_steps"("status", "leaseUntil");

ALTER TABLE "analysis_steps" ADD CONSTRAINT "analysis_steps_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analysis_steps" ADD CONSTRAINT "analysis_steps_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
