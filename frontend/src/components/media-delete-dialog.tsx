'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  CheckSquare,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  Volume2,
  BookOpen,
  AlertTriangle,
} from 'lucide-react';

export interface MediaDeleteAsset {
  uuid: string;
  mediaType: 'image' | 'audio';
  originalFilename: string;
  fileSize: number;
  url: string;
}

interface UsageRow {
  entity_type: string;
  entity_uuid: string;
  entity_label: string;
  frontend_url: string | null;
}

interface MediaDeleteDialogProps {
  asset: MediaDeleteAsset | null;
  onClose: () => void;
  onDeleted: (uuid: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function typeMeta(entityType: string): { icon: typeof FileText; label: string } {
  switch (entityType) {
    case 'node--study_note':
      return { icon: FileText, label: 'Note' };
    case 'node--flashcard_deck':
      return { icon: Layers, label: 'Deck' };
    case 'node--flashcard':
      return { icon: BookOpen, label: 'Flashcard' };
    case 'node--todo_list':
      return { icon: CheckSquare, label: 'Todo list' };
    default:
      return { icon: FileText, label: entityType };
  }
}

export function MediaDeleteDialog({
  asset,
  onClose,
  onDeleted,
}: MediaDeleteDialogProps) {
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Fetch usage whenever a new asset is selected. Reset state when the
  // dialog closes so the next open starts fresh.
  useEffect(() => {
    if (!asset) {
      setUsage(null);
      setUsageError(null);
      setDeleteError(null);
      setDeleting(false);
      setLoadingUsage(false);
      return;
    }
    let cancelled = false;
    setLoadingUsage(true);
    setUsageError(null);
    setUsage(null);
    fetch(`/api/media/${asset.uuid}/usage`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load usage (HTTP ${res.status})`);
        }
        return (await res.json()) as { data: UsageRow[] };
      })
      .then((body) => {
        if (cancelled) return;
        setUsage(body.data ?? []);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setUsageError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingUsage(false);
      });
    return () => {
      cancelled = true;
    };
  }, [asset]);

  async function handleConfirm() {
    if (!asset) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/media/${asset.uuid}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `Delete failed (HTTP ${res.status})`,
        );
      }
      onDeleted(asset.uuid);
      onClose();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  const open = asset !== null;
  const usageCount = usage?.length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !deleting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Delete this media file?
          </DialogTitle>
        </DialogHeader>

        {asset && (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                {asset.mediaType === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Volume2 className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {asset.originalFilename}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(asset.fileSize)}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {loadingUsage && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Checking where this file is used…
                </div>
              )}

              {usageError && (
                <p className="text-sm text-destructive">{usageError}</p>
              )}

              {usage !== null && !usageError && (
                <>
                  {usageCount === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nothing references this file.
                    </p>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-foreground">
                        Used in {usageCount} {usageCount === 1 ? 'place' : 'places'}:
                      </p>
                      <ul className="flex max-h-48 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border">
                        {usage.map((row) => {
                          const { icon: Icon, label: typeLabel } = typeMeta(row.entity_type);
                          return (
                            <li
                              key={`${row.entity_type}:${row.entity_uuid}`}
                              className="flex items-center gap-2 px-3 py-2"
                            >
                              <Icon
                                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                aria-label={typeLabel}
                              />
                              <span className="min-w-0 flex-1 truncate text-sm">
                                {row.entity_label || `(untitled ${typeLabel.toLowerCase()})`}
                              </span>
                              {row.frontend_url ? (
                                <a
                                  href={row.frontend_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex shrink-0 items-center text-muted-foreground transition-colors hover:text-foreground"
                                  aria-label={`Open ${typeLabel.toLowerCase()} in new tab`}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                      <p className="text-xs text-muted-foreground">
                        These items will be flagged with a missing-media reference. You can fix
                        them later by editing the content and removing the broken reference.
                      </p>
                    </>
                  )}
                </>
              )}
            </div>

            {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={deleting || loadingUsage}
          >
            {deleting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Deleting…
              </>
            ) : (
              'Delete'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
