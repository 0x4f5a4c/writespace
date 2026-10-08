import {
  pgEnum,
  pgTable,
  primaryKey,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

import { notifications } from "./notifications";

export const notificationDeliveryChannelEnum = pgEnum(
  "notification_delivery_channel",
  ["IN_APP", "EMAIL"],
);

export const notificationDeliveryStatusEnum = pgEnum(
  "notification_delivery_status",
  ["PENDING", "PROCESSING", "SENT", "FAILED"],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    notificationId: integer("notification_id")
      .notNull()
      .references(() => notifications.id, {
        onDelete: "cascade",
      }),

    channel: notificationDeliveryChannelEnum("channel").notNull(),
    status: notificationDeliveryStatusEnum("status")
      .default("PENDING")
      .notNull(),

    attemptCount: integer("attempt_count").default(0).notNull(),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", {
      withTimezone: true,
    }),

    failedAt: timestamp("failed_at", {
      withTimezone: true,
    }),

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
      columns: [table.notificationId, table.channel],
    }),

    index("notification_deliveries_status_idx").on(table.status),
  ],
);

export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;

export type NewNotificationDelivery =
  typeof notificationDeliveries.$inferInsert;
