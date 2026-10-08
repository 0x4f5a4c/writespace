import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../db";
import { posts, users } from "../../../db/schema";

import { CreatePostInput } from "../dtos/create-post.dto";
import { UpdatePostDto } from "../dtos/update-post.dto";

import {
  PostCoverImage,
  PostMediaItem,
  PostStatus,
} from "../interfaces/post.interface";

import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import logger from "@config/logger";

import sanitizeHtml from "sanitize-html";

import { calculateReadTime, generateExcerpt } from "../domain/post-content";

import {
  assertValidTransition,
  affectsTotalPosts,
  toPostStatus,
} from "../domain/post-lifecycle";

import { generateUniqueSlug } from "../domain/post-slug";

import { postMediaService } from "./post-media.service";

import { addMediaCleanupJob } from "@shared/queues/media.queue";

export interface CreatePostData extends CreatePostInput {
  media?: PostMediaItem[];
  coverImage?: PostCoverImage;
}

export interface UpdatePostData extends UpdatePostDto {
  media?: PostMediaItem[];
  coverImage?: PostCoverImage;
}

class PostCommandService {
  /**
   * Create a new post.
   */
  public async createPost(
    authorId: string,
    data: CreatePostData,
  ): Promise<string> {
    const cleanContent = this.sanitizeContent(data.content);

    const media = data.media ?? [];

    postMediaService.validateMedia(media);

    const status = data.status ?? PostStatus.DRAFT;

    const now = new Date();

    let scheduledAt: Date | null = null;

    if (status === PostStatus.SCHEDULED) {
      if (!data.scheduledAt) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "scheduledAt is required when scheduling a post",
        );
      }

      const requestedScheduledAt = new Date(data.scheduledAt);

