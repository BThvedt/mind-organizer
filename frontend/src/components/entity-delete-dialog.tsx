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
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle, File as FileIcon, Loader2, Volume2 } from 'lucide-react';

export type EntityKind = 'note' | 'deck' | 'todo_list';

interface ExclusiveAsset {
  uuid: string;
  mediaType: 'image' | 'audio' | 'file';
  originalFilename: string;
  fileSize: number;
  url: string;
}

export interface EntityDeleteConfirmOptions {
  deleteOrphanMedia: boolean;
  exclusiveUuids: string[];
}

interface EntityDeleteDialogProps {
  open: boolean;
  kind: EntityKind;
  entityUuid: string;
  /** Heading inside the dialog, e.g. "Delete this note?". */
  title: string;
  /** Short prompt under the title, e.g. "This action cannot be undone.". */
  description?: string;
  /** Set true while the parent is performing the delete network call. */
  deleting: boolean;
  /** Optional error message rendered inside the dialog footer area. */
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: (opts: EntityDeleteConfirmOptions) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Reusable destructive confirmation dialog for top-level entities (note,
 * deck, todo list).
 *
 * On open, fetches the list of media files referenced ONLY by this entity.
 * If any exist, shows an opt-in checkbox to soft-delete them too — keeping
 * the user's S3 storage tidy without forcing them through the media page.
 */
export function EntityDeleteDialog({
  open,
  kind,
  entityUuid,
  title,
  description,
  deleting,
  errorMessage,
  onCancel,
  onConfirm,
}: EntityDeleteDialogProps) {
  const [exclusive, setExclusive] = useState<ExclusiveAsset[] | null>(null);
  const [exclusiveError, setExclusiveError] = useState<string | null>(null);
  const [loadingExclusive, setLoadingExclusive] = useState(false);
  const [deleteOrphanMedia, setDeleteOrphanMedia] = useState(false);

  useEffect(() => {
    if (!open) {
      setExclusive(null);
      setExclusiveError(null);
      setLoadingExclusive(false);
      setDeleteOrphanMedia(false);
      return;
    }
    let cancelled = false;
    setLoadingExclusive(true);
    setExclusive(null);
    setExclusiveError(null);
    fetch(`/api/media/exclusive-for/${kind}/${entityUuid}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to check media usage (HTTP ${res.status})`);
        }
        return (await res.json()) as { data: ExclusiveAsset[] };
      })
      .then((body) => {
        if (cancelled) return;
        setExclusive(body.data ?? []);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setExclusiveError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingExclusive(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, kind, entityUuid]);

  function handleConfirm() {
    onConfirm({
      deleteOrphanMedia: deleteOrphanMedia && (exclusive?.length ?? 0) > 0,
      exclusiveUuids: deleteOrphanMedia ? (exclusive ?? []).map((a) => a.uuid) : [],
    });
  }

  const exclusiveCount = exclusive?.length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !deleting) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            {title}
          </DialogTitle>
        </DialogHeader>

        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}

        {loadingExclusive && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking for media files only used here…
          </div>
        )}

        {exclusiveError && (
          <p className="text-sm text-destructive">{exclusiveError}</p>
        )}

        {exclusive !== null && !exclusiveError && exclusiveCount > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
            <label className="flex cursor-pointer items-start gap-2.5">
              <Checkbox
                checked={deleteOrphanMedia}
                onCheckedChange={(v) => setDeleteOrphanMedia(v === true)}
                disabled={deleting}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  Also delete {exclusiveCount} media{' '}
                  {exclusiveCount === 1 ? 'file' : 'files'} only used here
                </span>
                <span className="text-xs text-muted-foreground">
                  These files will be removed from storage. If unchecked, they&apos;ll
                  remain in your media library.
                </span>
              </span>
            </label>

            <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto pl-6">
              {exclusive.map((asset) => (
                <li
                  key={asset.uuid}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                    {asset.mediaType === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={asset.url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : asset.mediaType === 'audio' ? (
                      <Volume2 className="h-3 w-3" />
                    ) : (
                      <FileIcon className="h-3 w-3" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={asset.originalFilename}>
                    {asset.originalFilename}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatBytes(asset.fileSize)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={deleting || loadingExclusive}
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
