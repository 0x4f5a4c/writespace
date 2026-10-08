import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import { PostStatus } from "../interfaces/post.interface";

const VALID_TRANSITIONS: Record<PostStatus, readonly PostStatus[]> = {
  [PostStatus.DRAFT]: [
    PostStatus.SCHEDULED,
    PostStatus.PUBLISHED,
    PostStatus.TRASH,
  ],

  [PostStatus.SCHEDULED]: [
    PostStatus.PUBLISHED,
    PostStatus.DRAFT,
    PostStatus.TRASH,
  ],

  [PostStatus.PUBLISHED]: [
    PostStatus.ARCHIVED,
    PostStatus.DRAFT,
    PostStatus.TRASH,
  ],

  [PostStatus.ARCHIVED]: [
    PostStatus.DRAFT,
    PostStatus.PUBLISHED,
    PostStatus.TRASH,
  ],

  [PostStatus.TRASH]: [PostStatus.DRAFT],
};

export function canTransition(from: PostStatus, to: PostStatus): boolean {
  if (from === to) {
    return true;
  }

  return VALID_TRANSITIONS[from].includes(to);
}

export function assertValidTransition(from: PostStatus, to: PostStatus): void {
  if (canTransition(from, to)) {
    return;
  }

  throw new AppError(
    HTTP_STATUS.BAD_REQUEST,
    `Invalid post status transition: ${from} → ${to}`,
  );
}

export function isPublicStatus(status: PostStatus): boolean {
  return status === PostStatus.PUBLISHED;
}

export function isTrashStatus(status: PostStatus): boolean {
  return status === PostStatus.TRASH;
}

export function affectsTotalPosts(from: PostStatus, to: PostStatus): number {
  if (from !== PostStatus.TRASH && to === PostStatus.TRASH) {
    return -1;
  }

  if (from === PostStatus.TRASH && to !== PostStatus.TRASH) {
    return 1;
  }

  return 0;
}

export function toPostStatus(status: string): PostStatus {
  if (Object.values(PostStatus).includes(status as PostStatus)) {
    return status as PostStatus;
  }

  throw new AppError(
    HTTP_STATUS.INTERNAL_SERVER_ERROR,
    `Invalid post status stored in database: ${status}`,
  );
}
