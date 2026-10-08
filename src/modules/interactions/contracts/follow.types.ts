export interface FollowUserInput {
  actorId: string;
  targetUserId: string;
}

export interface UnfollowUserInput {
  actorId: string;
  targetUserId: string;
}

export interface FollowResult {
  followerId: string;
  followingId: string;
  isFollowing: boolean;
}
