import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import logger from "@config/logger";

import type {
  SavedPostQuery,
  SavedPostResult,
  SavePostInput,
  UnsavePostInput,
} from "../contracts/save.types";

import { interactionEventMapper } from "../events/interaction-event.mapper";
import { interactionEventPublisher } from "../events/interaction-event.publisher";

import { saveRepository } from "../repositories/save.repository";

export class SaveService {
  async savePost(input: SavePostInput): Promise<SavedPostResult> {
    const { actorId, postId } = input;

    const saved = await saveRepository.createSave(actorId, postId);

    /*
     * Idempotent operation:
     * the post was already saved by this user.
     *
     * No state changed, so no interaction event is created.
     */
    if (!saved) {
      return {
        userId: actorId,
        postId,
        isSaved: true,
      };
    }

    try {
      const event = interactionEventMapper.mapSaveEvent("save.created", {
        actorId,
        postId,
      });

      await interactionEventPublisher.publish(event);
    } catch (error) {
      logger.error("Failed to publish save.created event", {
        actorId,
        postId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      userId: saved.userId,
      postId: saved.postId,
      isSaved: true,
    };
  }

  async unsavePost(input: UnsavePostInput): Promise<SavedPostResult> {
    const { actorId, postId } = input;

    const saved = await saveRepository.deleteSave(actorId, postId);

    /*
     * No existing save means no state changed.
     * Therefore no save.removed event is created.
     */
    if (!saved) {
      return {
        userId: actorId,
        postId,
        isSaved: false,
      };
    }

    try {
      const event = interactionEventMapper.mapSaveEvent("save.removed", {
        actorId,
        postId,
      });

      await interactionEventPublisher.publish(event);
    } catch (error) {
      logger.error("Failed to publish save.removed event", {
        actorId,
        postId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      userId: saved.userId,
      postId: saved.postId,
      isSaved: false,
    };
  }

  async isPostSaved(userId: string, postId: string): Promise<boolean> {
    return saveRepository.isPostSaved(userId, postId);
  }

  async getSavedPosts(input: SavedPostQuery) {
    const { userId, limit, cursor } = input;

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

    return saveRepository.getSavedPosts(userId, limit, parsedCursor);
  }
}

export const saveService = new SaveService();
