export interface SavePostInput {
  actorId: string;
  postId: string;
}

export interface UnsavePostInput {
  actorId: string;
  postId: string;
}

export interface SavedPostResult {
  userId: string;
  postId: string;
  isSaved: boolean;
}

export interface SavedPostQuery {
  userId: string;
  limit: number;
  cursor?: string;
}
