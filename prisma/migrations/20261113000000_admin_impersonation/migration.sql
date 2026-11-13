-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "impersonatorUserId" UUID,
ADD COLUMN     "readOnly" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "auth_sessions_impersonatorUserId_idx" ON "auth_sessions"("impersonatorUserId");
