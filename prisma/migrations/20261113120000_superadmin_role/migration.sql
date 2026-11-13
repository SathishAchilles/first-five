-- Split roles: whoever signs up is the admin of their own account; First Five operators are superadmins.
-- Rename in place so every existing user keeps their role (user -> account_admin, admin -> superadmin).
ALTER TYPE "UserRole" RENAME VALUE 'user' TO 'account_admin';
ALTER TYPE "UserRole" RENAME VALUE 'admin' TO 'superadmin';

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'account_admin';
