/**
 * Canonical names for domain events supported by the notification pipeline.
 *
 * New event names must be introduced together with their payload schema,
 * registry entry and consumer behaviour.
 */
export const DOMAIN_EVENT_NAMES = [
  "reaction.added",
  "reaction.changed",
  "reaction.removed",
  "follow.created",
  "follow.removed",
  "save.created",
  "save.removed",
  "share.created",
  "comment.created",
  "comment.replied",
  "mention.created",
  "auth.security_alert",
] as const;

export type DomainEventName = (typeof DOMAIN_EVENT_NAMES)[number];

/**
 * Runtime guard for values arriving from persisted rows, queues or other
 * boundaries where TypeScript types are not available.
 */
const domainEventNameSet: ReadonlySet<string> = new Set(DOMAIN_EVENT_NAMES);

export function isDomainEventName(value: unknown): value is DomainEventName {
  return typeof value === "string" && domainEventNameSet.has(value);
}
