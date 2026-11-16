import "dotenv/config";
import { defineConfig } from "drizzle-kit";

import { HTTP_STATUS } from "./src/shared/constants/http-codes";
import { AppError } from "./src/shared/utils/app.error";

/**
 * Drizzle Kit must use a direct PostgreSQL connection for schema
 * migrations and database administration.
 *
 * This connection intentionally bypasses PgBouncer so migration
 * operations do not depend on transaction-pooling behaviour.
 *
 * DATABASE_DIRECT_URL is required rather than falling back to
 * DATABASE_URL. This prevents migrations from accidentally using
 * the application runtime connection through PgBouncer.
 */
const databaseDirectUrl = process.env.DATABASE_DIRECT_URL;

if (!databaseDirectUrl) {
  throw new AppError(
    HTTP_STATUS.INTERNAL_SERVER_ERROR,
    "DATABASE_DIRECT_URL must be configured for Drizzle Kit operations.",
  );
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",

  /**
   * Keep migration history separate from application tables.
   * The writespace_migrator role owns this schema.
   */
  migrations: {
    schema: "drizzle",
    table: "__drizzle_migrations",
  },

  dbCredentials: {
    url: databaseDirectUrl,
  },
});
