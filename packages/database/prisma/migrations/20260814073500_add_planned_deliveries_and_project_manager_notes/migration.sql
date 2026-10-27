ALTER TABLE "Project"
  ADD COLUMN "projectManagerNotes" TEXT;

CREATE TABLE "PlannedDelivery" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "recipientDeptId" TEXT NOT NULL,
  "plannedDate" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlannedDelivery_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Delivery"
  ADD COLUMN "plannedDeliveryId" TEXT;

CREATE INDEX "PlannedDelivery_projectId_plannedDate_idx" ON "PlannedDelivery"("projectId", "plannedDate");
CREATE UNIQUE INDEX "Delivery_plannedDeliveryId_key" ON "Delivery"("plannedDeliveryId");

ALTER TABLE "PlannedDelivery"
  ADD CONSTRAINT "PlannedDelivery_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlannedDelivery"
  ADD CONSTRAINT "PlannedDelivery_recipientDeptId_fkey"
  FOREIGN KEY ("recipientDeptId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Delivery"
  ADD CONSTRAINT "Delivery_plannedDeliveryId_fkey"
  FOREIGN KEY ("plannedDeliveryId") REFERENCES "PlannedDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommitteeMeetingEvaluation"
  DROP CONSTRAINT "CommitteeMeetingEvaluation_projectId_fkey",
  ADD CONSTRAINT "CommitteeMeetingEvaluation_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
