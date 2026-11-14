-- One-time links that let a client onboarded by a superadmin choose their own password.
CREATE TABLE "password_setup_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_setup_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_setup_tokens_tokenHash_key" ON "password_setup_tokens"("tokenHash");
CREATE INDEX "password_setup_tokens_userId_idx" ON "password_setup_tokens"("userId");

ALTER TABLE "password_setup_tokens" ADD CONSTRAINT "password_setup_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
