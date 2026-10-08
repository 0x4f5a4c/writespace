import { eq, and, desc, lt, SQL, inArray, sql } from "drizzle-orm";
import { db } from "../../../db";
import { posts, postReactions, users, follows } from "../../../db/schema";
import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

class PostQueryService {
  public async getPost(postId: string, requesterId?: string) {
    const selectFields = {
      post: posts,
      authorUsername: users.username,
      authorProfileImage: users.profileImageUrl,
      authorFullname: users.fullname,

      ...(requesterId
        ? {
            isLikedByMe: sql<boolean>`
              exists(
                select 1
                from ${postReactions}
                where ${postReactions.postId} = ${posts.id}
                  and ${postReactions.userId} = ${requesterId}
                  and ${postReactions.reactionType} = 'like'
              )
            `.mapWith(Boolean),
          }
        : {}),
    };

    const [row] = await db
      .select(selectFields)
      .from(posts)
      .leftJoin(users, eq(posts.authorId, users.id))
      .where(eq(posts.id, postId))
      .limit(1);

    if (!row) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    const isOwner = requesterId === row.post.authorId;

    if (!isOwner && row.post.status !== "published") {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    return {
      ...row.post,

      isLikedByMe: "isLikedByMe" in row ? !!row.isLikedByMe : false,

      author: {
        id: row.post.authorId,
        username: row.authorUsername,
        fullname: row.authorFullname,
        profileImageUrl: row.authorProfileImage,
      },
    };
  }

  public async getPosts(
    limit: number,
    cursor?: string,
    requesterId?: string,
    authorIdFilter?: string,
  ) {
    const selectFields = {
      id: posts.id,
      title: posts.title,
      slug: posts.slug,
      subtitle: posts.subtitle,
      content: posts.content,
      excerpt: posts.excerpt,
      media: posts.media,
      codeSnippets: posts.codeSnippets,
      coverImageUrl: posts.coverImageUrl,
      coverImageAltText: posts.coverImageAltText,
      tags: posts.tags,
      authorId: posts.authorId,
      status: posts.status,
      publishDate: posts.publishDate,
      viewCount: posts.viewCount,
      likeCount: posts.likeCount,
      commentCount: posts.commentCount,
      shareCount: posts.shareCount,
      readTime: posts.readTime,
      createdAt: posts.createdAt,

      authorUsername: users.username,
      authorProfileImage: users.profileImageUrl,
      authorFullname: users.fullname,

      ...(requesterId
        ? {
            isLikedByMe: sql<boolean>`
                exists(
                  select 1
                  from ${postReactions}
                  where ${postReactions.postId} = ${posts.id}
                  and ${postReactions.userId} = ${requesterId}
                  and ${postReactions.reactionType} = 'like'
                )
              `.mapWith(Boolean),
          }
        : {}),
    };

    const conditions: SQL<unknown>[] = [eq(posts.status, "published")];

    if (cursor) {
      conditions.push(lt(posts.publishDate, new Date(cursor)));
    }

    if (authorIdFilter) {
      conditions.push(eq(posts.authorId, authorIdFilter));
    }

    const postsResult = await db
      .select(selectFields)
      .from(posts)
      .leftJoin(users, eq(posts.authorId, users.id))
      .where(and(...conditions))
      .orderBy(desc(posts.publishDate))
      .limit(limit);

    let followedAuthorIds = new Set<string>();

    if (requesterId && postsResult.length > 0) {
      const authorIds = [
        ...new Set(postsResult.map((row) => row.authorId)),
      ].filter(Boolean) as string[];

      if (authorIds.length > 0) {
        const userFollows = await db
          .select({
            followingId: follows.followingId,
          })
          .from(follows)
          .where(
            and(
              eq(follows.followerId, requesterId),
              inArray(follows.followingId, authorIds),
            ),
          );

        followedAuthorIds = new Set(
          userFollows.map((follow) => follow.followingId),
        );
      }
    }

    let nextCursor: string | null = null;

    if (postsResult.length === limit) {
      const lastPost = postsResult[postsResult.length - 1];

      if (lastPost.publishDate) {
        nextCursor = lastPost.publishDate.toISOString();
      }
    }

    const formattedPosts = postsResult.map((row) => {
      const { authorUsername, authorProfileImage, authorFullname, ...post } =
        row;

      return {
        ...post,

        isLikedByMe: "isLikedByMe" in row ? !!row.isLikedByMe : false,

        author: {
          id: post.authorId,
          username: authorUsername,
          fullname: authorFullname,
          profileImageUrl: authorProfileImage,
          isFollowingByMe: followedAuthorIds.has(post.authorId),
        },
      };
    });

    return {
      posts: formattedPosts,
      nextCursor,
    };
  }
}

export const postQueryService = new PostQueryService();
