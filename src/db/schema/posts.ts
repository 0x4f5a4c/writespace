import {
  pgTable,
  text,
  uuid,
  integer,
  timestamp,
  pgEnum,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const postStatusEnum = pgEnum("post_status", [
  "draft",
  "scheduled",
  "published",
  "archived",
  "trash",
]);

export interface CodeSnippetSchema {
  language: string;
  code: string;
}

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // Content
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(),
    subtitle: text("subtitle"),
    content: text("content").notNull(),
    excerpt: text("excerpt"),

    // Versioning
    version: integer("version").default(1).notNull(),

    // Cover Image
    coverImageUrl: text("cover_image_url"),
    coverImagePublicId: text("cover_image_public_id"),
    coverImageAltText: text("cover_image_alt_text"),
    coverImageCredit: text("cover_image_credit"),

    // Media & Code
    media: text("media").array().default([]),
    mediaPublicIds: jsonb("media_public_ids").$type<string[]>().default([]),
    codeSnippets: jsonb("code_snippets")
      .$type<CodeSnippetSchema[]>()
      .default([]),

    // Taxonomy
    tags: text("tags").array().default([]),

    // Ownership
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    // Lifecycle
    status: postStatusEnum("status").default("published").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishDate: timestamp("publish_date", { withTimezone: true }),

    // Stats
    viewCount: integer("view_count").default(0).notNull(),
    likeCount: integer("like_count").default(0).notNull(),
    commentCount: integer("comment_count").default(0).notNull(),
    shareCount: integer("share_count").default(0).notNull(),
    readTime: integer("read_time").default(0).notNull(),

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("posts_status_publish_date_id_idx").on(
      table.status,
      table.publishDate,
      table.id,
    ),

    index("posts_author_idx").on(table.authorId),
  ],
);

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
