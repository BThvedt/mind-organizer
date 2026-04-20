'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import { Header } from '@/components/header';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { FolderOpen, ArrowLeft, Plus, Pencil, X, Check, Layers, FileText } from 'lucide-react';
import { cn, toSlug } from '@/lib/utils';
import type { JsonApiResource } from '@/lib/drupal';

interface TaxonomyResponse { data: JsonApiResource[] }
interface SingleResponse { data: JsonApiResource }
interface ListResponse { data: JsonApiResource[] }

type ContentFilter = 'all' | 'decks' | 'notes';

function relId(resource: JsonApiResource, field: string): string | null {
  const rel = resource.relationships?.[field]?.data;
  if (!rel || Array.isArray(rel)) return null;
  return (rel as { id: string }).id ?? null;
}

export default function AreaDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const initialSubjectId = searchParams.get('subject');
  const [areaId, setAreaId] = useState<string | null>(null);
  const [area, setArea] = useState<JsonApiResource | null>(null);
  const [subjects, setSubjects] = useState<JsonApiResource[]>([]);
  const [decks, setDecks] = useState<JsonApiResource[]>([]);
  const [notes, setNotes] = useState<JsonApiResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Subject filter — pre-seeded from ?subject= query param
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(initialSubjectId);

  // Content type filter
  const [contentFilter, setContentFilter] = useState<ContentFilter>('all');

  // Add subject state
  const [adding, setAdding] = useState(false);
  const [addName, setAddName] = useState('');
  const [addError, setAddError] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  // Edit subject state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Delete subject state
  const [confirmDelete, setConfirmDelete] = useState<JsonApiResource | null>(null);
  const [deleting, setDeleting] = useState(false);

  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();

  useEffect(() => {
    if (!authenticated || !slug) return;
    async function load() {
      setLoading(true);
      try {
        // Resolve slug → UUID by fetching all areas
        const areasRes = await fetch('/api/taxonomy?type=areas');
        if (!areasRes.ok) return;
        const areasData: TaxonomyResponse = await areasRes.json();
        const matched = (areasData.data ?? []).find(
          (a) => toSlug(a.attributes?.name as string) === slug
        );
        if (!matched) { setNotFound(true); return; }

        const id = matched.id;
        setAreaId(id);
        setArea(matched);

        const [subjectsRes, decksRes, notesRes] = await Promise.all([
          fetch(`/api/taxonomy?type=subjects&area=${id}`),
          fetch('/api/decks'),
          fetch('/api/notes'),
        ]);
        if (subjectsRes.ok) setSubjects((await subjectsRes.json() as TaxonomyResponse).data ?? []);
        if (decksRes.ok) {
          const data: ListResponse = await decksRes.json();
          setDecks((data.data ?? []).filter((d) => relId(d, 'field_area') === id));
        }
        if (notesRes.ok) {
          const data: ListResponse = await notesRes.json();
          setNotes((data.data ?? []).filter((n) => relId(n, 'field_area') === id));
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [authenticated, slug]);

  useEffect(() => { if (adding) addInputRef.current?.focus(); }, [adding]);
  useEffect(() => { if (editingId) editInputRef.current?.focus(); }, [editingId]);

  function isDuplicate(name: string, excludeId?: string) {
    return subjects.some(
      (s) => s.id !== excludeId &&
        (s.attributes?.name as string).toLowerCase() === name.trim().toLowerCase()
    );
  }

  async function handleAdd() {
    const name = addName.trim();
    if (!name) { setAddError('Name is required.'); return; }
    if (isDuplicate(name)) { setAddError('A subject with this name already exists for this area.'); return; }
    setAddSaving(true);
    try {
      const res = await fetch('/api/taxonomy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'subject', name, areaUuid: areaId }),
      });
      if (res.ok) {
        const data: SingleResponse = await res.json();
        setSubjects((prev) => [...prev, data.data]);
        setAddName(''); setAdding(false); setAddError('');
      }
    } finally { setAddSaving(false); }
  }

  function startEdit(subject: JsonApiResource) {
    setEditingId(subject.id);
    setEditName(subject.attributes?.name as string);
    setEditError('');
  }

  async function handleEdit() {
    if (!editingId) return;
    const name = editName.trim();
    if (!name) { setEditError('Name is required.'); return; }
    if (isDuplicate(name, editingId)) { setEditError('A subject with this name already exists for this area.'); return; }
    setEditSaving(true);
    try {
      const res = await fetch(`/api/taxonomy/${editingId}?type=subject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setSubjects((prev) =>
          prev.map((s) => s.id === editingId ? { ...s, attributes: { ...s.attributes, name } } : s)
        );
        setEditingId(null); setEditError('');
      }
    } finally { setEditSaving(false); }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/taxonomy/${confirmDelete.id}?type=subject`, { method: 'DELETE' });
      if (res.ok || res.status === 204) {
        setSubjects((prev) => prev.filter((s) => s.id !== confirmDelete.id));
        if (selectedSubjectId === confirmDelete.id) setSelectedSubjectId(null);
        setConfirmDelete(null);
      }
    } finally { setDeleting(false); }
  }

  const filteredDecks = decks.filter(
    (d) => !selectedSubjectId || relId(d, 'field_subject') === selectedSubjectId
  );
  const filteredNotes = notes.filter(
    (n) => !selectedSubjectId || relId(n, 'field_subject') === selectedSubjectId
  );
  const visibleDecks = contentFilter !== 'notes' ? filteredDecks : [];
  const visibleNotes = contentFilter !== 'decks' ? filteredNotes : [];
  const totalVisible = visibleDecks.length + visibleNotes.length;

  if (authenticated === null) return null;

  return (
    <div className="min-h-screen bg-background">
      <Header
        authenticated={!!authenticated}
        onSignIn={() => {}}
        onSignUp={() => {}}
        onLogout={markSignedOut}
      />

      <main className="mx-auto max-w-3xl px-6 pt-24 pb-16 space-y-4">
        <Link
          href="/dashboard/areas"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Areas
        </Link>

        {loading ? (
          <>
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </>
        ) : notFound ? (
          <p className="text-sm text-muted-foreground">Area not found.</p>
        ) : (
          <>
            <Card>
              <CardHeader className="border-b border-border pb-4">
                <CardTitle className="flex items-center gap-2.5 text-xl font-semibold">
                  <FolderOpen className="h-6 w-6 text-primary shrink-0" />
                  {area?.attributes?.name as string}
                </CardTitle>
              </CardHeader>

              <CardContent className="pt-3 pb-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Subjects
                  </span>
                  <Button size="icon-sm" onClick={() => { setAdding(true); setAddError(''); }}>
                    <Plus className="h-4 w-4" />
                    <span className="sr-only">Add subject</span>
                  </Button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {subjects.map((subject) =>
                    editingId === subject.id ? (
                      <div key={subject.id} className="flex flex-col gap-1">
                        <div className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                          <input
                            ref={editInputRef}
                            value={editName}
                            onChange={(e) => { setEditName(e.target.value); setEditError(''); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleEdit(); if (e.key === 'Escape') setEditingId(null); }}
                            className="w-28 text-xs bg-transparent outline-none"
                          />
                          <button onClick={handleEdit} disabled={editSaving} className="text-primary hover:text-primary/80 transition-colors">
                            <Check className="h-3 w-3" />
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                        {editError && <p className="text-[10px] text-destructive pl-1">{editError}</p>}
                      </div>
                    ) : (
                      <span
                        key={subject.id}
                        className={cn(
                          'group inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors',
                          selectedSubjectId === subject.id
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-foreground/65 hover:bg-muted/80'
                        )}
                        onClick={() => setSelectedSubjectId(
                          selectedSubjectId === subject.id ? null : subject.id
                        )}
                      >
                        {subject.attributes?.name as string}
                        <button
                          onClick={(e) => { e.stopPropagation(); startEdit(subject); }}
                          className={cn(
                            'opacity-0 group-hover:opacity-100 transition-opacity ml-0.5 p-0.5',
                            selectedSubjectId === subject.id
                              ? 'hover:text-primary-foreground/70'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete(subject); }}
                          className={cn(
                            'opacity-0 group-hover:opacity-100 transition-opacity p-0.5',
                            selectedSubjectId === subject.id
                              ? 'hover:text-primary-foreground/70'
                              : 'text-muted-foreground hover:text-destructive'
                          )}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    )
                  )}

                  {adding && (
                    <div className="flex flex-col gap-1">
                      <div className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                        <input
                          ref={addInputRef}
                          value={addName}
                          onChange={(e) => { setAddName(e.target.value); setAddError(''); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setAdding(false); setAddName(''); } }}
                          placeholder="Subject name"
                          className="w-28 text-xs bg-transparent outline-none placeholder:text-muted-foreground/60"
                        />
                        <button onClick={handleAdd} disabled={addSaving} className="text-primary hover:text-primary/80 transition-colors">
                          <Check className="h-3 w-3" />
                        </button>
                        <button onClick={() => { setAdding(false); setAddName(''); setAddError(''); }} className="text-muted-foreground hover:text-foreground transition-colors">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      {addError && <p className="text-[10px] text-destructive pl-1">{addError}</p>}
                    </div>
                  )}

                  {subjects.length === 0 && !adding && (
                    <p className="text-xs text-muted-foreground">No subjects yet.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b border-border pb-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    Content
                    {selectedSubjectId && (
                      <span className="ml-2 text-xs text-muted-foreground font-normal">
                        — filtered by subject
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-1">
                    {(['all', 'decks', 'notes'] as ContentFilter[]).map((f) => (
                      <button
                        key={f}
                        onClick={() => setContentFilter(f)}
                        className={cn(
                          'px-2.5 py-1 rounded-md text-xs font-medium transition-colors capitalize',
                          contentFilter === f
                            ? 'bg-muted text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-2 pb-2">
                {totalVisible === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    No {contentFilter === 'all' ? 'content' : contentFilter} found
                    {selectedSubjectId ? ' for this subject' : ''}.
                  </p>
                ) : (
                  <div className="space-y-0.5">
                    {visibleDecks.map((deck) => (
                      <Link
                        key={deck.id}
                        href={`/dashboard/decks/${deck.id}`}
                        className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-muted/50 transition-colors group"
                      >
                        <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{deck.attributes?.title as string}</span>
                        <span className="text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">Deck</span>
                      </Link>
                    ))}
                    {visibleNotes.map((note) => (
                      <Link
                        key={note.id}
                        href={`/dashboard/notes?id=${note.id}`}
                        className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-muted/50 transition-colors group"
                      >
                        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{note.attributes?.title as string}</span>
                        <span className="text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">Note</span>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>

      <Dialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete subject?</DialogTitle>
            <DialogDescription>
              &ldquo;{confirmDelete?.attributes?.name as string}&rdquo; will be permanently deleted.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
