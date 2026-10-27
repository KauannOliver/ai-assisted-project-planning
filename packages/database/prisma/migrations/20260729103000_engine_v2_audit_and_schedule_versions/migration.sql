CREATE TYPE "ProjectPhaseStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');
CREATE TYPE "ScheduleRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "ScheduleRunType" AS ENUM ('OFFICIAL', 'PREVIEW');

ALTER TABLE "ProjectPhase"
  ADD COLUMN "status" "ProjectPhaseStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "completedMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "actualStartDate" TIMESTAMP(3),
  ADD COLUMN "actualEndDate" TIMESTAMP(3);

ALTER TABLE "CommitteeMeeting"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'FINAL',
  ADD COLUMN "portfolioSnapshot" JSONB,
  ADD COLUMN "supersedesMeetingId" TEXT;

ALTER TABLE "CurrentProjectSchedule" ADD COLUMN "scheduleRunId" TEXT;
ALTER TABLE "BusinessEvent" ADD COLUMN "actorName" TEXT;

CREATE TABLE "ScheduleRun" (
  "id" TEXT NOT NULL,
  "type" "ScheduleRunType" NOT NULL,
  "status" "ScheduleRunStatus" NOT NULL DEFAULT 'RUNNING',
  "triggerType" TEXT NOT NULL,
  "triggeredById" TEXT,
  "inputHash" TEXT NOT NULL,
  "parameters" JSONB,
  "portfolioEndDate" TIMESTAMP(3),
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ScheduleRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduleRunProject" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "queuePosition" INTEGER,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "riskStatus" TEXT NOT NULL,
  "isImpeded" BOOLEAN NOT NULL DEFAULT false,
  "impediments" TEXT,
  CONSTRAINT "ScheduleRunProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduleRunPhase" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectPhaseId" TEXT NOT NULL,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  CONSTRAINT "ScheduleRunPhase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduleRunAllocation" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectPhaseId" TEXT NOT NULL,
  "allocationId" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "minutesAllocated" INTEGER NOT NULL,
  CONSTRAINT "ScheduleRunAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScheduleRunProject_runId_projectId_key" ON "ScheduleRunProject"("runId", "projectId");
CREATE UNIQUE INDEX "ScheduleRunPhase_runId_projectPhaseId_key" ON "ScheduleRunPhase"("runId", "projectPhaseId");
CREATE INDEX "ScheduleRun_type_status_startedAt_idx" ON "ScheduleRun"("type", "status", "startedAt");
CREATE INDEX "ScheduleRunProject_projectId_idx" ON "ScheduleRunProject"("projectId");
CREATE INDEX "ScheduleRunPhase_projectId_idx" ON "ScheduleRunPhase"("projectId");
CREATE INDEX "ScheduleRunAllocation_runId_resourceId_date_idx" ON "ScheduleRunAllocation"("runId", "resourceId", "date");
CREATE INDEX "ScheduleRunAllocation_projectId_idx" ON "ScheduleRunAllocation"("projectId");
CREATE INDEX "BusinessEvent_aggregateType_aggregateId_createdAt_idx" ON "BusinessEvent"("aggregateType", "aggregateId", "createdAt");
CREATE INDEX "BusinessEvent_createdAt_idx" ON "BusinessEvent"("createdAt");

ALTER TABLE "CommitteeMeeting" ADD CONSTRAINT "CommitteeMeeting_supersedesMeetingId_fkey"
  FOREIGN KEY ("supersedesMeetingId") REFERENCES "CommitteeMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScheduleRun" ADD CONSTRAINT "ScheduleRun_triggeredById_fkey"
  FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScheduleRunProject" ADD CONSTRAINT "ScheduleRunProject_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ScheduleRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleRunPhase" ADD CONSTRAINT "ScheduleRunPhase_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ScheduleRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleRunAllocation" ADD CONSTRAINT "ScheduleRunAllocation_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ScheduleRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessEvent" ADD CONSTRAINT "BusinessEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
