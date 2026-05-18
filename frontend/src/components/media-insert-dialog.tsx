'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  File as FileIcon,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Presentation,
  Search,
  Sigma,
  Volume2,
  X,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { cn } from '@/lib/utils';
import {
  SESSION_EXPIRED_MESSAGE,
  SEARCH_HTTP_FALLBACK_MESSAGE,
  messageWhenSearchRequestThrows,
  userFacingMessageForApiError,
} from '@/lib/api-client-messages';
import { MathEquationEditor } from './math-equation-editor';

/**
 * The asset-search panel handles images/audio/files. Math is a fourth
 * insert "kind" that doesn't come from the media library — it's
 * authored on the fly with a visual equation editor and emitted as
 * inline or block LaTeX.
 */
export type InsertablePanel = 'image' | 'audio' | 'file' | 'math';
export type InsertableMediaType = 'image' | 'audio' | 'file';

export interface InsertableAsset {
  uuid: string;
  mediaType: InsertableMediaType;
  mimeType: string;
  originalFilename: string;
  description: string;
  fileSize: number;
  url: string;
}

/**
 * Discriminated payload returned to the caller when the user picks
 * something. Existing media flows receive `kind: 'asset'`; the math
 * panel returns `kind: 'math'` with the raw LaTeX and the chosen
 * delimiter style.
 */
export type InsertPayload =
  | { kind: 'asset'; asset: InsertableAsset }
  | { kind: 'math'; latex: string; display: 'inline' | 'block' };

interface MediaInsertDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (payload: InsertPayload) => void;
  /** Initial pill selection. Defaults to 'image'. */
  initialType?: InsertablePanel;
}

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Picks a Lucide icon based on the filename extension. Mirrors the
 * helper in `dashboard/files/page.tsx` so the picker visually matches
 * the Files management view.
 */
function iconForFilename(filename: string): IconComponent {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return FileSpreadsheet;
  if (['ppt', 'pptx', 'odp'].includes(ext)) return Presentation;
  if (['json', 'xml'].includes(ext)) return FileCode;
  if (ext === 'zip') return FileArchive;
  if (['pdf', 'doc', 'docx', 'odt', 'txt', 'md', 'markdown'].includes(ext)) return FileText;
  return FileIcon;
}

const TYPE_PILLS: Array<{ id: InsertablePanel; label: string }> = [
  { id: 'image', label: 'Images' },
  { id: 'audio', label: 'Audio' },
  { id: 'file', label: 'Files' },
  { id: 'math', label: 'Math' },
];

/**
 * Picker that searches the user's already-uploaded media (images, audio
 * files, document files) by filename / description and lets them insert
 * a markdown reference into the active editor.
 *
 * Mirrors the visual + interaction patterns of `SearchDialog` (custom
 * fixed overlay, debounced 300 ms search, escape-to-close, scrollable
 * result list). Differs in scope: only the current user's media, no
 * taxonomy filters, type toggle is mode-exclusive (no "All") since
 * previews differ per asset class.
 *
 * Backend: `GET /api/media/search?q=&type=` (see
 * `MediaFunctionalityController::searchAssets`).
 */
