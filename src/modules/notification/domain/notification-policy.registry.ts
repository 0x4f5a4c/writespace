import type { DomainEventName } from "./event-name";

export const NOTIFICATION_POLICY_VERSION = "notification-policy-v2";

export type NotificationPolicyCategory =
  | "social"
  | "content"
  | "security"
  | "chat"
  | "platform";

export type NotificationPolicyPriority = "critical" | "high" | "normal" | "low";

export type NotificationPolicyChannel = "in_app" | "email" | "browser_push";

export type NotificationClassification =
  | "mandatory_security"
  | "required_system"
  | "optional"
  | "conditional";

export interface NotificationChannelPolicy {
  readonly permitted: boolean;
  readonly available: boolean;
  readonly enabledByDefault: boolean;
  readonly preferenceControlled: boolean;
}

export interface NotificationEventPolicy {
  readonly category: NotificationPolicyCategory;
  readonly priority: NotificationPolicyPriority;
  readonly classification: NotificationClassification;

  readonly channels: Readonly<
    Record<NotificationPolicyChannel, NotificationChannelPolicy>
  >;
}

/**
 * Initial social policy shared by the currently supported social events.
 *
 * In-app notifications are enabled by default.
 * Optional social email is disabled by default.
 * Browser push is not available yet.
 */
const socialActivityPolicy: NotificationEventPolicy = {
  category: "social",
  priority: "normal",
  classification: "optional",

  channels: {
    in_app: {
      permitted: true,
      available: true,
      enabledByDefault: true,
      preferenceControlled: true,
    },

    email: {
      permitted: false,
      available: true,
      enabledByDefault: false,
      preferenceControlled: false,
    },

    browser_push: {
      permitted: false,
      available: false,
      enabledByDefault: false,
      preferenceControlled: false,
    },
  },
};

/**
 * Security alerts are mandatory account communications.
 *
 * Users cannot disable these alerts through ordinary notification
 * preferences or category-level preference overrides.
 *
 * Both the inbox and transactional email channels are enabled.
 * Realtime uses the existing authenticated Socket.IO delivery handler.
 */
const mandatorySecurityPolicy: NotificationEventPolicy = {
  category: "security",
  priority: "high",
  classification: "mandatory_security",

  channels: {
    in_app: {
      permitted: true,
      available: true,
      enabledByDefault: true,
      preferenceControlled: false,
    },

    email: {
      permitted: true,
      available: true,
      enabledByDefault: true,
      preferenceControlled: false,
    },

    browser_push: {
      permitted: false,
      available: false,
      enabledByDefault: false,
      preferenceControlled: false,
    },
  },
};

/**
 * Version-controlled policy registry.
 *
 * Only events that currently produce user-facing notifications are listed.
 * Other valid domain events may intentionally produce no notification.
 */
const notificationPolicyRegistry: Partial<
  Record<DomainEventName, NotificationEventPolicy>
> = {
  "reaction.added": socialActivityPolicy,
  "follow.created": socialActivityPolicy,
  "comment.created": socialActivityPolicy,
  "comment.replied": socialActivityPolicy,
  "mention.created": socialActivityPolicy,

  "auth.security_alert": mandatorySecurityPolicy,
};

export function getNotificationPolicy(
  eventName: DomainEventName,
): NotificationEventPolicy | null {
  const policy = notificationPolicyRegistry[eventName];

  return policy ?? null;
}

/**
 * Effective in-app preference policy exposed to the preference service
 * and API.
 */
export interface InAppPreferencePolicy {
  category: NotificationPolicyCategory;
  enabledByDefault: boolean;
  editable: boolean;
  required: boolean;
}

/**
 * Determine whether a category/channel can be changed by the user.
 *
 * Mandatory security and required system communications cannot be
 * disabled through ordinary notification preferences.
 */
function isInAppPreferenceEditable(policy: NotificationEventPolicy): boolean {
  const channel = policy.channels.in_app;

  return (
    channel.permitted &&
    channel.available &&
    channel.preferenceControlled &&
    policy.classification !== "mandatory_security" &&
    policy.classification !== "required_system"
  );
}

/**
 * Resolve the in-app preference policy for one domain event.
 */
export function getInAppPreferencePolicyForEvent(
  eventName: DomainEventName,
): InAppPreferencePolicy | null {
  const policy = getNotificationPolicy(eventName);

  if (!policy) {
    return null;
  }

  const channel = policy.channels.in_app;

  if (!channel.permitted || !channel.available) {
    return null;
  }

  const editable = isInAppPreferenceEditable(policy);

  return {
    category: policy.category,
    enabledByDefault: channel.enabledByDefault,
    editable,
    required: !editable,
  };
}

/**
 * Build the supported in-app preference catalogue.
 *
 * Categories are discovered from notification-producing events.
 * Events sharing a category must use the same in-app default because
 * the user controls that category through one preference setting.
 */
export function getInAppPreferencePolicies(): InAppPreferencePolicy[] {
  const policiesByCategory = new Map<
    NotificationPolicyCategory,
    NotificationEventPolicy[]
  >();

  for (const policy of Object.values(notificationPolicyRegistry)) {
    if (!policy) {
      continue;
    }

    const channel = policy.channels.in_app;

    if (!channel.permitted || !channel.available) {
      continue;
    }

    const categoryPolicies = policiesByCategory.get(policy.category) ?? [];

    categoryPolicies.push(policy);
    policiesByCategory.set(policy.category, categoryPolicies);
  }

  return Array.from(policiesByCategory.entries())
    .map(([category, policies]) => {
      const defaults = new Set(
        policies.map((policy) => policy.channels.in_app.enabledByDefault),
      );

      if (defaults.size !== 1) {
        throw new Error(
          `Conflicting in-app preference defaults for category "${category}".`,
        );
      }

      const editable = policies.every(isInAppPreferenceEditable);

      return {
        category,
        enabledByDefault: policies[0]!.channels.in_app.enabledByDefault,
        editable,
        required: !editable,
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category));
}
