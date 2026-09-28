ALTER TABLE "posts" ADD COLUMN "cover_image_public_id" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "media_public_ids" jsonb DEFAULT '[]'::jsonb;