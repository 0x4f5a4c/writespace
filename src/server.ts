import app from "./app";
import env from "./config/env";
import { connectRedis } from "./config/redis";
import { pool } from "./db";

import { emailWorker } from "./shared/queues/email.worker";
import { interactionWorker } from "./shared/queues/interaction.worker";
import { mediaWorker } from "./shared/queues/media.worker";

import { client as redisClient } from "./config/redis";

import logger from "./config/logger";

async function startServer(): Promise<void> {
  try {
    logger.info("Starting WriteSpace server...");

    // PostgreSQL

    await pool.query("SELECT 1");

    logger.info("PostgreSQL connected successfully");

    // Redis

    await connectRedis();

    logger.info("Redis connected successfully");

    // HTTP Server

    const server = app.listen(env.PORT, "0.0.0.0", () => {
      logger.info(`Server is running on port ${env.PORT}`);
    });

    server.on("error", (error) => {
      logger.error("HTTP server error", { error });

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

      const forceExit = setTimeout(() => {
        logger.error("Graceful shutdown timed out, forcing exit");

        process.exit(1);
      }, env.SHUTDOWN_TIMEOUT_MS);

      forceExit.unref();

      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            logger.info("HTTP server closed");

            resolve();
          });
        });
      } catch (error) {
        logger.error("Error closing HTTP server", { error });
      }

      try {
        await emailWorker.close();

        logger.info("Email worker closed");
      } catch (error) {
        logger.error("Error closing email worker", { error });
      }

      try {
        await interactionWorker.close();

        logger.info("Interaction worker closed");
      } catch (error) {
        logger.error("Error closing interaction worker", { error });
      }

      try {
        await mediaWorker.close();

        logger.info("Media worker closed");
      } catch (error) {
        logger.error("Error closing media worker", { error });
      }

      try {
        if (redisClient.isOpen) {
          await redisClient.quit();
        }

        logger.info("Redis connection closed");
      } catch (error) {
        logger.error("Error closing Redis", { error });
      }

      try {
        await pool.end();

        logger.info("PostgreSQL pool closed");
      } catch (error) {
        logger.error("Error closing PostgreSQL pool", { error });
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

    process.on("uncaughtException", (error) => {
      logger.error("Uncaught exception", { error });

      void gracefulShutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason) => {
      const error =
        reason instanceof Error ? reason : new Error(String(reason));

      logger.error("Unhandled rejection", { error });

      void gracefulShutdown("unhandledRejection");
    });
  } catch (error) {
    logger.error("Failed to start WriteSpace", { error });

    process.exit(1);
  }
}

void startServer();
