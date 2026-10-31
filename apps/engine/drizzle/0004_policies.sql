CREATE TABLE "policies" (
	"id" text PRIMARY KEY NOT NULL,
	"parent" text NOT NULL,
	"hypothesis" text NOT NULL,
	"spec" jsonb NOT NULL,
	"report" jsonb,
	"status" text NOT NULL,
	"allocation_pct" double precision DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
