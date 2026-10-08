import {
  jsonb,
  pgEnum,
  pgTable,
  serial,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export const interactionEventTypeEnum = pgEnum("interaction_event_type", [
  "reaction.added",
  "reaction.changed",
  "reaction.removed",
  "follow.created",
  "follow.removed",
  "save.created",
  "save.removed",
  "share.created",
]);

export const interactionEventTargetTypeEnum = pgEnum(
  "interaction_event_target_type",
  ["POST", "COMMENT", "USER"],
);

export const interactionEvents = pgTable(
  "interaction_events",
  {
    id: serial("id").primaryKey(),

    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    eventType: interactionEventTypeEnum("event_type").notNull(),

    targetType: interactionEventTargetTypeEnum("target_type").notNull(),

    targetId: uuid("target_id").notNull(),

    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("interaction_events_actor_created_idx").on(
      table.actorId,
      table.createdAt,
    ),

    index("interaction_events_target_created_idx").on(
      table.targetType,
      table.targetId,
      table.createdAt,
    ),

    index("interaction_events_type_created_idx").on(
      table.eventType,
      table.createdAt,
    ),
  ],
);

export type InteractionEvent = typeof interactionEvents.$inferSelect;
export type NewInteractionEvent = typeof interactionEvents.$inferInsert;
