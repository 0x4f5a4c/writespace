import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export type AuthChallengePurpose =
  | "registration"
  | "email_verification"
  | "password_reset"
  | "email_change";

/**
 * Temporary authentication challenges.
 *
 * The target email is stored in normalized form. Only a digest of the
 * challenge secret is stored; OTP digests must use a separate server-side
 * HMAC key because OTPs have low entropy.
 *
 * userId is nullable because a registration challenge may exist before
 * the corresponding user account has been created.
 */
export const authChallenges = pgTable(
  "auth_challenges",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),

    purpose: text("purpose").$type<AuthChallengePurpose>().notNull(),

    targetEmail: text("target_email").notNull(),

    secretHash: text("secret_hash").notNull(),

    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(5).notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "auth_challenges_purpose_check",
      sql`${table.purpose} IN (
        'registration',
        'email_verification',
        'password_reset',
        'email_change'
      )`,
    ),

    check(
      "auth_challenges_attempts_check",
      sql`${table.attempts} >= 0 AND ${table.maxAttempts} > 0`,
    ),

    uniqueIndex("auth_challenges_secret_hash_uq").on(table.secretHash),

    index("auth_challenges_active_lookup_idx")
      .on(table.targetEmail, table.purpose, table.createdAt.desc())
      .where(
        sql`${table.consumedAt} IS NULL
          AND ${table.revokedAt} IS NULL`,
      ),

    index("auth_challenges_user_idx").on(table.userId),
  ],
);

export type AuthChallenge = typeof authChallenges.$inferSelect;
export type NewAuthChallenge = typeof authChallenges.$inferInsert;
