import {
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";
import { posts } from "./posts";

export const reactionTypes = [
  "like",
  "love",
  "laugh",
  "celebrate",
  "support",
  "sad",
  "angry",
] as const;

export type ReactionType = (typeof reactionTypes)[number];

export const reactionTypeEnum = pgEnum("reaction_type", reactionTypes);

export const postReactions = pgTable(
  "post_reactions",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, {
        onDelete: "cascade",
      }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    reactionType: reactionTypeEnum("reaction_type").notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({
      columns: [table.postId, table.userId],
    }),
  ],
);

export type PostReaction = typeof postReactions.$inferSelect;
export type NewPostReaction = typeof postReactions.$inferInsert;
