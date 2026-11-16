import { z } from "zod";

import { reactionTypes } from "@db/schema/content-reactions";
import { DOMAIN_EVENT_NAMES } from "../domain/event-name";
import { AUTH_SECURITY_EVENT_TYPES } from "./auth-security-event.types";

/**
 * Runtime schema for the supported event-name vocabulary.
 */
export const domainEventNameSchema = z.enum(DOMAIN_EVENT_NAMES);

/**
 * Shared UUID validation for event payload identifiers.
 */
const uuidSchema = z.string().uuid();

/**
 * Authentication security events contain references only.
 *
 * Passwords, tokens, OTPs, session secrets and email addresses must never
 * be copied into the notification event payload.
 */
export const authSecurityAlertEventPayloadSchema = z.strictObject({
  securityEventId: uuidSchema,
  recipientUserId: uuidSchema,
  securityEventType: z.enum(AUTH_SECURITY_EVENT_TYPES),
});

export type AuthSecurityAlertEventPayload = z.infer<
  typeof authSecurityAlertEventPayloadSchema
>;

/**
 * Reactions are valid for either a content item or a comment.
 */
export const reactionEventPayloadSchema = z.strictObject({
  targetType: z.enum(["CONTENT_ITEM", "COMMENT"]),
  targetId: uuidSchema,
  reactionType: z.enum(reactionTypes),
});

/**
 * A follow event targets the user who was followed or unfollowed.
 */
export const followEventPayloadSchema = z.strictObject({
  targetUserId: uuidSchema,
});

/**
 * Save events are associated with the shared content-item model.
 */
export const saveEventPayloadSchema = z.strictObject({
  contentItemId: uuidSchema,
});

/**
 * A share event records the content item and selected platform.
 */
export const shareEventPayloadSchema = z.strictObject({
  contentItemId: uuidSchema,
  platform: z.string().trim().min(1).max(50),
});

/**
 * A top-level comment was created on a published Post or Article.
 */
export const commentCreatedEventPayloadSchema = z.strictObject({
  contentItemId: uuidSchema,
  commentId: uuidSchema,
});

/**
 * A user replied to an existing comment.
 */
export const commentRepliedEventPayloadSchema = z.strictObject({
  contentItemId: uuidSchema,
  commentId: uuidSchema,
  parentCommentId: uuidSchema,
});

/**
 * A user was newly mentioned in a published Post or Article.
 */
export const mentionCreatedEventPayloadSchema = z.strictObject({
  contentItemId: uuidSchema,
  mentionedUserId: uuidSchema,
});

export type MentionCreatedEventPayload = z.infer<
  typeof mentionCreatedEventPayloadSchema
>;

export type CommentRepliedEventPayload = z.infer<
  typeof commentRepliedEventPayloadSchema
>;

export type CommentCreatedEventPayload = z.infer<
  typeof commentCreatedEventPayloadSchema
>;

export type ReactionEventPayload = z.infer<typeof reactionEventPayloadSchema>;

export type FollowEventPayload = z.infer<typeof followEventPayloadSchema>;

export type SaveEventPayload = z.infer<typeof saveEventPayloadSchema>;

export type ShareEventPayload = z.infer<typeof shareEventPayloadSchema>;
