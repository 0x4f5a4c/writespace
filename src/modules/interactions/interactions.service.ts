import { commentService } from "./services/comment.service";
import { reactionService } from "./services/reaction.service";
import { followService } from "./services/follow.service";
import { saveService } from "./services/save.service";
import { shareService } from "./services/share.service";

import type { ReactionType, ReactionResult } from "./contracts/reaction.types";

import type { FollowResult } from "./contracts/follow.types";

import type { SavedPostResult, SavedPostQuery } from "./contracts/save.types";

import type { CreateShareInput, ShareResult } from "./contracts/share.types";

interface CreateCommentInput {
  content: string;
  parentCommentId?: string | null;
}

class InteractionsService {
  // ---------------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------------

  async createComment(
    userId: string,
    postId: string,
    input: CreateCommentInput,
  ) {
    return commentService.createComment(
      userId,
      postId,
      input.content,
      input.parentCommentId,
    );
  }

  async getTopLevelComments(
    postId: string,
    limit: number = 20,
    cursor?: string,
    requesterId?: string,
  ) {
    return commentService.getTopLevelComments(
      postId,
      limit,
      cursor,
      requesterId,
    );
  }

  async getCommentReplies(
    parentCommentId: string,
    limit: number = 20,
    cursor?: string,
    requesterId?: string,
  ) {
    return commentService.getCommentReplies(
      parentCommentId,
      limit,
      cursor,
      requesterId,
    );
  }

  async getCommentById(commentId: string, requesterId?: string) {
    return commentService.getCommentById(commentId, requesterId);
  }

  async updateComment(userId: string, commentId: string, content: string) {
    return commentService.updateComment(userId, commentId, content);
  }

  async deleteComment(
    userId: string,
    commentId: string,
    isAdmin: boolean = false,
  ): Promise<void> {
    return commentService.deleteComment(userId, commentId, isAdmin);
  }

  // ---------------------------------------------------------------------------
  // Reactions
  // ---------------------------------------------------------------------------

  async setReaction(
    actorId: string,
    targetId: string,
    targetType: "POST" | "COMMENT",
    reactionType: ReactionType,
  ): Promise<ReactionResult> {
    return reactionService.setReaction({
      actorId,
      targetId,
      targetType,
      reactionType,
    });
  }

  async removeReaction(
    actorId: string,
    targetId: string,
    targetType: "POST" | "COMMENT",
  ): Promise<ReactionResult> {
    return reactionService.removeReaction({
      actorId,
      targetId,
      targetType,
    });
  }

  async setPostReaction(
    actorId: string,
    postId: string,
    reactionType: ReactionType,
  ): Promise<ReactionResult> {
    return this.setReaction(actorId, postId, "POST", reactionType);
  }

  async removePostReaction(
    actorId: string,
    postId: string,
  ): Promise<ReactionResult> {
    return this.removeReaction(actorId, postId, "POST");
  }

  async setCommentReaction(
    actorId: string,
    commentId: string,
    reactionType: ReactionType,
  ): Promise<ReactionResult> {
    return this.setReaction(actorId, commentId, "COMMENT", reactionType);
  }

  async removeCommentReaction(
    actorId: string,
    commentId: string,
  ): Promise<ReactionResult> {
    return this.removeReaction(actorId, commentId, "COMMENT");
  }

  // ---------------------------------------------------------------------------
  // Follow
  // ---------------------------------------------------------------------------

  async followUser(
    actorId: string,
    targetUserId: string,
  ): Promise<FollowResult> {
    return followService.followUser({
      actorId,
      targetUserId,
    });
  }

  async unfollowUser(
    actorId: string,
    targetUserId: string,
  ): Promise<FollowResult> {
    return followService.unfollowUser({
      actorId,
      targetUserId,
    });
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    return followService.isFollowing(followerId, followingId);
  }

  // ---------------------------------------------------------------------------
  // Saves
  // ---------------------------------------------------------------------------

  async savePost(actorId: string, postId: string): Promise<SavedPostResult> {
    return saveService.savePost({
      actorId,
      postId,
    });
  }

  async unsavePost(actorId: string, postId: string): Promise<SavedPostResult> {
    return saveService.unsavePost({
      actorId,
      postId,
    });
  }

  async isPostSaved(userId: string, postId: string): Promise<boolean> {
    return saveService.isPostSaved(userId, postId);
  }

  async getSavedPosts(input: SavedPostQuery) {
    return saveService.getSavedPosts(input);
  }

  // ---------------------------------------------------------------------------
  // Shares
  // ---------------------------------------------------------------------------

  async createShare(input: CreateShareInput): Promise<ShareResult> {
    return shareService.createShare(input);
  }

  async getShareById(id: number): Promise<ShareResult | null> {
    return shareService.getShareById(id);
  }

  async getPostShares(
    postId: string,
    limit: number,
    cursor?: string,
  ): Promise<ShareResult[]> {
    return shareService.getPostShares(postId, limit, cursor);
  }

  async getUserPostShares(
    userId: string,
    postId: string,
  ): Promise<ShareResult[]> {
    return shareService.getUserPostShares(userId, postId);
  }
}

export const interactionsService = new InteractionsService();
