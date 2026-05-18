'use client';

import { isValidElement, useMemo, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {
  ExternalLink,
  FileArchive,
  FileCode,
  FileX,
  FileSpreadsheet,
  FileText,
  ImageOff,
  Presentation,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { MarkdownPre } from './markdown-pre';
import { MermaidBlock } from './mermaid-block';

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

const FILE_EXT_RE =
  /\.(pdf|txt|md|markdown|csv|docx?|xlsx?|pptx?|odt|ods|odp|json|xml|zip)$/i;

/**
 * True for `/api/media/<uuid>...` links whose extension belongs to a
 * file-class asset (PDFs, spreadsheets, etc.). Image/audio uses the
 * `![]()` embed syntax, not `[]()`, so this only fires on link-shaped
 * markdown that the upload pipeline produced for a file.
 */
function isFileUrl(src: string | undefined): boolean {
  if (!src) return false;
  const noQuery = src.split('?')[0];
  if (!MEDIA_PATH_RE.test(noQuery)) return false;
  return FILE_EXT_RE.test(noQuery);
}

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

function fileIconForUrl(src: string): IconComponent {
  const noQuery = src.split('?')[0].toLowerCase();
  if (/\.(xlsx?|csv|ods)$/.test(noQuery)) return FileSpreadsheet;
  if (/\.(pptx?|odp)$/.test(noQuery)) return Presentation;
  if (/\.(json|xml)$/.test(noQuery)) return FileCode;
  if (/\.zip$/.test(noQuery)) return FileArchive;
  return FileText;
}

function filenameFromUrl(src: string): string {
  const noQuery = src.split('?')[0];
  const tail = noQuery.split('/').pop() ?? '';
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}

/**
 * If `child` is the inner `<code class="language-mermaid">` element of a
 * fenced code block, return its raw text content. Otherwise return null.
 */
function extractMermaidSource(child: ReactElement): string | null {
  const props = child.props as Record<string, unknown> | null | undefined;
  if (!props || typeof props !== 'object') return null;
  const className = props.className;
  if (typeof className !== 'string' || !/\blanguage-mermaid\b/.test(className)) {
    return null;
  }
  const inner = props.children;
  if (typeof inner === 'string') return inner;
  if (Array.isArray(inner)) {
    return inner.map((c) => (typeof c === 'string' ? c : '')).join('');
  }
  return inner == null ? '' : String(inner);
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
      pre: (preProps) => {
        const child = Array.isArray(preProps.children)
          ? preProps.children[0]
          : preProps.children;
        if (isValidElement(child)) {
          const mermaidSource = extractMermaidSource(child);
          if (mermaidSource !== null) {
            return <MermaidBlock source={mermaidSource} />;
          }
        }
        return <MarkdownPre {...preProps} />;
      },
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
      a: ({ href, children, ...rest }) => {
        const hrefStr = typeof href === 'string' ? href : undefined;
        const assetUuid = extractAssetUuid(hrefStr);
        if (assetUuid && brokenSet.has(assetUuid)) {
          // Soft-deleted file — match the audio/image broken treatment but
          // keep the original link text visible so the user knows what
          // went missing.
          const label =
            typeof children === 'string' && children.trim() !== ''
              ? `${children} (deleted)`
              : 'File deleted';
          return (
            <span className="my-2 inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive">
              <FileX className="h-3.5 w-3.5" />
              <span>{label}</span>
            </span>
          );
        }

        if (hrefStr && isFileUrl(hrefStr)) {
          const finalHref = withShareToken(hrefStr) ?? hrefStr;
          const Icon = fileIconForUrl(hrefStr);
          const fallbackName = filenameFromUrl(hrefStr);
          const label =
            typeof children === 'string' && children.trim() !== ''
              ? children
              : fallbackName;
          return (
            <a
              href={finalHref}
              target="_blank"
              rel="noopener noreferrer"
              className="my-3 flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 no-underline transition-colors hover:bg-muted"
            >
              <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">
                  {label}
                </span>
                <span className="text-xs text-muted-foreground">
                  Open in new tab
                </span>
              </span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </a>
          );
        }

        // Default link — apply share-token forwarding when relevant so
        // shared embeds keep working off the public share page.
        const finalHref = withShareToken(hrefStr) ?? hrefStr ?? '';
        return (
          <a {...rest} href={finalHref} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      },
    };
  }, [brokenSet, shareToken]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={components}
    >
      {children}
    </ReactMarkdown>
  );
}
