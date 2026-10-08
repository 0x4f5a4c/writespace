import { interactionEventMapper } from "../events/interaction-event.mapper";
import { interactionEventPublisher } from "../events/interaction-event.publisher";
import { reactionRepository } from "../repositories/reaction.repository";

import type {
  ReactionResult,
  RemoveReactionInput,
  SetReactionInput,
} from "../contracts/reaction.types";

type ReactionEventType =
  | "reaction.added"
  | "reaction.changed"
  | "reaction.removed";

export class ReactionService {
  async setReaction(input: SetReactionInput): Promise<ReactionResult> {
    const { actorId, targetId, targetType, reactionType } = input;

    const result =
      targetType === "POST"
        ? await reactionRepository.setPostReaction(
            targetId,
            actorId,
            reactionType,
          )
        : await reactionRepository.setCommentReaction(
            targetId,
            actorId,
            reactionType,
          );

    const currentReactionType = result.reaction?.reactionType ?? null;

    /*
     * Same reaction means the operation is idempotent.
     * We do not create another interaction event.
     */
    if (result.previousReactionType === reactionType) {
      return {
        targetId,
        targetType,
        reactionType: currentReactionType,
        isReacted: true,
      };
    }

    const eventType: ReactionEventType =
      result.previousReactionType === null
        ? "reaction.added"
        : "reaction.changed";

    const event = interactionEventMapper.mapReactionEvent(eventType, {
      actorId,
      targetId,
      targetType,
      reactionType,
    });

    await interactionEventPublisher.publish(event);

    return {
      targetId,
      targetType,
      reactionType: currentReactionType,
      isReacted: true,
    };
  }

  async removeReaction(input: RemoveReactionInput): Promise<ReactionResult> {
    const { actorId, targetId, targetType } = input;

    const deleted =
      targetType === "POST"
        ? await reactionRepository.deletePostReaction(targetId, actorId)
        : await reactionRepository.deleteCommentReaction(targetId, actorId);

    /*
     * Removing a reaction that doesn't exist is
     * intentionally idempotent.
     *
     * No event is generated because no state changed.
     */
    if (!deleted) {
      return {
        targetId,
        targetType,
        reactionType: null,
        isReacted: false,
      };
    }

    const event = interactionEventMapper.mapReactionEvent("reaction.removed", {
      actorId,
      targetId,
      targetType,
      reactionType: deleted.reactionType,
    });

    await interactionEventPublisher.publish(event);

    return {
      targetId,
      targetType,
      reactionType: null,
      isReacted: false,
    };
  }
}

export const reactionService = new ReactionService();
