ALTER TABLE "applications" ALTER COLUMN "stage" SET DATA TYPE text;--> statement-breakpoint
UPDATE "applications" SET "stage" = 'researching' WHERE "stage" = 'tailoring';--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "stage" SET DEFAULT 'researching'::text;--> statement-breakpoint
DROP TYPE "public"."application_stage";--> statement-breakpoint
CREATE TYPE "public"."application_stage" AS ENUM('researching', 'applied', 'screen', 'interview', 'offer', 'closed');--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "stage" SET DEFAULT 'researching'::"public"."application_stage";--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "stage" SET DATA TYPE "public"."application_stage" USING "stage"::"public"."application_stage";