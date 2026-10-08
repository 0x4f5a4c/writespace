import { Request, Response, NextFunction } from "express";

import { ApiResponse } from "@shared/utils/api-response";
import { HTTP_STATUS } from "@shared/constants/http-codes";

import type { PublicUser } from "../users/interface/user.interface";

import { interactionsService } from "./interactions.service";

import type { ReactionType } from "./contracts/reaction.types";

interface AuthRequest<
  ReqBody = unknown,
  ReqQuery = Record<string, string | undefined>,
  ReqParams = Record<string, string>,
> extends Request<ReqParams, unknown, ReqBody, ReqQuery> {
  user?: PublicUser;
}

interface AddCommentBody {
  content: string;
  parentCommentId?: string | null;
}

interface ReactionBody {
  reactionType: ReactionType;
}

class InteractionsController {
  // ---------------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------------

  public addComment = async (
    req: AuthRequest<AddCommentBody, unknown, { postId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { postId } = req.params;

      const comment = await interactionsService.createComment(
        userId,
        postId,
        req.body,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.CREATED,
        "Comment added successfully",
        comment,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public getTopLevelComments = async (
    req: AuthRequest<
      unknown,
      {
        cursor?: string;
        limit?: string;
      },
      { postId: string }
    >,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { postId } = req.params;
      const limit = parseInt(req.query.limit || "20", 10);

      const data = await interactionsService.getTopLevelComments(
        postId,
        limit,
        req.query.cursor,
        req.user?.id,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Comments fetched successfully",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public getCommentReplies = async (
    req: AuthRequest<
      unknown,
      {
        cursor?: string;
        limit?: string;
      },
      { commentId: string }
    >,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { commentId } = req.params;
      const limit = parseInt(req.query.limit || "20", 10);

      const data = await interactionsService.getCommentReplies(
        commentId,
        limit,
        req.query.cursor,
        req.user?.id,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Replies fetched successfully",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public getCommentById = async (
    req: AuthRequest<unknown, unknown, { commentId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const comment = await interactionsService.getCommentById(
        req.params.commentId,
        req.user?.id,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Comment fetched successfully",
        comment,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public updateComment = async (
    req: AuthRequest<{ content: string }, unknown, { commentId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const comment = await interactionsService.updateComment(
        req.user!.id,
        req.params.commentId,
        req.body.content,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Comment updated successfully",
        comment,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public deleteComment = async (
    req: AuthRequest<unknown, unknown, { commentId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await interactionsService.deleteComment(
        req.user!.id,
        req.params.commentId,
        req.user?.role === "admin",
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Comment deleted successfully",
        null,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  // ---------------------------------------------------------------------------
  // Reactions
  // ---------------------------------------------------------------------------

  public setPostReaction = async (
    req: AuthRequest<ReactionBody, unknown, { postId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.setPostReaction(
        req.user!.id,
        req.params.postId,
        req.body.reactionType,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Post reaction updated successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public removePostReaction = async (
    req: AuthRequest<unknown, unknown, { postId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.removePostReaction(
        req.user!.id,
        req.params.postId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Post reaction removed successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public setCommentReaction = async (
    req: AuthRequest<ReactionBody, unknown, { commentId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.setCommentReaction(
        req.user!.id,
        req.params.commentId,
        req.body.reactionType,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Comment reaction updated successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public removeCommentReaction = async (
    req: AuthRequest<unknown, unknown, { commentId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.removeCommentReaction(
        req.user!.id,
        req.params.commentId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Comment reaction removed successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  // ---------------------------------------------------------------------------
  // Follow
  // ---------------------------------------------------------------------------

  public followUser = async (
    req: AuthRequest<unknown, unknown, { userId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.followUser(
        req.user!.id,
        req.params.userId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "User followed successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public unfollowUser = async (
    req: AuthRequest<unknown, unknown, { userId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.unfollowUser(
        req.user!.id,
        req.params.userId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "User unfollowed successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public checkFollowing = async (
    req: AuthRequest<unknown, unknown, { userId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const isFollowing = await interactionsService.isFollowing(
        req.user!.id,
        req.params.userId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Follow status fetched successfully",
        { isFollowing },
      ).send();
    } catch (error) {
      next(error);
    }
  };

  // ---------------------------------------------------------------------------
  // Saves
  // ---------------------------------------------------------------------------

  public savePost = async (
    req: AuthRequest<unknown, unknown, { postId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.savePost(
        req.user!.id,
        req.params.postId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Post saved successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public unsavePost = async (
    req: AuthRequest<unknown, unknown, { postId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.unsavePost(
        req.user!.id,
        req.params.postId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Post unsaved successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public getSavedPosts = async (
    req: AuthRequest<
      unknown,
      {
        cursor?: string;
        limit?: string;
      }
    >,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const limit = parseInt(req.query.limit || "20", 10);

      const data = await interactionsService.getSavedPosts({
        userId: req.user!.id,
        limit,
        cursor: req.query.cursor,
      });

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Saved posts fetched successfully",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  // ---------------------------------------------------------------------------
  // Shares
  // ---------------------------------------------------------------------------

  public createShare = async (
    req: AuthRequest<{ platform: string }, unknown, { postId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const share = await interactionsService.createShare({
        actorId: req.user!.id,
        postId: req.params.postId,
        platform: req.body.platform,
      });

      new ApiResponse(
        res,
        HTTP_STATUS.CREATED,
        "Post shared successfully",
        share,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public getPostShares = async (
    req: AuthRequest<
      unknown,
      {
        cursor?: string;
        limit?: string;
      },
      { postId: string }
    >,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const limit = parseInt(req.query.limit || "20", 10);

      const shares = await interactionsService.getPostShares(
        req.params.postId,
        limit,
        req.query.cursor,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Post shares fetched successfully",
        shares,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public getUserPostShares = async (
    req: AuthRequest<unknown, unknown, { postId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const shares = await interactionsService.getUserPostShares(
        req.user!.id,
        req.params.postId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "User post shares fetched successfully",
        shares,
      ).send();
    } catch (error) {
      next(error);
    }
  };
}

export const interactionsController = new InteractionsController();
