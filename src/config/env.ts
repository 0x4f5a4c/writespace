import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    // PostgreSQL

    DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
    DB_POOL_MIN: z.coerce.number().int().min(0).default(2),
    DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
    DB_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

    // Redis

    REDIS_URL: z
      .string()
      .url("REDIS_URL must be a valid URL")
      .default("redis://localhost:6379"),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

    // BullMQ / Workers

    EMAIL_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),

    INTERACTION_WORKER_CONCURRENCY: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10),

    MEDIA_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
    EMAIL_QUEUE_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    INTERACTION_QUEUE_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(2),
    MEDIA_QUEUE_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    QUEUE_BACKOFF_DELAY_MS: z.coerce.number().int().positive().default(1000),

    // HTTP / Application

    CLIENT_URL: z
      .string()
      .url("CLIENT_URL must be a valid URL")
      .default("http://localhost:5173"),

    SERVER_URL: z
      .string()
      .url("SERVER_URL must be a valid URL")
      .default("http://localhost:8000/api/v1"),

    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

    // Authentication

    JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET is required"),
    JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
    JWT_ACCESS_EXPIRE: z.string().default("15m"),

    // Cloudinary

    CLOUDINARY_CLOUD_NAME: z
      .string()
      .min(1, "CLOUDINARY_CLOUD_NAME is required"),
    CLOUDINARY_API_KEY: z.string().min(1, "CLOUDINARY_API_KEY is required"),
    CLOUDINARY_API_SECRET: z
      .string()
      .min(1, "CLOUDINARY_API_SECRET is required"),

    // Upload limits

    MAX_FILE_SIZE_MB: z.coerce.number().positive().default(5),
    MAX_FILES_PER_UPLOAD: z.coerce.number().int().positive().default(10),

    // SMTP

    SMTP_HOST: z.string().min(1).default("smtp.gmail.com"),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: z.string().min(1, "SMTP_USER is required"),
    SMTP_PASS: z.string().min(1, "SMTP_PASS is required"),

    // OAuth

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),

    // AI

    AI_ENABLED: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .default("false"),

    AI_PROVIDER: z.enum(["gemini", "mock"]).default("gemini"),
    AI_MODEL: z.string().min(1, "AI model name is required"),
    GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1000),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    AI_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(12000),
  })
  .refine((data) => data.DB_POOL_MIN <= data.DB_POOL_MAX, {
    message: "DB_POOL_MIN cannot be greater than DB_POOL_MAX",
    path: ["DB_POOL_MIN"],
  });

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error("❌ Invalid environment variables:", _env.error.format());
  process.exit(1);
}

export const env = _env.data;
export default env;
