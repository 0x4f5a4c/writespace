DROP INDEX "posts_status_publish_date_idx";--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "posts_status_publish_date_id_idx" ON "posts" USING btree ("status","publish_date","id");--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "is_premium";