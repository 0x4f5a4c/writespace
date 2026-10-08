export function generateExcerpt(content: string, maxLength = 150): string {
  const normalizedContent = content.trim();

  if (!normalizedContent) {
    return "";
  }

  if (normalizedContent.length <= maxLength) {
    return normalizedContent;
  }

  return `${normalizedContent.substring(0, maxLength).trimEnd()}...`;
}

export function calculateReadTime(
  content: string,
  wordsPerMinute = 200,
): number {
  const normalizedContent = content.trim();

  if (!normalizedContent) {
    return 0;
  }

  const wordCount = normalizedContent.split(/\s+/).length;

  return Math.ceil(wordCount / wordsPerMinute);
}
