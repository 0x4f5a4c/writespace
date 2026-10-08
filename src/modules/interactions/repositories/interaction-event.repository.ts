import { and, desc, eq, lt } from "drizzle-orm";

import { db } from "../../../db";
import { interactionEvents } from "../../../db/schema";
import type {
  InteractionEventInput,
  InteractionEventTargetType,
  InteractionEventType,
} from "../contracts/interaction-event.types";

export class InteractionEventRepository {
  async createEvent(input: InteractionEventInput) {
    const result = await db
      .insert(interactionEvents)
      .values({
        actorId: input.actorId,
        eventType: input.eventType,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata ?? {},
      })
      .returning();

    return result[0] ?? null;
  }

  async getEventById(id: number) {
    const result = await db
      .select()
      .from(interactionEvents)
      .where(eq(interactionEvents.id, id))
      .limit(1);

    return result[0] ?? null;
  }

  async getActorEvents(actorId: string, limit: number, cursor?: Date) {
    const conditions = cursor
      ? and(
          eq(interactionEvents.actorId, actorId),
          lt(interactionEvents.createdAt, cursor),
        )
      : eq(interactionEvents.actorId, actorId);

    return db
      .select()
      .from(interactionEvents)
      .where(conditions)
      .orderBy(desc(interactionEvents.createdAt))
      .limit(limit);
  }

  async getTargetEvents(
    targetType: InteractionEventTargetType,
    targetId: string,
    limit: number,
    cursor?: Date,
  ) {
    const conditions = cursor
      ? and(
          eq(interactionEvents.targetType, targetType),
          eq(interactionEvents.targetId, targetId),
          lt(interactionEvents.createdAt, cursor),
        )
      : and(
          eq(interactionEvents.targetType, targetType),
          eq(interactionEvents.targetId, targetId),
        );

    return db
      .select()
      .from(interactionEvents)
      .where(conditions)
      .orderBy(desc(interactionEvents.createdAt))
      .limit(limit);
  }

  async getEventsByType(
    eventType: InteractionEventType,
    limit: number,
    cursor?: Date,
  ) {
    const conditions = cursor
      ? and(
          eq(interactionEvents.eventType, eventType),
          lt(interactionEvents.createdAt, cursor),
        )
      : eq(interactionEvents.eventType, eventType);

    return db
      .select()
      .from(interactionEvents)
      .where(conditions)
      .orderBy(desc(interactionEvents.createdAt))
      .limit(limit);
  }
}

export const interactionEventRepository = new InteractionEventRepository();
