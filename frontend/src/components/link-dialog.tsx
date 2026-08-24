'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type UIEvent } from 'react';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CheckSquare,
  ExternalLink,
  FileText,
  Layers,
  Link2,
  Loader2,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  MATCH_STRENGTH_DEFAULT,
  MATCH_STRENGTH_MAX,
  MATCH_STRENGTH_MIN,
  MATCH_STRENGTH_STEP,
} from '@/lib/match-strength';
import { useMatchStrengthPreferences } from '@/hooks/useMatchStrengthPreferences';
import {
  SESSION_EXPIRED_MESSAGE,
  SEARCH_HTTP_FALLBACK_MESSAGE,
  messageWhenSearchRequestThrows,
  userFacingMessageForApiError,
} from '@/lib/api-client-messages';
import type { JsonApiResource } from '@/lib/json-api';
import { toRelIds } from '@/lib/json-api';
import type { TaxonomyTerm } from '@/components/area-subject-selector';

// ── Types ────────────────────────────────────────────────────────────────────

export type LinkTab = 'deck' | 'note' | 'todo';
type ActiveTab = LinkTab | 'ai';

interface TermRef {
  uuid: string;
  name: string;
}

interface SearchResult {
  uuid: string;
  type: string;
  title: string;
  areas: TermRef[];
  subjects: TermRef[];
}

interface RelatedResult {
  uuid: string;
  type: string;
  title: string;
  areas: TermRef[];
  subjects: TermRef[];
  score: number;
}

function bundleToTab(bundle: string): LinkTab {
  if (bundle === 'study_note') return 'note';
  if (bundle === 'todo_list') return 'todo';
  return 'deck';
}

interface LinkedIds {
  deck: string[];
  note: string[];
  todo: string[];
}

/**
 * Metadata the dialog has resolved for items the user browsed, searched, or
 * selected via the AI tab.  Keyed by UUID; type is the Drupal bundle string.
 */
export type KnownLinkedItems = Record<string, { title: string; type: string }>;

type ControlledProps = {
  mode: 'controlled';
  selectedDeckIds: string[];
  selectedNoteIds: string[];
  selectedTodoIds: string[];
  /**
   * Fired when the user clicks Done.  The second argument contains title/type
   * metadata for every selected item that was visible in the dialog; callers
   * can use it to update their display state immediately, without waiting for
   * a server round-trip.
   */
  onChange: (next: LinkedIds, knownItems: KnownLinkedItems) => void;
  /** When editing an existing entity, exclude its own ID from the relevant tab. */
  excludeSelf?: { type: LinkTab; id: string };
  contextAreaUuid?: string;
  contextSubjectUuid?: string;
  /** Icon-only trigger — useful for compact headers. */
  compactTrigger?: boolean;
  /** Disables the trigger button entirely. */
  disabled?: boolean;
};

type UncontrolledProps = {
  mode: 'uncontrolled';
  entityType: LinkTab;
  entityId: string;
  /** Called after a save succeeds so the parent can refresh its own state. */
  onLinksChanged?: () => void;
  initialLinkedDeckIds?: string[];
  initialLinkedNoteIds?: string[];
  initialLinkedTodoIds?: string[];
  /** Loader for the true server-side linked IDs, called each time the dialog opens. */
  loadLinkedIds?: () => Promise<Partial<LinkedIds>>;
  /** Saves the change set; resolves to true on success. */
  saveLinks: (changes: {
    deck: { add: string[]; remove: string[] };
    note: { add: string[]; remove: string[] };
    todo: { add: string[]; remove: string[] };
  }) => Promise<{ ok: true } | { ok: false; message: string }>;
  contextAreaUuid?: string;
  contextSubjectUuid?: string;
  compactTrigger?: boolean;
  /** Disables the trigger button entirely. */
  disabled?: boolean;
};

type LinkDialogProps = ControlledProps | UncontrolledProps;

// ── Per-tab metadata ─────────────────────────────────────────────────────────

const TAB_META: Record<LinkTab, {
  label: string;
  plural: string;
  searchPlaceholder: string;
  listEndpoint: string;
  searchType: 'deck' | 'note' | 'todo';
  serverType: 'flashcard_deck' | 'study_note' | 'todo_list';
  icon: typeof Layers;
  hrefPrefix: string;
}> = {
  deck: {
    label: 'Decks',
    plural: 'decks',
    searchPlaceholder: 'Search decks…',
    listEndpoint: '/api/decks',
    searchType: 'deck',
    serverType: 'flashcard_deck',
    icon: Layers,
    hrefPrefix: '/dashboard/decks',
  },
  note: {
    label: 'Notes',
    plural: 'notes',
    searchPlaceholder: 'Search notes…',
    listEndpoint: '/api/notes',
    searchType: 'note',
    serverType: 'study_note',
    icon: FileText,
    hrefPrefix: '/dashboard/notes',
  },
  todo: {
    label: 'Todos',
    plural: 'todo lists',
    searchPlaceholder: 'Search todos…',
    listEndpoint: '/api/todos',
    searchType: 'todo',
    serverType: 'todo_list',
    icon: CheckSquare,
    hrefPrefix: '/dashboard/todos',
  },
};

