'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Loader2,
  Paperclip,
  Presentation,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { ALLOWED_FILE_MIMES } from '@/lib/compress-media';
import { useMediaUpload } from '@/hooks/useMediaUpload';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface FileAsset {
  uuid: string;
  originalFilename: string;
  fileSize: number;
  url: string;
}

// ── Attachment-section parsing ────────────────────────────────────────────────
// When the body contains an `<!-- attachments -->` separator, the links below
// it are treated as the authoritative attachment list and displayed directly —
// no API cross-reference needed. This matches the convention in the note editor.
const ATTACHMENTS_SEP = '<!-- attachments -->';
const ATTACH_LINK_RE = /^\[([^\]]+)\]\(([^)]+)\)\s*$/;

interface ParsedLink {
  name: string;
  url: string;
}

/**
 * Parses `[name](url)` lines from the `<!-- attachments -->` section of
 * the body. Returns `null` if the body has no such section (legacy/viewer mode).
 */
function parseAttachmentSection(body: string): ParsedLink[] | null {
  const idx = body.indexOf(ATTACHMENTS_SEP);
  if (idx === -1) return null;
  const section = body.slice(idx + ATTACHMENTS_SEP.length);
  return section
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((l) => {
      const m = ATTACH_LINK_RE.exec(l);
      return m ? [{ name: m[1], url: m[2] }] : [];
    });
}
// ─────────────────────────────────────────────────────────────────────────────

interface AttachmentsMenuProps {
  /** Current markdown body. Parsed for `/api/media/<uuid>` references. */
  body: string;
  /**
   * Called with a fully-formed `[name](url)` markdown snippet that should
   * be appended to the attachments section (or inserted at the cursor —
   * caller's choice). Set to `null` to disable uploading from this menu
   * (viewer-only mode).
   */
  onInsert: ((markdownLink: string) => void) | null;
  /** Called when the user removes an attachment. Receives the markdown
   *  link snippet that should be removed from the body. Optional. */
  onRemove?: (snippet: string) => void;
  /**
   * When provided (and upload is enabled), adds a "Search library…" item
   * below "Upload file…" that opens a media-search dialog in the parent.
   */
  onSearchFile?: () => void;
  className?: string;
}

const MEDIA_REF_RE = /\/api\/media\/([0-9a-f-]{36})(?:\/[^\s)]*)?/gi;

function extOf(filename: string): string {
  return filename.toLowerCase().split('.').pop() ?? '';
}

function iconForFilename(filename: string): IconComponent {
  const ext = extOf(filename);
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return FileSpreadsheet;
  if (['ppt', 'pptx', 'odp'].includes(ext)) return Presentation;
  if (['json', 'xml'].includes(ext)) return FileCode;
  if (ext === 'zip') return FileArchive;
  if (['pdf', 'doc', 'docx', 'odt', 'txt', 'md', 'markdown'].includes(ext)) return FileText;
  return FileIcon;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** All distinct asset UUIDs referenced anywhere in the body. */
function extractReferencedUuids(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(MEDIA_REF_RE)) {
    seen.add(match[1].toLowerCase());
  }
  return Array.from(seen);
}

/**
 * Toolbar button that opens a dropdown listing every file currently
 * attached to (referenced from) the editor body, plus an "Upload file"
 * action that runs the picker through the same upload pipeline as
 * drag-and-drop and inserts a markdown link via the `onInsert` callback.
 *
 * Pass `onInsert={null}` for a viewer-only variant (e.g. todos page,
 * where there's no single body to insert into).
 */
