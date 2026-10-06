import { Router } from "express";
import { aiController } from "./controllers/ai.controller";

const router = Router();

router.post(
  "/post-assistant",
  aiController.generatePostAssistant.bind(aiController),
);

export const aiRoutes = router;
