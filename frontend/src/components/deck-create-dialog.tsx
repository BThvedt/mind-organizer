'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AreaSubjectSelector } from '@/components/area-subject-selector';
import { Plus } from 'lucide-react';

interface DeckCreateDialogProps {
  onCreated: () => void;
}

export function DeckCreateDialog({ onCreated }: DeckCreateDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [areaUuid, setAreaUuid] = useState('');
  const [subjectUuid, setSubjectUuid] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [queued, setQueued] = useState(false);

  const reset = () => {
    setTitle('');
    setDescription('');
    setAreaUuid('');
    setSubjectUuid('');
    setError('');
    setQueued(false);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setSaving(true);
    setError('');

    try {
      const res = await Promise.race([
        fetch('/api/decks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || undefined,
            areaUuid: areaUuid || undefined,
            subjectUuid: subjectUuid || undefined,
          }),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 8000),
        ),
      ]);

      if (!res.ok) {
        try {
          const data = await res.json();
          setError(data.error ?? 'Failed to create deck.');
        } catch {
          setQueued(true);
        }
        return;
      }

      const data = await res.json();
      if (data.queued) {
        setQueued(true);
        return;
      }

      setOpen(false);
      reset();
      onCreated();
    } catch {
      setQueued(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="h-4 w-4" />
            New deck
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create a new deck</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="deck-title">Title *</Label>
              <Input
                id="deck-title"
                placeholder="e.g. Biology Fundamentals"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="deck-desc">Description</Label>
              <Textarea
                id="deck-desc"
                placeholder="What is this deck about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <AreaSubjectSelector
              areaUuid={areaUuid}
              subjectUuid={subjectUuid}
              onAreaChange={setAreaUuid}
              onSubjectChange={setSubjectUuid}
              layout="col"
            />

            {error && <p className="text-sm text-destructive">{error}</p>}
            {queued && (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-200">
                Deck saved offline. It will appear once you reconnect.
              </div>
            )}
          </div>

          <DialogFooter showCloseButton>
            {queued ? (
              <Button type="button" onClick={() => { setOpen(false); reset(); }}>
                Done
              </Button>
            ) : (
              <Button type="submit" disabled={saving}>
                {saving ? 'Creating…' : 'Create deck'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
