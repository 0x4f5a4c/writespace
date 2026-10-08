import { and, eq, sql } from "drizzle-orm";

import { db } from "../../../db";
import { follows, users } from "../../../db/schema";

export class FollowRepository {
  async findFollow(followerId: string, followingId: string) {
    const result = await db
      .select({
        followerId: follows.followerId,
        followingId: follows.followingId,
        createdAt: follows.createdAt,
      })
      .from(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followingId, followingId),
        ),
      )
      .limit(1);

    return result[0] ?? null;
  }

  async createFollow(followerId: string, followingId: string) {
    return db.transaction(async (tx) => {
      const inserted = await tx
        .insert(follows)
        .values({
          followerId,
          followingId,
        })
        .onConflictDoNothing({
          target: [follows.followerId, follows.followingId],
        })
        .returning({
          followerId: follows.followerId,
          followingId: follows.followingId,
          createdAt: follows.createdAt,
        });

      if (inserted.length === 0) {
        return null;
      }

      await tx
        .update(users)
        .set({
          totalFollowing: sql`
            ${users.totalFollowing}
            + CASE
                WHEN ${users.id} = ${followerId} THEN 1
                ELSE 0
              END
          `,
          totalFollowers: sql`
            ${users.totalFollowers}
            + CASE
                WHEN ${users.id} = ${followingId} THEN 1
                ELSE 0
              END
          `,
        })
        .where(sql`${users.id} IN (${followerId}, ${followingId})`);

      return inserted[0];
    });
  }

  async deleteFollow(followerId: string, followingId: string) {
    return db.transaction(async (tx) => {
      const deleted = await tx
        .delete(follows)
        .where(
          and(
            eq(follows.followerId, followerId),
            eq(follows.followingId, followingId),
          ),
        )
        .returning({
          followerId: follows.followerId,
          followingId: follows.followingId,
          createdAt: follows.createdAt,
        });

      if (deleted.length === 0) {
        return null;
      }

      await tx
        .update(users)
        .set({
          totalFollowing: sql`
            ${users.totalFollowing}
            - CASE
                WHEN ${users.id} = ${followerId} THEN 1
                ELSE 0
              END
          `,
          totalFollowers: sql`
            ${users.totalFollowers}
            - CASE
                WHEN ${users.id} = ${followingId} THEN 1
                ELSE 0
              END
          `,
        })
        .where(sql`${users.id} IN (${followerId}, ${followingId})`);

      return deleted[0];
    });
  }

  async isFollowing(followerId: string, followingId: string) {
    const result = await db
      .select({
        exists: sql<boolean>`true`,
      })
      .from(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followingId, followingId),
        ),
      )
      .limit(1);

    return result.length > 0;
  }
}

export const followRepository = new FollowRepository();
