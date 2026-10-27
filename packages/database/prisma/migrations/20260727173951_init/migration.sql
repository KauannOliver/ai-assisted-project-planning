-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'PROJECT_MANAGER', 'MANAGER', 'DIRECTOR');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CatalogType" AS ENUM ('SYSTEM', 'CLASSIFICATION', 'FLOW_TYPE', 'BUSINESS_PRIORITY', 'CLASS', 'PHASE', 'IMPEDIMENT_TYPE', 'RESOURCE_MODALITY', 'ROLE');

-- CreateEnum
CREATE TYPE "UnavailabilityType" AS ENUM ('FERIADO', 'FERIAS', 'ATESTADO', 'TREINAMENTO', 'LICENCA', 'OUTRO');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "forcePasswordChange" BOOLEAN NOT NULL DEFAULT true,
    "invalidAttempts" INTEGER NOT NULL DEFAULT 0,
    "tempLockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDepartmentScope" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDepartmentScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL,
    "type" "CatalogType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT,
    "order" INTEGER,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalParameter" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalParameter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modalityId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "weeklyHours" DOUBLE PRECISION NOT NULL,
    "overheadPercentage" DOUBLE PRECISION NOT NULL,
    "developmentPercentage" DOUBLE PRECISION NOT NULL,
    "recommendedWipLimit" INTEGER NOT NULL DEFAULT 3,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceUnavailability" (
    "id" TEXT NOT NULL,
    "type" "UnavailabilityType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "unavailableMinutesPerDay" INTEGER,
    "resourceId" TEXT,
    "global" BOOLEAN NOT NULL DEFAULT false,
    "annualRecurrence" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceUnavailability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "UserDepartmentScope_userId_departmentId_key" ON "UserDepartmentScope"("userId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_type_code_key" ON "CatalogItem"("type", "code");

-- AddForeignKey
ALTER TABLE "UserDepartmentScope" ADD CONSTRAINT "UserDepartmentScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDepartmentScope" ADD CONSTRAINT "UserDepartmentScope_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_modalityId_fkey" FOREIGN KEY ("modalityId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceUnavailability" ADD CONSTRAINT "ResourceUnavailability_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