function todoHref(id: string) {
  return `/dashboard/todos?id=${id}`;
}

/** Page size for the "show all for area/subject" list's incremental rendering. */
const SHOW_ALL_PAGE_SIZE = 15;

// ── Handle ───────────────────────────────────────────────────────────────────

/** Imperative handle exposed via `ref` — lets parents open the dialog programmatically. */
export interface LinkDialogHandle {
  openDialog: () => void;
}

// ── Main component ───────────────────────────────────────────────────────────

export const LinkDialog = forwardRef<LinkDialogHandle, LinkDialogProps>(function LinkDialog(props, ref) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('deck');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-tab cached lists (browse mode)
  const [lists, setLists] = useState<Record<LinkTab, JsonApiResource[]>>({ deck: [], note: [], todo: [] });
  const [includedMap, setIncludedMap] = useState<Record<LinkTab, JsonApiResource[]>>({ deck: [], note: [], todo: [] });
  const [loadingList, setLoadingList] = useState<Record<LinkTab, boolean>>({ deck: false, note: false, todo: false });

  // Per-tab search state
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState('');
  // Whether the user has actually run a search / changed filters during this
  // dialog session. Used to pick a helpful empty-state message: a fresh open
  // with nothing visible should prompt to search rather than claim filters
  // excluded everything.
  const [searchedOnce, setSearchedOnce] = useState(false);
  const [filtersTouched, setFiltersTouched] = useState(false);
  // "Show all for area/subject" mode — entered via the link shown in the
  // search empty state. Lists every item in the filtered scope (excluding
  // already-linked ones), rendered progressively with infinite scroll.
  const [showAll, setShowAll] = useState(false);
  const [showAllCount, setShowAllCount] = useState(SHOW_ALL_PAGE_SIZE);

  // Browse filters (per tab)
  const [filterAreaId, setFilterAreaId] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');
  // Full taxonomy lists — same source as the area/subject selectors on the note
  // edit screen, so the filter dropdowns show every area (and every subject of
  // the selected area), not just terms present in the current tab's items.
  const [taxonomyAreas, setTaxonomyAreas] = useState<TaxonomyTerm[]>([]);
  const [taxonomySubjects, setTaxonomySubjects] = useState<TaxonomyTerm[]>([]);
  const [taxonomyAreasLoading, setTaxonomyAreasLoading] = useState(false);
  const [taxonomySubjectsLoading, setTaxonomySubjectsLoading] = useState(false);

  // Selection state — three buckets, copied from props on open
  const [local, setLocal] = useState<LinkedIds>({ deck: [], note: [], todo: [] });
  const [original, setOriginal] = useState<LinkedIds>({ deck: [], note: [], todo: [] });

  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const { linkDefault, loaded: prefsLoaded } = useMatchStrengthPreferences();

  // AI suggestions state
  const [aiResults, setAiResults] = useState<RelatedResult[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiLoaded, setAiLoaded] = useState(false);
  const [aiThreshold, setAiThreshold] = useState(MATCH_STRENGTH_DEFAULT);
  // Draft tracks the slider position visually; aiThreshold is only committed on mouseup/touchend.
  const [aiThresholdDraft, setAiThresholdDraft] = useState(MATCH_STRENGTH_DEFAULT);

  useEffect(() => {
    if (!prefsLoaded) return;
    setAiThreshold(linkDefault);
    setAiThresholdDraft(linkDefault);
  }, [prefsLoaded, linkDefault]);

  // Accumulates metadata for items we've seen across browse + search across all tabs
  type KnownInfo = { type: LinkTab; title: string; areaName?: string; subjectName?: string };
  const [known, setKnown] = useState<Map<string, KnownInfo>>(new Map());

  const isSearchMode = search.trim().length >= 2;
  const meta = activeTab !== 'ai' ? TAB_META[activeTab] : null;

  const excludeSelf = props.mode === 'controlled' ? props.excludeSelf : undefined;

  // Context entity — used to call the related-items endpoint for the AI tab.
  const contextEntityType: LinkTab | null =
    props.mode === 'uncontrolled'
      ? props.entityType
      : props.mode === 'controlled' && props.excludeSelf
        ? props.excludeSelf.type
        : null;
  const contextEntityId: string | null =
    props.mode === 'uncontrolled'
      ? props.entityId
      : props.mode === 'controlled' && props.excludeSelf
        ? props.excludeSelf.id
        : null;

  // ── Open / reset ───────────────────────────────────────────────────────────

  function initialSelectionFromProps(): LinkedIds {
    if (props.mode === 'controlled') {
      return {
        deck: [...props.selectedDeckIds],
        note: [...props.selectedNoteIds],
        todo: [...props.selectedTodoIds],
      };
    }
    return {
      deck: [...(props.initialLinkedDeckIds ?? [])],
      note: [...(props.initialLinkedNoteIds ?? [])],
      todo: [...(props.initialLinkedTodoIds ?? [])],
    };
  }

  const handleOpenChange = useCallback(
    async (next: boolean) => {
      setOpen(next);
      if (!next) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setSearch('');
        setSearchResults([]);
        setSearched(false);
        setSearchError('');
        setSearchedOnce(false);
        setFiltersTouched(false);
        setShowAll(false);
        setUrlInput('');
        setUrlError('');
        setSaveError('');
        setAiResults([]);
        setAiLoaded(false);
        setAiError('');
        setAiThreshold(linkDefault);
        setAiThresholdDraft(linkDefault);
        return;
      }

      const fromProps = initialSelectionFromProps();
      setLocal(fromProps);
      setOriginal(fromProps);

      setFilterAreaId(props.contextAreaUuid ?? '');
      setFilterSubjectId(props.contextAreaUuid ? (props.contextSubjectUuid ?? '') : '');

      if (activeTab !== 'ai' && lists[activeTab].length === 0 && !loadingList[activeTab]) {
        void loadList(activeTab);
      }
      setTimeout(() => searchInputRef.current?.focus(), 50);

      if (props.mode === 'uncontrolled' && props.loadLinkedIds) {
        try {
          const fresh = await props.loadLinkedIds();
          const merged: LinkedIds = {
            deck: fresh.deck ?? fromProps.deck,
            note: fresh.note ?? fromProps.note,
            todo: fresh.todo ?? fromProps.todo,
          };
          setLocal(merged);
          setOriginal(merged);
        } catch {
          // Fall back to the props-seeded values
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props, lists, loadingList, activeTab, linkDefault],
  );

  // ── Data loading ───────────────────────────────────────────────────────────

  async function loadList(tab: LinkTab) {
    setLoadingList((s) => ({ ...s, [tab]: true }));
    try {
      const res = await fetch(TAB_META[tab].listEndpoint);
      if (res.ok) {
        const data = await res.json();
        setLists((s) => ({ ...s, [tab]: data.data ?? [] }));
        setIncludedMap((s) => ({ ...s, [tab]: data.included ?? [] }));
      }
    } finally {
      setLoadingList((s) => ({ ...s, [tab]: false }));
    }
  }

  // Lazy-load a tab's list the first time the user switches to it while open.
  useEffect(() => {
    if (!open) return;
    if (activeTab !== 'ai' && lists[activeTab].length === 0 && !loadingList[activeTab]) {
      void loadList(activeTab);
    }
    // Reset tab-local UI on switch
    setShowAll(false);
    setSearch('');
    setSearchResults([]);
    setSearched(false);
    setSearchError('');
    setUrlInput('');
    setUrlError('');
    setFilterAreaId(props.contextAreaUuid ?? '');
    setFilterSubjectId(props.contextAreaUuid ? (props.contextSubjectUuid ?? '') : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, open]);

  // ── Taxonomy (full area/subject lists for the filter dropdowns) ─────────────

  // Fetch every area once per dialog session.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTaxonomyAreasLoading(true);
    fetch('/api/taxonomy?type=areas')
      .then((r) => r.json())
      .then((d: { data?: TaxonomyTerm[] }) => {
        if (!cancelled) setTaxonomyAreas(d.data ?? []);
      })
      .finally(() => {
        if (!cancelled) setTaxonomyAreasLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Fetch the full subject list whenever the selected area changes — mirrors
  // the area/subject selector behavior on the note edit screen.
  useEffect(() => {
    if (!open || !filterAreaId) {
      setTaxonomySubjects([]);
      return;
    }
    let cancelled = false;
    setTaxonomySubjectsLoading(true);
    fetch(`/api/taxonomy?type=subjects&area=${filterAreaId}`)
      .then((r) => r.json())
      .then((d: { data?: TaxonomyTerm[] }) => {
        if (!cancelled) setTaxonomySubjects(d.data ?? []);
      })
      .finally(() => {
        if (!cancelled) setTaxonomySubjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, filterAreaId]);

  // Fetch AI suggestions whenever aiLoaded is false and the AI tab is active.
  // aiLoaded is reset to false when the threshold changes (see slider handler),
  // which triggers a fresh fetch with the new score_threshold.
  useEffect(() => {
    if (!open || activeTab !== 'ai' || aiLoaded || !contextEntityType || !contextEntityId) return;
    setAiLoading(true);
    setAiError('');
    const qs = new URLSearchParams({ limit: '20', score_threshold: String(aiThreshold) });
    fetch(`/api/search/related/${contextEntityType}/${contextEntityId}?${qs}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('failed');
        const data: { results?: RelatedResult[] } = await res.json();
        const results = Array.isArray(data.results) ? data.results : [];
        setAiResults(results.filter((r) => r.uuid !== contextEntityId));
        setAiLoaded(true);
      })
      .catch(() => {
        setAiError("Couldn't load AI suggestions right now.");
      })
      .finally(() => {
        setAiLoading(false);
      });
  // contextEntityType and contextEntityId are derived from stable props — no object identity issue
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTab, aiLoaded, contextEntityType, contextEntityId, aiThreshold]);

  const doSearch = useCallback(
    (q: string, tab: LinkTab, area: string, subject: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (q.trim().length < 2) {
        setSearchResults([]);
        setSearchLoading(false);
        setSearched(false);
        setSearchError('');
        return;
      }
      setSearchLoading(true);
      debounceRef.current = setTimeout(async () => {
        setSearchError('');
        try {
          const params = new URLSearchParams({ q: q.trim(), type: TAB_META[tab].searchType });
          if (area) params.set('area', area);
          if (subject) params.set('subject', subject);
          const res = await fetch(`/api/search?${params}`);
          if (res.ok) {
            const data = await res.json();
            const expected = TAB_META[tab].serverType;
            const excludeId =
              excludeSelf && excludeSelf.type === tab ? excludeSelf.id : null;
            setSearchResults(
              (data.results ?? []).filter(
                (r: SearchResult) => r.type === expected && r.uuid !== excludeId,
              ),
            );
          } else {
            const data = await res.json().catch(() => ({}));
            setSearchResults([]);
            setSearchError(
              userFacingMessageForApiError(res, data, SEARCH_HTTP_FALLBACK_MESSAGE),
            );
          }
        } catch {
          setSearchResults([]);
          setSearchError(messageWhenSearchRequestThrows());
        } finally {
          setSearchLoading(false);
          setSearched(true);
          setSearchedOnce(true);
        }
      }, 300);
    },
    [excludeSelf],
  );

  useEffect(() => {
    if (activeTab === 'ai') return;
    doSearch(search, activeTab, filterAreaId, filterSubjectId);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, activeTab, filterAreaId, filterSubjectId, doSearch]);

  // Typing a new search leaves "show all" mode.
  useEffect(() => {
    if (isSearchMode) setShowAll(false);
  }, [isSearchMode]);

  // ── Derived browse data ────────────────────────────────────────────────────

  const tabItems = activeTab !== 'ai' ? lists[activeTab] : [];
  const tabIncluded = activeTab !== 'ai' ? includedMap[activeTab] : [];

  const browseable = useMemo(() => {
    if (activeTab === 'ai') return [];
    if (excludeSelf && excludeSelf.type === activeTab) {
      return tabItems.filter((item) => item.id !== excludeSelf.id);
    }
    return tabItems;
  }, [tabItems, excludeSelf, activeTab]);

  const areaOptions = useMemo(
    () =>
      taxonomyAreas
        .map((t) => ({ id: t.id, name: t.attributes.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [taxonomyAreas],
  );

  const subjectOptions = useMemo(
    () =>
      taxonomySubjects
        .map((t) => ({ id: t.id, name: t.attributes.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [taxonomySubjects],
  );

  // Keep filter state in sync with the dropdown options. A preset
  // area/subject (from the note's context) can be stale — e.g. the term was
  // deleted — so drop selections that don't resolve to a real taxonomy term.
  // The loading guards keep the preset alive while the taxonomy lists are
  // still being fetched.
  useEffect(() => {
    if (activeTab === 'ai') return;
    if (!taxonomyAreasLoading && filterAreaId && !areaOptions.some((a) => a.id === filterAreaId)) {
      setFilterAreaId('');
      setFilterSubjectId('');
    } else if (
      !taxonomySubjectsLoading &&
      filterAreaId &&
      filterSubjectId &&
      !subjectOptions.some((s) => s.id === filterSubjectId)
    ) {
      setFilterSubjectId('');
    }
  }, [
    activeTab,
    taxonomyAreasLoading,
    taxonomySubjectsLoading,
    filterAreaId,
    filterSubjectId,
    areaOptions,
    subjectOptions,
  ]);

  const visibleItems = useMemo(() => {
    return browseable.filter((item) => {
      const areaIds = toRelIds(item.relationships?.field_area?.data);
      const subjectIds = toRelIds(item.relationships?.field_subject?.data);
      if (filterAreaId && !areaIds.includes(filterAreaId)) return false;
      if (filterAreaId && filterSubjectId && !subjectIds.includes(filterSubjectId)) return false;
      return true;
    });
  }, [browseable, filterAreaId, filterSubjectId]);

  // Search results are re-fetched server-side whenever the area/subject
  // filters change, but the request is debounced — this client-side pass
  // narrows the previous results immediately while the new ones load.
  const filteredSearchResults = useMemo(() => {
    return searchResults.filter((r) => {
      if (filterAreaId && !r.areas.some((a) => a.uuid === filterAreaId)) return false;
      if (filterAreaId && filterSubjectId && !r.subjects.some((s) => s.uuid === filterSubjectId)) return false;
      return true;
    });
  }, [searchResults, filterAreaId, filterSubjectId]);

  // Display names for the selected filters — used by the "Or show all for…"
  // affordance and the show-all list header, so they track the dropdowns live.
  const filterAreaName = filterAreaId
    ? (areaOptions.find((a) => a.id === filterAreaId)?.name ?? 'this area')
    : '';
  const filterSubjectName = filterAreaId && filterSubjectId
    ? (subjectOptions.find((s) => s.id === filterSubjectId)?.name ?? 'this subject')
    : '';
  const filterScopeLabel = [filterAreaName, filterSubjectName].filter(Boolean).join(' · ');

  // Only offer "show all" when the area filter is genuinely active — i.e., the
  // area (preset from the note's context or picked in the dropdown) actually
  // appears in the filter dropdown's taxonomy options.
  const areaFilterActive = !!filterAreaId && areaOptions.some((a) => a.id === filterAreaId);
  const subjectFilterActive =
    areaFilterActive && !!filterSubjectId && subjectOptions.some((s) => s.id === filterSubjectId);

  // Shared "Or show all for…" affordance — rendered in the search AND browse
  // empty states alike, whenever an area filter is visibly selected.
  const showAllLink = areaFilterActive ? (
    <button
      onClick={enterShowAll}
      className="text-xs text-primary underline-offset-2 transition-colors hover:underline"
      type="button"
    >
      Or show all for {filterAreaName}
      {subjectFilterActive ? ` and ${filterSubjectName}` : ''}
    </button>
  ) : null;

  // Everything in the current filter scope that isn't linked yet. Excludes the
  // links that existed when the dialog opened (not draft selections made here),
  // so rows don't vanish while the user checks them.
  const showAllItems = useMemo(() => {
    if (!showAll || activeTab === 'ai') return [];
    const linked = new Set(original[activeTab]);
    return visibleItems.filter((item) => !linked.has(item.id));
  }, [showAll, activeTab, visibleItems, original]);

  function enterShowAll() {
    setShowAll(true);
    setShowAllCount(SHOW_ALL_PAGE_SIZE);
    // Leave search mode but keep the area/subject filters applied.
    setSearch('');
    setSearchResults([]);
    setSearched(false);
    setSearchError('');
  }

  // Leave the show-all view and return to the regular filtered browse list.
  function exitShowAll() {
    setShowAll(false);
    setShowAllCount(SHOW_ALL_PAGE_SIZE);
  }

  // Infinite scroll for the show-all list: when the user nears the bottom of
  // the scroll container, reveal the next page of items.
  function handleListScroll(e: UIEvent<HTMLDivElement>) {
    if (!showAll) return;
    const el = e.currentTarget;
    if (
      showAllCount < showAllItems.length &&
      el.scrollTop + el.clientHeight >= el.scrollHeight - 48
    ) {
      setShowAllCount((c) => c + SHOW_ALL_PAGE_SIZE);
    }
  }

  function itemMeta(item: JsonApiResource) {
    const areaIds = toRelIds(item.relationships?.field_area?.data);
    const subjectIds = toRelIds(item.relationships?.field_subject?.data);
    const areaName = areaIds[0]
      ? (tabIncluded.find((r) => r.id === areaIds[0])?.attributes.name as string | undefined)
      : undefined;
    const subjectName = subjectIds[0]
      ? (tabIncluded.find((r) => r.id === subjectIds[0])?.attributes.name as string | undefined)
      : undefined;
    return { areaName, subjectName };
  }

  // Absorb metadata into the cross-tab `known` map so the "Currently linked"
  // section can label items even after the user switches tabs.
  useEffect(() => {
    setKnown((prev) => {
      const next = new Map(prev);
      (['deck', 'note', 'todo'] as LinkTab[]).forEach((tab) => {
        lists[tab].forEach((item) => {
          const areaIds = toRelIds(item.relationships?.field_area?.data);
          const subjectIds = toRelIds(item.relationships?.field_subject?.data);
          const areaName = areaIds[0]
            ? (includedMap[tab].find((r) => r.id === areaIds[0])?.attributes.name as string | undefined)
            : undefined;
          const subjectName = subjectIds[0]
            ? (includedMap[tab].find((r) => r.id === subjectIds[0])?.attributes.name as string | undefined)
            : undefined;
          next.set(item.id, {
            type: tab,
            title: item.attributes.title as string,
            areaName,
            subjectName,
          });
        });
      });
      return next;
    });
  }, [lists, includedMap]);

  // Also absorb search results into `known`.
  useEffect(() => {
    if (searchResults.length === 0 || activeTab === 'ai') return;
    setKnown((prev) => {
      const next = new Map(prev);
      searchResults.forEach((r) => {
        if (!next.has(r.uuid)) {
          next.set(r.uuid, {
            type: activeTab,
            title: r.title,
            areaName: r.areas[0]?.name ?? undefined,
            subjectName: r.subjects[0]?.name ?? undefined,
          });
        }
      });
      return next;
    });
  }, [searchResults, activeTab]);

  // Absorb AI results into `known`.
  useEffect(() => {
    if (aiResults.length === 0) return;
    setKnown((prev) => {
      const next = new Map(prev);
      aiResults.forEach((r) => {
        if (!next.has(r.uuid)) {
          next.set(r.uuid, {
            type: bundleToTab(r.type),
            title: r.title,
            areaName: r.areas[0]?.name ?? undefined,
            subjectName: r.subjects[0]?.name ?? undefined,
          });
        }
      });
      return next;
    });
  }, [aiResults]);

  // ── Actions ────────────────────────────────────────────────────────────────

  function toggle(id: string, tab: LinkTab = activeTab as LinkTab) {
    setLocal((prev) => {
      const bucket = prev[tab];
      const nextBucket = bucket.includes(id)
        ? bucket.filter((x) => x !== id)
        : [...bucket, id];
      return { ...prev, [tab]: nextBucket };
    });
  }

  function handleAddByUrl() {
    setUrlError('');
    const input = urlInput.trim();
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const match = input.match(uuidRegex);
    if (!match) {
      setUrlError('No valid ID found in the URL.');
      return;
    }
    const uuid = match[0];
    const item = tabItems.find((d) => d.id === uuid);
    if (!item) {
      setUrlError(`Not found or doesn't belong to you.`);
      return;
    }
    if (excludeSelf && excludeSelf.type === activeTab && excludeSelf.id === uuid) {
      setUrlError('You cannot link an item to itself.');
      return;
    }
    if (!local[activeTab as LinkTab].includes(uuid)) {
      toggle(uuid, activeTab as LinkTab);
    }
    setUrlInput('');
  }

  async function handleDone() {
    if (props.mode === 'controlled') {
      // Build a flat map of UUID → {title, type} for every selected item that
      // the dialog has resolved metadata for.  The caller can use this to
      // update its display state immediately without waiting for a save.
      const knownItems: KnownLinkedItems = {};
      for (const [id, info] of known.entries()) {
        const bundle =
          info.type === 'note' ? 'study_note'
          : info.type === 'todo' ? 'todo_list'
          : 'flashcard_deck';
        knownItems[id] = { title: info.title, type: bundle };
      }
      props.onChange(local, knownItems);
      setOpen(false);
      return;
    }

    const changes = (['deck', 'note', 'todo'] as LinkTab[]).reduce(
      (acc, tab) => {
        acc[tab] = {
          add: local[tab].filter((id) => !original[tab].includes(id)),
          remove: original[tab].filter((id) => !local[tab].includes(id)),
        };
        return acc;
      },
      {} as { deck: { add: string[]; remove: string[] }; note: { add: string[]; remove: string[] }; todo: { add: string[]; remove: string[] } },
    );

    const empty =
      changes.deck.add.length === 0 && changes.deck.remove.length === 0 &&
      changes.note.add.length === 0 && changes.note.remove.length === 0 &&
      changes.todo.add.length === 0 && changes.todo.remove.length === 0;
    if (empty) {
      setOpen(false);
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const result = await props.saveLinks(changes);
      if (result.ok) {
        props.onLinksChanged?.();
        setOpen(false);
      } else {
        setSaveError(result.message);
      }
    } catch {
      setSaveError('An unexpected error occurred.');
    } finally {
      setSaving(false);
    }
  }

  // ── Derived / counts ───────────────────────────────────────────────────────

  const totalSelected = local.deck.length + local.note.length + local.todo.length;
  const displayedCount =
    props.mode === 'controlled'
      ? (props.selectedDeckIds.length + props.selectedNoteIds.length + props.selectedTodoIds.length)
      : (original.deck.length + original.note.length + original.todo.length);

  const hasFilters = !!(filterAreaId || filterSubjectId);

  // ── Row renderer ───────────────────────────────────────────────────────────

  function renderRow(id: string, title: string, areaName?: string, subjectName?: string) {
    // renderRow is only called when activeTab is a LinkTab, never 'ai'
    const tab = activeTab as LinkTab;
    const checked = local[tab].includes(id);
    return (
      <label
        key={id}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors',
          checked && 'bg-primary/5',
        )}
      >
        <Checkbox
          checked={checked}
          onCheckedChange={() => toggle(id, tab)}
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

  function renderAiRow(result: RelatedResult) {
    const tab = bundleToTab(result.type);
    const checked = local[tab].includes(result.uuid);
    const TypeIcon = TAB_META[tab].icon;
    const typeLabel = tab === 'note' ? 'Note' : tab === 'deck' ? 'Deck' : 'Todo';
    return (
      <label
        key={result.uuid}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors',
          checked && 'bg-primary/5',
        )}
      >
        <Checkbox
          checked={checked}
          onCheckedChange={() => toggle(result.uuid, tab)}
          className="shrink-0"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{result.title}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TypeIcon className="h-3 w-3 shrink-0" aria-hidden />
            <span>{typeLabel}</span>
            {result.areas[0] && (
              <>
                <span aria-hidden>·</span>
                <span>{result.areas[0].name}</span>
              </>
            )}
          </p>
        </div>
        <span
          className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
          aria-label={`${Math.round(result.score * 100)} percent match`}
        >
          {Math.round(result.score * 100)}%
        </span>
      </label>
    );
  }

  // ── Linked list renderer ───────────────────────────────────────────────────

  function hrefFor(tab: LinkTab, id: string) {
    if (tab === 'todo') return todoHref(id);
    return `${TAB_META[tab].hrefPrefix}/${id}`;
  }

  function LinkedChip({ id }: { id: string }) {
    const info = known.get(id);
    const tab: LinkTab =
      info?.type ??
      (local.deck.includes(id) ? 'deck' : local.note.includes(id) ? 'note' : 'todo');
    const Icon = TAB_META[tab].icon;
    return (
      <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <a
          href={hrefFor(tab, id)}
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
          href={hrefFor(tab, id)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label={`Open ${TAB_META[tab].label.toLowerCase()} in new tab`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <button
          onClick={() => toggle(id, tab)}
          className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
          aria-label="Remove link"
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const compactTrigger = (props.mode === 'controlled' || props.mode === 'uncontrolled')
    ? (props as { compactTrigger?: boolean }).compactTrigger
    : false;

  const isDisabled = (props.mode === 'controlled' || props.mode === 'uncontrolled')
    ? (props as { disabled?: boolean }).disabled
    : false;

  // Expose openDialog() via ref so parents can programmatically open the dialog
  // (e.g. from the pencil icon in the Related panel).
  useImperativeHandle(ref, () => ({
    openDialog: () => void handleOpenChange(true),
  }), [handleOpenChange]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size={compactTrigger ? 'sm' : undefined} disabled={isDisabled}>
            <Link2 className="h-4 w-4" />
            Link
            {displayedCount > 0 && (
              <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                {displayedCount}
              </span>
            )}
          </Button>
        }
      />

      <DialogContent className="sm:max-w-lg flex flex-col max-h-[85vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Link items
            {totalSelected > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                · {totalSelected} selected
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 flex-1 overflow-hidden min-h-0">
          {/* Search bar — hidden on AI tab */}
          <div className={cn(
            'flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5',
            activeTab === 'ai' && 'hidden',
          )}>
            {searchLoading ? (
              <Loader2 className="h-4 w-4 shrink-0 text-muted-foreground animate-spin" />
            ) : (
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={meta?.searchPlaceholder}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear search"
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as ActiveTab)}
          >
            <TabsList className="w-full">
              <TabsTrigger value="deck">
                Decks
                {local.deck.length > 0 && (
                  <span className="ml-1 rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary">
                    {local.deck.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="note">
                Notes
                {local.note.length > 0 && (
                  <span className="ml-1 rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary">
                    {local.note.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="todo">
                Todos
                {local.todo.length > 0 && (
                  <span className="ml-1 rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary">
                    {local.todo.length}
                  </span>
                )}
              </TabsTrigger>
              {contextEntityId && (
                <TabsTrigger value="ai" className="gap-1">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  AI
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>

          {/* AI tab — match-strength slider */}
          {activeTab === 'ai' && contextEntityId && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="ai-score-threshold"
                  className="text-xs text-muted-foreground"
                >
                  Match strength
                </label>
                <span className="font-mono text-xs text-foreground tabular-nums">
                  {aiThresholdDraft.toFixed(2)}
                </span>
              </div>
              <input
                id="ai-score-threshold"
                type="range"
                min={MATCH_STRENGTH_MIN}
                max={MATCH_STRENGTH_MAX}
                step={MATCH_STRENGTH_STEP}
                value={aiThresholdDraft}
                onChange={(e) => setAiThresholdDraft(parseFloat(e.target.value))}
                onMouseUp={(e) => {
                  const next = parseFloat((e.target as HTMLInputElement).value);
                  setAiThreshold(next);
                  setAiLoaded(false);
                }}
                onTouchEnd={(e) => {
                  const next = parseFloat((e.target as HTMLInputElement).value);
                  setAiThreshold(next);
                  setAiLoaded(false);
                }}
                disabled={aiLoading}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary disabled:opacity-60"
              />
              <p className="text-[11px] text-muted-foreground">
                Too many results? Raise the threshold. Too few? Lower it.
              </p>
            </div>
          )}

          {/* Area/subject filters — shown while browsing and searching alike */}
          {activeTab !== 'ai' && areaOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={filterAreaId || '__all__'}
                onValueChange={(v) => {
                  setFiltersTouched(true);
                  const next = !v || v === '__all__' ? '' : v;
                  setFilterAreaId(next);
                  setFilterSubjectId('');
                  // Clearing the area resets the search term — the results
                  // were scoped to that area, so start fresh.
                  if (!next) setSearch('');
                }}
              >
                <SelectTrigger className="h-7 w-auto min-w-28 text-xs">
                  <span className={cn('truncate', !filterAreaId && 'text-muted-foreground')}>
                    {filterAreaId
                      ? (areaOptions.find((a) => a.id === filterAreaId)?.name ?? 'All areas')
                      : 'All areas'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All areas</SelectItem>
                  {areaOptions.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {filterAreaId && (
                <Select
                  value={filterSubjectId || '__all__'}
                  onValueChange={(v) => { setFiltersTouched(true); setFilterSubjectId(!v || v === '__all__' ? '' : v); }}
                >
                  <SelectTrigger className="h-7 w-auto min-w-28 text-xs">
                    <span className={cn('truncate', !filterSubjectId && 'text-muted-foreground')}>
                      {filterSubjectId
                        ? (subjectOptions.find((s) => s.id === filterSubjectId)?.name ?? 'All subjects')
                        : 'All subjects'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All subjects</SelectItem>
                    {subjectOptions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {hasFilters && (
                <button
                  onClick={() => {
                    setFilterAreaId('');
                    setFilterSubjectId('');
                    setSearch('');
                  }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  type="button"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              )}
            </div>
          )}

          {/* List */}
          <div
            onScroll={handleListScroll}
            className="flex-1 overflow-y-auto min-h-0 rounded-md border border-border [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
          >
            {activeTab === 'ai' ? (
              aiLoading ? (
                <div className="p-3 flex flex-col gap-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
                  ))}
                </div>
              ) : aiError ? (
                <p className="py-12 px-4 text-center text-sm text-muted-foreground">{aiError}</p>
              ) : aiResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground gap-2">
                  <Sparkles className="h-5 w-5 opacity-40" aria-hidden />
                  <span>No related items found yet.</span>
                  <span className="text-xs">Keep adding content and AI suggestions will appear here.</span>
                </div>
              ) : (
                <>
                  <p className="px-3 pt-2.5 pb-1 text-xs text-muted-foreground">
                    Related items found by AI
                  </p>
                  <div className="divide-y divide-border">
                    {aiResults.map((r) => renderAiRow(r))}
                  </div>
                </>
              )
            ) : isSearchMode ? (
              searchLoading && !searched ? (
                <div className="p-3 flex flex-col gap-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
                  ))}
                </div>
              ) : !searched ? (
                <p className="py-12 text-center text-sm text-muted-foreground">Searching…</p>
              ) : searchError ? (
                <p
                  className={cn(
                    'py-12 px-4 text-center text-sm',
                    searchError === SESSION_EXPIRED_MESSAGE
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                  )}
                >
                  {searchError}
                </p>
              ) : filteredSearchResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground gap-2">
                  {meta && <meta.icon className="h-5 w-5 opacity-40" />}
                  <span>
                    {searchResults.length > 0
                      ? <>No {meta?.plural} match &ldquo;{search.trim()}&rdquo; with the selected filters.</>
                      : <>No {meta?.plural} found for &ldquo;{search.trim()}&rdquo;</>}
                  </span>
                  {showAllLink}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredSearchResults.map((r) =>
                    renderRow(r.uuid, r.title, r.areas[0]?.name, r.subjects[0]?.name),
                  )}
                </div>
              )
            ) : showAll ? (
              showAllItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground gap-2">
                  {meta && <meta.icon className="h-5 w-5 opacity-40" />}
                  <span>
                    {visibleItems.length === 0
                      ? hasFilters
                        ? `No ${meta?.plural} in ${filterScopeLabel}.`
                        : `You have no ${meta?.plural} yet.`
                      : `Everything ${filterScopeLabel ? `in ${filterScopeLabel} ` : ''}is already linked.`}
                  </span>
                  <button
                    onClick={exitShowAll}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    type="button"
                  >
                    <X className="h-3 w-3" />
                    Back
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1">
                    <p className="text-xs text-muted-foreground">
                      All {meta?.plural} in {filterScopeLabel || 'all areas'} ({showAllItems.length})
                    </p>
                    <button
                      onClick={exitShowAll}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      type="button"
                    >
                      <X className="h-3 w-3" />
                      Back
                    </button>
                  </div>
                  <div className="divide-y divide-border">
                    {showAllItems.slice(0, showAllCount).map((item) => {
                      const { areaName, subjectName } = itemMeta(item);
                      return renderRow(
                        item.id,
                        item.attributes.title as string,
                        areaName,
                        subjectName,
                      );
                    })}
                  </div>
                  {showAllCount < showAllItems.length && (
                    <div className="py-3 text-center text-xs text-muted-foreground">
                      Scroll for more…
                    </div>
                  )}
                </>
              )
            ) : (
              loadingList[activeTab as LinkTab] ? (
                <div className="p-3 flex flex-col gap-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
                  ))}
                </div>
              ) : visibleItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground gap-2">
                  {meta && <meta.icon className="h-5 w-5 opacity-40" />}
                  <span>
                    {browseable.length === 0
                      ? `You have no ${meta?.plural} yet.`
                      : filtersTouched || searchedOnce
                        ? `No ${meta?.plural} match the selected filters.`
                        : 'Enter a search term to find results'}
                  </span>
                  {showAllLink}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {visibleItems.map((item) => {
                    const { areaName, subjectName } = itemMeta(item);
                    return renderRow(
                      item.id,
                      item.attributes.title as string,
                      areaName,
                      subjectName,
                    );
                  })}
                </div>
              )
            )}
          </div>

          {/* Paste URL / ID — resolves against the active tab's items */}
          {activeTab !== 'ai' && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Or paste URL / ID</Label>
              <div className="flex gap-2">
                <Input
                  value={urlInput}
                  onChange={(e) => { setUrlInput(e.target.value); setUrlError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddByUrl()}
                  placeholder="https://… or UUID"
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
          )}

          {/* Currently linked (across all tabs) */}
          {totalSelected > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Currently linked</Label>
              <div className="flex flex-col gap-1 max-h-36 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
                {(['deck', 'note', 'todo'] as LinkTab[]).flatMap((tab) =>
                  local[tab].map((id) => <LinkedChip key={`${tab}:${id}`} id={id} />),
                )}
              </div>
            </div>
          )}

          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
        </div>

        <DialogFooter showCloseButton>
          <Button onClick={handleDone} disabled={saving}>
            {saving ? 'Saving…' : 'Done'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
