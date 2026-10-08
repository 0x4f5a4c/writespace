import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import logger from "@config/logger";

import type { CreateShareInput, ShareResult } from "../contracts/share.types";

import { interactionEventMapper } from "../events/interaction-event.mapper";
import { interactionEventPublisher } from "../events/interaction-event.publisher";

import { shareRepository } from "../repositories/share.repository";

export class ShareService {
  async createShare(input: CreateShareInput): Promise<ShareResult> {
    const { actorId, postId, platform } = input;

    const normalizedPlatform = platform.trim();

    if (!normalizedPlatform) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Share platform is required");
    }

    const share = await shareRepository.createShare(
      actorId,
      postId,
      normalizedPlatform,
    );

    if (!share) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to create share",
      );
    }

    try {
      const event = interactionEventMapper.mapShareEvent({
        actorId,
        postId,
        platform: normalizedPlatform,
      });

      await interactionEventPublisher.publish(event);
    } catch (error) {
      logger.error("Failed to publish share.created event", {
        actorId,
        postId,
        platform: normalizedPlatform,
        shareId: share.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      id: share.id,
      userId: share.userId,
      postId: share.postId,
      platform: share.platform,
      createdAt: share.createdAt,
    };
  }

  async getShareById(id: number): Promise<ShareResult | null> {
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid share id");
    }

    const share = await shareRepository.getShareById(id);

    if (!share) {
      return null;
    }

    return {
      id: share.id,
      userId: share.userId,
      postId: share.postId,
      platform: share.platform,
      createdAt: share.createdAt,
    };
  }

  async getPostShares(
    postId: string,
    limit: number,
    cursor?: string,
  ): Promise<ShareResult[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Limit must be a positive integer",
      );
    }

    const parsedCursor = cursor ? new Date(cursor) : undefined;

    if (parsedCursor && Number.isNaN(parsedCursor.getTime())) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid cursor");
    }

    const shares = await shareRepository.getPostShares(
      postId,
      limit,
      parsedCursor,
    );

    return shares.map((share) => ({
      id: share.id,
      userId: share.userId,
      postId: share.postId,
      platform: share.platform,
      createdAt: share.createdAt,
    }));
  }

  async getUserPostShares(
    userId: string,
    postId: string,
  ): Promise<ShareResult[]> {
    const shares = await shareRepository.getUserPostShares(userId, postId);

    return shares.map((share) => ({
      id: share.id,
      userId: share.userId,
      postId: share.postId,
      platform: share.platform,
      createdAt: share.createdAt,
    }));
  }
}

export const shareService = new ShareService();
