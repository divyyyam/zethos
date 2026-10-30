CREATE TABLE "epochs" (
	"epoch" integer PRIMARY KEY NOT NULL,
	"started_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fills" (
	"id" text PRIMARY KEY NOT NULL,
	"quote_id" text NOT NULL,
	"ts" bigint NOT NULL,
	"epoch" integer NOT NULL,
	"pair" text NOT NULL,
	"side" text NOT NULL,
	"taker" text NOT NULL,
	"token_in" text NOT NULL,
	"token_out" text NOT NULL,
	"amount_in" numeric(78, 0) NOT NULL,
	"amount_out" numeric(78, 0) NOT NULL,
	"nonce" numeric(78, 0) NOT NULL,
	"price" double precision NOT NULL,
	"mid_at_fill" double precision NOT NULL,
	"flow" text NOT NULL,
	CONSTRAINT "fills_quoteId_unique" UNIQUE("quote_id")
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"epoch" integer NOT NULL,
	"token" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	CONSTRAINT "inventory_epoch_token_pk" PRIMARY KEY("epoch","token")
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"ts" bigint NOT NULL,
	"epoch" integer NOT NULL,
	"pair" text NOT NULL,
	"side" text NOT NULL,
	"client" text NOT NULL,
	"taker" text NOT NULL,
	"token_in" text NOT NULL,
	"token_out" text NOT NULL,
	"amount_in" numeric(78, 0) NOT NULL,
	"amount_out" numeric(78, 0) NOT NULL,
	"nonce" numeric(78, 0) NOT NULL,
	"issued_at" bigint NOT NULL,
	"expiry" bigint NOT NULL,
	"signature" text NOT NULL,
	"breakdown" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fills_taker_nonce" ON "fills" USING btree ("taker","nonce");