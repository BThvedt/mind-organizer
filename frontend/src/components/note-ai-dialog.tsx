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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Sparkles,
  Loader2,
  ChevronLeft,
  WandSparkles,
  PlusCircle,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Step =
  | 'menu'
  | 'confirm-format'
  | 'add-content'
  | 'confirm-add'
  | 'generate-deck-config'
  | 'deck-review';

interface Candidate {
  front: string;
  back: string;
  selected: boolean;
}

interface NoteAiDialogProps {
  noteId: string;
  noteBody: string;
  noteTitle: string;
  noteAreaUuid?: string;
  noteSubjectUuid?: string;
  linkedDeckIds: string[];
  onBodyChange: (body: string) => void;
  onLinksChange: (ids: string[]) => void;
}

export function NoteAiDialog({
  noteId,
  noteBody,
  noteTitle,
  noteAreaUuid = '',
  noteSubjectUuid = '',
  linkedDeckIds,
  onBodyChange,
  onLinksChange,
}: NoteAiDialogProps) {
  const generateLimitInputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('menu');

  // Shared loading / error
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Format step
  const [formattedBody, setFormattedBody] = useState('');

  // Add-content step
  const [addPrompt, setAddPrompt] = useState('');
  const [addedBody, setAddedBody] = useState('');

  // Deck-review step
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [deckTitle, setDeckTitle] = useState('');
  const [autoLink, setAutoLink] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [generateLimitValue, setGenerateLimitValue] = useState(5);
  const [generateIsAuto, setGenerateIsAuto] = useState(false);

  function reset() {
    setStep('menu');
    setLoading(false);
    setError('');
    setFormattedBody('');
    setAddPrompt('');
    setAddedBody('');
    setCandidates([]);
    setDeckTitle('');
    setAutoLink(true);
    setSaving(false);
    setSaveError('');
    setGenerateLimitValue(5);
    setGenerateIsAuto(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  // ── Format ────────────────────────────────────────────────────────────────

  async function handleFormat() {
    if (!noteBody.trim()) {
      setError('The note has no content to format.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/notes/${noteId}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'format', noteBody }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Format failed.'); return; }
      setFormattedBody(data.result ?? '');
      setStep('confirm-format');
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  function applyFormat() {
    onBodyChange(formattedBody);
    setOpen(false);
    reset();
  }

  // ── Add content ───────────────────────────────────────────────────────────

  async function handleAddContent() {
    if (!addPrompt.trim()) { setError('Please describe what you would like to add.'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/notes/${noteId}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-content', noteBody, prompt: addPrompt }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Generation failed.'); return; }
      setAddedBody(data.result ?? '');
      setStep('confirm-add');
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  function applyAddContent() {
    onBodyChange(addedBody);
    setOpen(false);
    reset();
  }

  // ── Generate deck ─────────────────────────────────────────────────────────

  async function handleGenerateDeck() {
    if (!noteBody.trim()) {
      setError('The note has no content to generate cards from.');
      return;
    }
    setLoading(true);
    setError('');
    setDeckTitle(noteTitle || 'New deck');
    try {
      const res = await fetch(`/api/notes/${noteId}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate-deck', noteBody, limit: generateIsAuto ? 10 : generateLimitValue }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Generation failed.'); return; }
      const raw: { front: string; back: string }[] = data.candidates ?? [];
      if (raw.length === 0) { setError('No cards could be generated from this note.'); return; }
      setCandidates(raw.map((c) => ({ ...c, selected: true })));
      setStep('deck-review');
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
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

  async function handleSaveDeck() {
    const toSave = candidates.filter((c) => c.selected && c.front.trim() && c.back.trim());
    if (toSave.length === 0) { setSaveError('Select at least one card to save.'); return; }
    if (!deckTitle.trim()) { setSaveError('Please enter a deck title.'); return; }

    setSaving(true);
    setSaveError('');
    try {
      // 1. Create the deck
      const deckRes = await fetch('/api/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: deckTitle.trim(),
          ...(noteAreaUuid ? { areaUuid: noteAreaUuid } : {}),
          ...(noteSubjectUuid ? { subjectUuid: noteSubjectUuid } : {}),
        }),
      });
      if (!deckRes.ok) {
        const d = await deckRes.json();
        setSaveError(d.error ?? 'Failed to create deck.');
        return;
      }
      const deckData = await deckRes.json();
      const newDeckId: string = deckData.data.id;

      // 2. Save cards sequentially
      for (const card of toSave) {
        const cardRes = await fetch(`/api/decks/${newDeckId}/cards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ front: card.front.trim(), back: card.back.trim() }),
        });
        if (!cardRes.ok) {
          const d = await cardRes.json();
          setSaveError(d.error ?? 'Failed to save one or more cards.');
          return;
        }
      }

      // 3. Auto-link the deck to the note
      if (autoLink) {
        const updatedIds = [...new Set([...linkedDeckIds, newDeckId])];
        await fetch(`/api/notes/${noteId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ linkedDeckUuids: updatedIds }),
        });
        onLinksChange(updatedIds);
      }

      setOpen(false);
      reset();
    } catch {
      setSaveError('An unexpected error occurred.');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Sparkles className="h-4 w-4" />
            AI
          </Button>
        }
      />

      <DialogContent className="sm:max-w-2xl max-h-[90dvh] flex flex-col">

        {/* ── Menu ── */}
        {step === 'menu' && (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                AI Actions
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-2">
              <button
                onClick={handleFormat}
                disabled={loading}
                className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-ring/50 hover:bg-muted/40 disabled:opacity-50"
              >
                <WandSparkles className="h-5 w-5 mt-0.5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Format with AI</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Clean up structure, headings, lists and spacing without changing the content.
                  </p>
                </div>
                {loading && step === 'menu' && (
                  <Loader2 className="h-4 w-4 animate-spin ml-auto shrink-0 mt-0.5 text-muted-foreground" />
                )}
              </button>

              <button
                onClick={() => { setError(''); setStep('add-content'); }}
                disabled={loading}
                className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-ring/50 hover:bg-muted/40 disabled:opacity-50"
              >
                <PlusCircle className="h-5 w-5 mt-0.5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Add content with AI</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Describe what you&apos;d like to add — examples, facts, explanations — and AI will expand the note.
                  </p>
                </div>
              </button>

              <button
                onClick={() => { setError(''); setStep('generate-deck-config'); }}
                disabled={loading}
                className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-ring/50 hover:bg-muted/40 disabled:opacity-50"
              >
                <Layers className="h-5 w-5 mt-0.5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Generate deck from note</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Create a flashcard deck based on the content of this note.
                  </p>
                </div>
              </button>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter showCloseButton />
          </div>
        )}

        {/* ── Confirm format ── */}
        {step === 'confirm-format' && (
          <div className="flex flex-col gap-4 min-h-0">
            <DialogHeader>
              <DialogTitle>Review formatted note</DialogTitle>
              <p className="text-sm text-muted-foreground">
                Preview the reformatted content below. Apply to replace your note.
              </p>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto min-h-0 rounded-xl border border-border bg-muted/30 p-4">
              <pre className="whitespace-pre-wrap font-mono text-sm text-foreground leading-relaxed">
                {formattedBody}
              </pre>
            </div>

            <DialogFooter showCloseButton>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep('menu')}
                className="mr-auto gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              <Button onClick={applyFormat}>Apply</Button>
            </DialogFooter>
          </div>
        )}

        {/* ── Add content prompt ── */}
        {step === 'add-content' && (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Add content with AI</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-prompt">What would you like to add?</Label>
              <Textarea
                id="add-prompt"
                placeholder="e.g. Please include some more examples, or add a section on common misconceptions"
                value={addPrompt}
                onChange={(e) => setAddPrompt(e.target.value)}
                rows={4}
                autoFocus
                className="resize-none"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter showCloseButton>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { setError(''); setStep('menu'); }}
                className="mr-auto gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              <Button onClick={handleAddContent} disabled={loading}>
                {loading ? (
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
          </div>
        )}

        {/* ── Confirm add ── */}
        {step === 'confirm-add' && (
          <div className="flex flex-col gap-4 min-h-0">
            <DialogHeader>
              <DialogTitle>Review updated note</DialogTitle>
              <p className="text-sm text-muted-foreground">
                Preview the updated content below. Apply to replace your note.
              </p>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto min-h-0 rounded-xl border border-border bg-muted/30 p-4">
              <pre className="whitespace-pre-wrap font-mono text-sm text-foreground leading-relaxed">
                {addedBody}
              </pre>
            </div>

            <DialogFooter showCloseButton>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep('add-content')}
                className="mr-auto gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              <Button onClick={applyAddContent}>Apply</Button>
            </DialogFooter>
          </div>
        )}

        {/* ── Generate deck config ── */}
        {step === 'generate-deck-config' && (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Generate deck from note</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-1.5">
              <Label>Number of cards to generate</Label>
              <div className="flex items-center gap-2">
                <div
                  onClick={() => {
                    if (generateIsAuto) {
                      setGenerateIsAuto(false);
                      setTimeout(() => generateLimitInputRef.current?.focus(), 0);
                    }
                  }}
                  className={generateIsAuto ? 'cursor-text' : undefined}
                >
                  <Input
                    ref={generateLimitInputRef}
                    type="number"
                    min={1}
                    max={15}
                    value={generateLimitValue}
                    onChange={(e) => {
                      const v = Math.min(15, Math.max(1, parseInt(e.target.value, 10) || 1));
                      setGenerateLimitValue(v);
                    }}
                    disabled={generateIsAuto}
                    className="w-20 h-8 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setGenerateIsAuto((a) => !a)}
                  className={cn(
                    'rounded-full px-3 py-1 text-sm font-medium border transition-colors',
                    generateIsAuto
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-ring/50'
                  )}
                >
                  Auto
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {generateIsAuto
                  ? 'AI will generate cards (max 10).'
                  : `AI will try to generate ${generateLimitValue} card${generateLimitValue === 1 ? '' : 's'} from this note.`}
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter showCloseButton>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { setError(''); setStep('menu'); }}
                className="mr-auto gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              <Button onClick={handleGenerateDeck} disabled={loading}>
                {loading ? (
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
          </div>
        )}

        {/* ── Deck review ── */}
        {step === 'deck-review' && (
          <div className="flex flex-col gap-4 min-h-0">
            <DialogHeader>
              <DialogTitle>Review generated cards</DialogTitle>
              <p className="text-sm text-muted-foreground">
                Edit cards, deselect ones you don&apos;t want, then save as a new deck.
              </p>
            </DialogHeader>

            {/* Deck title + auto-link */}
            <div className="flex flex-col sm:flex-row gap-3 shrink-0">
              <div className="flex flex-col gap-1.5 flex-1">
                <Label htmlFor="deck-title">Deck title</Label>
                <Input
                  id="deck-title"
                  value={deckTitle}
                  onChange={(e) => setDeckTitle(e.target.value)}
                  placeholder="Deck title…"
                  className="h-9"
                />
              </div>
              <div className="flex items-end gap-2 pb-0.5">
                <Checkbox
                  id="auto-link"
                  checked={autoLink}
                  onCheckedChange={(v) => setAutoLink(!!v)}
                />
                <Label htmlFor="auto-link" className="text-sm cursor-pointer">
                  Link this deck to the note
                </Label>
              </div>
            </div>

            {/* Scrollable candidate list */}
            <div className="flex-1 overflow-y-auto -mx-1 px-1 flex flex-col gap-3 min-h-0">
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
                onClick={() => { setSaveError(''); setStep('menu'); }}
                className="mr-auto gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                onClick={handleSaveDeck}
                disabled={saving || selectedCount === 0}
              >
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
