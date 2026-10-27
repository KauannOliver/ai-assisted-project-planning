-- CreateTable
CREATE TABLE "CommitteeMeeting" (
    "id" TEXT NOT NULL,
    "meetingDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommitteeMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommitteeMeetingEvaluation" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "notes" TEXT,
    "estimatedMonthlyGain" DOUBLE PRECISION,
    "estimatedMonthlyLossAvoided" DOUBLE PRECISION,
    "roiMonthly" DOUBLE PRECISION,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommitteeMeetingEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriorityQueueState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "mode" TEXT NOT NULL DEFAULT 'automatic',
    "manualOrder" TEXT NOT NULL DEFAULT '[]',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriorityQueueState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrentProjectSchedule" (
    "projectId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "isImpeded" BOOLEAN NOT NULL DEFAULT false,
    "impediments" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrentProjectSchedule_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "CurrentPhaseSchedule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectPhaseId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrentPhaseSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrentResourceAllocation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectPhaseId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "minutesAllocated" INTEGER NOT NULL,

    CONSTRAINT "CurrentResourceAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrentResourceUtilization" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "minutesBusy" INTEGER NOT NULL,
    "minutesTotal" INTEGER NOT NULL,
    "utilizationPercentage" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "CurrentResourceUtilization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrentEngineWarning" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "projectId" TEXT,
    "resourceId" TEXT,
    "date" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrentEngineWarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineChangeLog" (
    "id" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "portfolioEndDateBefore" TIMESTAMP(3),
    "portfolioEndDateAfter" TIMESTAMP(3),
    "differenceDays" INTEGER NOT NULL,
    "mainCause" TEXT NOT NULL,
    "details" TEXT NOT NULL,

    CONSTRAINT "EngineChangeLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CommitteeMeeting" ADD CONSTRAINT "CommitteeMeeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeMeetingEvaluation" ADD CONSTRAINT "CommitteeMeetingEvaluation_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "CommitteeMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeMeetingEvaluation" ADD CONSTRAINT "CommitteeMeetingEvaluation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentProjectSchedule" ADD CONSTRAINT "CurrentProjectSchedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentPhaseSchedule" ADD CONSTRAINT "CurrentPhaseSchedule_projectPhaseId_fkey" FOREIGN KEY ("projectPhaseId") REFERENCES "ProjectPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
