import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { authSessions } from "./auth-sessions";

/**
 * Refresh-token history for a session.
 *
 * Only a cryptographic hash of the opaque refresh credential is stored.
 * Raw refresh tokens must never be persisted in the database.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    sessionId: uuid("session_id")
      .notNull()
      .references(() => authSessions.id, { onDelete: "cascade" }),

    tokenHash: text("token_hash").notNull(),

    // Links successive tokens in a rotation history.
    parentTokenId: uuid("parent_token_id").references(
      (): AnyPgColumn => refreshTokens.id,
      { onDelete: "set null" },
    ),

    replacedByTokenId: uuid("replaced_by_token_id").references(
      (): AnyPgColumn => refreshTokens.id,
      { onDelete: "set null" },
    ),

    issuedAt: timestamp("issued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    reuseDetectedAt: timestamp("reuse_detected_at", {
      withTimezone: true,
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "refresh_tokens_expiry_check",
      sql`${table.expiresAt} > ${table.issuedAt}`,
    ),

    uniqueIndex("refresh_tokens_token_hash_uq").on(table.tokenHash),

    index("refresh_tokens_session_issued_idx").on(
      table.sessionId,
      table.issuedAt.desc(),
    ),

    index("refresh_tokens_expiry_idx").on(table.expiresAt),

    // A token can have at most one direct successor.
    uniqueIndex("refresh_tokens_parent_uq")
      .on(table.parentTokenId)
      .where(sql`${table.parentTokenId} IS NOT NULL`),

    // A replacement token can be referenced by only one predecessor.
    uniqueIndex("refresh_tokens_replacement_uq")
      .on(table.replacedByTokenId)
      .where(sql`${table.replacedByTokenId} IS NOT NULL`),
  ],
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
