import app from "./app";
import env from "./config/env";
import { emailWorker } from "./shared/queues/email.worker";
import { interactionWorker } from "./shared/queues/interaction.worker";
import { mediaWorker } from "./shared/queues/media.worker";
import { client as redisClient } from "./config/redis";
import { pool } from "./db";
import logger from "./config/logger";

const PORT = env.PORT;

const server = app
  .listen(Number(PORT), "0.0.0.0", () => {
    logger.info(`Server is running on port no ${PORT}`);
  })
  .on("error", (err) => {
    logger.error(`Error while running the server : ${err}`);
    process.exit(1);
  });

let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn(`Shutdown already in progress, ignoring "${signal}"`);
    return;
  }
  isShuttingDown = true;

  logger.info(`${signal} received. Starting graceful shutdown...`);

  // Hard cap: if shutdown does not complete in 10s, force exit.
  const forceExit = setTimeout(() => {
    logger.error("Graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  // Stop accepting new connections; wait for in-flight requests to finish.
  try {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) return reject(err);
        logger.info("HTTP server closed");
        resolve();
      });
    });
  } catch (err) {
    logger.error(`Error closing HTTP server: ${err}`);
  }

  // Drain BullMQ workers so in-flight jobs finish.
  try {
    await emailWorker.close();
    logger.info("Email worker closed");
  } catch (err) {
    logger.error(`Error closing email worker: ${err}`);
  }

  try {
    await interactionWorker.close();
    logger.info("Interaction worker closed");
  } catch (err) {
    logger.error(`Error closing interaction worker: ${err}`);
  }

  try {
    await mediaWorker.close();
    logger.info("Media worker closed");
  } catch (err) {
    logger.error(`Error closing media worker: ${err}`);
  }

  // Close Redis (shared by queues and app).
  try {
    await redisClient.quit();
    logger.info("Redis connection closed");
  } catch (err) {
    logger.error(`Error closing Redis: ${err}`);
  }

  // Close Postgres pool last.
  try {
    await pool.end();
    logger.info("PostgreSQL pool closed");
  } catch (err) {
    logger.error(`Error closing PostgreSQL pool: ${err}`);
  }

  clearTimeout(forceExit);
  logger.info("Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception:", err);
  void gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error(`Unhandled rejection: ${err.message}`, err);
  void gracefulShutdown("unhandledRejection");
});
