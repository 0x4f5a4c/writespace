import {
  interactionEventTargetTypeEnum,
  interactionEventTypeEnum,
} from "../../../db/schema/interaction-events";

export type InteractionEventType =
  (typeof interactionEventTypeEnum.enumValues)[number];

export type InteractionEventTargetType =
  (typeof interactionEventTargetTypeEnum.enumValues)[number];

export interface InteractionEventInput {
  actorId: string;
  eventType: InteractionEventType;
  targetType: InteractionEventTargetType;
  targetId: string;
  metadata?: Record<string, unknown>;
}

export interface InteractionEvent {
  id: number;
  actorId: string;
  eventType: InteractionEventType;
  targetType: InteractionEventTargetType;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}
