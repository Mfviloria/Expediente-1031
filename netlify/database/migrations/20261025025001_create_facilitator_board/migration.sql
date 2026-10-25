CREATE TABLE "facilitator_attempts" (
	"id" text PRIMARY KEY,
	"count" integer NOT NULL,
	"reset" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilitator_sessions" (
	"id" text PRIMARY KEY,
	"expires" bigint NOT NULL,
	"version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"pid" text PRIMARY KEY,
	"data" jsonb NOT NULL,
	"updated" bigint NOT NULL
);
