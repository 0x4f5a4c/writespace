import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import env from "../config/env";
import logger from "../config/logger";
import * as schema from "./schema";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  min: env.DB_POOL_MIN,
  idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
});

pool.on("error", (error) => {
  logger.error("Unexpected PostgreSQL pool error", {
    error,
  });
});

export const db = drizzle(pool, {
  schema,
});
