'use client';

import { Suspense, useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { FileText, ArrowLeft, Plus, Pencil, Layers, ChevronLeft, X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { JsonApiResource } from '@/lib/drupal';

function stripMarkdown(md: string): string {
  return md
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/`[^`]+`/g, (m) => m.slice(1, -1))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function NotesPage() {
  return (
    <Suspense>
      <NotesPageContent />
    </Suspense>
  );
}

function NotesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [notes, setNotes] = useState<JsonApiResource[]>([]);
  const [included, setIncluded] = useState<JsonApiResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileShowReader, setMobileShowReader] = useState(false);
  const [filterAreaId, setFilterAreaId] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');

  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();

  // Restore selection from URL on first load
  useEffect(() => {
    const id = searchParams.get('id');
    if (id) {
      setSelectedId(id);
      setMobileShowReader(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notes');
      if (res.ok) {
        const data = await res.json();
        setNotes(data.data ?? []);
        setIncluded(data.included ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated) loadNotes();
  }, [authenticated, loadNotes]);

  useEffect(() => {
    router.prefetch('/dashboard/notes/new');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    markSignedOut();
    router.replace('/');
  }

  function selectNote(id: string) {
    setSelectedId(id);
    setMobileShowReader(true);
    router.replace(`/dashboard/notes?id=${id}`, { scroll: false });
  }

  // ── Filter options derived from loaded data ────────────────────────────────

  const uniqueAreas = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    notes.forEach((note) => {
      const rel = note.relationships?.field_area?.data;
      const id = rel && !Array.isArray(rel) ? rel.id : null;
      if (id && !seen.has(id)) {
        seen.add(id);
        const name = included.find((r) => r.id === id)?.attributes.name as string | undefined;
        if (name) result.push({ id, name });
      }
    });
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [notes, included]);

  const uniqueSubjectsForArea = useMemo(() => {
    if (!filterAreaId) return [];
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    notes.forEach((note) => {
      const aRel = note.relationships?.field_area?.data;
      const aId = aRel && !Array.isArray(aRel) ? aRel.id : null;
      if (aId !== filterAreaId) return;
      const sRel = note.relationships?.field_subject?.data;
      const sId = sRel && !Array.isArray(sRel) ? sRel.id : null;
      if (sId && !seen.has(sId)) {
        seen.add(sId);
        const name = included.find((r) => r.id === sId)?.attributes.name as string | undefined;
        if (name) result.push({ id: sId, name });
      }
    });
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [notes, included, filterAreaId]);

  const visibleNotes = useMemo(() => {
    if (!filterAreaId && !filterSubjectId) return notes;
    return notes.filter((note) => {
      const aRel = note.relationships?.field_area?.data;
      const sRel = note.relationships?.field_subject?.data;
      const aId = aRel && !Array.isArray(aRel) ? aRel.id : null;
      const sId = sRel && !Array.isArray(sRel) ? sRel.id : null;
      if (filterAreaId && aId !== filterAreaId) return false;
      if (filterSubjectId && sId !== filterSubjectId) return false;
      return true;
    });
  }, [notes, filterAreaId, filterSubjectId]);

  const hasFilters = !!(filterAreaId || filterSubjectId);

  function clearFilters() {
    setFilterAreaId('');
    setFilterSubjectId('');
  }

  if (!authenticated) return null;

  // ── Derive data for the selected note from the already-loaded list ─────────
  const selectedNote = selectedId ? (notes.find((n) => n.id === selectedId) ?? null) : null;

  const areaRel = selectedNote?.relationships?.field_area?.data;
  const subjectRel = selectedNote?.relationships?.field_subject?.data;
  const linkedDecksRel = selectedNote?.relationships?.field_linked_decks?.data;
  const linkedNotesRel = selectedNote?.relationships?.field_linked_notes?.data;

  const areaId = areaRel && !Array.isArray(areaRel) ? areaRel.id : null;
  const subjectId = subjectRel && !Array.isArray(subjectRel) ? subjectRel.id : null;

  const areaName = areaId
    ? (included.find((r) => r.id === areaId)?.attributes.name as string | undefined)
    : undefined;
  const subjectName = subjectId
    ? (included.find((r) => r.id === subjectId)?.attributes.name as string | undefined)
    : undefined;
  const linkedDecks = Array.isArray(linkedDecksRel)
    ? (linkedDecksRel
        .map((rel) => included.find((r) => r.id === rel.id))
        .filter(Boolean) as JsonApiResource[])
    : [];
  const linkedNotes = Array.isArray(linkedNotesRel)
    ? (linkedNotesRel
        .map((rel) => included.find((r) => r.id === rel.id) ?? notes.find((n) => n.id === rel.id))
        .filter(Boolean) as JsonApiResource[])
    : [];

  const noteBody = (selectedNote?.attributes.field_body as string | null) ?? '';

  return (
    <>
      <Header authenticated onSignIn={() => {}} onSignUp={() => {}} onLogout={handleLogout} />

      <div className="fixed inset-x-0 bottom-0 top-16 flex min-h-0">

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside
          className={cn(
            'flex min-h-0 flex-col border-r border-border bg-background shrink-0',
            'w-full md:w-72 lg:w-80',
            mobileShowReader ? 'hidden md:flex' : 'flex'
          )}
        >
          {/* Sidebar header */}
          <div className="flex items-center justify-between gap-2 px-4 h-12 border-b border-border shrink-0">
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon-sm"
                nativeButton={false}
                render={<Link href="/dashboard" />}
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">Back to dashboard</span>
              </Button>
              <h1 className="font-semibold text-sm text-foreground">My Notes</h1>
              {!loading && (
                <span className="text-xs text-muted-foreground">
                  ({hasFilters ? `${visibleNotes.length} of ${notes.length}` : notes.length})
                </span>
              )}
            </div>
            <Button
              size="icon-sm"
              nativeButton={false}
              render={<Link href="/dashboard/notes/new" />}
            >
              <Plus className="h-4 w-4" />
              <span className="sr-only">New note</span>
            </Button>
          </div>

          {/* Filter section */}
          {!loading && uniqueAreas.length > 0 && (
            <div className="px-3 py-2 border-b border-border flex flex-col gap-1.5 shrink-0">
              <Select
                value={filterAreaId || '__all__'}
                onValueChange={(v) => {
                  setFilterAreaId(!v || v === '__all__' ? '' : v);
                  setFilterSubjectId('');
                }}
              >
                <SelectTrigger className="h-7 text-xs">
                  <span className={cn(!filterAreaId && 'text-muted-foreground')}>
                    {filterAreaId
                      ? (uniqueAreas.find((a) => a.id === filterAreaId)?.name ?? 'All areas')
                      : 'All areas'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All areas</SelectItem>
                  {uniqueAreas.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {filterAreaId && (
                <Select
                  value={filterSubjectId || '__all__'}
                  onValueChange={(v) => setFilterSubjectId(!v || v === '__all__' ? '' : v)}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <span className={cn(!filterSubjectId && 'text-muted-foreground')}>
                      {filterSubjectId
                        ? (uniqueSubjectsForArea.find((s) => s.id === filterSubjectId)?.name ?? 'All subjects')
                        : 'All subjects'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All subjects</SelectItem>
                    {uniqueSubjectsForArea.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors self-start"
                >
                  <X className="h-3 w-3" />
                  Clear filters
                </button>
              )}
            </div>
          )}

          {/* Note list */}
          <ScrollArea className="flex-1 min-h-0">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="px-4 py-3 border-b border-border">
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted mb-2" />
                  <div className="h-3 w-full animate-pulse rounded bg-muted mb-1" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                </div>
              ))
            ) : notes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-3">
                <FileText className="h-8 w-8 text-muted-foreground/40" />
                <div>
                  <p className="text-sm font-medium text-foreground">No notes yet</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Create your first note to get started.
                  </p>
                </div>
                <Button
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/dashboard/notes/new" />}
                >
                  <Plus className="h-4 w-4" />
                  New note
                </Button>
              </div>
            ) : visibleNotes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-3">
                <FileText className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No notes match the selected filters.</p>
                <button
                  onClick={clearFilters}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              visibleNotes.map((note) => {
                const nAreaRel = note.relationships?.field_area?.data;
                const nSubjectRel = note.relationships?.field_subject?.data;
                const nAreaId = nAreaRel && !Array.isArray(nAreaRel) ? nAreaRel.id : null;
                const nSubjectId = nSubjectRel && !Array.isArray(nSubjectRel) ? nSubjectRel.id : null;
                const nAreaName = nAreaId
                  ? (included.find((r) => r.id === nAreaId)?.attributes.name as string | undefined)
                  : undefined;
                const nSubjectName = nSubjectId
                  ? (included.find((r) => r.id === nSubjectId)?.attributes.name as string | undefined)
                  : undefined;
                const rawBody = (note.attributes.field_body as string | null) ?? '';
                const preview = stripMarkdown(rawBody).slice(0, 110);
                const changed = note.attributes.changed as string | undefined;
                const isSelected = selectedId === note.id;

                return (
                  <button
                    key={note.id}
                    onClick={() => selectNote(note.id)}
                    className={cn(
                      'w-full text-left px-4 py-3 border-b border-border transition-colors',
                      isSelected
                        ? 'bg-muted'
                        : 'hover:bg-muted/50'
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="text-sm font-medium text-foreground truncate leading-snug">
                        {note.attributes.title as string}
                      </span>
                      {changed && (
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {timeAgo(changed)}
                        </span>
                      )}
                    </div>
                    {preview && (
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {preview}
                      </p>
                    )}
                    {(nAreaName || nSubjectName) && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {nAreaName && (
                          <Badge variant="secondary" className="text-[10px] py-0 h-4 px-1.5">
                            {nAreaName}
                          </Badge>
                        )}
                        {nSubjectName && (
                          <Badge variant="outline" className="text-[10px] py-0 h-4 px-1.5">
                            {nSubjectName}
                          </Badge>
                        )}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </ScrollArea>
        </aside>

        {/* ── Reader ──────────────────────────────────────────────────────── */}
        <main
          className={cn(
            'flex min-h-0 flex-1 flex-col bg-background',
            mobileShowReader ? 'flex' : 'hidden md:flex'
          )}
        >
          {selectedNote ? (
            <ScrollArea className="flex-1 min-h-0">
            <div className="max-w-3xl mx-auto w-full px-6 py-8">

              {/* Reader header */}
              <div className="flex items-start justify-between gap-4 mb-6">
                <div className="flex items-start gap-2 min-w-0">
                  {/* Mobile: back to sidebar */}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setMobileShowReader(false)}
                    className="md:hidden mt-0.5 shrink-0"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span className="sr-only">Back to list</span>
                  </Button>
                  <div className="min-w-0">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground leading-tight">
                      {selectedNote.attributes.title as string}
                    </h1>
                    {(areaName || subjectName) && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {areaName && <Badge variant="secondary">{areaName}</Badge>}
                        {subjectName && <Badge variant="outline">{subjectName}</Badge>}
                      </div>
                    )}
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  nativeButton={false}
                  render={<Link href={`/dashboard/notes/${selectedNote.id}`} />}
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
              </div>

              {/* Markdown body */}
              {noteBody.trim() ? (
                <article className="prose prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{noteBody}</ReactMarkdown>
                </article>
              ) : (
                <p className="text-sm text-muted-foreground italic">No content yet.</p>
              )}

              {/* Linked decks */}
              {linkedDecks.length > 0 && (
                <section className="mt-12 pt-8 border-t border-border">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <Layers className="h-4 w-4" />
                    Linked decks
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {linkedDecks.map((deck) => (
                      <Link
                        key={deck.id}
                        href={`/dashboard/decks/${deck.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-ring/50 hover:bg-card/80"
                      >
                        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                        {deck.attributes.title as string}
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {/* Linked notes */}
              {linkedNotes.length > 0 && (
                <section className={cn("pt-8 border-t border-border", linkedDecks.length > 0 ? "mt-6" : "mt-12")}>
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <FileText className="h-4 w-4" />
                    Linked notes
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {linkedNotes.map((note) => (
                      <button
                        key={note.id}
                        onClick={() => { setSelectedId(note.id); setMobileShowReader(true); }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-ring/50 hover:bg-card/80"
                      >
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        {note.attributes.title as string}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
            </ScrollArea>
          ) : (
            /* Empty state — only visible on desktop when nothing is selected */
            <div className="hidden md:flex flex-col flex-1 items-center justify-center text-center p-8">
              <FileText className="h-10 w-10 text-muted-foreground/25 mb-3" />
              <p className="text-sm text-muted-foreground">Select a note to read it</p>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
