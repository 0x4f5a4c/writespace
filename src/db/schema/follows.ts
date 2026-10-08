import {
  pgTable,
  uuid,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export const follows = pgTable(
  "follows",
  {
    /**
     * The user who initiates the follow relationship.
     *
     * Example:
     * Afzal → Meenal
     *
     * followerId = Afzal
     */
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    /**
     * The user being followed.
     *
     * Example:
     * Afzal → Meenal
     *
     * followingId = Meenal
     */
    followingId: uuid("following_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    /**
     * When the follow relationship was created.
     */
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },

  (table) => [
    /**
     * Decision:
     *
     * A user can follow another user only once.
     *
     * This also gives us an index beginning with followerId,
     * which efficiently supports:
     *
     * "Who does this user follow?"
     *
     * Example:
     * WHERE follower_id = Afzal
     */
    primaryKey({
      columns: [table.followerId, table.followingId],
    }),

    /**
     * Decision:
     *
     * We also need the reverse access pattern:
     *
     * "Who follows this user?"
     *
     * That query filters by followingId and commonly orders
     * or paginates by createdAt.
     *
     * The primary key cannot efficiently serve a query whose
     * leading column is only followingId, so we add this index.
     *
     * Example:
     * WHERE following_id = Meenal
     * ORDER BY created_at DESC
     */
    index("follows_following_created_idx").on(
      table.followingId,
      table.createdAt,
    ),
  ],
);

export type Follow = typeof follows.$inferSelect;
export type NewFollow = typeof follows.$inferInsert;
