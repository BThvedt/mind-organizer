'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AreaSubjectSelector } from '@/components/area-subject-selector';
import { LinkDecksDialog } from '@/components/link-decks-dialog';
import { ArrowLeft, Save, Eye, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';

type MobileTab = 'write' | 'preview';

export default function NewNotePage() {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [areaUuid, setAreaUuid] = useState('');
  const [subjectUuid, setSubjectUuid] = useState('');
  const [linkedDeckIds, setLinkedDeckIds] = useState<string[]>([]);

  // UI state
  const [mobileTab, setMobileTab] = useState<MobileTab>('write');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (!d.authenticated) router.replace('/');
        else setAuthenticated(true);
      });
  }, [router]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
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
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          fieldBody: body,
          areaUuid: areaUuid || undefined,
          subjectUuid: subjectUuid || undefined,
          linkedDeckUuids: linkedDeckIds.length > 0 ? linkedDeckIds : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Failed to save note.');
        return;
      }

      router.push('/dashboard/notes');
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setSaving(false);
    }
  }

  if (!authenticated) return null;

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

          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save note'}
          </Button>
        </div>
        {error && (
          <p className="px-4 pb-2 text-xs text-destructive">{error}</p>
        )}
      </div>

      {/* Editor area — starts below both header (64px) and top bar (56px) */}
      <div className="flex flex-col" style={{ paddingTop: '120px', height: '100dvh' }}>

        {/* Split pane (desktop) / single pane (mobile) */}
        <div className="flex flex-1 overflow-hidden">

          {/* Write pane */}
          <div
            className={cn(
              'flex flex-col overflow-hidden',
              // Desktop: always half width
              'md:w-1/2 md:flex md:border-r md:border-border',
              // Mobile: show only when write tab active
              mobileTab === 'write' ? 'flex w-full' : 'hidden'
            )}
          >
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your notes in Markdown…"
              className="flex-1 resize-none rounded-none border-0 bg-transparent font-mono text-sm leading-relaxed focus-visible:ring-0 p-4 h-full"
            />
          </div>

          {/* Preview pane */}
          <div
            className={cn(
              'overflow-y-auto',
              // Desktop: always half width
              'md:w-1/2 md:flex md:flex-col',
              // Mobile: show only when preview tab active
              mobileTab === 'preview' ? 'flex w-full flex-col' : 'hidden'
            )}
          >
            {body.trim() ? (
              <div className="prose prose-sm max-w-none p-6">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-muted-foreground text-sm">
                Preview will appear here as you write.
              </div>
            )}
          </div>
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
