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

interface AttachmentsMenuProps {
  /** Current markdown body. Parsed for `/api/media/<uuid>` references. */
  body: string;
  /**
   * Called with a fully-formed `[name](url)` markdown snippet that should
   * be inserted at the cursor (or appended to the body — caller's choice).
   * Set to `null` to disable uploading from this menu (viewer-only mode).
   */
  onInsert: ((markdownLink: string) => void) | null;
  /** Called when the user removes an attachment. Receives the markdown
   *  link snippet that should be removed from the body. Optional. */
  onRemove?: (snippet: string) => void;
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

  // Lazily fetch the user's file list the first time the menu is opened,
  // and refresh on every reopen so newly-attached uploads appear.
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

  // Cross-reference body UUIDs against the user's file library to find
  // file-class attachments (image/audio refs are silently filtered out).
  const attached = useMemo<FileAsset[]>(() => {
    if (!allFiles) return [];
    const byUuid = new Map(allFiles.map((f) => [f.uuid.toLowerCase(), f]));
    return referencedUuids
      .map((uuid) => byUuid.get(uuid))
      .filter((f): f is FileAsset => f !== undefined);
  }, [allFiles, referencedUuids]);

  const acceptAttr = useMemo(() => ALLOWED_FILE_MIMES.join(','), []);

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
      // Force the file refetch on next open by clearing the cache.
      setAllFiles(null);
    },
    [onInsert, upload],
  );

  function handleRemove(asset: FileAsset) {
    if (!onRemove) return;
    onRemove(`[${asset.originalFilename}](${asset.url})`);
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
              {attached.length > 0 && (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium tabular-nums text-muted-foreground">
                  {attached.length}
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
              <DropdownMenuSeparator />
            </>
          )}

          {uploadError && (
            <p className="px-3 py-1.5 text-xs text-destructive">{uploadError}</p>
          )}

          {loading && (
            <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading files…
            </p>
          )}

          {!loading && error && (
            <p className="px-3 py-2 text-xs text-destructive">{error}</p>
          )}

          {!loading && !error && attached.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No files attached yet.
            </p>
          )}

          {!loading && !error && attached.length > 0 && (
            <ul className="flex flex-col">
              {attached.map((asset) => {
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
                        onClick={() => handleRemove(asset)}
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
