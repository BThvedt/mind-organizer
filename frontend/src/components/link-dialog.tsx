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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CheckSquare,
  ExternalLink,
  FileText,
  Layers,
  Link2,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SESSION_EXPIRED_MESSAGE,
  SEARCH_HTTP_FALLBACK_MESSAGE,
  messageWhenSearchRequestThrows,
  userFacingMessageForApiError,
} from '@/lib/api-client-messages';
import type { JsonApiResource } from '@/lib/drupal';

// ── Types ────────────────────────────────────────────────────────────────────

export type LinkTab = 'deck' | 'note' | 'todo';

interface SearchResult {
  uuid: string;
  type: string;
  title: string;
  area: { uuid: string; name: string } | null;
  subject: { uuid: string; name: string } | null;
}

interface LinkedIds {
  deck: string[];
  note: string[];
  todo: string[];
}

type ControlledProps = {
  mode: 'controlled';
  selectedDeckIds: string[];
  selectedNoteIds: string[];
  selectedTodoIds: string[];
  onChange: (next: LinkedIds) => void;
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

// ── Main component ───────────────────────────────────────────────────────────

export function LinkDialog(props: LinkDialogProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<LinkTab>('deck');
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

  // Browse filters (per tab)
  const [filterAreaId, setFilterAreaId] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');

  // Selection state — three buckets, copied from props on open
  const [local, setLocal] = useState<LinkedIds>({ deck: [], note: [], todo: [] });
  const [original, setOriginal] = useState<LinkedIds>({ deck: [], note: [], todo: [] });

  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Accumulates metadata for items we've seen across browse + search across all tabs
  type KnownInfo = { type: LinkTab; title: string; areaName?: string; subjectName?: string };
  const [known, setKnown] = useState<Map<string, KnownInfo>>(new Map());

  const isSearchMode = search.trim().length >= 2;
  const meta = TAB_META[activeTab];

  const excludeSelf = props.mode === 'controlled' ? props.excludeSelf : undefined;

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
        setUrlInput('');
        setUrlError('');
        setSaveError('');
        return;
      }

      const fromProps = initialSelectionFromProps();
      setLocal(fromProps);
      setOriginal(fromProps);

      setFilterAreaId(props.contextAreaUuid ?? '');
      setFilterSubjectId(props.contextAreaUuid ? (props.contextSubjectUuid ?? '') : '');

      if (lists[activeTab].length === 0 && !loadingList[activeTab]) {
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
    [props, lists, loadingList, activeTab],
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
    if (lists[activeTab].length === 0 && !loadingList[activeTab]) {
      void loadList(activeTab);
    }
    // Reset tab-local UI on switch
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

  const doSearch = useCallback(
    (q: string, tab: LinkTab) => {
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
        }
      }, 300);
    },
    [excludeSelf],
  );

  useEffect(() => {
    doSearch(search, activeTab);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, activeTab, doSearch]);

  // ── Derived browse data ────────────────────────────────────────────────────

  const tabItems = lists[activeTab];
  const tabIncluded = includedMap[activeTab];

  const browseable = useMemo(() => {
    if (excludeSelf && excludeSelf.type === activeTab) {
      return tabItems.filter((item) => item.id !== excludeSelf.id);
    }
    return tabItems;
  }, [tabItems, excludeSelf, activeTab]);

  const uniqueAreas = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    browseable.forEach((item) => {
      const rel = item.relationships?.field_area?.data;
      const id = rel && !Array.isArray(rel) ? rel.id : null;
      if (id && !seen.has(id)) {
        seen.add(id);
        const name = tabIncluded.find((r) => r.id === id)?.attributes.name as string | undefined;
        if (name) result.push({ id, name });
      }
    });
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [browseable, tabIncluded]);

  const uniqueSubjectsForArea = useMemo(() => {
    if (!filterAreaId) return [];
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    browseable.forEach((item) => {
      const aRel = item.relationships?.field_area?.data;
      const aId = aRel && !Array.isArray(aRel) ? aRel.id : null;
      if (aId !== filterAreaId) return;
      const sRel = item.relationships?.field_subject?.data;
      const sId = sRel && !Array.isArray(sRel) ? sRel.id : null;
      if (sId && !seen.has(sId)) {
        seen.add(sId);
        const name = tabIncluded.find((r) => r.id === sId)?.attributes.name as string | undefined;
        if (name) result.push({ id: sId, name });
      }
    });
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [browseable, tabIncluded, filterAreaId]);

  const visibleItems = useMemo(() => {
    return browseable.filter((item) => {
      const aRel = item.relationships?.field_area?.data;
      const sRel = item.relationships?.field_subject?.data;
      const aId = aRel && !Array.isArray(aRel) ? aRel.id : null;
      const sId = sRel && !Array.isArray(sRel) ? sRel.id : null;
      if (filterAreaId && aId !== filterAreaId) return false;
      if (filterAreaId && filterSubjectId && sId !== filterSubjectId) return false;
      return true;
    });
  }, [browseable, filterAreaId, filterSubjectId]);

  function itemMeta(item: JsonApiResource) {
    const aRel = item.relationships?.field_area?.data;
    const sRel = item.relationships?.field_subject?.data;
    const aId = aRel && !Array.isArray(aRel) ? aRel.id : null;
    const sId = sRel && !Array.isArray(sRel) ? sRel.id : null;
    const areaName = aId
      ? (tabIncluded.find((r) => r.id === aId)?.attributes.name as string | undefined)
      : undefined;
    const subjectName = sId
      ? (tabIncluded.find((r) => r.id === sId)?.attributes.name as string | undefined)
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
          const aRel = item.relationships?.field_area?.data;
          const sRel = item.relationships?.field_subject?.data;
          const aId = aRel && !Array.isArray(aRel) ? aRel.id : null;
          const sId = sRel && !Array.isArray(sRel) ? sRel.id : null;
          const areaName = aId
            ? (includedMap[tab].find((r) => r.id === aId)?.attributes.name as string | undefined)
            : undefined;
          const subjectName = sId
            ? (includedMap[tab].find((r) => r.id === sId)?.attributes.name as string | undefined)
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
    if (searchResults.length === 0) return;
    setKnown((prev) => {
      const next = new Map(prev);
      searchResults.forEach((r) => {
        if (!next.has(r.uuid)) {
          next.set(r.uuid, {
            type: activeTab,
            title: r.title,
            areaName: r.area?.name ?? undefined,
            subjectName: r.subject?.name ?? undefined,
          });
        }
      });
      return next;
    });
  }, [searchResults, activeTab]);

  // ── Actions ────────────────────────────────────────────────────────────────

  function toggle(id: string, tab: LinkTab = activeTab) {
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
    if (!local[activeTab].includes(uuid)) {
      toggle(uuid, activeTab);
    }
    setUrlInput('');
  }

  async function handleDone() {
    if (props.mode === 'controlled') {
      props.onChange(local);
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
    const checked = local[activeTab].includes(id);
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
          onCheckedChange={() => toggle(id)}
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
              placeholder={meta.searchPlaceholder}
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
            onValueChange={(v) => setActiveTab(v as LinkTab)}
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
            </TabsList>
          </Tabs>

          {/* Browse-mode filters */}
          {!isSearchMode && !loadingList[activeTab] && uniqueAreas.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={filterAreaId || '__all__'}
                onValueChange={(v) => {
                  setFilterAreaId(!v || v === '__all__' ? '' : v);
                  setFilterSubjectId('');
                }}
              >
                <SelectTrigger className="h-7 w-auto min-w-28 text-xs">
                  <span className={cn('truncate', !filterAreaId && 'text-muted-foreground')}>
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
                  <SelectTrigger className="h-7 w-auto min-w-28 text-xs">
                    <span className={cn('truncate', !filterSubjectId && 'text-muted-foreground')}>
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
                  type="button"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              )}
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto min-h-0 rounded-md border border-border">
            {isSearchMode ? (
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
              ) : searchResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground gap-2">
                  <meta.icon className="h-5 w-5 opacity-40" />
                  <span>No {meta.plural} found for &ldquo;{search.trim()}&rdquo;</span>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {searchResults.map((r) =>
                    renderRow(r.uuid, r.title, r.area?.name, r.subject?.name),
                  )}
                </div>
              )
            ) : (
              loadingList[activeTab] ? (
                <div className="p-3 flex flex-col gap-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
                  ))}
                </div>
              ) : visibleItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground gap-2">
                  <meta.icon className="h-5 w-5 opacity-40" />
                  <span>
                    {browseable.length === 0
                      ? `You have no ${meta.plural} yet.`
                      : `No ${meta.plural} match the selected filters.`}
                  </span>
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

          {/* Currently linked (across all tabs) */}
          {totalSelected > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Currently linked</Label>
              <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
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
}
