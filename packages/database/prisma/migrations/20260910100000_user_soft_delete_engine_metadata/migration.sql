ALTER TABLE "User"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT;

CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

ALTER TABLE "ScheduleRun"
  ADD COLUMN "engineVersion" TEXT NOT NULL DEFAULT '2.1.0',
  ADD COLUMN "referenceDate" TIMESTAMP(3);
