/** Convert a local filesystem path to an /api/assets/ URL for display. */
export function assetUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  // Already an HTTP URL or data URI — use as-is
  if (path.startsWith('http') || path.startsWith('data:') || path.startsWith('/api/')) return path;
  // Extract filename from filesystem path
  const filename = path.split('/').pop() ?? path.split('\\').pop() ?? path;
  return `/api/assets/${encodeURIComponent(filename)}`;
}
