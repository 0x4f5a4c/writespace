import { type DatabaseTransaction } from "../../db";

import {
  securityEvents,
  type NewSecurityEvent,
} from "@db/schema/security-events";

import { eventPublisherService } from "../notification/services/event-publisher.service";
import { isAuthSecurityEventType } from "../notification/events/auth-security-event.types";

/**
 * Centralized event names prevent inconsistent event identifiers
 * across authentication and session repositories.
 */
export const SECURITY_EVENT_TYPES = {
  SESSION_CREATED: "session.created",
  REFRESH_TOKEN_ROTATED: "refresh_token.rotated",
  REFRESH_TOKEN_REUSE_DETECTED: "refresh_token.reuse_detected",
  SESSION_REVOKED: "session.revoked",
  SESSIONS_REVOKED: "sessions.revoked",

  PASSWORD_RESET: "password.reset",
  PASSWORD_CHANGED: "password.changed",
  ACCOUNT_SUSPENDED: "account.suspended",

  AUTH_REGISTRATION_COMPLETED: "auth.registration_completed",
  AUTH_LOGIN: "auth.login",
  AUTH_OAUTH_LOGIN: "auth.oauth_login",
  AUTH_OAUTH_ACCOUNT_CREATED: "auth.oauth_account_created",
} as const;

export const SECURITY_EVENT_OUTCOMES = {
  SUCCESS: "success",
  DETECTED: "detected",
} as const;

/**
 * Persists security events and publishes selected user-facing security
 * alerts through the existing transactional notification outbox.
 *
 * The audit record and notification outbox event commit or roll back
 * together with the caller's authentication transaction.
 *
 * Never include passwords, OTPs, JWTs, raw refresh tokens,
 * or recovery secrets in event metadata or notification payloads.
 */
export class SecurityEventRepository {
  public async create(
    tx: DatabaseTransaction,
    data: NewSecurityEvent,
  ): Promise<void> {
    const occurredAt = data.occurredAt ?? new Date();

    const [securityEvent] = await tx
      .insert(securityEvents)
      .values({
        ...data,
        occurredAt,
      })
      .returning({
        id: securityEvents.id,
      });

    if (!securityEvent) {
      throw new Error("Failed to persist security event");
    }

    // Only the allowlisted security events produce user-facing alerts.
    // Session creation/revocation and registration events are not duplicated
    // because they already have their own lifecycle or welcome flows.
    if (!data.userId || !isAuthSecurityEventType(data.eventType)) {
      return;
    }

    await eventPublisherService.recordInTransaction(tx, {
      eventName: "auth.security_alert",
      eventVersion: 1,
      producer: "authentication",
      occurredAt,

      // The user is the recipient. Do not misrepresent system actions
      // such as password reset or account suspension as user-initiated.
      actorId: null,

      aggregate: {
        type: "USER",
        id: data.userId,
      },

      payload: {
        securityEventId: securityEvent.id,
        recipientUserId: data.userId,
        securityEventType: data.eventType,
      },

      metadata: {
        source: "security_events",
      },
    });
  }
}

export const securityEventRepository = new SecurityEventRepository();
