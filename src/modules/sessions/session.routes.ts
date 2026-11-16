import { Router } from "express";

import { authenticate } from "@shared/middlewares/auth.middleware";
import { SessionController } from "./session.controller";

const router = Router();

// Every session-management operation requires authentication.
router.use(authenticate);

// Session collection.
router.get("/", SessionController.getSessions);

// Static session-management actions.
router.post("/revoke-others", SessionController.revokeOtherSessions);
router.post("/revoke-all", SessionController.revokeAllSessions);

// Individual session operations.
router.get("/:sessionId", SessionController.getSession);
router.delete("/:sessionId", SessionController.revokeSession);

export const sessionRoutes = router;
