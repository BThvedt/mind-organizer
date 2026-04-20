'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { CheckSquare, FileText, Layers, Search, X, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  SESSION_EXPIRED_MESSAGE,
  SEARCH_HTTP_FALLBACK_MESSAGE,
  messageWhenSearchRequestThrows,
  userFacingMessageForApiError,
} from '@/lib/api-client-messages';

type ResultType = 'study_note' | 'flashcard_deck' | 'todo_list';
type FilterType = 'all' | 'note' | 'deck' | 'todo';

interface SearchResult {
  uuid: string;
  type: ResultType;
  title: string;
  area: { uuid: string; name: string } | null;
  subject: { uuid: string; name: string } | null;
}

interface TaxonomyTerm {
  id: string;
  attributes: { name: string };
}

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SearchDialog({ open, onClose }: SearchDialogProps) {
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [filterAreaId, setFilterAreaId] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');
  const [areas, setAreas] = useState<TaxonomyTerm[]>([]);
  const [subjects, setSubjects] = useState<TaxonomyTerm[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input and load areas when dialog opens; reset state on close
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      fetch('/api/taxonomy?type=areas')
        .then((r) => r.json())
        .then((d) => setAreas(d.data ?? []));
    } else {
      setQuery('');
      setFilterType('all');
      setFilterAreaId('');
      setFilterSubjectId('');
      setResults([]);
      setTotal(0);
      setSearched(false);
      setSearchError('');
    }
  }, [open]);

  // Load subjects when area changes
  useEffect(() => {
    if (!filterAreaId) {
      setSubjects([]);
      setFilterSubjectId('');
      return;
    }
    fetch(`/api/taxonomy?type=subjects&area=${filterAreaId}`)
      .then((r) => r.json())
      .then((d) => setSubjects(d.data ?? []));
  }, [filterAreaId]);

  // Debounced search whenever query or filters change
  const doSearch = useCallback(
    (q: string, type: FilterType, area: string, subject: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (q.length < 2) {
        setResults([]);
        setTotal(0);
        setSearched(false);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        setLoading(true);
        setSearchError('');
        try {
          const params = new URLSearchParams({ q, type });
          if (area) params.set('area', area);
          if (subject) params.set('subject', subject);
          const res = await Promise.race([
            fetch(`/api/search?${params}`),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), 5000),
            ),
          ]);
          if (res.ok) {
            const data = await res.json();
            setResults(data.results ?? []);
            setTotal(data.total ?? 0);
          } else {
            const data = await res.json().catch(() => ({}));
            setResults([]);
            setSearchError(
              userFacingMessageForApiError(
                res,
                data,
                SEARCH_HTTP_FALLBACK_MESSAGE
              )
            );
          }
        } catch {
          setResults([]);
          setSearchError(messageWhenSearchRequestThrows());
        } finally {
          setLoading(false);
          setSearched(true);
        }
      }, 300);
    },
    [],
  );

  useEffect(() => {
    doSearch(query, filterType, filterAreaId, filterSubjectId);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, filterType, filterAreaId, filterSubjectId, doSearch]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  function getResultHref(result: SearchResult) {
    if (result.type === 'study_note') {
      return `/dashboard/notes?id=${result.uuid}`;
    }
    if (result.type === 'todo_list') {
      return `/dashboard/todos?id=${result.uuid}`;
    }
    return `/dashboard/decks/${result.uuid}`;
  }

  function resultKindLabel(type: ResultType) {
    if (type === 'study_note') return 'Note';
    if (type === 'todo_list') return 'Todo list';
    return 'Deck';
  }

  function resultArrowLabel(type: ResultType) {
    if (type === 'study_note') return '→ Note';
    if (type === 'todo_list') return '→ Todos';
    return '→ Deck';
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-xl rounded-xl border border-border bg-popover shadow-xl overflow-hidden flex flex-col max-h-[70vh]">

        {/* Search input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          {loading ? (
            <Loader2 className="h-4 w-4 text-muted-foreground shrink-0 animate-spin" />
          ) : (
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes, decks, and todo lists…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query ? (
            <button
              onClick={() => setQuery('')}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 text-[10px] text-muted-foreground font-mono">
              Esc
            </kbd>
          )}
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
          {/* Type pills */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs bg-background">
            {(['all', 'note', 'deck', 'todo'] as FilterType[]).map((t) => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={cn(
                  'px-2.5 py-1 transition-colors',
                  filterType === t
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t === 'all'
                  ? 'All'
                  : t === 'note'
                    ? 'Notes'
                    : t === 'deck'
                      ? 'Decks'
                      : 'Todos'}
              </button>
            ))}
          </div>

          {/* Area select */}
          {areas.length > 0 && (
            <select
              value={filterAreaId}
              onChange={(e) => {
                setFilterAreaId(e.target.value);
                setFilterSubjectId('');
              }}
              className="h-7 rounded-lg border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">All areas</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.attributes.name}
                </option>
              ))}
            </select>
          )}

          {/* Subject select — only visible when an area is selected */}
          {filterAreaId && subjects.length > 0 && (
            <select
              value={filterSubjectId}
              onChange={(e) => setFilterSubjectId(e.target.value)}
              className="h-7 rounded-lg border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">All subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.attributes.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto">
          {!searched && !loading && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search.
            </p>
          )}

          {searchError && !loading && (
            <div
              className={cn(
                'flex flex-col items-center gap-2 py-12 text-center text-sm',
                searchError === SESSION_EXPIRED_MESSAGE
                  ? 'text-destructive'
                  : 'text-muted-foreground',
              )}
            >
              <p>{searchError}</p>
            </div>
          )}

          {!searchError && searched && results.length === 0 && !loading && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No results for{' '}
              <span className="font-medium text-foreground">"{query}"</span>
            </p>
          )}

          {results.length > 0 && (
            <ul className="py-1">
              {results.map((result) => (
                <li key={result.uuid}>
                  <Link
                    href={getResultHref(result)}
                    onClick={onClose}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
                      {result.type === 'study_note' ? (
                        <FileText className="h-3.5 w-3.5 text-primary" />
                      ) : result.type === 'todo_list' ? (
                        <CheckSquare className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <Layers className="h-3.5 w-3.5 text-primary" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {result.title}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-xs text-muted-foreground">
                          {resultKindLabel(result.type)}
                        </span>
                        {result.area && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] py-0 h-4 px-1.5"
                          >
                            {result.area.name}
                          </Badge>
                        )}
                        {result.subject && (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 h-4 px-1.5"
                          >
                            {result.subject.name}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground mt-0.5">
                      {resultArrowLabel(result.type)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {results.length > 0 && total > results.length && (
            <p className="px-4 py-2 text-xs text-muted-foreground border-t border-border text-center">
              Showing {results.length} of {total} results — refine your query to
              narrow results
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
