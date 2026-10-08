import { Router, RequestHandler } from "express";
import { postsController } from "./posts.controller";
import { authenticate } from "../../shared/middlewares/auth.middleware";
import { upload } from "../../shared/middlewares/upload.middleware";
import { validate } from "../../shared/middlewares/validate.middleware";
import { parseFormDataJson } from "../../shared/middlewares/parse-form-data.middleware";
import { CreatePostSchema } from "./dtos/create-post.dto";
import { updatePostSchema } from "./dtos/update-post.dto";

const router = Router();

router.get(
  "/",
  authenticate as RequestHandler,
  postsController.getPosts as RequestHandler,
);

router.get(
  "/:id",
  authenticate as RequestHandler,
  postsController.getPost as RequestHandler,
);

router.post(
  "/create",
  authenticate as RequestHandler,
  upload.fields([
    { name: "banner", maxCount: 1 },
    { name: "media", maxCount: 10 },
  ]),
  parseFormDataJson as RequestHandler,
  validate(CreatePostSchema) as RequestHandler,
  postsController.createPost as RequestHandler,
);

router.delete(
  "/:id",
  authenticate as RequestHandler,
  postsController.deletePost as RequestHandler,
);

router.put(
  "/:id",
  authenticate as RequestHandler,
  upload.fields([
    { name: "banner", maxCount: 1 },
    { name: "media", maxCount: 10 },
  ]),
  parseFormDataJson as RequestHandler,
  validate(updatePostSchema) as RequestHandler,
  postsController.updatePost as RequestHandler,
);

router.post(
  "/:id/like",
  authenticate as RequestHandler,
  postsController.likePost as RequestHandler,
);

router.post(
  "/:id/share",
  authenticate as RequestHandler,
  postsController.sharePost as RequestHandler,
);

export const postsRoutes = router;
