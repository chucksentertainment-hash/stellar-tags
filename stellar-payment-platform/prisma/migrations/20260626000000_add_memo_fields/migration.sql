-- AlterTable: add optional memo_type and memo columns to username_registry
ALTER TABLE "username_registry" ADD COLUMN "memo_type" TEXT;
ALTER TABLE "username_registry" ADD COLUMN "memo" TEXT;
