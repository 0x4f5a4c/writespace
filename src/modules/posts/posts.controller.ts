import { Request, Response, NextFunction } from "express";
import { postService } from "./posts.service";
import { CreatePostInput } from "./dtos/create-post.dto";
import { ApiResponse } from "@shared/utils/api-response";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import type { CodeSnippetSchema } from "../../db/schema/posts";
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
  media: string[];
  mediaPublicIds?: string[];
  codeSnippets: CodeSnippetSchema[];
  coverImage?: {
    url: string;
    publicId: string;
    altText?: string;
    credit?: string;
  };
};

type UpdatePayloadWithExtras = Partial<CreatePostInput> & {
  media?: string[];
  mediaPublicIds?: string[];
  codeSnippets?: CodeSnippetSchema[];
  coverImage?: {
    url: string;
    publicId: string;
    altText?: string;
    credit?: string;
  };
};

class PostsController {
  public createPost = async (
    req: AuthRequest<
      CreatePostInput & { media?: string[]; codeSnippets?: unknown }
    >,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const authorId = req.user!.id;
      // Typecasting safely
      const payload = req.body as CreatePayloadWithExtras;

      const files = req.files as CloudinaryFilesMap | undefined;

      const bannerFile = files?.["banner"]?.[0];
      if (bannerFile) {
        payload.coverImage = {
          url: bannerFile.location,
          publicId: bannerFile.public_id,
          altText: payload.coverImage?.altText,
          credit: payload.coverImage?.credit,
        };
      }

      const mediaFiles = files?.["media"] ?? [];
      if (mediaFiles.length > 0) {
        payload.media = mediaFiles.map((f) => f.location);
        payload.mediaPublicIds = mediaFiles.map((f) => f.public_id);
      }

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
        media?: string[];
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
      // Typecasting safely
      const payload = req.body as UpdatePayloadWithExtras;

      const files = req.files as CloudinaryFilesMap | undefined;

      const bannerFile = files?.["banner"]?.[0];
      if (bannerFile) {
        payload.coverImage = {
          url: bannerFile.location,
          publicId: bannerFile.public_id,
          altText: payload.coverImage?.altText,
          credit: payload.coverImage?.credit,
        };
      }

      const mediaFiles = files?.["media"] ?? [];
      const newMediaUrls = mediaFiles.map((f) => f.location);
      const newMediaPublicIds = mediaFiles.map((f) => f.public_id);

      let existingMedia: string[] = [];
      let existingMediaPublicIds: string[] = [];

      if (req.body.existingMedia) {
        existingMedia = Array.isArray(req.body.existingMedia)
          ? (req.body.existingMedia as string[])
          : [req.body.existingMedia as string];
      }

      if (req.body.existingMediaPublicIds) {
        existingMediaPublicIds = Array.isArray(req.body.existingMediaPublicIds)
          ? (req.body.existingMediaPublicIds as string[])
          : [req.body.existingMediaPublicIds as string];
      }

      if (newMediaUrls.length > 0 || existingMedia.length > 0) {
        payload.media = [...existingMedia, ...newMediaUrls];
        payload.mediaPublicIds = [
          ...existingMediaPublicIds,
          ...newMediaPublicIds,
        ];
      }

      const rawIsPublished = (req.body as Record<string, unknown>)
        .isPublished as unknown;
      if (rawIsPublished === "true" || rawIsPublished === true) {
        payload.isPublished = true;
      } else if (rawIsPublished === "false" || rawIsPublished === false) {
        payload.isPublished = false;
      }

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
