import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { authSessions } from "./auth-sessions";
import { users } from "./users";

/**
 * Durable history of account-security activity.
 *
 * Metadata must contain safe descriptive information only.
 * Never store passwords, OTPs, JWTs, refresh tokens, or recovery secrets.
 */
export const securityEvents = pgTable(
  "security_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // Nullable so security history can survive account deletion.
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // Nullable because some events happen before a session exists.
    sessionId: uuid("session_id").references(() => authSessions.id, {
      onDelete: "set null",
    }),

    eventType: text("event_type").notNull(),

    outcome: text("outcome").notNull(),

    reason: text("reason"),

    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("security_events_user_occurred_idx").on(
      table.userId,
      table.occurredAt.desc(),
    ),

    index("security_events_session_occurred_idx").on(
      table.sessionId,
      table.occurredAt.desc(),
    ),

    index("security_events_type_occurred_idx").on(
      table.eventType,
      table.occurredAt.desc(),
    ),
  ],
);

export type SecurityEvent = typeof securityEvents.$inferSelect;
export type NewSecurityEvent = typeof securityEvents.$inferInsert;
