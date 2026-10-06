import { Worker, Job } from "bullmq";
import logger from "@config/logger";
import env from "@config/env";
import { bullmqRedisConnection } from "@config/bullmq";
import { v2 as cloudinary } from "cloudinary";

// Cloudinary client
cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

interface MediaCleanupJobData {
  publicIds: string[];
}

export const mediaWorker = new Worker(
  "media-cleanup",
  async (job: Job<MediaCleanupJobData>) => {
    const { publicIds } = job.data;

    if (!Array.isArray(publicIds) || publicIds.length === 0) {
      logger.warn(`Media cleanup job ${job.id} received no publicIds`);
      return;
    }

    for (const publicId of publicIds) {
      if (!publicId || publicId.startsWith("http")) {
        // Guard: refuse to process raw URLs — they were never valid inputs.
        logger.warn(
          `Media cleanup skipped invalid public_id (looks like a URL): ${publicId}`,
        );
        continue;
      }

      try {
        await cloudinary.uploader.destroy(publicId);
        logger.info(`Cloudinary destroy succeeded for public_id: ${publicId}`);
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(`Failed to delete Cloudinary asset ${publicId}:`, err);
        // Rethrow so BullMQ retries the whole job per the queue's backoff config.
        throw err;
      }
    }
  },
  {
    connection: bullmqRedisConnection,
    concurrency: env.MEDIA_WORKER_CONCURRENCY,
  },
);

mediaWorker.on("failed", (job: Job | undefined, err: Error) => {
  logger.error(`Media cleanup job ${job?.id} failed:`, err);
});
