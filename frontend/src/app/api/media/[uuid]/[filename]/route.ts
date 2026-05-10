import { NextRequest } from 'next/server';
import { streamMediaFromDrupal } from '@/lib/media-proxy';

/**
 * GET /api/media/[uuid]/[filename]
 *
 * Canonical media-stream URL. The trailing `[filename]` is cosmetic — it
 * exists so the markdown renderer can detect audio assets via file
 * extension (`.mp3`, `.wav`, …) and so DevTools / direct downloads land
 * with a meaningful filename. The proxy ignores it; only the uuid is
 * used to fetch the underlying object from Drupal.
 *
 * DELETE does NOT live here — soft-deletion goes through `/api/media/[uuid]`
 * (the canonical entity URL), since deletion is per-asset, not per-URL.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string; filename: string }> }
) {
  const { uuid } = await params;
  return streamMediaFromDrupal(request, uuid);
}
