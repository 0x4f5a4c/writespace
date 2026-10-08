import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

import { commentRepository } from "../repositories/comment.repository";

export class CommentService {
  async createComment(
    userId: string,
    postId: string,
    content: string,
    parentCommentId?: string | null,
  ) {
    const post = await commentRepository.findPostForComment(postId);

    if (!post) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    if (parentCommentId) {
      const parentComment =
        await commentRepository.getCommentById(parentCommentId);

      if (!parentComment) {
        throw new AppError(HTTP_STATUS.NOT_FOUND, "Parent comment not found");
      }

      if (parentComment.postId !== postId) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "Parent comment does not belong to this post",
        );
      }
    }

    const comment = await commentRepository.createComment(
      postId,
      userId,
      content,
      parentCommentId,
    );

    if (!comment) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to create comment",
      );
    }

    const createdComment = await commentRepository.getCommentById(
      comment.id,
      userId,
    );

    if (!createdComment) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to fetch created comment",
      );
    }

    return createdComment;
  }

  async getTopLevelComments(
    postId: string,
    limit: number = 20,
    cursor?: string,
    requesterId?: string,
  ) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Limit must be a positive integer",
      );
    }

    const parsedCursor = this.parseCursor(cursor);

    const comments = await commentRepository.getTopLevelComments(
      postId,
      limit,
      parsedCursor,
      requesterId,
    );

    const nextCursor =
      comments.length === limit
        ? (comments[comments.length - 1]?.createdAt?.toISOString() ?? null)
        : null;

    return {
      comments: comments.map((comment) => ({
        ...comment,
        isReacted: Boolean(comment.reactionType),
        reactionType: comment.reactionType ?? null,
      })),
      nextCursor,
    };
  }

  async getCommentReplies(
    parentCommentId: string,
    limit: number = 20,
    cursor?: string,
    requesterId?: string,
  ) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Limit must be a positive integer",
      );
    }

    const parentComment =
      await commentRepository.getCommentById(parentCommentId);

    if (!parentComment) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Comment not found");
    }

    const parsedCursor = this.parseCursor(cursor);

    const replies = await commentRepository.getCommentReplies(
      parentCommentId,
      limit,
      parsedCursor,
      requesterId,
    );

    const nextCursor =
      replies.length === limit
        ? (replies[replies.length - 1]?.createdAt?.toISOString() ?? null)
        : null;

    return {
      replies: replies.map((reply) => ({
        ...reply,
        isReacted: Boolean(reply.reactionType),
        reactionType: reply.reactionType ?? null,
      })),
      nextCursor,
    };
  }

  async getCommentById(commentId: string, requesterId?: string) {
    const comment = await commentRepository.getCommentById(
      commentId,
      requesterId,
    );

    if (!comment) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Comment not found");
    }

    return {
      ...comment,
      isReacted: Boolean(comment.reactionType),
      reactionType: comment.reactionType ?? null,
    };
  }

  async updateComment(userId: string, commentId: string, content: string) {
    const normalizedContent = content.trim();

    if (!normalizedContent) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Comment content cannot be empty",
      );
    }

    const comment = await commentRepository.getCommentById(commentId);

    if (!comment) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Comment not found");
    }

    if (comment.authorId !== userId) {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "You are not authorized to edit this comment",
      );
    }

    const updated = await commentRepository.updateComment(
      commentId,
      normalizedContent,
    );

    if (!updated) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to update comment",
      );
    }

    return this.getCommentById(commentId, userId);
  }

  async deleteComment(
    userId: string,
    commentId: string,
    isAdmin: boolean = false,
  ): Promise<void> {
    const comment = await commentRepository.getCommentById(commentId);

    if (!comment) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Comment not found");
    }

    if (comment.authorId !== userId && !isAdmin) {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "Not authorized to delete this comment",
      );
    }

    const deleted = await commentRepository.deleteComment(commentId);

    if (!deleted) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to delete comment",
      );
    }
  }

  private parseCursor(cursor?: string): Date | undefined {
    if (!cursor) {
      return undefined;
    }

    const parsedCursor = new Date(cursor);

    if (Number.isNaN(parsedCursor.getTime())) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid cursor");
    }

    return parsedCursor;
  }
}

export const commentService = new CommentService();
