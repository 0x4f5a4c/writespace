export enum NotificationType {
  REACTION = "REACTION",
  COMMENT = "COMMENT",
  FOLLOW = "FOLLOW",
  SHARE = "SHARE",
  WELCOME = "WELCOME",
  SYSTEM = "SYSTEM",
}

export interface INotificationPayload {
  recipientId: string;
  type: NotificationType;
  message: string;
  relatedId?: string;
  actorId?: string;
}
