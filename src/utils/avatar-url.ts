/** Public URL path segment for stored avatar files (served under /api/public/avatars). */
export function buildAvatarUrl(avatarFileName: string | null | undefined): string | null {
  if (!avatarFileName) return null;
  return `/api/public/avatars/${avatarFileName}`;
}
