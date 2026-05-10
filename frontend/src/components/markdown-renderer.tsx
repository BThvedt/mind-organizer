'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ImageOff } from 'lucide-react';
import { MarkdownPre } from './markdown-pre';

interface MarkdownRendererProps {
  children: string;
  /**
   * Soft-deleted asset uuids. When the markdown contains
   * `/api/media/<uuid>` for one of these, we render a "file deleted"
   * placeholder instead of the broken image/audio.
   */
  brokenUuids?: ReadonlySet<string> | string[];
  /**
   * Optional share token. When set, every `/api/media/<uuid>` URL gets
   * `?share_token=<token>` appended so the public share page can load
   * embedded media.
   */
  shareToken?: string | null;
}

const MEDIA_PATH_RE = /\/api\/media\/([0-9a-f-]{36})/i;

function extractAssetUuid(src: string | undefined): string | null {
  if (!src) return null;
  const m = src.match(MEDIA_PATH_RE);
  return m ? m[1].toLowerCase() : null;
}

function isAudioUrl(src: string | undefined): boolean {
  if (!src) return false;
  const noQuery = src.split('?')[0];
  return /\.(mp3|ogg|wav|m4a|aac)$/i.test(noQuery);
}

export function MarkdownRenderer({
  children,
  brokenUuids,
  shareToken,
}: MarkdownRendererProps) {
  const brokenSet = useMemo<ReadonlySet<string>>(() => {
    if (!brokenUuids) return new Set();
    if (brokenUuids instanceof Set) return brokenUuids;
    return new Set(Array.from(brokenUuids).map((u) => u.toLowerCase()));
  }, [brokenUuids]);

  const components = useMemo<React.ComponentProps<typeof ReactMarkdown>['components']>(() => {
    function withShareToken(src: string | undefined): string | undefined {
      if (!src || !shareToken) return src;
      if (!MEDIA_PATH_RE.test(src)) return src;
      const sep = src.includes('?') ? '&' : '?';
      return `${src}${sep}share_token=${encodeURIComponent(shareToken)}`;
    }

    return {
      pre: MarkdownPre,
      img: ({ src, alt }) => {
        const srcStr = typeof src === 'string' ? src : undefined;
        const assetUuid = extractAssetUuid(srcStr);
        if (assetUuid && brokenSet.has(assetUuid)) {
          return (
            <span className="my-2 inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive">
              <ImageOff className="h-3.5 w-3.5" />
              <span>{alt ? `${alt} (deleted)` : 'Media deleted'}</span>
            </span>
          );
        }
        const finalSrc = withShareToken(srcStr);
        if (isAudioUrl(srcStr)) {
          return (
            <span className="my-3 block rounded-lg border border-border bg-muted/40 px-4 py-3">
              {alt ? (
                <span className="mb-1 block text-xs text-muted-foreground">{alt}</span>
              ) : null}
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls src={finalSrc ?? undefined} className="h-8 w-full" />
            </span>
          );
        }
        // Plain image. Use a regular <img> (not next/image) since markdown
        // bodies can reference user-uploaded files of unknown dimensions.
        // eslint-disable-next-line @next/next/no-img-element
        return (
          <img
            src={finalSrc ?? undefined}
            alt={alt ?? ''}
            className="max-w-full rounded-md"
          />
        );
      },
    };
  }, [brokenSet, shareToken]);

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
