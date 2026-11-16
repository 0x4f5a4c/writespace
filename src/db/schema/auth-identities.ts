import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export type AuthIdentityProvider = "password" | "google" | "github";

/**
 * An authentication method linked to a Writespace account.
 *
 * OAuth identities are identified by the provider's immutable subject ID.
 * Email addresses must not be used as a substitute for provider identity.
 */
export const authIdentities = pgTable(
  "auth_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    provider: text("provider").$type<AuthIdentityProvider>().notNull(),

    // Immutable account identifier supplied by Google or GitHub.
    // Password identities do not have a provider subject.
    providerSubject: text("provider_subject"),

    // Used only for password identities.
    passwordHash: text("password_hash"),

    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "auth_identities_provider_check",
      sql`${table.provider} IN ('password', 'google', 'github')`,
    ),

    // Enforce the credential shape expected for each provider.
    check(
      "auth_identities_credentials_check",
      sql`(
        (
          ${table.provider} = 'password'
          AND ${table.passwordHash} IS NOT NULL
          AND ${table.providerSubject} IS NULL
        )
        OR
        (
          ${table.provider} IN ('google', 'github')
          AND ${table.providerSubject} IS NOT NULL
          AND ${table.passwordHash} IS NULL
        )
      )`,
    ),

    index("auth_identities_user_idx").on(table.userId),

    // A provider subject must identify only one linked account.
    uniqueIndex("auth_identities_provider_subject_uq")
      .on(table.provider, table.providerSubject)
      .where(sql`${table.providerSubject} IS NOT NULL`),

    // An account can have at most one password identity.
    uniqueIndex("auth_identities_user_password_uq")
      .on(table.userId)
      .where(sql`${table.provider} = 'password'`),
  ],
);

export type AuthIdentity = typeof authIdentities.$inferSelect;
export type NewAuthIdentity = typeof authIdentities.$inferInsert;
