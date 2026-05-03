'use client';

import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ShareDialog } from '@/components/share/share-dialog';
import { SHARE_LABELS, type ShareableType } from '@/components/share/share-types';

interface ShareButtonProps {
  type: ShareableType;
  nodeUuid: string;
  isShared: boolean;
  shareToken: string | null;
  /**
   * Visual variant:
   *  - 'iconText'  → icon + "Share" label, fits inline with other action buttons (notes, decks)
   *  - 'icon'      → icon-only, matches the existing destructive icon-button (todos)
   */
  variant?: 'icon' | 'iconText';
  /**
   * Called whenever the parent should refresh its local state with the
   * latest share fields (e.g. after toggling).
   */
  onChange: (next: { isShared: boolean; shareToken: string | null }) => void;
  disabled?: boolean;
  className?: string;
}

interface PatchResponse {
  data?: {
    attributes?: Record<string, unknown>;
  };
}

export function ShareButton({
  type,
  nodeUuid,
  isShared,
  shareToken,
  variant = 'iconText',
  onChange,
  disabled,
  className,
}: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const labels = SHARE_LABELS[type];

  async function patchShare(next: boolean): Promise<{ shareToken: string | null } | null> {
    try {
      const res = await fetch(`${labels.apiBasePath}/${nodeUuid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isShared: next }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as PatchResponse;
      const token = data.data?.attributes
        ? ((data.data.attributes['field_share_token'] as string | null | undefined) ?? null)
        : null;
      onChange({ isShared: next, shareToken: next ? token : null });
      return { shareToken: next ? token : null };
    } catch {
      return null;
    }
  }

  async function handleEnable() {
    return patchShare(true);
  }

  async function handleDisable(): Promise<boolean> {
    const result = await patchShare(false);
    return result !== null;
  }

  const activeIconClass = isShared ? 'text-emerald-600 dark:text-emerald-500' : '';

  return (
    <>
      {variant === 'icon' ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(true)}
          disabled={disabled}
          className={cn(
            isShared
              ? 'text-emerald-600 hover:text-emerald-700 dark:text-emerald-500 dark:hover:text-emerald-400'
              : 'text-muted-foreground hover:text-foreground',
            'shrink-0',
            className,
          )}
          aria-label={isShared ? `Manage sharing for this ${labels.noun}` : `Share this ${labels.noun}`}
        >
          <Share2 className="h-4 w-4" />
          <span className="sr-only">
            {isShared ? `Manage sharing for this ${labels.noun}` : `Share this ${labels.noun}`}
          </span>
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={disabled}
          className={cn(
            isShared &&
              'border-emerald-500/60 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-500/60 dark:text-emerald-400 dark:hover:bg-emerald-950/40',
            className,
          )}
        >
          <Share2 className={cn('h-4 w-4', activeIconClass)} />
          Share
        </Button>
      )}

      <ShareDialog
        open={open}
        onOpenChange={setOpen}
        type={type}
        isShared={isShared}
        shareToken={shareToken}
        onEnable={handleEnable}
        onDisable={handleDisable}
      />
    </>
  );
}
