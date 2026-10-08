DROP INDEX "comments_post_parent_created_idx";--> statement-breakpoint
DROP INDEX "comments_parent_idx";--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "content" SET DATA TYPE varchar(2500);--> statement-breakpoint
CREATE INDEX "comments_post_parent_created_id_idx" ON "comments" USING btree ("post_id","parent_comment_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comments_parent_created_id_idx" ON "comments" USING btree ("parent_comment_id","created_at","id");