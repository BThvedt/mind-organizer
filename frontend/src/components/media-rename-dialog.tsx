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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  CheckSquare,
  ExternalLink,
  File as FileIcon,
  FileText,
  Layers,
  Loader2,
  Pencil,
  Sparkles,
  Volume2,
  BookOpen,
} from 'lucide-react';

const DESCRIPTION_MAX_LENGTH = 2000;

export interface MediaRenameAsset {
  uuid: string;
  mediaType: 'image' | 'audio' | 'file';
  originalFilename: string;
  description: string;
  fileSize: number;
  url: string;
}

interface UsageRow {
  entity_type: string;
  entity_uuid: string;
  entity_label: string;
  frontend_url: string | null;
}

interface MediaRenameDialogProps {
  asset: MediaRenameAsset | null;
  onClose: () => void;
  onRenamed: (uuid: string, updates: { originalFilename: string; description: string }) => void;
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

/**
 * Lets the user edit a media asset's display name and short description,
 * with the same "where this is used" context as the delete dialog so they
 * can see who the change will affect (purely metadata — references are by
 * UUID, so this never breaks anything).
 */
export function MediaRenameDialog({
  asset,
  onClose,
  onRenamed,
}: MediaRenameDialogProps) {
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    if (!asset) {
      setUsage(null);
      setUsageError(null);
      setLoadingUsage(false);
      setName('');
      setDescription('');
      setSaveError(null);
      setSaving(false);
      setAiLoading(false);
      setAiError(null);
      return;
    }
    setName(asset.originalFilename);
    setDescription(asset.description);
    setSaveError(null);
    setAiError(null);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!asset) return;
    const trimmedName = name.trim();
    const trimmedDesc = description.trim();
    if (trimmedName === '') return;

    const nameChanged = trimmedName !== asset.originalFilename;
    const descChanged = trimmedDesc !== asset.description;
    if (!nameChanged && !descChanged) {
      onClose();
      return;
    }

    const payload: { originalFilename?: string; description?: string } = {};
    if (nameChanged) payload.originalFilename = trimmedName;
    if (descChanged) payload.description = trimmedDesc;

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/media/${asset.uuid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `Save failed (HTTP ${res.status})`,
        );
      }
      const body = (await res.json()) as {
        data: { originalFilename: string; description: string };
      };
      onRenamed(asset.uuid, {
        originalFilename: body.data?.originalFilename ?? trimmedName,
        description: body.data?.description ?? trimmedDesc,
      });
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleAiGenerate() {
    if (!asset) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch(`/api/media/${asset.uuid}/describe-ai`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `Generation failed (HTTP ${res.status})`,
        );
      }
      const body = (await res.json()) as { data: { description: string } };
      const generated = body.data?.description?.trim() ?? '';
      if (generated === '') {
        throw new Error('AI returned an empty description.');
      }
      setDescription(generated.slice(0, DESCRIPTION_MAX_LENGTH));
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setAiLoading(false);
    }
  }

  const open = asset !== null;
  const usageCount = usage?.length ?? 0;
  const trimmedName = name.trim();
  const trimmedDesc = description.trim();
  const dirty =
    !!asset &&
    trimmedName !== '' &&
    (trimmedName !== asset.originalFilename || trimmedDesc !== asset.description);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Edit media file
          </DialogTitle>
        </DialogHeader>

        {asset && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                {asset.mediaType === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : asset.mediaType === 'audio' ? (
                  <Volume2 className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <FileIcon className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="File name"
                  autoFocus
                  disabled={saving}
                  onFocus={(e) => {
                    const idx = e.currentTarget.value.lastIndexOf('.');
                    if (idx > 0) e.currentTarget.setSelectionRange(0, idx);
                    else e.currentTarget.select();
                  }}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatBytes(asset.fileSize)}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label
                  htmlFor="media-description"
                  className="text-xs font-medium text-foreground"
                >
                  Description{' '}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                {asset.mediaType === 'image' && (
                  <button
                    type="button"
                    onClick={handleAiGenerate}
                    disabled={saving || aiLoading}
                    title="Generate description with AI"
                    aria-label="Generate description with AI"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {aiLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    {aiLoading ? 'Generating…' : 'AI'}
                  </button>
                )}
              </div>
              <Textarea
                id="media-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Notes about this file…"
                rows={3}
                maxLength={DESCRIPTION_MAX_LENGTH}
                disabled={saving}
                className="resize-y text-sm"
              />
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="text-destructive">{aiError ?? ''}</span>
                <span className="tabular-nums">
                  {description.length} / {DESCRIPTION_MAX_LENGTH}
                </span>
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
                        Edits only change metadata. The references in these items use the
                        file&apos;s ID, so they won&apos;t break.
                      </p>
                    </>
                  )}
                </>
              )}
            </div>

            {saveError && <p className="text-sm text-destructive">{saveError}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !dirty}>
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
