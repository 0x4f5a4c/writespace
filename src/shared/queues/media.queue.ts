import { Queue } from "bullmq";
import { bullmqRedisConnection } from "@config/bullmq";

// Parse the REDIS_URL from env.ts to extract host and port for BullMQ
export const mediaQueue = new Queue("media-cleanup", {
  connection: bullmqRedisConnection,
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
