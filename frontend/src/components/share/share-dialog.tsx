'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Copy, ExternalLink, Lock, Share2 } from 'lucide-react';
import {
  SHARE_LABELS,
  publicShareUrl,
  type ShareableType,
} from '@/components/share/share-types';

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: ShareableType;
  isShared: boolean;
  shareToken: string | null;
  onEnable: () => Promise<{ shareToken: string | null } | null>;
  onDisable: () => Promise<boolean>;
}

export function ShareDialog({
  open,
  onOpenChange,
  type,
  isShared,
  shareToken,
  onEnable,
  onDisable,
}: ShareDialogProps) {
  const labels = SHARE_LABELS[type];

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Reset transient UI state whenever the dialog opens or the shared state
  // flips, so a re-share cleanly shows the new URL state.
  useEffect(() => {
    if (open) {
      setError('');
      setCopied(false);
    }
  }, [open, isShared]);

  const url = isShared && shareToken ? publicShareUrl(type, shareToken) : '';

  async function handleEnable() {
    setSubmitting(true);
    setError('');
    try {
      const result = await onEnable();
      if (!result) {
        setError(`Failed to share this ${labels.noun}. Please try again.`);
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisable() {
    setSubmitting(true);
    setError('');
    try {
      const ok = await onDisable();
      if (!ok) {
        setError(`Failed to make this ${labels.noun} private. Please try again.`);
        return;
      }
      onOpenChange(false);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not access the clipboard. Copy the link manually.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {isShared && shareToken ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Share2 className="h-4 w-4 text-emerald-600" />
                This {labels.noun} is shared
              </DialogTitle>
              <DialogDescription>
                Anyone with this link can {labels.publicVerbDescription}. Make it
                private to invalidate the link.
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center gap-2">
              <Input
                value={url}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={handleCopy}
                aria-label="Copy share link"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                nativeButton={false}
                render={<a href={url} target="_blank" rel="noopener noreferrer" />}
                aria-label="Open share link in a new tab"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Close
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDisable}
                disabled={submitting}
              >
                <Lock className="h-4 w-4" />
                {submitting ? 'Working…' : 'Make private'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Share2 className="h-4 w-4" />
                Share this {labels.noun}?
              </DialogTitle>
              <DialogDescription>
                A public link will be generated. Anyone with the link can{' '}
                {labels.publicVerbDescription}. You can revoke access at any time.
              </DialogDescription>
            </DialogHeader>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleEnable}
                disabled={submitting}
              >
                <Share2 className="h-4 w-4" />
                {submitting ? 'Sharing…' : 'Share'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
