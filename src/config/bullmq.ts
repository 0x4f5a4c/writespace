import env from "./env";

const redisUrl = new URL(env.REDIS_URL);

export const bullmqRedisConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password:
    env.REDIS_PASSWORD ||
    (redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined),
  connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
};
