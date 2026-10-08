import { ReactionType } from "../../../db/schema/post-reactions";

export type { ReactionType };

export type ReactionTargetType = "POST" | "COMMENT";

export interface SetReactionInput {
  actorId: string;
  targetId: string;
  targetType: ReactionTargetType;
  reactionType: ReactionType;
}

export interface RemoveReactionInput {
  actorId: string;
  targetId: string;
  targetType: ReactionTargetType;
}

export interface ReactionResult {
  targetId: string;
  targetType: ReactionTargetType;
  reactionType: ReactionType | null;
  isReacted: boolean;
}

export interface ReactionCount {
  total: number;
  byType: Record<ReactionType, number>;
}