export function AttachmentsMenu({
  body,
  onInsert,
  onRemove,
  onSearchFile,
  className,
}: AttachmentsMenuProps) {
  const [open, setOpen] = useState(false);
  const [allFiles, setAllFiles] = useState<FileAsset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { upload } = useMediaUpload();

  // Parse the attachment section directly from the body. When this returns
  // a non-null array, it is used as the authoritative attached-files list
  // (the API cross-reference below is used only for fileSize enrichment).
  const parsedAttachments = useMemo(() => parseAttachmentSection(body), [body]);
  const hasAttachmentSection = parsedAttachments !== null;

  // Lazily fetch the user's file list when the menu opens. In attachment-section
  // mode this is used only to enrich file sizes; in legacy mode it drives the
  // displayed list via the cross-reference below.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/media?type=file')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load files (HTTP ${res.status})`);
        return (await res.json()) as { data: FileAsset[] };
      })
      .then((bodyJson) => {
        if (!cancelled) setAllFiles(bodyJson.data ?? []);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const referencedUuids = useMemo(() => extractReferencedUuids(body), [body]);

  // Legacy mode: cross-reference body UUIDs against the user's file library
  // (image/audio refs are silently filtered out). Not used when the body has
  // an `<!-- attachments -->` section.
  const legacyAttached = useMemo<FileAsset[]>(() => {
    if (hasAttachmentSection || !allFiles) return [];
    const byUuid = new Map(allFiles.map((f) => [f.uuid.toLowerCase(), f]));
    return referencedUuids
      .map((uuid) => byUuid.get(uuid))
      .filter((f): f is FileAsset => f !== undefined);
  }, [hasAttachmentSection, allFiles, referencedUuids]);

  // Build a URL → fileSize map from the API response for enriching the
  // attachment-section list (best-effort; no fileSize shown while loading).
  const fileSizeByUrl = useMemo<Map<string, number>>(() => {
    if (!allFiles) return new Map();
    return new Map(allFiles.map((f) => [f.url, f.fileSize]));
  }, [allFiles]);

  // For the badge count: prefer the parsed section length; fall back to the
  // legacy cross-reference count.
  const attachCount = hasAttachmentSection
    ? parsedAttachments.length
    : legacyAttached.length;

  const acceptAttr = useMemo(() => ALLOWED_FILE_MIMES.join(',') + ',.zip', []);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || !onInsert) return;
      setUploadError(null);
      setUploadingCount((n) => n + files.length);
      for (const file of Array.from(files)) {
        try {
          const uploaded = await upload(file);
          onInsert(`[${file.name}](${uploaded.url})`);
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : 'Upload failed.');
        } finally {
          setUploadingCount((n) => Math.max(0, n - 1));
        }
      }
    },
    [onInsert, upload],
  );

  function handleRemove(name: string, url: string) {
    if (!onRemove) return;
    onRemove(`[${name}](${url})`);
  }

  const showUpload = onInsert !== null;

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className={className}
              title="Attachments"
            >
              {uploadingCount > 0 ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">Attach</span>
              {attachCount > 0 && (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium tabular-nums text-muted-foreground">
                  {attachCount}
                </span>
              )}
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-72 max-h-96 overflow-y-auto">
          {showUpload && (
            <>
              <DropdownMenuItem
                onClick={() => {
                  // base-ui auto-closes the menu on click; the file input
                  // is a sibling of the dropdown, so it survives the close
                  // and the picker opens after the click handler returns.
                  fileInputRef.current?.click();
                }}
                className="flex items-center gap-2"
              >
                <Upload className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Upload file…</span>
              </DropdownMenuItem>
              {onSearchFile && (
                <DropdownMenuItem
                  onClick={() => onSearchFile()}
                  className="flex items-center gap-2"
                >
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Search library…</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}

          {uploadError && (
            <p className="px-3 py-1.5 text-xs text-destructive">{uploadError}</p>
          )}

          {/* ── Attachment-section mode (notes) ──────────────────────── */}
          {hasAttachmentSection && parsedAttachments.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No files attached yet.
            </p>
          )}

          {hasAttachmentSection && parsedAttachments.length > 0 && (
            <ul className="flex flex-col">
              {parsedAttachments.map(({ name, url }) => {
                const Icon = iconForFilename(name);
                const fileSize = fileSizeByUrl.get(url);
                return (
                  <li
                    key={url}
                    className="group flex items-center gap-2 px-2 py-1.5"
                  >
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-muted"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate" title={name}>
                        {name}
                      </span>
                      {fileSize !== undefined && (
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                          {formatBytes(fileSize)}
                        </span>
                      )}
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </a>
                    {onRemove && (
                      <button
                        type="button"
                        onClick={() => handleRemove(name, url)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        aria-label={`Remove ${name} from this entry`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* ── Legacy mode (decks, todos — no attachment section) ───── */}
          {!hasAttachmentSection && loading && (
            <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading files…
            </p>
          )}

          {!hasAttachmentSection && !loading && error && (
            <p className="px-3 py-2 text-xs text-destructive">{error}</p>
          )}

          {!hasAttachmentSection && !loading && !error && legacyAttached.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No files attached yet.
            </p>
          )}

          {!hasAttachmentSection && !loading && !error && legacyAttached.length > 0 && (
            <ul className="flex flex-col">
              {legacyAttached.map((asset) => {
                const Icon = iconForFilename(asset.originalFilename);
                return (
                  <li
                    key={asset.uuid}
                    className="group flex items-center gap-2 px-2 py-1.5"
                  >
                    <a
                      href={asset.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-muted"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate" title={asset.originalFilename}>
                        {asset.originalFilename}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                        {formatBytes(asset.fileSize)}
                      </span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </a>
                    {onRemove && (
                      <button
                        type="button"
                        onClick={() => handleRemove(asset.originalFilename, asset.url)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        aria-label={`Remove ${asset.originalFilename} from this entry`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {showUpload && (
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptAttr}
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files);
            // Reset so picking the same file twice still triggers onChange.
            e.target.value = '';
          }}
        />
      )}
    </>
  );
}
