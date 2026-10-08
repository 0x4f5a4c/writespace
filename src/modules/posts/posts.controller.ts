import { Request, Response, NextFunction } from "express";
import { postService } from "./posts.service";
import { CreatePostInput } from "./dtos/create-post.dto";
import { ApiResponse } from "@shared/utils/api-response";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import type { CodeSnippetSchema } from "../../db/schema/posts";
import type {
  PostMediaItem,
  PostCoverImage,
} from "./interfaces/post.interface";
import { postMediaService } from "./services/post-media.service";
import type { PublicUser } from "@modules/users/interface/user.interface";
import type { CloudinaryFilesMap } from "@shared/types/cloudinary-file";

interface AuthRequest<
  ReqBody = unknown,
  ReqQuery = Record<string, string | undefined>,
  ReqParams = Record<string, string>,
> extends Request<ReqParams, unknown, ReqBody, ReqQuery> {
  user?: PublicUser;
}

type CreatePayloadWithExtras = CreatePostInput & {
  media: PostMediaItem[];
  codeSnippets: CodeSnippetSchema[];
  coverImage?: PostCoverImage;
};

type UpdatePayloadWithExtras = Partial<CreatePostInput> & {
  media?: PostMediaItem[];
  codeSnippets?: CodeSnippetSchema[];
  coverImage?: PostCoverImage;
};

