import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { postsRoutes } from "./modules/posts/posts.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { userRoutes } from "./modules/users/user.routes";
import { interactionsRoutes } from "./modules/interactions/interactions.routes";
import { notificationRoutes } from "./modules/notification/notification.routes";
import { aiRoutes } from "./modules/ai/ai.routes";
import httpLogger from "./shared/middlewares/httpLogger";
import helmet from "helmet";
import cors from "cors";
import { errorHandler } from "./shared/middlewares/error.middleware";
import { apiLimiter } from "./shared/middlewares/rate-limit.middleware";
import { botInterceptor } from "./shared/middlewares/bot-interceptor.middleware";
import { env } from "./config/env";
import { configurePassport } from "./modules/auth/auth.utils";
import passport from "passport";

dotenv.config();

const app = express();

app.set("trust proxy", 1);

app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(httpLogger);
/**
 * only wile development
 */
app.use("/uploads", express.static("uploads"));
configurePassport();
app.use(passport.initialize());
app.use(botInterceptor);
// app.use("/api/v1", apiLimiter);

app.use("/api/v1/auth", apiLimiter, authRoutes);
app.use("/api/v1/posts", postsRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/interactions", interactionsRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/ai", aiRoutes);
app.use(errorHandler);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export default app;
