-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "username_registry" (
    "username" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flagged_at" TIMESTAMP(3),

    CONSTRAINT "username_registry_pkey" PRIMARY KEY ("username")
);

-- CreateIndex
CREATE UNIQUE INDEX "username_registry_address_key" ON "username_registry"("address");

-- CreateIndex
CREATE INDEX "username_registry_username_idx" ON "username_registry"("username");

