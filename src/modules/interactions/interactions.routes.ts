import { Router, RequestHandler } from "express";
import { interactionsController } from "./interactions.controllers";
import { authenticate } from "../../shared/middlewares/auth.middleware";
import { validate } from "../../shared/middlewares/validate.middleware";
import { addCommentSchema } from "./dtos/add-comment.dto";

const router = Router();

// Comments

// Get top-level comments for a post
router.get(
  "/comments/:postId",
  authenticate as RequestHandler,
  interactionsController.getTopLevelComments as RequestHandler,
);

// Add comment / reply to a post
router.post(
  "/comments/:postId",
  authenticate as RequestHandler,
  validate(addCommentSchema),
  interactionsController.addComment as RequestHandler,
);

// Get replies for a comment
router.get(
  "/comments/:commentId/replies",
  authenticate as RequestHandler,
  interactionsController.getCommentReplies as RequestHandler,
);

// Get a specific comment
router.get(
  "/comments/:commentId",
  authenticate as RequestHandler,
  interactionsController.getCommentById as RequestHandler,
);

// Update a comment
router.put(
  "/comments/:commentId",
  authenticate as RequestHandler,
  interactionsController.updateComment as RequestHandler,
);

// Delete a comment
router.delete(
  "/comments/:commentId",
  authenticate as RequestHandler,
  interactionsController.deleteComment as RequestHandler,
);

// Reactions

// Set/change reaction on a post
router.post(
  "/posts/:postId/reaction",
  authenticate as RequestHandler,
  interactionsController.setPostReaction as RequestHandler,
);

// Remove reaction from a post
router.delete(
  "/posts/:postId/reaction",
  authenticate as RequestHandler,
  interactionsController.removePostReaction as RequestHandler,
);

// Set/change reaction on a comment
router.post(
  "/comments/:commentId/reaction",
  authenticate as RequestHandler,
  interactionsController.setCommentReaction as RequestHandler,
);

// Remove reaction from a comment
router.delete(
  "/comments/:commentId/reaction",
  authenticate as RequestHandler,
  interactionsController.removeCommentReaction as RequestHandler,
);

// Follow

// Follow a user
router.post(
  "/users/:userId/follow",
  authenticate as RequestHandler,
  interactionsController.followUser as RequestHandler,
);

// Unfollow a user
router.delete(
  "/users/:userId/follow",
  authenticate as RequestHandler,
  interactionsController.unfollowUser as RequestHandler,
);

// Check whether current user follows another user
router.get(
  "/users/:userId/follow",
  authenticate as RequestHandler,
  interactionsController.checkFollowing as RequestHandler,
);

// Saves

// Save a post
router.post(
  "/posts/:postId/save",
  authenticate as RequestHandler,
  interactionsController.savePost as RequestHandler,
);

// Unsave a post
router.delete(
  "/posts/:postId/save",
  authenticate as RequestHandler,
  interactionsController.unsavePost as RequestHandler,
);

// Get current user's saved posts
router.get(
  "/saved-posts",
  authenticate as RequestHandler,
  interactionsController.getSavedPosts as RequestHandler,
);

// Shares

// Create a share
router.post(
  "/posts/:postId/share",
  authenticate as RequestHandler,
  interactionsController.createShare as RequestHandler,
);

// Get shares for a post
router.get(
  "/posts/:postId/shares",
  authenticate as RequestHandler,
  interactionsController.getPostShares as RequestHandler,
);

// Get current user's shares for a post
router.get(
  "/posts/:postId/my-shares",
  authenticate as RequestHandler,
  interactionsController.getUserPostShares as RequestHandler,
);

export const interactionsRoutes = router;
