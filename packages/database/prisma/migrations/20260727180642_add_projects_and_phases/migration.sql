-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "sdNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "requester" TEXT NOT NULL,
    "openingDate" TIMESTAMP(3) NOT NULL,
    "requestedDeadline" TIMESTAMP(3),
    "problemDescription" TEXT,
    "objective" TEXT,
    "currentProcess" TEXT,
    "desiredProcess" TEXT,
    "classificationId" TEXT NOT NULL,
    "flowTypeId" TEXT NOT NULL,
    "businessPriorityId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "totalHours" DOUBLE PRECISION NOT NULL,
    "isLegalRequirement" BOOLEAN NOT NULL DEFAULT false,
    "status" INTEGER NOT NULL DEFAULT 1,
    "committeeDecision" TEXT,
    "committeeScore" DOUBLE PRECISION,
    "decisionDate" TIMESTAMP(3),
    "boardNotes" TEXT,
    "estimatedMonthlyGain" DOUBLE PRECISION,
    "estimatedMonthlyLossAvoided" DOUBLE PRECISION,
    "roiMonthly" DOUBLE PRECISION,
    "realCompletionDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDepartment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSystem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectSystem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPhase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "order" INTEGER NOT NULL,
    "totalMinutes" INTEGER NOT NULL,
    "executionMode" TEXT NOT NULL DEFAULT 'SIMULTANEOUS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectPhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPhaseAllocation" (
    "id" TEXT NOT NULL,
    "projectPhaseId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "minutesAllocated" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectPhaseAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_sdNumber_key" ON "Project"("sdNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDepartment_projectId_departmentId_key" ON "ProjectDepartment"("projectId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSystem_projectId_systemId_key" ON "ProjectSystem"("projectId", "systemId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPhase_projectId_phaseId_key" ON "ProjectPhase"("projectId", "phaseId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPhaseAllocation_projectPhaseId_resourceId_key" ON "ProjectPhaseAllocation"("projectPhaseId", "resourceId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_flowTypeId_fkey" FOREIGN KEY ("flowTypeId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_businessPriorityId_fkey" FOREIGN KEY ("businessPriorityId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_classId_fkey" FOREIGN KEY ("classId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDepartment" ADD CONSTRAINT "ProjectDepartment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDepartment" ADD CONSTRAINT "ProjectDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSystem" ADD CONSTRAINT "ProjectSystem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSystem" ADD CONSTRAINT "ProjectSystem_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhaseAllocation" ADD CONSTRAINT "ProjectPhaseAllocation_projectPhaseId_fkey" FOREIGN KEY ("projectPhaseId") REFERENCES "ProjectPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhaseAllocation" ADD CONSTRAINT "ProjectPhaseAllocation_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
