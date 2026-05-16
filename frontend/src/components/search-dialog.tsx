'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  CheckSquare,
  FileText,
  Layers,
  Search,
  Sparkles,
  X,
  Loader2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  SESSION_EXPIRED_MESSAGE,
  SEARCH_HTTP_FALLBACK_MESSAGE,
  SEMANTIC_SEARCH_DEGRADED_MESSAGE,
  KEYWORD_SEARCH_DEGRADED_MESSAGE,
  messageWhenSearchRequestThrows,
  userFacingMessageForApiError,
} from '@/lib/api-client-messages';

type ResultType = 'study_note' | 'flashcard_deck' | 'todo_list';
type FilterType = 'all' | 'note' | 'deck' | 'todo';

interface TermRef {
  uuid: string;
  name: string;
}

interface SearchResult {
  uuid: string;
  type: ResultType;
  title: string;
  areas: TermRef[];
  subjects: TermRef[];
  /** Present on semantic results; undefined for pure keyword hits. */
  score?: number;
}

interface MergedResult extends SearchResult {
  /** True if this row appeared in keyword results. */
  fromKeyword: boolean;
  /** True if this row appeared in semantic results. */
  fromSemantic: boolean;
  /** Best score seen across sources (semantic only — keyword has no score). */
  score?: number;
}

interface TaxonomyTerm {
  id: string;
  attributes: { name: string };
}

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Local-storage key used to persist the "AI search on" toggle across
 * sessions. Set to `"0"` to disable; any other value (or absent) means on.
 */
const AI_TOGGLE_STORAGE_KEY = 'search.aiEnabled';

/**
 * Below this score, semantic-only matches are considered noise and hidden.
 * The Drupal-side service applies the same floor; this is a belt-and-braces
 * filter so a model change on the backend cant accidentally leak garbage.
 */
const SEMANTIC_MIN_SCORE = 0.6;

/**
 * Score at which a semantic-only hit is "strong enough" that we re-rank
 * it above keyword-only hits for question-shaped queries. Cosine scores on
 * `voyage-3-lite` tend to land in [0.5, 0.85] for relevant matches; 0.8 is
 * a high-confidence floor.
 */
const SEMANTIC_REORDER_STRONG_SCORE = 0.8;

