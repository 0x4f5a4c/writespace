import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import logger from "@config/logger";

import type {
  FollowResult,
  FollowUserInput,
  UnfollowUserInput,
} from "../contracts/follow.types";

import { interactionEventMapper } from "../events/interaction-event.mapper";
import { interactionEventPublisher } from "../events/interaction-event.publisher";

import { followRepository } from "../repositories/follow.repository";

export class FollowService {
  async followUser(input: FollowUserInput): Promise<FollowResult> {
    const { actorId, targetUserId } = input;

    if (actorId === targetUserId) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "You cannot follow yourself");
    }

    const follow = await followRepository.createFollow(actorId, targetUserId);

    /*
     * Idempotent operation:
     * the user was already following the target.
     *
     * No state changed, so no interaction event is created.
     */
    if (!follow) {
      return {
        followerId: actorId,
        followingId: targetUserId,
        isFollowing: true,
      };
    }

    try {
      const event = interactionEventMapper.mapFollowEvent("follow.created", {
        actorId,
        targetUserId,
      });

      await interactionEventPublisher.publish(event);
    } catch (error) {
      logger.error("Failed to publish follow.created event", {
        actorId,
        targetUserId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      followerId: follow.followerId,
      followingId: follow.followingId,
      isFollowing: true,
    };
  }

  async unfollowUser(input: UnfollowUserInput): Promise<FollowResult> {
    const { actorId, targetUserId } = input;

    if (actorId === targetUserId) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "You cannot unfollow yourself",
      );
    }

    const follow = await followRepository.deleteFollow(actorId, targetUserId);

    /*
     * No existing follow means no state changed.
     * Therefore no follow.removed event is created.
     */
    if (!follow) {
      return {
        followerId: actorId,
        followingId: targetUserId,
        isFollowing: false,
      };
    }

    try {
      const event = interactionEventMapper.mapFollowEvent("follow.removed", {
        actorId,
        targetUserId,
      });

      await interactionEventPublisher.publish(event);
    } catch (error) {
      logger.error("Failed to publish follow.removed event", {
        actorId,
        targetUserId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      followerId: follow.followerId,
      followingId: follow.followingId,
      isFollowing: false,
    };
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    return followRepository.isFollowing(followerId, followingId);
  }
}

export const followService = new FollowService();
