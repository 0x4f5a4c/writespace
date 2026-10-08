import { and, eq, sql } from "drizzle-orm";

import { db } from "../../../db";
import { commentReactions, postReactions } from "../../../db/schema";
import type { ReactionType } from "../contracts/reaction.types";

export class ReactionRepository {
  async findPostReaction(postId: string, userId: string) {
    const result = await db
      .select({
        postId: postReactions.postId,
        userId: postReactions.userId,
        reactionType: postReactions.reactionType,
      })
      .from(postReactions)
      .where(
        and(eq(postReactions.postId, postId), eq(postReactions.userId, userId)),
      )
      .limit(1);

    return result[0] ?? null;
  }

  async findCommentReaction(commentId: string, userId: string) {
    const result = await db
      .select({
        commentId: commentReactions.commentId,
        userId: commentReactions.userId,
        reactionType: commentReactions.reactionType,
      })
      .from(commentReactions)
      .where(
        and(
          eq(commentReactions.commentId, commentId),
          eq(commentReactions.userId, userId),
        ),
      )
      .limit(1);

    return result[0] ?? null;
  }

  async setPostReaction(
    postId: string,
    userId: string,
    reactionType: ReactionType,
  ) {
    return db.transaction(async (tx) => {
      /*
       * Lock the existing row when it exists.
       *
       * If no row exists, another concurrent request may insert it.
       * Therefore the INSERT uses ON CONFLICT DO NOTHING instead of
       * relying on a 23505 exception, which would abort the PostgreSQL
       * transaction.
       */
      const existing = await tx
        .select({
          reactionType: postReactions.reactionType,
        })
        .from(postReactions)
        .where(
          and(
            eq(postReactions.postId, postId),
            eq(postReactions.userId, userId),
          ),
        )
        .for("update")
        .limit(1);

      if (existing.length === 0) {
        const inserted = await tx
          .insert(postReactions)
          .values({
            postId,
            userId,
            reactionType,
          })
          .onConflictDoNothing({
            target: [postReactions.postId, postReactions.userId],
          })
          .returning();

        if (inserted.length > 0) {
          return {
            previousReactionType: null,
            reaction: inserted[0],
          };
        }

        /*
         * A concurrent transaction inserted the reaction.
         *
         * The INSERT has now completed successfully, so the
         * transaction is still valid. We can safely read the row.
         */
        const concurrentExisting = await tx
          .select({
            reactionType: postReactions.reactionType,
          })
          .from(postReactions)
          .where(
            and(
              eq(postReactions.postId, postId),
              eq(postReactions.userId, userId),
            ),
          )
          .for("update")
          .limit(1);

        const previousReactionType =
          concurrentExisting[0]?.reactionType ?? null;

        if (previousReactionType === reactionType) {
          return {
            previousReactionType,
            reaction: concurrentExisting[0],
          };
        }

        const updated = await tx
          .update(postReactions)
          .set({
            reactionType,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(postReactions.postId, postId),
              eq(postReactions.userId, userId),
            ),
          )
          .returning();

        return {
          previousReactionType,
          reaction: updated[0],
        };
      }

      const previousReactionType = existing[0]?.reactionType ?? null;

      if (previousReactionType === reactionType) {
        return {
          previousReactionType,
          reaction: existing[0],
        };
      }

      const updated = await tx
        .update(postReactions)
        .set({
          reactionType,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(postReactions.postId, postId),
            eq(postReactions.userId, userId),
          ),
        )
        .returning();

      return {
        previousReactionType,
        reaction: updated[0],
      };
    });
  }

  async setCommentReaction(
    commentId: string,
    userId: string,
    reactionType: ReactionType,
  ) {
    return db.transaction(async (tx) => {
      const existing = await tx
        .select({
          reactionType: commentReactions.reactionType,
        })
        .from(commentReactions)
        .where(
          and(
            eq(commentReactions.commentId, commentId),
            eq(commentReactions.userId, userId),
          ),
        )
        .for("update")
        .limit(1);

      if (existing.length === 0) {
        const inserted = await tx
          .insert(commentReactions)
          .values({
            commentId,
            userId,
            reactionType,
          })
          .onConflictDoNothing({
            target: [commentReactions.commentId, commentReactions.userId],
          })
          .returning();

        if (inserted.length > 0) {
          return {
            previousReactionType: null,
            reaction: inserted[0],
          };
        }

        /*
         * A concurrent request inserted the reaction.
         * The transaction remains valid because ON CONFLICT
         * handled the conflict without raising 23505.
         */
        const concurrentExisting = await tx
          .select({
            reactionType: commentReactions.reactionType,
          })
          .from(commentReactions)
          .where(
            and(
              eq(commentReactions.commentId, commentId),
              eq(commentReactions.userId, userId),
            ),
          )
          .for("update")
          .limit(1);

        const previousReactionType =
          concurrentExisting[0]?.reactionType ?? null;

        if (previousReactionType === reactionType) {
          return {
            previousReactionType,
            reaction: concurrentExisting[0],
          };
        }

        const updated = await tx
          .update(commentReactions)
          .set({
            reactionType,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(commentReactions.commentId, commentId),
              eq(commentReactions.userId, userId),
            ),
          )
          .returning();

        return {
          previousReactionType,
          reaction: updated[0],
        };
      }

      const previousReactionType = existing[0]?.reactionType ?? null;

      if (previousReactionType === reactionType) {
        return {
          previousReactionType,
          reaction: existing[0],
        };
      }

      const updated = await tx
        .update(commentReactions)
        .set({
          reactionType,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(commentReactions.commentId, commentId),
            eq(commentReactions.userId, userId),
          ),
        )
        .returning();

      return {
        previousReactionType,
        reaction: updated[0],
      };
    });
  }

  async deletePostReaction(postId: string, userId: string) {
    const result = await db
      .delete(postReactions)
      .where(
        and(eq(postReactions.postId, postId), eq(postReactions.userId, userId)),
      )
      .returning();

    return result[0] ?? null;
  }

  async deleteCommentReaction(commentId: string, userId: string) {
    const result = await db
      .delete(commentReactions)
      .where(
        and(
          eq(commentReactions.commentId, commentId),
          eq(commentReactions.userId, userId),
        ),
      )
      .returning();

    return result[0] ?? null;
  }

  async getPostReactionCounts(postId: string) {
    return db
      .select({
        reactionType: postReactions.reactionType,
        count: sql<number>`count(*)::int`,
      })
      .from(postReactions)
      .where(eq(postReactions.postId, postId))
      .groupBy(postReactions.reactionType);
  }

  async getCommentReactionCounts(commentId: string) {
    return db
      .select({
        reactionType: commentReactions.reactionType,
        count: sql<number>`count(*)::int`,
      })
      .from(commentReactions)
      .where(eq(commentReactions.commentId, commentId))
      .groupBy(commentReactions.reactionType);
  }
}

export const reactionRepository = new ReactionRepository();
