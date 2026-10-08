import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";

import { db } from "../../../db";
import { comments, commentReactions, posts, users } from "../../../db/schema";

export class CommentRepository {
  async findPostForComment(postId: string) {
    const result = await db
      .select({
        id: posts.id,
        authorId: posts.authorId,
      })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

    return result[0] ?? null;
  }

  async createComment(
    postId: string,
    authorId: string,
    content: string,
    parentCommentId?: string | null,
  ) {
    return db.transaction(async (tx) => {
      const [createdComment] = await tx
        .insert(comments)
        .values({
          content,
          postId,
          authorId,
          parentCommentId: parentCommentId ?? null,
        })
        .returning({
          id: comments.id,
          postId: comments.postId,
          authorId: comments.authorId,
          parentCommentId: comments.parentCommentId,
          createdAt: comments.createdAt,
        });

      await tx
        .update(posts)
        .set({
          commentCount: sql`${posts.commentCount} + 1`,
        })
        .where(eq(posts.id, postId));

      if (parentCommentId) {
        await tx
          .update(comments)
          .set({
            replyCount: sql`${comments.replyCount} + 1`,
          })
          .where(eq(comments.id, parentCommentId));
      }

      return createdComment;
    });
  }

  async getTopLevelComments(
    postId: string,
    limit: number,
    cursor?: Date,
    requesterId?: string,
  ) {
    const conditions = [
      eq(comments.postId, postId),
      isNull(comments.parentCommentId),
    ];

    if (cursor) {
      conditions.push(lt(comments.createdAt, cursor));
    }

    return db
      .select({
        id: comments.id,
        content: comments.content,
        parentCommentId: comments.parentCommentId,
        replyCount: comments.replyCount,
        isEdited: comments.isEdited,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,

        author: {
          id: users.id,
          username: users.username,
          fullname: users.fullname,
          profileImageUrl: users.profileImageUrl,
        },

        ...(requesterId
          ? {
              reactionType: sql<string | null>`
                  (
                    SELECT ${commentReactions.reactionType}
                    FROM ${commentReactions}
                    WHERE
                      ${commentReactions.commentId} = ${comments.id}
                      AND ${commentReactions.userId} = ${requesterId}
                    LIMIT 1
                  )
                `.mapWith(String),
            }
          : {}),
      })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(and(...conditions))
      .orderBy(desc(comments.createdAt))
      .limit(limit);
  }

  async getCommentReplies(
    parentCommentId: string,
    limit: number,
    cursor?: Date,
    requesterId?: string,
  ) {
    const conditions = [eq(comments.parentCommentId, parentCommentId)];

    if (cursor) {
      conditions.push(lt(comments.createdAt, cursor));
    }

    return db
      .select({
        id: comments.id,
        content: comments.content,
        parentCommentId: comments.parentCommentId,
        replyCount: comments.replyCount,
        isEdited: comments.isEdited,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,

        author: {
          id: users.id,
          username: users.username,
          fullname: users.fullname,
          profileImageUrl: users.profileImageUrl,
        },

        ...(requesterId
          ? {
              reactionType: sql<string | null>`
                  (
                    SELECT ${commentReactions.reactionType}
                    FROM ${commentReactions}
                    WHERE
                      ${commentReactions.commentId} = ${comments.id}
                      AND ${commentReactions.userId} = ${requesterId}
                    LIMIT 1
                  )
                `.mapWith(String),
            }
          : {}),
      })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(and(...conditions))
      .orderBy(desc(comments.createdAt))
      .limit(limit);
  }

  async getCommentById(commentId: string, requesterId?: string) {
    const result = await db
      .select({
        id: comments.id,
        content: comments.content,
        postId: comments.postId,
        authorId: comments.authorId,
        parentCommentId: comments.parentCommentId,
        replyCount: comments.replyCount,
        isEdited: comments.isEdited,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,

        author: {
          id: users.id,
          username: users.username,
          fullname: users.fullname,
          profileImageUrl: users.profileImageUrl,
        },

        ...(requesterId
          ? {
              reactionType: sql<string | null>`
                  (
                    SELECT ${commentReactions.reactionType}
                    FROM ${commentReactions}
                    WHERE
                      ${commentReactions.commentId} = ${comments.id}
                      AND ${commentReactions.userId} = ${requesterId}
                    LIMIT 1
                  )
                `.mapWith(String),
            }
          : {}),
      })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(eq(comments.id, commentId))
      .limit(1);

    return result[0] ?? null;
  }

  async deleteComment(commentId: string) {
    return db.transaction(async (tx) => {
      const [comment] = await tx
        .select({
          id: comments.id,
          postId: comments.postId,
          parentCommentId: comments.parentCommentId,
        })
        .from(comments)
        .where(eq(comments.id, commentId))
        .limit(1);

      if (!comment) {
        return null;
      }

      await tx.delete(comments).where(eq(comments.id, commentId));

      await tx
        .update(posts)
        .set({
          commentCount: sql`
            (
              SELECT COUNT(*)
              FROM ${comments}
              WHERE ${comments.postId} = ${comment.postId}
            )
          `,
        })
        .where(eq(posts.id, comment.postId));

      if (comment.parentCommentId) {
        await tx
          .update(comments)
          .set({
            replyCount: sql`
              (
                SELECT COUNT(*)
                FROM ${comments} AS child_comments
                WHERE child_comments.parent_comment_id =
                  ${comment.parentCommentId}
              )
            `,
          })
          .where(eq(comments.id, comment.parentCommentId));
      }

      return comment;
    });
  }

  async updateComment(commentId: string, content: string) {
    const result = await db
      .update(comments)
      .set({
        content,
        isEdited: true,
      })
      .where(eq(comments.id, commentId))
      .returning({
        id: comments.id,
      });

    return result[0] ?? null;
  }
}

export const commentRepository = new CommentRepository();
