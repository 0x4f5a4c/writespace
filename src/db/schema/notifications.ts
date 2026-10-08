import {
  pgTable,
  text,
  uuid,
  boolean,
  timestamp,
  serial,
  index,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export const notificationTypeEnum = pgEnum("notification_type", [
  "WELCOME",
  "REACTION",
  "COMMENT",
  "FOLLOW",
  "SHARE",
  "MENTION",
  "REPORT",
  "MESSAGE",
  "SYSTEM",
  "LOGIN_ALERT",
  "PASSWORD_CHANGED",
  "PASSWORD_RESET",
  "ACCOUNT_STATUS",
]);

export const notificationEntityTypeEnum = pgEnum("notification_entity_type", [
  "POST",
  "COMMENT",
  "USER",
  "MESSAGE",
  "REPORT",
  "SYSTEM",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),

    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    type: notificationTypeEnum("type").notNull(),
    entityType: notificationEntityTypeEnum("entity_type"),
    relatedId: uuid("related_id"),
    message: text("message").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    isRead: boolean("is_read").default(false).notNull(),

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
    index("notifications_recipient_is_read_idx").on(
      table.recipientId,
      table.isRead,
    ),

    index("notifications_recipient_created_idx").on(
      table.recipientId,
      table.createdAt,
    ),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
