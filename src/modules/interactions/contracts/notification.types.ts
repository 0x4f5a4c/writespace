import {
  notificationEntityTypeEnum,
  notificationTypeEnum,
} from "../../../db/schema/notifications";

export type NotificationType = (typeof notificationTypeEnum.enumValues)[number];

export type NotificationEntityType =
  (typeof notificationEntityTypeEnum.enumValues)[number];

export interface CreateNotificationInput {
  recipientId: string;
  actorId?: string;
  type: NotificationType;
  entityType?: NotificationEntityType;
  relatedId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}
