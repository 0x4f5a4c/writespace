import { relations } from "drizzle-orm";
import { users } from "./users";
import { posts } from "./posts";
import { comments } from "./comments";
import { shares } from "./shares";
import { notifications } from "./notifications";
import { notificationDeliveries } from "./notification-deliveries";
import { follows } from "./follows";
import { postReactions } from "./post-reactions";
import { commentReactions } from "./comment-reactions";
import { postSaves } from "./post-saves";
import { interactionEvents } from "./interaction-events";

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
  comments: many(comments),

  postReactions: many(postReactions),
  commentReactions: many(commentReactions),

  postSaves: many(postSaves),

  interactionEvents: many(interactionEvents),

  notificationsReceived: many(notifications, {
    relationName: "notifications_received",
  }),

  notificationsTriggered: many(notifications, {
    relationName: "notifications_triggered",
  }),

  followers: many(follows, {
    relationName: "user_followers",
  }),

  following: many(follows, {
    relationName: "user_following",
  }),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, {
    fields: [posts.authorId],
    references: [users.id],
  }),

  comments: many(comments),

  reactions: many(postReactions),

  shares: many(shares),

  saves: many(postSaves),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  post: one(posts, {
    fields: [comments.postId],
    references: [posts.id],
  }),

  author: one(users, {
    fields: [comments.authorId],
    references: [users.id],
  }),

  parent: one(comments, {
    fields: [comments.parentCommentId],
    references: [comments.id],
    relationName: "commentReplies",
  }),

  replies: many(comments, {
    relationName: "commentReplies",
  }),

  reactions: many(commentReactions),
}));

export const postReactionsRelations = relations(postReactions, ({ one }) => ({
  user: one(users, {
    fields: [postReactions.userId],
    references: [users.id],
  }),

  post: one(posts, {
    fields: [postReactions.postId],
    references: [posts.id],
  }),
}));

export const commentReactionsRelations = relations(
  commentReactions,
  ({ one }) => ({
    user: one(users, {
      fields: [commentReactions.userId],
      references: [users.id],
    }),

    comment: one(comments, {
      fields: [commentReactions.commentId],
      references: [comments.id],
    }),
  }),
);

export const sharesRelations = relations(shares, ({ one }) => ({
  user: one(users, {
    fields: [shares.userId],
    references: [users.id],
  }),

  post: one(posts, {
    fields: [shares.postId],
    references: [posts.id],
  }),
}));

export const postSavesRelations = relations(postSaves, ({ one }) => ({
  user: one(users, {
    fields: [postSaves.userId],
    references: [users.id],
  }),

  post: one(posts, {
    fields: [postSaves.postId],
    references: [posts.id],
  }),
}));

export const interactionEventsRelations = relations(
  interactionEvents,
  ({ one }) => ({
    actor: one(users, {
      fields: [interactionEvents.actorId],
      references: [users.id],
    }),
  }),
);

export const notificationsRelations = relations(
  notifications,
  ({ one, many }) => ({
    recipient: one(users, {
      fields: [notifications.recipientId],
      references: [users.id],
      relationName: "notifications_received",
    }),

    actor: one(users, {
      fields: [notifications.actorId],
      references: [users.id],
      relationName: "notifications_triggered",
    }),

    deliveries: many(notificationDeliveries),
  }),
);

export const notificationDeliveriesRelations = relations(
  notificationDeliveries,
  ({ one }) => ({
    notification: one(notifications, {
      fields: [notificationDeliveries.notificationId],
      references: [notifications.id],
    }),
  }),
);

export const followsRelations = relations(follows, ({ one }) => ({
  follower: one(users, {
    fields: [follows.followerId],
    references: [users.id],
    relationName: "user_following",
  }),

  following: one(users, {
    fields: [follows.followingId],
    references: [users.id],
    relationName: "user_followers",
  }),
}));
