import { Router } from "express";

import { authRoutes } from "@modules/auth/auth.routes";
import { userRoutes } from "@modules/users/user.routes";
import { postsRoutes } from "@modules/posts/posts.routes";
import { aiRoutes } from "@modules/ai/ai.routes";
import { notificationRoutes } from "@modules/notification/notification.routes";
import { interactionsRoutes } from "@modules/interactions/interactions.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/posts", postsRoutes);
router.use("/ai", aiRoutes);
router.use("/notifications", notificationRoutes);
router.use("/interactions", interactionsRoutes);

export default router;