export function MediaInsertDialog({
  open,
  onClose,
  onSelect,
  initialType = 'image',
}: MediaInsertDialogProps) {
  const [query, setQuery] = useState('');
  const [activeType, setActiveType] = useState<InsertablePanel>(initialType);
  const [results, setResults] = useState<InsertableAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMath = activeType === 'math';

  // Focus input on open; reset everything on close.
  useEffect(() => {
    if (open) {
      setActiveType(initialType);
      if (initialType !== 'math') {
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    } else {
      setQuery('');
      setResults([]);
      setSearched(false);
      setSearchError('');
    }
  }, [open, initialType]);

  const doSearch = useCallback(
    (q: string, type: InsertableMediaType) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (q.length < 2) {
        setResults([]);
        setSearched(false);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        setLoading(true);
        setSearchError('');
        try {
          const params = new URLSearchParams({ q, type });
          const res = await Promise.race([
            fetch(`/api/media/search?${params}`),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), 5000),
            ),
          ]);
          if (res.ok) {
            const data = (await res.json()) as { data: InsertableAsset[] };
            setResults(data.data ?? []);
          } else {
            const data = await res.json().catch(() => ({}));
            setResults([]);
            setSearchError(
              userFacingMessageForApiError(
                res,
                data,
                SEARCH_HTTP_FALLBACK_MESSAGE,
              ),
            );
          }
        } catch {
          setResults([]);
          setSearchError(messageWhenSearchRequestThrows());
        } finally {
          setLoading(false);
          setSearched(true);
        }
      }, 300);
    },
    [],
  );

  // Re-search whenever the query or active type changes (and on open
  // restore from a stale state). The math panel doesn't hit the asset
  // search API, so skip it there.
  useEffect(() => {
    if (!open) return;
    if (activeType === 'math') {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return;
    }
    doSearch(query, activeType);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, query, activeType, doSearch]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  function handleSelect(asset: InsertableAsset) {
    onSelect({ kind: 'asset', asset });
    onClose();
  }

  function handleMathInsert(latex: string, display: 'inline' | 'block') {
    onSelect({ kind: 'math', latex, display });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-xl rounded-xl border border-border bg-popover shadow-xl overflow-hidden flex flex-col max-h-[70vh]">
        {/* Search input row — hidden when authoring an equation */}
        {!isMath && (
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            {loading ? (
              <Loader2 className="h-4 w-4 text-muted-foreground shrink-0 animate-spin" />
            ) : (
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${activeType === 'file' ? 'files' : activeType === 'audio' ? 'audio' : 'images'} by name…`}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {query ? (
              <button
                onClick={() => setQuery('')}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <kbd className="hidden sm:inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 text-[10px] text-muted-foreground font-mono">
                Esc
              </kbd>
            )}
          </div>
        )}

        {/* Math header — replaces the search row when the math pill is active */}
        {isMath && (
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Sigma className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="flex-1 text-sm font-medium text-foreground">
              Insert math equation
            </span>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Type toggle */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
          <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs bg-background">
            {TYPE_PILLS.map((pill) => (
              <button
                key={pill.id}
                onClick={() => setActiveType(pill.id)}
                className={cn(
                  'px-2.5 py-1 transition-colors',
                  activeType === pill.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body — either the asset list or the math editor */}
        <div className="flex-1 overflow-y-auto">
          {isMath ? (
            <MathEquationEditor onInsert={handleMathInsert} onCancel={onClose} />
          ) : (
            <>
              {!searched && !loading && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  Type at least 2 characters to search your {activeType === 'file' ? 'files' : activeType === 'audio' ? 'audio' : 'images'}.
                </p>
              )}

              {searchError && !loading && (
                <div
                  className={cn(
                    'flex flex-col items-center gap-2 py-12 text-center text-sm',
                    searchError === SESSION_EXPIRED_MESSAGE
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                  )}
                >
                  <p>{searchError}</p>
                </div>
              )}

              {!searchError && searched && results.length === 0 && !loading && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No results for{' '}
                  <span className="font-medium text-foreground">&quot;{query}&quot;</span>
                </p>
              )}

              {results.length > 0 && (
                <ul className="py-1">
                  {results.map((asset) => (
                    <li key={asset.uuid}>
                      <button
                        type="button"
                        onClick={() => handleSelect(asset)}
                        className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50 focus:bg-muted/50 focus:outline-none"
                      >
                        <AssetThumbnail asset={asset} />
                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate text-sm font-medium text-foreground"
                            title={asset.originalFilename}
                          >
                            {asset.originalFilename}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatBytes(asset.fileSize)}
                            {asset.description ? ` \u00B7 ${asset.description}` : ''}
                          </p>
                        </div>
                        <span className="shrink-0 self-center text-xs text-muted-foreground">
                          Insert
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AssetThumbnail({ asset }: { asset: InsertableAsset }) {
  if (asset.mediaType === 'image') {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.url}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </span>
    );
  }
  if (asset.mediaType === 'audio') {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
        <Volume2 className="h-4 w-4 text-muted-foreground" />
      </span>
    );
  }
  const Icon = iconForFilename(asset.originalFilename);
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
      <Icon className="h-4 w-4 text-muted-foreground" />
    </span>
  );
}

// Re-export ImageIcon for callers that want a matching trigger icon
// without re-importing lucide-react themselves.
export { ImageIcon as InsertTriggerIcon };