class PostsController {
  public createPost = async (
    req: AuthRequest<
      CreatePostInput & {
        codeSnippets?: unknown;
      }
    >,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const authorId = req.user!.id;

      const payload = req.body as CreatePayloadWithExtras;

      const files = req.files as CloudinaryFilesMap | undefined;

      /*
       * ---------------------------------------------------------
       * Cover Image
       * ---------------------------------------------------------
       *
       * Cloudinary uploads the banner and gives us:
       *
       *   location  -> image URL
       *   public_id -> Cloudinary public ID
       *
       * The Post module uses the canonical PostCoverImage
       * representation.
       */
      const bannerFile = files?.["banner"]?.[0];

      if (bannerFile) {
        payload.coverImage = postMediaService.createCoverImage(
          bannerFile.location,
          bannerFile.public_id,
          payload.coverImage?.altText,
          payload.coverImage?.credit,
        );
      }

      /*
       * ---------------------------------------------------------
       * Post Media
       * ---------------------------------------------------------
       *
       * Convert uploaded Cloudinary files into the canonical
       * PostMediaItem[] representation:
       *
       *   {
       *     url,
       *     publicId
       *   }
       */
      const mediaFiles = files?.["media"] ?? [];

      payload.media = mediaFiles.map((file) =>
        postMediaService.createMediaItem(file.location, file.public_id),
      );

      /*
       * ---------------------------------------------------------
       * Code Snippets
       * ---------------------------------------------------------
       *
       * multipart/form-data sends complex fields as strings,
       * so parse codeSnippets before passing the payload to the
       * Post service.
       */
      let parsedCodeSnippets: CodeSnippetSchema[] = [];

      if (req.body.codeSnippets) {
        if (typeof req.body.codeSnippets === "string") {
          try {
            parsedCodeSnippets = JSON.parse(
              req.body.codeSnippets,
            ) as CodeSnippetSchema[];
          } catch (error: unknown) {
            console.error("Failed to parse code snippets", error);

            parsedCodeSnippets = [];
          }
        } else if (Array.isArray(req.body.codeSnippets)) {
          parsedCodeSnippets = req.body.codeSnippets as CodeSnippetSchema[];
        }
      }

      payload.codeSnippets = parsedCodeSnippets;

      /*
       * ---------------------------------------------------------
       * Create Post
       * ---------------------------------------------------------
       */
      const fullyHydratedPost = await postService.createPost(authorId, payload);

      new ApiResponse(
        res,
        HTTP_STATUS.CREATED,
        "Post created successfully",
        fullyHydratedPost,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public getPosts = async (
    req: AuthRequest<
      unknown,
      { cursor?: string; limit?: string; authorId?: string }
    >,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const cursor = req.query.cursor;
      const limitQuery = req.query.limit;
      const authorIdFilter = req.query.authorId;

      const limit = Math.min(50, Math.max(1, parseInt(limitQuery || "20", 10)));
      const requesterId = req.user?.id;

      const { posts, nextCursor } = await postService.getPosts(
        limit,
        cursor,
        requesterId,
        authorIdFilter,
      );

      new ApiResponse(res, HTTP_STATUS.OK, "Posts fetched successfully", {
        posts,
        pagination: { limit, nextCursor },
      }).send();
    } catch (error) {
      next(error);
    }
  };

  public getPost = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const postId = req.params.id;
      const requesterId = req.user?.id;
      const post = await postService.getPost(postId, requesterId);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Post fetched successfully",
        post,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public updatePost = async (
    req: AuthRequest<
      Partial<CreatePostInput> & {
        existingMedia?: string | string[];
        existingMediaPublicIds?: string | string[];
        codeSnippets?: unknown;
      }
    >,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const postId = req.params.id;
      const authorId = req.user!.id;

      const payload = req.body as UpdatePayloadWithExtras;

      const files = req.files as CloudinaryFilesMap | undefined;

      /*
       * ---------------------------------------------------------
       * Cover Image
       * ---------------------------------------------------------
       */
      const bannerFile = files?.["banner"]?.[0];

      if (bannerFile) {
        payload.coverImage = postMediaService.createCoverImage(
          bannerFile.location,
          bannerFile.public_id,
          payload.coverImage?.altText,
          payload.coverImage?.credit,
        );
      }

      /*
       * ---------------------------------------------------------
       * Media
       * ---------------------------------------------------------
       *
       * The client sends:
       *
       * existingMedia
       * existingMediaPublicIds
       *
       * New uploads come from Cloudinary files.
       *
       * We convert everything into the canonical:
       *
       * PostMediaItem[]
       *
       * representation before passing it to the service.
       */

      const mediaFiles = files?.["media"] ?? [];

      const newMedia: PostMediaItem[] = mediaFiles.map((file) =>
        postMediaService.createMediaItem(file.location, file.public_id),
      );

      let existingMedia: string[] = [];
      let existingMediaPublicIds: string[] = [];

      const hasExistingMediaField = Object.prototype.hasOwnProperty.call(
        req.body,
        "existingMedia",
      );

      const hasExistingMediaPublicIdsField =
        Object.prototype.hasOwnProperty.call(
          req.body,
          "existingMediaPublicIds",
        );

      if (hasExistingMediaField) {
        const value = req.body.existingMedia;

        existingMedia = Array.isArray(value)
          ? (value as string[])
          : [value as string];
      }

      if (hasExistingMediaPublicIdsField) {
        const value = req.body.existingMediaPublicIds;

        existingMediaPublicIds = Array.isArray(value)
          ? (value as string[])
          : [value as string];
      }

      /*
       * If the client sent any media information, construct the
       * complete next media state.
       *
       * This also allows the client to explicitly send empty
       * arrays to remove all existing media.
       */
      if (
        hasExistingMediaField ||
        hasExistingMediaPublicIdsField ||
        newMedia.length > 0
      ) {
        if (existingMedia.length !== existingMediaPublicIds.length) {
          throw new Error(
            "Existing media URLs and publicIds must contain the same number of items",
          );
        }

        const existingMediaItems: PostMediaItem[] = existingMedia.map(
          (url, index) =>
            postMediaService.createMediaItem(
              url,
              existingMediaPublicIds[index],
            ),
        );

        payload.media = [...existingMediaItems, ...newMedia];

        postMediaService.validateMedia(payload.media);
      }

      /*
       * ---------------------------------------------------------
       * Code Snippets
       * ---------------------------------------------------------
       */
      let parsedCodeSnippets: CodeSnippetSchema[] | undefined = undefined;

      if (req.body.codeSnippets) {
        if (typeof req.body.codeSnippets === "string") {
          try {
            parsedCodeSnippets = JSON.parse(
              req.body.codeSnippets,
            ) as CodeSnippetSchema[];
          } catch (error: unknown) {
            console.error("Failed to parse code snippets", error);
          }
        } else if (Array.isArray(req.body.codeSnippets)) {
          parsedCodeSnippets = req.body.codeSnippets as CodeSnippetSchema[];
        }
      }

      if (parsedCodeSnippets !== undefined) {
        payload.codeSnippets = parsedCodeSnippets;
      }

      /*
       * ---------------------------------------------------------
       * Update Post
       * ---------------------------------------------------------
       */
      const updatedPost = await postService.updatePost(
        postId,
        authorId,
        payload,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Post updated successfully",
        updatedPost,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public deletePost = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const postId = req.params.id;
      const authorId = req.user!.id;
      const isAdmin = req.user!.role === "admin";

      await postService.deletePost(postId, authorId, isAdmin);
      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Post deleted successfully",
        null,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public likePost = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const postId = req.params.id;
      const userId = req.user!.id;

      const result = await postService.likePost(postId, userId);
      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        result.status === "liked" ? "Post liked" : "Post unliked",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public sharePost = async (
    req: AuthRequest<{ platform?: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const postId = req.params.id;
      const userId = req.user!.id;
      const platform = req.body.platform;

      const shareData = await postService.sharePost(
        postId,
        userId,
        platform || "generic",
      );
      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Share link generated",
        shareData,
      ).send();
    } catch (error) {
      next(error);
    }
  };
}

export const postsController = new PostsController();
