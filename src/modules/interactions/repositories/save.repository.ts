import { and, desc, eq, lt, sql } from "drizzle-orm";

import { db } from "../../../db";
import { postSaves } from "../../../db/schema";

export class SaveRepository {
  async findSave(userId: string, postId: string) {
    const result = await db
      .select({
        postId: postSaves.postId,
        userId: postSaves.userId,
        createdAt: postSaves.createdAt,
      })
      .from(postSaves)
      .where(and(eq(postSaves.userId, userId), eq(postSaves.postId, postId)))
      .limit(1);

    return result[0] ?? null;
  }

  async isPostSaved(userId: string, postId: string) {
    const result = await db
      .select({
        exists: sql<boolean>`true`,
      })
      .from(postSaves)
      .where(and(eq(postSaves.userId, userId), eq(postSaves.postId, postId)))
      .limit(1);

    return result.length > 0;
  }

  async createSave(userId: string, postId: string) {
    const result = await db
      .insert(postSaves)
      .values({
        userId,
        postId,
      })
      .onConflictDoNothing({
        target: [postSaves.postId, postSaves.userId],
      })
      .returning({
        postId: postSaves.postId,
        userId: postSaves.userId,
        createdAt: postSaves.createdAt,
      });

    return result[0] ?? null;
  }

  async deleteSave(userId: string, postId: string) {
    const result = await db
      .delete(postSaves)
      .where(and(eq(postSaves.userId, userId), eq(postSaves.postId, postId)))
      .returning({
        postId: postSaves.postId,
        userId: postSaves.userId,
        createdAt: postSaves.createdAt,
      });

    return result[0] ?? null;
  }

  async getSavedPosts(userId: string, limit: number, cursor?: Date) {
    const conditions = cursor
      ? and(eq(postSaves.userId, userId), lt(postSaves.createdAt, cursor))
      : eq(postSaves.userId, userId);

    return db
      .select({
        postId: postSaves.postId,
        userId: postSaves.userId,
        createdAt: postSaves.createdAt,
      })
      .from(postSaves)
      .where(conditions)
      .orderBy(desc(postSaves.createdAt))
      .limit(limit);
  }
}

export const saveRepository = new SaveRepository();
