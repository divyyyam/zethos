CREATE TABLE "engine_state" (
	"id" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "issued_at" SET DATA TYPE numeric(78, 0);--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "expiry" SET DATA TYPE numeric(78, 0);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "status" text DEFAULT 'issued' NOT NULL;--> statement-breakpoint
CREATE INDEX "fills_epoch_ts_idx" ON "fills" USING btree ("epoch","ts");--> statement-breakpoint
CREATE INDEX "quotes_epoch_idx" ON "quotes" USING btree ("epoch");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_taker_nonce_idx" ON "quotes" USING btree ("taker","nonce");
--> statement-breakpoint
UPDATE quotes SET status = 'filled' WHERE id IN (SELECT quote_id FROM fills);
