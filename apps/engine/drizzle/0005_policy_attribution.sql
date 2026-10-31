ALTER TABLE "fills" ADD COLUMN "policy_id" text DEFAULT 'v0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "policy_id" text DEFAULT 'v0' NOT NULL;