'use client';

import { use, useEffect, useState } from 'react';
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
import { ArrowLeft, Pencil, Eye, Save, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JsonApiResource } from '@/lib/drupal';

type MobileTab = 'write' | 'preview';

interface NoteResponse {
  data: JsonApiResource;
}

export default function EditNotePage({
  params,
}: {
  params: Promise<{ noteid: string }>;
}) {
  const { noteid } = use(params);
  const router = useRouter();

  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [areaUuid, setAreaUuid] = useState('');
  const [subjectUuid, setSubjectUuid] = useState('');
  const [linkedDeckIds, setLinkedDeckIds] = useState<string[]>([]);
  const [mobileTab, setMobileTab] = useState<MobileTab>('write');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (!d.authenticated) router.replace('/');
        else setAuthenticated(true);
      });
  }, [router]);

  useEffect(() => {
    if (!authenticated) return;
    setLoading(true);
    fetch(`/api/notes/${noteid}`)
      .then(async (res) => {
        if (res.status === 404 || res.status === 403) {
          setNotFound(true);
          return;
        }
        if (res.ok) {
          const data: NoteResponse = await res.json();
          const note = data.data;
          setTitle((note.attributes.title as string) ?? '');
          setBody((note.attributes.field_body as string) ?? '');
          const areaRel = note.relationships?.field_area?.data;
          const subjectRel = note.relationships?.field_subject?.data;
          const linkedDecksRel = note.relationships?.field_linked_decks?.data;
          setAreaUuid(areaRel && !Array.isArray(areaRel) ? areaRel.id : '');
          setSubjectUuid(subjectRel && !Array.isArray(subjectRel) ? subjectRel.id : '');
          setLinkedDeckIds(Array.isArray(linkedDecksRel) ? linkedDecksRel.map((r) => r.id) : []);
        }
      })
      .finally(() => setLoading(false));
  }, [authenticated, noteid]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/');
  }

  async function handleSave() {
    if (!title.trim()) {
      setSaveError('Title is required.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch(`/api/notes/${noteid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          fieldBody: body,
          areaUuid: areaUuid || null,
          subjectUuid: subjectUuid || null,
          linkedDeckUuids: linkedDeckIds,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setSaveError(data.error ?? 'Failed to save note.');
        return;
      }
      router.push(`/dashboard/notes?id=${noteid}`);
    } catch {
      setSaveError('An unexpected error occurred.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/notes/${noteid}`, { method: 'DELETE' });
      if (res.ok || res.status === 204) {
        router.push('/dashboard/notes');
      }
    } finally {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }

  if (!authenticated) return null;

  if (!loading && notFound) {
    return (
      <>
        <Header authenticated onSignIn={() => {}} onSignUp={() => {}} onLogout={handleLogout} />
        <main className="mx-auto max-w-4xl px-6 pt-28 pb-16 text-center">
          <p className="text-lg font-semibold text-foreground">Note not found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been deleted or you don&apos;t have permission to view it.
          </p>
          <Button
            className="mt-6"
            size="sm"
            nativeButton={false}
            render={<Link href="/dashboard/notes" />}
          >
            Back to notes
          </Button>
        </main>
      </>
    );
  }

  return (
    <>
      <Header authenticated onSignIn={() => {}} onSignUp={() => {}} onLogout={handleLogout} />

      {/* Top bar */}
      <div className="fixed top-16 left-0 right-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto max-w-screen-2xl px-4 h-14 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href={`/dashboard/notes?id=${noteid}`} />}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to notes</span>
          </Button>

          {loading ? (
            <div className="flex-1 h-5 animate-pulse rounded bg-muted" />
          ) : (
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title…"
              className="flex-1 h-8 border-0 bg-transparent text-base font-medium shadow-none focus-visible:ring-0 px-0"
            />
          )}

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

          {deleteConfirm ? (
            <>
              <span className="text-sm text-muted-foreground hidden sm:inline">Delete this note?</span>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Confirm'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(false)}>
                <X className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setDeleteConfirm(true)}
                className="text-muted-foreground hover:text-destructive"
                disabled={loading}
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Delete note</span>
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving || loading}>
                <Save className="h-4 w-4" />
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </>
          )}
        </div>
        {saveError && (
          <p className="px-4 pb-2 text-xs text-destructive">{saveError}</p>
        )}
      </div>

      {/* Editor area */}
      <div className="flex flex-col" style={{ paddingTop: '120px', height: '100dvh' }}>
        <div className="flex flex-1 overflow-hidden">
          {/* Write pane */}
          <div
            className={cn(
              'flex flex-col overflow-hidden',
              'md:w-1/2 md:flex md:border-r md:border-border',
              mobileTab === 'write' ? 'flex w-full' : 'hidden'
            )}
          >
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your notes in Markdown…"
              className="flex-1 resize-none rounded-none border-0 bg-transparent font-mono text-sm leading-relaxed focus-visible:ring-0 p-4 h-full"
              disabled={loading}
            />
          </div>

          {/* Preview pane */}
          <div
            className={cn(
              'overflow-y-auto',
              'md:w-1/2 md:flex md:flex-col',
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
                onAreaChange={(uuid) => { setAreaUuid(uuid); setSubjectUuid(''); }}
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
