/**
 * Authentication security events eligible for user-facing security alerts.
 *
 * Keep this list aligned with the event types in SecurityEventRepository.
 * Registration and OAuth account creation already have welcome-email flows,
 * while user-initiated session revocations do not need another alert.
 */
export const AUTH_SECURITY_EVENT_TYPES = [
  "auth.login",
  "auth.oauth_login",
  "password.reset",
  "password.changed",
  "account.suspended",
  "refresh_token.reuse_detected",
] as const;

export type AuthSecurityEventType = (typeof AUTH_SECURITY_EVENT_TYPES)[number];

export function isAuthSecurityEventType(
  value: string,
): value is AuthSecurityEventType {
  return (AUTH_SECURITY_EVENT_TYPES as readonly string[]).includes(value);
}
