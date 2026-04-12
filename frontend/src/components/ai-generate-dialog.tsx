'use client';

import { useState, useRef } from 'react';
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
import { Sparkles, Loader2, ChevronLeft, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { cn } from '@/lib/utils';

interface Candidate {
  front: string;
  back: string;
}

interface EditableCandidate extends Candidate {
  selected: boolean;
}

interface AiGenerateDialogProps {
  deckId: string;
  onSaved: () => void;
  existingCards?: { front: string; back: string }[];
}

export function AiGenerateDialog({ deckId, onSaved, existingCards = [] }: AiGenerateDialogProps) {
  const limitInputRef = useRef<HTMLInputElement>(null);
  const { isOnline } = useOnlineStatus();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'prompt' | 'review'>('prompt');

  // Step 1
  const [prompt, setPrompt] = useState('');
  const [limitValue, setLimitValue] = useState(5);
  const [isAuto, setIsAuto] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  // Step 2
  const [candidates, setCandidates] = useState<EditableCandidate[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  function reset() {
    setStep('prompt');
    setPrompt('');
    setLimitValue(5);
    setIsAuto(false);
    setGenerating(false);
    setGenError('');
    setCandidates([]);
    setSaving(false);
    setSaveError('');
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) { setGenError('Please enter a topic or some text.'); return; }
    setGenerating(true);
    setGenError('');

    try {
      const res = await fetch(`/api/decks/${deckId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), limit: isAuto ? 10 : limitValue, existingCards }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenError(data.error ?? 'Generation failed. Please try again.');
        return;
      }
      const raw: Candidate[] = data.candidates ?? [];
      if (raw.length === 0) {
        setGenError('No cards were generated. Try a more detailed prompt.');
        return;
      }
      setCandidates(raw.map((c) => ({ ...c, selected: true })));
      setStep('review');
    } catch {
      setGenError('An unexpected error occurred.');
    } finally {
      setGenerating(false);
    }
  }

  function updateCandidate(index: number, field: 'front' | 'back', value: string) {
    setCandidates((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    );
  }

  function toggleCandidate(index: number) {
    setCandidates((prev) =>
      prev.map((c, i) => (i === index ? { ...c, selected: !c.selected } : c))
    );
  }

  const selectedCount = candidates.filter((c) => c.selected).length;

  async function handleSave() {
    const toSave = candidates.filter((c) => c.selected && c.front.trim() && c.back.trim());
    if (toSave.length === 0) { setSaveError('Select at least one card to save.'); return; }
    setSaving(true);
    setSaveError('');

    try {
      // Save cards sequentially to avoid race conditions in Drupal
      for (const card of toSave) {
        const res = await fetch(`/api/decks/${deckId}/cards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ front: card.front.trim(), back: card.back.trim() }),
        });
        if (!res.ok) {
          const data = await res.json();
          setSaveError(data.error ?? 'Failed to save one or more cards.');
          return;
        }
      }
      setOpen(false);
      reset();
      onSaved();
    } catch {
      setSaveError('An unexpected error occurred while saving.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        disabled={!isOnline}
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={!isOnline}
            title={isOnline ? undefined : "AI generation requires an internet connection"}
          >
            {isOnline ? <Sparkles className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            AI
          </Button>
        }
      />

      <DialogContent className="sm:max-w-2xl max-h-[90dvh] flex flex-col">
        {step === 'prompt' ? (
          <form onSubmit={handleGenerate} className="flex flex-col gap-4 min-h-0">
            <DialogHeader>
              <DialogTitle>Generate cards with AI</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-prompt">
                Describe the topic or paste some text to turn into flashcards
              </Label>
              <Textarea
                id="ai-prompt"
                placeholder="e.g. The water cycle, including evaporation, condensation, and precipitation"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                autoFocus
                className="resize-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Number of cards to generate</Label>
              <div className="flex items-center gap-2">
                <div
                  onClick={() => {
                    if (isAuto) {
                      setIsAuto(false);
                      setTimeout(() => limitInputRef.current?.focus(), 0);
                    }
                  }}
                  className={isAuto ? 'cursor-text' : undefined}
                >
                  <Input
                    ref={limitInputRef}
                    type="number"
                    min={1}
                    max={15}
                    value={limitValue}
                    onChange={(e) => {
                      const v = Math.min(15, Math.max(1, parseInt(e.target.value, 10) || 1));
                      setLimitValue(v);
                    }}
                    disabled={isAuto}
                    className="w-20 h-8 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setIsAuto((a) => !a)}
                  className={cn(
                    'rounded-full px-3 py-1 text-sm font-medium border transition-colors',
                    isAuto
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-ring/50'
                  )}
                >
                  Auto
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {isAuto
                  ? 'AI will generate cards (max 10).'
                  : `AI will try to generate ${limitValue} card${limitValue === 1 ? '' : 's'}.`}
              </p>
            </div>

            {genError && <p className="text-sm text-destructive">{genError}</p>}

            <DialogFooter showCloseButton>
              <Button type="submit" disabled={generating} className="gap-2">
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex flex-col gap-4 min-h-0">
            <DialogHeader>
              <DialogTitle>Review generated cards</DialogTitle>
              <p className="text-sm text-muted-foreground">
                Edit any card, deselect ones you don&apos;t want, then save.
              </p>
            </DialogHeader>

            {/* Scrollable candidate list */}
            <div className="flex-1 overflow-y-auto -mx-1 px-1 flex flex-col gap-3">
              {candidates.map((card, i) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-xl border p-4 flex flex-col gap-3 transition-colors',
                    card.selected
                      ? 'border-border bg-card'
                      : 'border-border/40 bg-muted/30 opacity-50'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Card {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleCandidate(i)}
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors',
                        card.selected
                          ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {card.selected ? 'Selected' : 'Skipped'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs text-muted-foreground">Front</Label>
                      <Textarea
                        value={card.front}
                        onChange={(e) => updateCandidate(i, 'front', e.target.value)}
                        rows={3}
                        className="resize-none text-sm"
                        disabled={!card.selected}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs text-muted-foreground">Back</Label>
                      <Textarea
                        value={card.back}
                        onChange={(e) => updateCandidate(i, 'back', e.target.value)}
                        rows={3}
                        className="resize-none text-sm"
                        disabled={!card.selected}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {saveError && <p className="text-sm text-destructive">{saveError}</p>}

            <DialogFooter showCloseButton>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep('prompt')}
                className="mr-auto gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              <Button onClick={handleSave} disabled={saving || selectedCount === 0}>
                {saving
                  ? 'Saving…'
                  : `Save ${selectedCount} ${selectedCount === 1 ? 'card' : 'cards'}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
