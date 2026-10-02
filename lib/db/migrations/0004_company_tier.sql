CREATE TYPE "public"."company_tier" AS ENUM('tier_1', 'tier_2', 'tier_3');--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tier" "company_tier";