export function SearchDialog({ open, onClose }: SearchDialogProps) {
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [filterAreaId, setFilterAreaId] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showDateRange, setShowDateRange] = useState(false);
  const [areas, setAreas] = useState<TaxonomyTerm[]>([]);
  const [subjects, setSubjects] = useState<TaxonomyTerm[]>([]);
  const [results, setResults] = useState<MergedResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState('');
  /**
   * Inline non-fatal warning shown above the results list when only one
   * half of the hybrid search succeeded (e.g. semantic timed out). Empty
   * when both halves are healthy or when AI is disabled.
   */
  const [degradedWarning, setDegradedWarning] = useState('');

  // AI toggle — defaults to on, persisted in localStorage so the user's
  // preference sticks across page loads. We start as `true` on the server
  // for SSR safety and reconcile in the mount effect below.
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiHydrated, setAiHydrated] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read the persisted AI preference once on first mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(AI_TOGGLE_STORAGE_KEY);
    if (stored !== null) {
      setAiEnabled(stored !== '0');
    }
    setAiHydrated(true);
  }, []);

  const toggleAi = useCallback(() => {
    setAiEnabled((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(AI_TOGGLE_STORAGE_KEY, next ? '1' : '0');
      }
      return next;
    });
  }, []);

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
      setDateFrom('');
      setDateTo('');
      setShowDateRange(false);
      setResults([]);
      setTotal(0);
      setSearched(false);
      setSearchError('');
      setDegradedWarning('');
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

  // Debounced hybrid search whenever query, filters, or AI toggle change.
  const doSearch = useCallback(
    (
      q: string,
      type: FilterType,
      area: string,
      subject: string,
      from: string,
      to: string,
      ai: boolean,
    ) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (q.length < 2) {
        setResults([]);
        setTotal(0);
        setSearched(false);
        setDegradedWarning('');
        return;
      }
      debounceRef.current = setTimeout(async () => {
        setLoading(true);
        setSearchError('');
        setDegradedWarning('');

        const keywordPromise = runKeywordSearch(q, type, area, subject, from, to);
        const semanticPromise: Promise<FetchOutcome<SearchResult>> = ai
          ? runSemanticSearch(q, type)
          : Promise.resolve({ ok: true, results: [] });

        const [keywordOutcome, semanticOutcome] = await Promise.all([
          keywordPromise,
          semanticPromise,
        ]);

        // Both halves failed at the same time — surface the worst one and bail.
        if (!keywordOutcome.ok && !semanticOutcome.ok) {
          setResults([]);
          setTotal(0);
          // 401 should always win over generic errors so the user sees the
          // session-expired prompt rather than a vague failure copy.
          const sessionExpired =
            keywordOutcome.error === SESSION_EXPIRED_MESSAGE ||
            semanticOutcome.error === SESSION_EXPIRED_MESSAGE;
          setSearchError(
            sessionExpired ? SESSION_EXPIRED_MESSAGE : keywordOutcome.error,
          );
          setLoading(false);
          setSearched(true);
          return;
        }

        // Partial failure: render what we got and warn inline so the user
        // doesnt assume the missing half just had no results.
        if (!keywordOutcome.ok && ai) {
          setDegradedWarning(KEYWORD_SEARCH_DEGRADED_MESSAGE);
        } else if (ai && !semanticOutcome.ok) {
          setDegradedWarning(SEMANTIC_SEARCH_DEGRADED_MESSAGE);
        }

        const keywordResults = keywordOutcome.ok ? keywordOutcome.results : [];
        const semanticResults = semanticOutcome.ok ? semanticOutcome.results : [];

        const merged = mergeAndRank(q, keywordResults, semanticResults, ai);
        setResults(merged);
        setTotal(merged.length);
        setSearched(true);
        setLoading(false);
      }, 300);
    },
    [],
  );

  useEffect(() => {
    if (!aiHydrated) return;
    doSearch(query, filterType, filterAreaId, filterSubjectId, dateFrom, dateTo, aiEnabled);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [
    query,
    filterType,
    filterAreaId,
    filterSubjectId,
    dateFrom,
    dateTo,
    aiEnabled,
    aiHydrated,
    doSearch,
  ]);

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
            placeholder={
              aiEnabled
                ? 'Search or ask a question…'
                : 'Search notes, decks, and todo lists…'
            }
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close search"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Filter bar — row 1: type + taxonomy + AI toggle */}
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

          {/* AI toggle pill — mirrors the Date range button visual treatment */}
          <button
            onClick={toggleAi}
            title={
              aiEnabled
                ? 'AI semantic matches: on'
                : 'AI semantic matches: off'
            }
            aria-pressed={aiEnabled}
            className={cn(
              'flex items-center gap-1 h-7 px-2 rounded-lg border text-xs transition-colors',
              aiEnabled
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:text-foreground',
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI
          </button>

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

          {/* Date range toggle button */}
          <button
            onClick={() => {
              if (showDateRange) {
                setShowDateRange(false);
                setDateFrom('');
                setDateTo('');
              } else {
                setShowDateRange(true);
              }
            }}
            className={cn(
              'flex items-center gap-1 h-7 px-2 rounded-lg border text-xs transition-colors',
              showDateRange || dateFrom || dateTo
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:text-foreground',
            )}
            aria-label="Toggle date range filter"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Date range
          </button>
        </div>

        {/* Filter bar — row 2: date range (shown on demand) */}
        {showDateRange && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
            <span className="text-xs text-muted-foreground">Date</span>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">From</span>
              <Input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-7 w-32 rounded-lg border border-border bg-background px-2 text-xs text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">To</span>
              <Input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-7 w-32 rounded-lg border border-border bg-background px-2 text-xs text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            {(dateFrom || dateTo) && (
              <button
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear dates"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

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

          {!searchError && degradedWarning && !loading && (
            <p className="px-4 py-2 text-xs text-muted-foreground bg-muted/40 border-b border-border">
              {degradedWarning}
            </p>
          )}

          {!searchError && searched && results.length === 0 && !loading && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No results for{' '}
              <span className="font-medium text-foreground">"{query}"</span>
            </p>
          )}

          {results.length > 0 && (
            <ResultsList results={results} onSelect={onClose} aiEnabled={aiEnabled} />
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

/* -------------------------------------------------------------------------- */
/* Result list + row                                                          */
/* -------------------------------------------------------------------------- */

interface ResultsListProps {
  results: MergedResult[];
  onSelect: () => void;
  aiEnabled: boolean;
}

function ResultsList({ results, onSelect, aiEnabled }: ResultsListProps) {
  // Split into keyword/dual band and semantic-only band so we can render
  // the "Related results" divider between them.
  const primary: MergedResult[] = [];
  const related: MergedResult[] = [];
  for (const r of results) {
    if (r.fromKeyword) primary.push(r);
    else related.push(r);
  }

  return (
    <ul className="py-1">
      {primary.map((r) => (
        <ResultRow
          key={r.uuid}
          result={r}
          onSelect={onSelect}
          aiEnabled={aiEnabled}
        />
      ))}
      {aiEnabled && related.length > 0 && (
        <li className="px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground bg-muted/30 border-y border-border">
          Related results
        </li>
      )}
      {related.map((r) => (
        <ResultRow
          key={r.uuid}
          result={r}
          onSelect={onSelect}
          aiEnabled={aiEnabled}
        />
      ))}
    </ul>
  );
}

interface ResultRowProps {
  result: MergedResult;
  onSelect: () => void;
  aiEnabled: boolean;
}

function ResultRow({ result, onSelect, aiEnabled }: ResultRowProps) {
  return (
    <li>
      <Link
        href={getResultHref(result)}
        onClick={onSelect}
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
            {/* Provenance icons — only meaningful when AI is on; with AI off,
                every row is keyword and showing the search icon is noise. */}
            {aiEnabled && (
              <ProvenanceIcons
                keyword={result.fromKeyword}
                semantic={result.fromSemantic}
              />
            )}
            {result.areas.map((a) => (
              <Badge
                key={a.uuid}
                variant="secondary"
                className="text-[10px] py-0 h-4 px-1.5"
              >
                {a.name}
              </Badge>
            ))}
            {result.subjects.map((s) => (
              <Badge
                key={s.uuid}
                variant="outline"
                className="text-[10px] py-0 h-4 px-1.5"
              >
                {s.name}
              </Badge>
            ))}
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-0.5 mt-0.5">
          {aiEnabled && !result.fromKeyword && result.score !== undefined && (
            <span className="text-[10px] text-primary font-medium">
              {Math.round(result.score * 100)}% match
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {resultArrowLabel(result.type)}
          </span>
        </div>
      </Link>
    </li>
  );
}

function ProvenanceIcons({
  keyword,
  semantic,
}: {
  keyword: boolean;
  semantic: boolean;
}) {
  return (
    <span className="flex items-center gap-0.5">
      {keyword && (
        <Search
          className="h-3 w-3 text-muted-foreground"
          aria-label="Keyword match"
        />
      )}
      {semantic && (
        <Sparkles
          className="h-3 w-3 text-primary"
          aria-label="AI semantic match"
        />
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Fetch helpers                                                              */
/* -------------------------------------------------------------------------- */

type FetchOutcome<T> =
  | { ok: true; results: T[] }
  | { ok: false; error: string };

async function runKeywordSearch(
  q: string,
  type: FilterType,
  area: string,
  subject: string,
  from: string,
  to: string,
): Promise<FetchOutcome<SearchResult>> {
  try {
    const params = new URLSearchParams({ q, type });
    if (area) params.set('area', area);
    if (subject) params.set('subject', subject);
    if (from) params.set('date_from', from);
    if (to) params.set('date_to', to);

    const res = await Promise.race([
      fetch(`/api/search?${params}`),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 5000),
      ),
    ]);

    if (res.ok) {
      const data = await res.json();
      return { ok: true, results: data.results ?? [] };
    }
    const data = await res.json().catch(() => ({}));
    return {
      ok: false,
      error: userFacingMessageForApiError(res, data, SEARCH_HTTP_FALLBACK_MESSAGE),
    };
  } catch {
    return { ok: false, error: messageWhenSearchRequestThrows() };
  }
}

async function runSemanticSearch(
  q: string,
  type: FilterType,
): Promise<FetchOutcome<SearchResult>> {
  try {
    // The semantic endpoint takes a `types` array; "all" means omit the filter.
    const body: { query: string; types?: string[]; limit?: number } = {
      query: q,
      limit: 20,
    };
    if (type !== 'all') {
      body.types = [type];
    }

    const res = await Promise.race([
      fetch('/api/search/semantic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 8000),
      ),
    ]);

    if (res.ok) {
      const data = await res.json();
      return { ok: true, results: data.results ?? [] };
    }
    const data = await res.json().catch(() => ({}));
    return {
      ok: false,
      error: userFacingMessageForApiError(res, data, SEARCH_HTTP_FALLBACK_MESSAGE),
    };
  } catch {
    return { ok: false, error: messageWhenSearchRequestThrows() };
  }
}

/* -------------------------------------------------------------------------- */
/* Merge + rank                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Combines keyword and semantic result lists into a single ranked list:
 *   1. dual matches (both keyword AND semantic) first
 *   2. keyword-only next
 *   3. semantic-only after that, score desc, gated at SEMANTIC_MIN_SCORE
 *
 * For longer queries or anything that looks like a question, a strong
 * semantic-only hit (>= SEMANTIC_REORDER_STRONG_SCORE) is promoted above
 * keyword-only matches because the user likely meant a fuzzy match.
 */
function mergeAndRank(
  query: string,
  keyword: SearchResult[],
  semantic: SearchResult[],
  aiEnabled: boolean,
): MergedResult[] {
  const byUuid = new Map<string, MergedResult>();

  for (const r of keyword) {
    byUuid.set(r.uuid, {
      ...r,
      fromKeyword: true,
      fromSemantic: false,
    });
  }

  if (aiEnabled) {
    for (const r of semantic) {
      const existing = byUuid.get(r.uuid);
      if (existing) {
        existing.fromSemantic = true;
        // Keep the score so we can still show "% match" if a dual match
        // happens to be reordered into the semantic-only band later.
        existing.score = r.score;
      } else if ((r.score ?? 0) >= SEMANTIC_MIN_SCORE) {
        byUuid.set(r.uuid, {
          ...r,
          fromKeyword: false,
          fromSemantic: true,
        });
      }
    }
  }

  const all = Array.from(byUuid.values());

  // Initial sort:
  //   dual (both)            → bucket 0
  //   keyword only           → bucket 1
  //   semantic only          → bucket 2 (ordered by score desc within bucket)
  all.sort((a, b) => {
    const bucket = (r: MergedResult): number => {
      if (r.fromKeyword && r.fromSemantic) return 0;
      if (r.fromKeyword) return 1;
      return 2;
    };
    const diff = bucket(a) - bucket(b);
    if (diff !== 0) return diff;
    // Within the semantic-only bucket, higher score wins.
    if (!a.fromKeyword && !b.fromKeyword) {
      return (b.score ?? 0) - (a.score ?? 0);
    }
    return 0;
  });

  // Question-shaped or long queries: promote very strong semantic hits
  // ahead of keyword-only ones. We dont rewrite the buckets; we just bubble
  // qualifying semantic matches up by one slot until they sit just below
  // the dual-match band.
  if (aiEnabled && isLongOrQuestionLike(query)) {
    const promoted: MergedResult[] = [];
    const rest: MergedResult[] = [];
    for (const r of all) {
      const isStrongSemanticOnly =
        !r.fromKeyword &&
        r.fromSemantic &&
        (r.score ?? 0) >= SEMANTIC_REORDER_STRONG_SCORE;
      if (isStrongSemanticOnly) {
        promoted.push(r);
      } else {
        rest.push(r);
      }
    }
    // Place promoted items immediately after the dual-match band.
    const firstNonDualIdx = rest.findIndex(
      (r) => !(r.fromKeyword && r.fromSemantic),
    );
    if (firstNonDualIdx === -1) {
      return [...rest, ...promoted];
    }
    return [
      ...rest.slice(0, firstNonDualIdx),
      ...promoted,
      ...rest.slice(firstNonDualIdx),
    ];
  }

  return all;
}

function isLongOrQuestionLike(query: string): boolean {
  if (query.includes('?')) return true;
  const wordCount = query.trim().split(/\s+/).filter(Boolean).length;
  return wordCount > 3;
}

/* -------------------------------------------------------------------------- */
/* Display helpers                                                            */
/* -------------------------------------------------------------------------- */

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
