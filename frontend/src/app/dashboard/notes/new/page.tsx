'use client';

// Autosave (every 5 min when dirty) runs only on the edit page after the note exists — not here before the first save.

import { useEffect, useState } from 'react';
import { useMarkdownEditor } from '@/hooks/use-markdown-editor';
import { useRouter } from 'next/navigation';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import Link from 'next/link';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { AreaSubjectSelector } from '@/components/area-subject-selector';
import { LinkDecksDialog } from '@/components/link-decks-dialog';
import { ArrowLeft, Save, Eye, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { userFacingMessageForApiError } from '@/lib/api-client-messages';

type MobileTab = 'write' | 'preview';

export default function NewNotePage() {
  const router = useRouter();

  // Form state
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const { ref: editorRef, onKeyDown: editorKeyDown } = useMarkdownEditor(body, setBody);
  const [areaUuid, setAreaUuid] = useState('');
  const [subjectUuid, setSubjectUuid] = useState('');
  const [linkedDeckIds, setLinkedDeckIds] = useState<string[]>([]);

  // UI state
  const [mobileTab, setMobileTab] = useState<MobileTab>('write');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [queued, setQueued] = useState(false);

  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    markSignedOut();
    router.replace('/');
  }

  async function handleSave() {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setSaving(true);
    setError('');

    try {
      const res = await Promise.race([
        fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            fieldBody: body,
            areaUuid: areaUuid || undefined,
            subjectUuid: subjectUuid || undefined,
            linkedDeckUuids: linkedDeckIds.length > 0 ? linkedDeckIds : undefined,
          }),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 8000),
        ),
      ]);

      if (!res.ok) {
        try {
          const data = await res.json();
          setError(
            userFacingMessageForApiError(res, data, 'Failed to save note.')
          );
        } catch {
          setQueued(true);
        }
        return;
      }

      const data = await res.json();
      if (data.queued) {
        setError('');
        setQueued(true);
        return;
      }

      router.push('/dashboard/notes');
    } catch {
      setQueued(true);
    } finally {
      setSaving(false);
    }
  }

  if (!authenticated) return null;

  const isDirty =
    title.trim() !== '' ||
    body.trim() !== '' ||
    areaUuid !== '' ||
    subjectUuid !== '' ||
    linkedDeckIds.length > 0;

  return (
    <>
      <Header authenticated onSignIn={() => {}} onSignUp={() => {}} onLogout={handleLogout} />

      {/* Top bar */}
      <div className="fixed top-16 left-0 right-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto max-w-screen-2xl px-4 h-14 flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link href="/dashboard/notes" />}>
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to notes</span>
          </Button>

          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Note title…"
            className="flex-1 h-8 border-0 bg-transparent text-base font-medium shadow-none focus-visible:ring-0 px-0"
          />

          {/* Mobile tab toggle */}
          <div className="flex md:hidden items-center rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setMobileTab('write')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors',
                mobileTab === 'write'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Pencil className="h-3 w-3" />
              Write
            </button>
            <button
              onClick={() => setMobileTab('preview')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors',
                mobileTab === 'preview'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Eye className="h-3 w-3" />
              Preview
            </button>
          </div>

          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:border-emerald-500/50 focus-visible:ring-emerald-500/30 border-transparent shadow-none [a]:hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save note'}
          </Button>
        </div>
        {error && !queued && (
          <p className="px-4 pb-2 text-xs text-destructive">{error}</p>
        )}
        {queued && (
          <div className="mx-4 mb-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-200">
            Note saved offline. It will appear once you reconnect.
          </div>
        )}
      </div>

      {/* Editor area — starts below both header (64px) and top bar (56px) */}
      <div className="flex min-h-0 flex-col" style={{ paddingTop: '120px', height: '100dvh' }}>

        {/* Split pane (desktop) / single pane (mobile) */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">

          {/* Write pane */}
          <div
            className={cn(
              'flex min-h-0 flex-col overflow-hidden',
              // Desktop: always half width
              'md:w-1/2 md:flex md:border-r md:border-border',
              // Mobile: show only when write tab active
              mobileTab === 'write' ? 'flex w-full' : 'hidden'
            )}
          >
            <Textarea
              ref={editorRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={editorKeyDown}
              placeholder="Write your notes in Markdown…"
              className="flex-1 resize-none rounded-none border-0 bg-transparent font-mono text-sm leading-relaxed focus-visible:ring-0 p-4 h-full [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
            />
          </div>

          {/* Preview pane */}
          <ScrollArea
            className={cn(
              'min-h-0 flex-1',
              'md:w-1/2 md:flex md:flex-col',
              mobileTab === 'preview' ? 'flex w-full flex-col' : 'hidden'
            )}
          >
            {body.trim() ? (
              <div className="prose prose-sm max-w-none p-6">
                <MarkdownRenderer>{body}</MarkdownRenderer>
              </div>
            ) : (
              <div className="flex min-h-[12rem] flex-1 items-center justify-center p-8 text-muted-foreground text-sm md:min-h-0">
                Preview will appear here as you write.
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Bottom metadata bar */}
        <div className="border-t border-border bg-background px-4 py-3">
          <div className="mx-auto max-w-screen-2xl">
            <Label className="text-xs text-muted-foreground mb-2 block">Categorise</Label>
            <div className="flex flex-wrap items-end gap-3">
              <AreaSubjectSelector
                areaUuid={areaUuid}
                subjectUuid={subjectUuid}
                onAreaChange={setAreaUuid}
                onSubjectChange={setSubjectUuid}
                layout="row"
              />
              <LinkDecksDialog
                selectedIds={linkedDeckIds}
                onChange={setLinkedDeckIds}
                noteAreaUuid={areaUuid}
                noteSubjectUuid={subjectUuid}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
