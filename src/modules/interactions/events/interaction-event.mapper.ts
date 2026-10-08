import type {
  InteractionEventInput,
  InteractionEventTargetType,
  InteractionEventType,
} from "../contracts/interaction-event.types";

import type { ReactionType } from "../contracts/reaction.types";

interface ReactionEventInput {
  actorId: string;
  targetId: string;
  targetType: Extract<InteractionEventTargetType, "POST" | "COMMENT">;
  reactionType?: ReactionType;
}

interface FollowEventInput {
  actorId: string;
  targetUserId: string;
}

interface SaveEventInput {
  actorId: string;
  postId: string;
}

interface ShareEventInput {
  actorId: string;
  postId: string;
  platform: string;
}

export class InteractionEventMapper {
  mapReactionEvent(
    eventType: Extract<
      InteractionEventType,
      "reaction.added" | "reaction.changed" | "reaction.removed"
    >,
    input: ReactionEventInput,
  ): InteractionEventInput {
    return {
      actorId: input.actorId,
      eventType,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.reactionType
        ? {
            reactionType: input.reactionType,
          }
        : {},
    };
  }

  mapFollowEvent(
    eventType: Extract<
      InteractionEventType,
      "follow.created" | "follow.removed"
    >,
    input: FollowEventInput,
  ): InteractionEventInput {
    return {
      actorId: input.actorId,
      eventType,
      targetType: "USER",
      targetId: input.targetUserId,
      metadata: {},
    };
  }

  mapSaveEvent(
    eventType: Extract<InteractionEventType, "save.created" | "save.removed">,
    input: SaveEventInput,
  ): InteractionEventInput {
    return {
      actorId: input.actorId,
      eventType,
      targetType: "POST",
      targetId: input.postId,
      metadata: {},
    };
  }

  mapShareEvent(input: ShareEventInput): InteractionEventInput {
    return {
      actorId: input.actorId,
      eventType: "share.created",
      targetType: "POST",
      targetId: input.postId,
      metadata: {
        platform: input.platform,
      },
    };
  }
}

export const interactionEventMapper = new InteractionEventMapper();
