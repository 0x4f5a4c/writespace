import { Queue } from "bullmq";
import env from "@config/env";

// Parse the REDIS_URL from env.ts to extract host and port for BullMQ
const redisUrl = new URL(env.REDIS_URL);
const redisConnectionOptions = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || "6379", 10),
  password: env.REDIS_PASSWORD || redisUrl.password || undefined,
};

export const mediaQueue = new Queue("media-cleanup", {
  connection: redisConnectionOptions,
});

/**
 * Enqueue a Cloudinary cleanup job.
 *
 * @param publicIds - Cloudinary `public_id` values to destroy.
 *                    Do NOT pass URLs here — Cloudinary's destroy API
 *                    requires the public_id, not the secure_url.
 */
export const addMediaCleanupJob = async (
  publicIds: string[],
): Promise<void> => {
  const filtered = publicIds.filter((id) => id && id.trim().length > 0);
  if (filtered.length === 0) return;

  await mediaQueue.add(
    "cleanup",
    { publicIds: filtered },
    {
      removeOnComplete: true,
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
    },
  );
};
