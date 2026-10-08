import { PostCoverImage, PostMediaItem } from "../interfaces/post.interface";
import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

export interface PostMediaState {
  media: PostMediaItem[];
  coverImage?: PostCoverImage;
}

export interface PostMediaDbState {
  media: string[];
  mediaPublicIds: string[];
  coverImageUrl: string | null;
  coverImagePublicId: string | null;
  coverImageAltText: string | null;
  coverImageCredit: string | null;
}

export interface PostMediaDiff {
  keptMedia: PostMediaItem[];
  addedMedia: PostMediaItem[];
  removedMedia: PostMediaItem[];
  oldCoverImage?: PostCoverImage;
  newCoverImage?: PostCoverImage;
  coverImageChanged: boolean;
}

class PostMediaService {
  /**
   * Convert the current database representation into the
   * application's canonical PostMediaItem representation.
   */
  public fromDatabase(
    media: string[] | null | undefined,
    mediaPublicIds: string[] | null | undefined,
    coverImageUrl: string | null | undefined,
    coverImagePublicId: string | null | undefined,
    coverImageAltText: string | null | undefined,
    coverImageCredit: string | null | undefined,
  ): PostMediaState {
    const urls = media ?? [];
    const publicIds = mediaPublicIds ?? [];

    this.assertMatchingMediaArrays(urls, publicIds);

    const mediaItems: PostMediaItem[] = urls.map((url, index) => {
      const item: PostMediaItem = {
        url,
        publicId: publicIds[index],
      };

      this.assertValidMediaItem(item);

      return item;
    });

    let coverImage: PostCoverImage | undefined;

    if (coverImageUrl || coverImagePublicId) {
      if (!coverImageUrl || !coverImagePublicId) {
        throw new Error(
          "Post cover image is inconsistent: both URL and publicId are required",
        );
      }

      coverImage = {
        url: coverImageUrl,
        publicId: coverImagePublicId,
        ...(coverImageAltText ? { altText: coverImageAltText } : {}),
        ...(coverImageCredit ? { credit: coverImageCredit } : {}),
      };
    }

    return {
      media: mediaItems,
      coverImage,
    };
  }

  /**
   * Convert the canonical application representation back into
   * the current database representation.
   */
  public toDatabase(state: PostMediaState): PostMediaDbState {
    this.validateMedia(state.media);

    const media = state.media.map((item) => item.url);
    const mediaPublicIds = state.media.map((item) => item.publicId);

    this.assertMatchingMediaArrays(media, mediaPublicIds);

    return {
      media,
      mediaPublicIds,
      coverImageUrl: state.coverImage?.url ?? null,
      coverImagePublicId: state.coverImage?.publicId ?? null,
      coverImageAltText: state.coverImage?.altText ?? null,
      coverImageCredit: state.coverImage?.credit ?? null,
    };
  }

  /**
   * Build a media item from the result returned by the upload layer.
   */
  public createMediaItem(url: string, publicId: string): PostMediaItem {
    this.assertValidMediaItem({ url, publicId });

    return {
      url,
      publicId,
    };
  }

  /**
   * Build a cover image from the result returned by the upload layer.
   */
  public createCoverImage(
    url: string,
    publicId: string,
    altText?: string,
    credit?: string,
  ): PostCoverImage {
    const coverImage: PostCoverImage = {
      url,
      publicId,
      ...(altText ? { altText } : {}),
      ...(credit ? { credit } : {}),
    };

    this.assertValidMediaItem(coverImage);

    return coverImage;
  }

  /**
   * Validate a collection of media items.
   */
  public validateMedia(media: PostMediaItem[]): void {
    const publicIds = new Set<string>();

    for (const item of media) {
      this.assertValidMediaItem(item);

      if (publicIds.has(item.publicId)) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          `Duplicate media publicId detected: ${item.publicId}`,
        );
      }

      publicIds.add(item.publicId);
    }
  }

  /**
   * Calculate what changed between the old and new post media.
   *
   * Media is identified by publicId because it is the stable
   * provider-side identifier of the asset.
   */
  public diff(previous: PostMediaState, next: PostMediaState): PostMediaDiff {
    this.validateMedia(previous.media);
    this.validateMedia(next.media);

    const previousById = new Map(
      previous.media.map((item) => [item.publicId, item]),
    );

    const nextById = new Map(next.media.map((item) => [item.publicId, item]));

    const keptMedia: PostMediaItem[] = [];
    const addedMedia: PostMediaItem[] = [];
    const removedMedia: PostMediaItem[] = [];

    for (const item of next.media) {
      if (previousById.has(item.publicId)) {
        keptMedia.push(item);
      } else {
        addedMedia.push(item);
      }
    }

    for (const item of previous.media) {
      if (!nextById.has(item.publicId)) {
        removedMedia.push(item);
      }
    }

    const coverImageChanged = !this.areSameMediaItem(
      previous.coverImage,
      next.coverImage,
    );

    return {
      keptMedia,
      addedMedia,
      removedMedia,
      oldCoverImage: previous.coverImage,
      newCoverImage: next.coverImage,
      coverImageChanged,
    };
  }

  /**
   * Determine whether two media assets represent the same asset.
   */
  public areSameMediaItem(
    first?: PostMediaItem,
    second?: PostMediaItem,
  ): boolean {
    if (!first && !second) {
      return true;
    }

    if (!first || !second) {
      return false;
    }

    return first.publicId === second.publicId;
  }

  /**
   * Return all Cloudinary publicIds that should be cleaned up
   * after a media state change.
   *
   * Cover image is intentionally handled separately from body
   * media so callers can decide when/how it should be removed.
   */
  public getRemovedPublicIds(diff: PostMediaDiff): string[] {
    return diff.removedMedia.map((item) => item.publicId);
  }

  private assertValidMediaItem(item: PostMediaItem): void {
    if (!item.url || !item.url.trim()) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Media URL is required");
    }

    if (!item.publicId || !item.publicId.trim()) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Media publicId is required");
    }

    if (
      item.url.startsWith("http://") === false &&
      item.url.startsWith("https://") === false
    ) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Media URL must be an HTTP or HTTPS URL",
      );
    }

    if (
      item.publicId.startsWith("http://") ||
      item.publicId.startsWith("https://")
    ) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Media publicId must not be a URL",
      );
    }
  }

  private assertMatchingMediaArrays(
    media: string[],
    mediaPublicIds: string[],
  ): void {
    if (media.length !== mediaPublicIds.length) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Post media URLs and publicIds must contain the same number of items",
      );
    }
  }
}

export const postMediaService = new PostMediaService();
