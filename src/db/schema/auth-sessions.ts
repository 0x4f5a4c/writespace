import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export type AuthClientType = "web" | "native";

/**
 * A server-managed authentication session.
 *
 * A user may have multiple independent sessions. Session validity is
 * determined by its expiry timestamps and revocation state.
 */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    clientType: text("client_type")
      .$type<AuthClientType>()
      .default("web")
      .notNull(),

    platform: text("platform"),
    deviceLabel: text("device_label"),
    userAgentSummary: text("user_agent_summary"),

    firstIp: text("first_ip"),
    lastIp: text("last_ip"),

    authTime: timestamp("auth_time", { withTimezone: true })
      .defaultNow()
      .notNull(),

    // Examples: password, google, github. Future authentication methods
    // can be recorded without changing the session table structure.
    authMethods: text("auth_methods")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),

    // 1 is the initial password/OAuth assurance level.
    // Higher levels can be introduced when stronger authentication exists.
    assuranceLevel: integer("assurance_level").default(1).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    lastRefreshAt: timestamp("last_refresh_at", { withTimezone: true }),

    idleExpiresAt: timestamp("idle_expires_at", {
      withTimezone: true,
    }).notNull(),

    absoluteExpiresAt: timestamp("absolute_expires_at", {
      withTimezone: true,
    }).notNull(),

    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),
  },
  (table) => [
    check(
      "auth_sessions_client_type_check",
      sql`${table.clientType} IN ('web', 'native')`,
    ),

    check(
      "auth_sessions_assurance_level_check",
      sql`${table.assuranceLevel} BETWEEN 1 AND 3`,
    ),

    check(
      "auth_sessions_absolute_expiry_check",
      sql`${table.absoluteExpiresAt} > ${table.createdAt}`,
    ),

    check(
      "auth_sessions_idle_expiry_check",
      sql`${table.idleExpiresAt} <= ${table.absoluteExpiresAt}`,
    ),

    index("auth_sessions_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),

    // Efficient retrieval of sessions that have not been revoked.
    index("auth_sessions_active_user_idx")
      .on(table.userId, table.createdAt.desc())
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

export type AuthSession = typeof authSessions.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;
