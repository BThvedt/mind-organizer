'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { ExternalLink, Layers, Link2, Loader2, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JsonApiResource } from '@/lib/drupal';

interface SearchDeckResult {
  uuid: string;
  type: string;
  title: string;
  area: { uuid: string; name: string } | null;
  subject: { uuid: string; name: string } | null;
}

interface LinkDecksDialogProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  noteAreaUuid?: string;
  noteSubjectUuid?: string;
}

export function LinkDecksDialog({
  selectedIds,
  onChange,
  noteAreaUuid = '',
  noteSubjectUuid = '',
}: LinkDecksDialogProps) {
  const [open, setOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Full deck list for browse mode + URL paste validation
  const [decks, setDecks] = useState<JsonApiResource[]>([]);
  const [included, setIncluded] = useState<JsonApiResource[]>([]);
  const [loadingDecks, setLoadingDecks] = useState(false);

  // Search mode
  const [searchResults, setSearchResults] = useState<SearchDeckResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const [localSelected, setLocalSelected] = useState<string[]>([]);
  const [filterAreaId, setFilterAreaId] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');
  const [search, setSearch] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState('');

  const isSearchMode = search.trim().length >= 2;

  async function loadDecks() {
    setLoadingDecks(true);
    try {
      const res = await fetch('/api/decks');
      if (res.ok) {
        const data = await res.json();
        setDecks(data.data ?? []);
        setIncluded(data.included ?? []);
      }
    } finally {
      setLoadingDecks(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setLocalSelected([...selectedIds]);
      setFilterAreaId(noteAreaUuid);
      setFilterSubjectId(noteAreaUuid ? noteSubjectUuid : '');
      setSearch('');
      setSearchResults([]);
      setSearched(false);
      setUrlInput('');
      setUrlError('');
      if (decks.length === 0 && !loadingDecks) {
        loadDecks();
      }
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    }
  }

  const doSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearched(false);
      return;
    }
    setSearchLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: q.trim(), type: 'deck' });
        const res = await fetch(`/api/search?${params}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(
            (data.results ?? []).filter((r: SearchDeckResult) => r.type === 'flashcard_deck')
          );
        }
      } finally {
        setSearchLoading(false);
        setSearched(true);
      }
    }, 300);
  }, []);

  useEffect(() => {
    doSearch(search);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, doSearch]);

  // ── Browse mode derived data ──────────────────────────────────────────────

  const uniqueAreas = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    decks.forEach((deck) => {
      const rel = deck.relationships?.field_area?.data;
      const id = rel && !Array.isArray(rel) ? rel.id : null;
      if (id && !seen.has(id)) {
        seen.add(id);
        const name = included.find((r) => r.id === id)?.attributes.name as string | undefined;
        if (name) result.push({ id, name });
      }
    });
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [decks, included]);

  const uniqueSubjectsForArea = useMemo(() => {
    if (!filterAreaId) return [];
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    decks.forEach((deck) => {
      const aRel = deck.relationships?.field_area?.data;
      const aId = aRel && !Array.isArray(aRel) ? aRel.id : null;
      if (aId !== filterAreaId) return;
      const sRel = deck.relationships?.field_subject?.data;
      const sId = sRel && !Array.isArray(sRel) ? sRel.id : null;
      if (sId && !seen.has(sId)) {
        seen.add(sId);
        const name = included.find((r) => r.id === sId)?.attributes.name as string | undefined;
        if (name) result.push({ id: sId, name });
      }
    });
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [decks, included, filterAreaId]);

  const visibleDecks = useMemo(() => {
    return decks.filter((deck) => {
      const aRel = deck.relationships?.field_area?.data;
      const sRel = deck.relationships?.field_subject?.data;
      const aId = aRel && !Array.isArray(aRel) ? aRel.id : null;
      const sId = sRel && !Array.isArray(sRel) ? sRel.id : null;
      if (filterAreaId && aId !== filterAreaId) return false;
      if (filterAreaId && filterSubjectId && sId !== filterSubjectId) return false;
      return true;
    });
  }, [decks, filterAreaId, filterSubjectId]);

  // Accumulates title/area/subject from both browse list and search results so
  // we can always label a linked deck even if it isn't in the current view.
  const knownDeckInfo = useMemo(() => {
    const map = new Map<string, { title: string; areaName?: string; subjectName?: string }>();
    decks.forEach((deck) => {
      const aRel = deck.relationships?.field_area?.data;
      const sRel = deck.relationships?.field_subject?.data;
      const aId = aRel && !Array.isArray(aRel) ? aRel.id : null;
      const sId = sRel && !Array.isArray(sRel) ? sRel.id : null;
      map.set(deck.id, {
        title: deck.attributes.title as string,
        areaName: aId ? (included.find((r) => r.id === aId)?.attributes.name as string | undefined) : undefined,
        subjectName: sId ? (included.find((r) => r.id === sId)?.attributes.name as string | undefined) : undefined,
      });
    });
    searchResults.forEach((r) => {
      if (!map.has(r.uuid)) {
        map.set(r.uuid, {
          title: r.title,
          areaName: r.area?.name ?? undefined,
          subjectName: r.subject?.name ?? undefined,
        });
      }
    });
    return map;
  }, [decks, included, searchResults]);

  function getDeckMeta(deck: JsonApiResource) {
    const aRel = deck.relationships?.field_area?.data;
    const sRel = deck.relationships?.field_subject?.data;
    const aId = aRel && !Array.isArray(aRel) ? aRel.id : null;
    const sId = sRel && !Array.isArray(sRel) ? sRel.id : null;
    const areaName = aId
      ? (included.find((r) => r.id === aId)?.attributes.name as string | undefined)
      : undefined;
    const subjectName = sId
      ? (included.find((r) => r.id === sId)?.attributes.name as string | undefined)
      : undefined;
    return { areaName, subjectName };
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  function toggleDeck(id: string) {
    setLocalSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleAddByUrl() {
    setUrlError('');
    const input = urlInput.trim();
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const match = input.match(uuidRegex);
    if (!match) {
      setUrlError('No valid deck ID found in the URL.');
      return;
    }
    const uuid = match[0];
    const deck = decks.find((d) => d.id === uuid);
    if (!deck) {
      setUrlError("Deck not found or doesn't belong to you.");
      return;
    }
    if (!localSelected.includes(uuid)) {
      setLocalSelected((prev) => [...prev, uuid]);
    }
    setUrlInput('');
  }

  function handleDone() {
    onChange(localSelected);
    setOpen(false);
  }

  const hasFilters = !!(filterAreaId || filterSubjectId);

  // ── Render ────────────────────────────────────────────────────────────────

  function renderDeckRow(id: string, title: string, areaName?: string, subjectName?: string) {
    const checked = localSelected.includes(id);
    return (
      <label
        key={id}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors',
          checked && 'bg-primary/5'
        )}
      >
        <Checkbox
          checked={checked}
          onCheckedChange={() => toggleDeck(id)}
          className="shrink-0"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>
          {(areaName || subjectName) && (
            <p className="text-xs text-muted-foreground truncate">
              {[areaName, subjectName].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </label>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <Link2 className="h-4 w-4" />
            {selectedIds.length > 0 ? 'Linked Decks' : 'Link Decks'}
            {selectedIds.length > 0 && (
              <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                {selectedIds.length}
              </span>
            )}
          </Button>
        }
      />

      <DialogContent className="sm:max-w-lg flex flex-col max-h-[85vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Link decks
            {localSelected.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                · {localSelected.length} selected
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 flex-1 overflow-hidden min-h-0">

          {/* Search bar */}
          <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5">
            {searchLoading ? (
              <Loader2 className="h-4 w-4 shrink-0 text-muted-foreground animate-spin" />
            ) : (
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search decks…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Browse-mode filters (hidden while searching) */}
          {!isSearchMode && !loadingDecks && uniqueAreas.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={filterAreaId || '__all__'}
                onValueChange={(v) => {
                  setFilterAreaId(v === '__all__' ? '' : v);
                  setFilterSubjectId('');
                }}
              >
                <SelectTrigger className="h-7 w-auto min-w-28 text-xs">
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
                  onValueChange={(v) => setFilterSubjectId(v === '__all__' ? '' : v)}
                >
                  <SelectTrigger className="h-7 w-auto min-w-28 text-xs">
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
                  onClick={() => { setFilterAreaId(''); setFilterSubjectId(''); }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              )}
            </div>
          )}

          {/* Deck list */}
          <div className="flex-1 overflow-y-auto min-h-0 rounded-md border border-border">
            {isSearchMode ? (
              // ── Search results ──
              searchLoading && !searched ? (
                <div className="p-3 flex flex-col gap-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
                  ))}
                </div>
              ) : !searched ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  Searching…
                </p>
              ) : searchResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground gap-2">
                  <Layers className="h-5 w-5 opacity-40" />
                  <span>No decks found for &ldquo;{search.trim()}&rdquo;</span>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {searchResults.map((result) =>
                    renderDeckRow(
                      result.uuid,
                      result.title,
                      result.area?.name,
                      result.subject?.name
                    )
                  )}
                </div>
              )
            ) : (
              // ── Browse list ──
              loadingDecks ? (
                <div className="p-3 flex flex-col gap-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
                  ))}
                </div>
              ) : visibleDecks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground gap-2">
                  <Layers className="h-5 w-5 opacity-40" />
                  <span>{decks.length === 0 ? 'You have no decks yet.' : 'No decks match the selected filters.'}</span>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {visibleDecks.map((deck) => {
                    const { areaName, subjectName } = getDeckMeta(deck);
                    return renderDeckRow(
                      deck.id,
                      deck.attributes.title as string,
                      areaName,
                      subjectName
                    );
                  })}
                </div>
              )
            )}
          </div>

          {/* Paste URL */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Or paste a deck URL / ID</Label>
            <div className="flex gap-2">
              <Input
                value={urlInput}
                onChange={(e) => { setUrlInput(e.target.value); setUrlError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleAddByUrl()}
                placeholder="https://… or deck UUID"
                className="h-8 text-sm flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddByUrl}
                disabled={!urlInput.trim()}
              >
                Add
              </Button>
            </div>
            {urlError && <p className="text-xs text-destructive">{urlError}</p>}
          </div>

          {/* Currently linked */}
          {localSelected.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Currently linked</Label>
              <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
                {localSelected.map((id) => {
                  const info = knownDeckInfo.get(id);
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5"
                    >
                      <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <a
                        href={`/dashboard/decks/${id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 min-w-0 truncate text-sm font-medium hover:underline underline-offset-2"
                      >
                        {info?.title ?? `${id.slice(0, 8)}…`}
                      </a>
                      {info?.areaName && (
                        <span className="hidden sm:inline text-xs text-muted-foreground shrink-0">
                          {[info.areaName, info.subjectName].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      <a
                        href={`/dashboard/decks/${id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        aria-label="Open deck in new tab"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      <button
                        onClick={() => toggleDeck(id)}
                        className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        aria-label="Remove link"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter showCloseButton>
          <Button onClick={handleDone}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
