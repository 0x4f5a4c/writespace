export interface CreateShareInput {
  actorId: string;
  postId: string;
  platform: string;
}

export interface ShareResult {
  id: number;
  userId: string;
  postId: string;
  platform: string;
  createdAt: Date;
}