      if (Number.isNaN(requestedScheduledAt.getTime())) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "scheduledAt must be a valid date",
        );
      }

      if (requestedScheduledAt <= now) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "scheduledAt must be in the future",
        );
      }

      scheduledAt = requestedScheduledAt;
    }

    const publishDate = status === PostStatus.PUBLISHED ? now : null;

    const slug = generateUniqueSlug(data.title);

    if (!slug) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Unable to generate a valid slug from the post title",
      );
    }

    const excerpt = generateExcerpt(cleanContent);
    const readTime = calculateReadTime(cleanContent);

    const mediaDbState = postMediaService.toDatabase({
      media,
      coverImage: data.coverImage,
    });

    const newPostId = await db.transaction(async (tx) => {
      const [createdPost] = await tx
        .insert(posts)
        .values({
          title: data.title,
          slug,
          subtitle: data.subtitle,
          content: cleanContent,
          excerpt,

          authorId,

          readTime,

          tags: data.tags && data.tags.length > 0 ? data.tags : undefined,

          media: mediaDbState.media.length > 0 ? mediaDbState.media : undefined,

          mediaPublicIds:
            mediaDbState.mediaPublicIds.length > 0
              ? mediaDbState.mediaPublicIds
              : undefined,

          codeSnippets:
            data.codeSnippets && data.codeSnippets.length > 0
              ? data.codeSnippets
              : undefined,

          coverImageUrl: mediaDbState.coverImageUrl,
          coverImagePublicId: mediaDbState.coverImagePublicId,
          coverImageAltText: mediaDbState.coverImageAltText,
          coverImageCredit: mediaDbState.coverImageCredit,

          status,
          scheduledAt,
          publishDate,
        })
        .returning({
          id: posts.id,
        });

      if (!createdPost) {
        throw new AppError(
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          "Failed to create post",
        );
      }

      await tx
        .update(users)
        .set({
          totalPosts: sql`${users.totalPosts} + 1`,
        })
        .where(eq(users.id, authorId));

      return createdPost.id;
    });

    return newPostId;
  }

  /**
   * Move a post to trash.
   */
  public async trashPost(
    postId: string,
    userId: string,
    isAdmin: boolean = false,
  ): Promise<void> {
    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

    if (!post) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    if (!isAdmin && post.authorId !== userId) {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "You are not authorized to delete this post",
      );
    }

    const currentStatus = toPostStatus(post.status);
    const nextStatus = PostStatus.TRASH;

    assertValidTransition(currentStatus, nextStatus);

    const totalPostsDelta = affectsTotalPosts(currentStatus, nextStatus);

    await db.transaction(async (tx) => {
      const [updatedPost] = await tx
        .update(posts)
        .set({
          status: nextStatus,
          scheduledAt: null,
          version: sql`${posts.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(posts.id, postId), eq(posts.version, post.version)))
        .returning({
          id: posts.id,
        });

      if (!updatedPost) {
        throw new AppError(
          HTTP_STATUS.CONFLICT,
          "Post was modified by another request. Please refresh and try again.",
        );
      }

      if (totalPostsDelta !== 0) {
        await tx
          .update(users)
          .set({
            totalPosts: sql`${users.totalPosts} + ${totalPostsDelta}`,
          })
          .where(eq(users.id, post.authorId));
      }
    });
  }

  /**
   * Restore a trashed post back to draft.
   */
  public async restorePost(postId: string, userId: string): Promise<void> {
    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

    if (!post) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    if (post.authorId !== userId) {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "You are not authorized to restore this post",
      );
    }

    const currentStatus = toPostStatus(post.status);
    const nextStatus = PostStatus.DRAFT;

    assertValidTransition(currentStatus, nextStatus);

    const totalPostsDelta = affectsTotalPosts(currentStatus, nextStatus);

    await db.transaction(async (tx) => {
      const [updatedPost] = await tx
        .update(posts)
        .set({
          status: nextStatus,
          scheduledAt: null,
          publishDate: null,
          version: sql`${posts.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(posts.id, postId), eq(posts.version, post.version)))
        .returning({
          id: posts.id,
        });

      if (!updatedPost) {
        throw new AppError(
          HTTP_STATUS.CONFLICT,
          "Post was modified by another request. Please refresh and try again.",
        );
      }

      if (totalPostsDelta !== 0) {
        await tx
          .update(users)
          .set({
            totalPosts: sql`${users.totalPosts} + ${totalPostsDelta}`,
          })
          .where(eq(users.id, post.authorId));
      }
    });
  }

  /**
   * Update an existing post.
   *
   * Database state is committed first.
   * Media cleanup is queued only after the transaction succeeds.
   */
  public async updatePost(
    postId: string,
    userId: string,
    data: UpdatePostData,
  ): Promise<string> {
    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

    if (!post) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    if (post.authorId !== userId) {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "You are not authorized to edit this post",
      );
    }

    const currentStatus = toPostStatus(post.status);

    const nextStatus = data.status ? toPostStatus(data.status) : currentStatus;

    assertValidTransition(currentStatus, nextStatus);

    let nextScheduledAt = post.scheduledAt;
    let nextPublishDate = post.publishDate;

    if (nextStatus === PostStatus.SCHEDULED) {
      const requestedScheduledAt = data.scheduledAt
        ? new Date(data.scheduledAt)
        : post.scheduledAt;

      if (!requestedScheduledAt) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "scheduledAt is required when scheduling a post",
        );
      }

      if (Number.isNaN(requestedScheduledAt.getTime())) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "scheduledAt must be a valid date",
        );
      }

      if (requestedScheduledAt <= new Date()) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "scheduledAt must be in the future",
        );
      }

      nextScheduledAt = requestedScheduledAt;
      nextPublishDate = null;
    }

    if (nextStatus === PostStatus.PUBLISHED) {
      nextPublishDate =
        currentStatus === PostStatus.PUBLISHED && post.publishDate
          ? post.publishDate
          : new Date();

      nextScheduledAt = null;
    }

    if (nextStatus === PostStatus.DRAFT) {
      nextScheduledAt = null;
      nextPublishDate = null;
    }

    if (nextStatus === PostStatus.ARCHIVED) {
      nextScheduledAt = null;
    }

    if (nextStatus === PostStatus.TRASH) {
      nextScheduledAt = null;
    }

    const totalPostsDelta = affectsTotalPosts(currentStatus, nextStatus);

    const updates: Partial<typeof posts.$inferInsert> = {};

    let hasChanges = false;

    /**
     * Media IDs that become unused because of this update.
     *
     * These are only candidates at this point.
     * They will be filtered against the final media state
     * before being sent to the cleanup queue.
     */
    const mediaPublicIdsToCleanup = new Set<string>();

    /**
     * Keep track of the media state that will remain attached
     * to the post after this update.
     */
    let nextBodyMediaPublicIds = post.mediaPublicIds ?? [];

    let nextCoverImagePublicId = post.coverImagePublicId ?? null;

    /*
     * Title
     */
    if (data.title !== undefined && data.title !== post.title) {
      const newSlug = generateUniqueSlug(data.title);

      if (!newSlug) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "Unable to generate a valid slug from the post title",
        );
      }

      updates.title = data.title;
      updates.slug = newSlug;

      hasChanges = true;
    }

    /*
     * Content
     */
    if (data.content !== undefined && data.content !== post.content) {
      const cleanContent = this.sanitizeContent(data.content);

      updates.content = cleanContent;
      updates.excerpt = generateExcerpt(cleanContent);
      updates.readTime = calculateReadTime(cleanContent);

      hasChanges = true;
    }

    /*
     * Subtitle
     */
    if (data.subtitle !== undefined && data.subtitle !== post.subtitle) {
      updates.subtitle = data.subtitle;

      hasChanges = true;
    }

    /*
     * Excerpt
     */
    if (data.excerpt !== undefined && data.excerpt !== post.excerpt) {
      updates.excerpt = data.excerpt;

      hasChanges = true;
    }

    /*
     * Tags
     */
    if (data.tags !== undefined) {
      const currentTags = post.tags ?? [];

      if (JSON.stringify(currentTags) !== JSON.stringify(data.tags)) {
        updates.tags = data.tags;

        hasChanges = true;
      }
    }

    /*
     * Body media
     */
    if (data.media !== undefined) {
      const currentMediaState = postMediaService.fromDatabase(
        post.media,
        post.mediaPublicIds,
        post.coverImageUrl,
        post.coverImagePublicId,
        post.coverImageAltText,
        post.coverImageCredit,
      );

      postMediaService.validateMedia(data.media);

      const nextMediaState = {
        ...currentMediaState,
        media: data.media,
      };

      const mediaDiff = postMediaService.diff(
        currentMediaState,
        nextMediaState,
      );

      if (
        mediaDiff.addedMedia.length > 0 ||
        mediaDiff.removedMedia.length > 0
      ) {
        const mediaDbState = postMediaService.toDatabase(nextMediaState);

        updates.media = mediaDbState.media;

        updates.mediaPublicIds = mediaDbState.mediaPublicIds;

        nextBodyMediaPublicIds = mediaDbState.mediaPublicIds;

        const removedPublicIds =
          postMediaService.getRemovedPublicIds(mediaDiff);

        for (const publicId of removedPublicIds) {
          mediaPublicIdsToCleanup.add(publicId);
        }

        hasChanges = true;
      }
    }

    /*
     * Code snippets
     */
    if (data.codeSnippets !== undefined) {
      const currentCodeSnippets = post.codeSnippets ?? [];

      if (
        JSON.stringify(currentCodeSnippets) !==
        JSON.stringify(data.codeSnippets)
      ) {
        updates.codeSnippets = data.codeSnippets;

        hasChanges = true;
      }
    }

    /*
     * Cover image
     */
    if (data.coverImage !== undefined) {
      const newCoverImagePublicId = data.coverImage.publicId;

      const coverImageChanged =
        post.coverImageUrl !== data.coverImage.url ||
        post.coverImagePublicId !== newCoverImagePublicId ||
        post.coverImageAltText !== (data.coverImage.altText ?? null) ||
        post.coverImageCredit !== (data.coverImage.credit ?? null);

      if (coverImageChanged) {
        /*
         * If the actual cover asset changed,
         * the old asset becomes a cleanup candidate.
         */
        if (
          post.coverImagePublicId &&
          post.coverImagePublicId !== newCoverImagePublicId
        ) {
          mediaPublicIdsToCleanup.add(post.coverImagePublicId);
        }

        updates.coverImageUrl = data.coverImage.url;

        updates.coverImagePublicId = newCoverImagePublicId;

        updates.coverImageAltText = data.coverImage.altText ?? null;

        updates.coverImageCredit = data.coverImage.credit ?? null;

        nextCoverImagePublicId = newCoverImagePublicId;

        hasChanges = true;
      }
    }

    /*
     * Lifecycle timestamps
     */
    const statusChanged = nextStatus !== currentStatus;

    const scheduledAtChanged =
      nextScheduledAt?.getTime() !== post.scheduledAt?.getTime();

    const publishDateChanged =
      nextPublishDate?.getTime() !== post.publishDate?.getTime();

    if (statusChanged) {
      updates.status = nextStatus;
      updates.scheduledAt = nextScheduledAt;
      updates.publishDate = nextPublishDate;

      hasChanges = true;
    } else {
      if (scheduledAtChanged) {
        updates.scheduledAt = nextScheduledAt;

        hasChanges = true;
      }

      if (publishDateChanged) {
        updates.publishDate = nextPublishDate;

        hasChanges = true;
      }
    }

    /*
     * Nothing changed.
     */
    if (!hasChanges) {
      return postId;
    }

    updates.updatedAt = new Date();

    /*
     * Only delete Cloudinary assets that are no longer
     * referenced by the updated post.
     *
     * This protects against deleting an asset that was removed
     * from body media but is still being used as the cover,
     * or vice versa.
     */
    const activeMediaPublicIds = new Set<string>([
      ...nextBodyMediaPublicIds,
      ...(nextCoverImagePublicId ? [nextCoverImagePublicId] : []),
    ]);

    const cleanupPublicIds = [...mediaPublicIdsToCleanup].filter(
      (publicId) => !activeMediaPublicIds.has(publicId),
    );

    /*
     * Database update + post-count update must be atomic.
     */
    await db.transaction(async (tx) => {
      const [updatedPost] = await tx
        .update(posts)
        .set({
          ...updates,
          version: sql`${posts.version} + 1`,
        })
        .where(and(eq(posts.id, postId), eq(posts.version, post.version)))
        .returning({
          id: posts.id,
        });

      if (!updatedPost) {
        throw new AppError(
          HTTP_STATUS.CONFLICT,
          "Post was modified by another request. Please refresh and try again.",
        );
      }

      if (totalPostsDelta !== 0) {
        await tx
          .update(users)
          .set({
            totalPosts: sql`${users.totalPosts} + ${totalPostsDelta}`,
          })
          .where(eq(users.id, post.authorId));
      }
    });

    /*
     * IMPORTANT:
     *
     * Queue cleanup only after the database transaction
     * has successfully committed.
     *
     * A queue failure must not make an already-committed
     * database update appear as a failed request.
     */
    await this.enqueueMediaCleanup(postId, cleanupPublicIds);

    return postId;
  }

  /**
   * Queue Cloudinary cleanup for media that is no longer
   * referenced by the post.
   *
   * Cleanup is asynchronous and therefore should not block
   * or invalidate an already successful database update.
   */
  private async enqueueMediaCleanup(
    postId: string,
    publicIds: string[],
  ): Promise<void> {
    const uniquePublicIds = [
      ...new Set(
        publicIds.filter(
          (publicId) => Boolean(publicId) && publicId.trim().length > 0,
        ),
      ),
    ];

    if (uniquePublicIds.length === 0) {
      return;
    }

    try {
      await addMediaCleanupJob(uniquePublicIds);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));

      /*
       * The database update has already committed.
       *
       * Throwing here would incorrectly report the request
       * as failed even though the post was successfully updated.
       *
       * The failed cleanup must instead be visible through logs
       * and operational monitoring.
       */
      logger.error(`Failed to enqueue media cleanup for post ${postId}`, {
        error: err,
        publicIds: uniquePublicIds,
      });
    }
  }

  /**
   * Sanitize user-generated post content.
   */
  private sanitizeContent(content: string): string {
    return sanitizeHtml(content, {
      allowedTags: [
        "p",
        "br",
        "strong",
        "em",
        "u",
        "s",
        "blockquote",
        "ul",
        "ol",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "a",
        "img",
        "pre",
        "code",
      ],

      allowedAttributes: {
        a: ["href", "target", "rel"],
        img: ["src", "alt"],
      },
    });
  }
}

export const postCommandService = new PostCommandService();
