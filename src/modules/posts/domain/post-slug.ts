import { randomUUID } from "crypto";
import slugify from "slugify";

export function generateBaseSlug(title: string): string {
  const normalizedTitle = title.trim();

  if (!normalizedTitle) {
    return "";
  }

  return slugify(normalizedTitle, {
    lower: true,
    strict: true,
    trim: true,
  });
}

export function generateUniqueSlug(title: string): string {
  const baseSlug = generateBaseSlug(title);

  if (!baseSlug) {
    return "";
  }

  return `${baseSlug}-${randomUUID()}`;
}
