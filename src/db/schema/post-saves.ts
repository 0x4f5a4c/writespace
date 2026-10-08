import {
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";

import { users } from "./users";
import { posts } from "./posts";

export const postSaves = pgTable(
  "post_saves",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.userId] }),

    index("post_saves_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export type PostSave = typeof postSaves.$inferSelect;
export type NewPostSave = typeof postSaves.$inferInsert;
