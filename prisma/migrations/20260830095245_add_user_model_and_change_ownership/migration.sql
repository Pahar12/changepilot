-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('REQUESTER', 'REVIEWER', 'ADMIN');

-- AlterTable
ALTER TABLE "change_requests" ADD COLUMN     "createdById" TEXT;

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'REQUESTER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "change_requests_createdById_idx" ON "change_requests"("createdById");

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
