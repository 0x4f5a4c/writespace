import { Post } from "../../../db/schema";

export type { Post };

export enum PostStatus {
  DRAFT = "draft",
  SCHEDULED = "scheduled",
  PUBLISHED = "published",
  ARCHIVED = "archived",
  TRASH = "trash",
}

/**
 * Canonical representation of a media asset attached to a post.
 *
 * The URL is used by clients to display the asset.
 * The publicId is used by the server to manage/delete the asset
 * from the media provider.
 */
export interface PostMediaItem {
  url: string;
  publicId: string;
}

/**
 * Canonical representation of a post cover image.
 *
 * A cover image is managed separately from post body media because
 * its lifecycle is different.
 */
export interface PostCoverImage extends PostMediaItem {
  altText?: string;
  credit?: string;
}
