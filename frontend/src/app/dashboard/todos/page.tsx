'use client';

import { Suspense, useEffect, useState, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { ArrowLeft, Plus, Trash2, ChevronLeft, CheckSquare, X, ChevronDown, GripVertical, Check } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { JsonApiResource } from '@/lib/drupal';
import {
  MUTATION_QUEUED_MESSAGE,
  OFFLINE_ACTION_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  messageWhenNetworkRequestThrows,
  userFacingMessageForApiError,
} from '@/lib/api-client-messages';

// ── Sortable item ──────────────────────────────────────────────────────────────

type DragListeners = ReturnType<typeof useSortable>['listeners'];
const SortableDragContext = createContext<DragListeners>(undefined);

function SortableTodoItem({
  id,
  isDeleting,
  isExpanded,
  children,
}: {
  id: string;
  isDeleting: boolean;
  isExpanded: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <SortableDragContext.Provider value={listeners}>
      <li
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={cn(
          'rounded-lg border transition-colors',
          isExpanded ? 'border-border bg-muted/20' : 'border-transparent hover:border-border hover:bg-muted/40',
          isDeleting && 'opacity-50 pointer-events-none',
          isDragging && 'shadow-md opacity-60 z-10'
        )}
        {...attributes}
      >
        {children}
      </li>
    </SortableDragContext.Provider>
  );
}

function DragHandle() {
  const listeners = useContext(SortableDragContext);
  return (
    <button
      type="button"
      {...listeners}
      className="flex-none cursor-grab active:cursor-grabbing text-muted-foreground opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity touch-none"
      aria-label="Drag to reorder"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
}

// ── Priority dropdown ──────────────────────────────────────────────────────────

type Priority = 'high' | 'med' | 'low' | '';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const PRIORITY_OPTIONS: { value: Priority; label: string; triggerColor: string; optionColor: string }[] = [
  { value: '',     label: '—',    triggerColor: 'bg-transparent text-muted-foreground border-border',           optionColor: 'text-muted-foreground hover:bg-muted' },
  { value: 'high', label: 'High', triggerColor: 'bg-red-500 text-white border-red-500',                        optionColor: 'text-red-500 hover:bg-red-500 hover:text-white' },
  { value: 'med',  label: 'Med',  triggerColor: 'bg-yellow-500 text-white border-yellow-500',                  optionColor: 'text-yellow-500 hover:bg-yellow-500 hover:text-white' },
  { value: 'low',  label: 'Low',  triggerColor: 'bg-blue-500 text-white border-blue-500',                      optionColor: 'text-blue-500 hover:bg-blue-500 hover:text-white' },
];

function PriorityDropdown({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (v: Priority) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = PRIORITY_OPTIONS.find((o) => o.value === value) ?? PRIORITY_OPTIONS[0];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative flex-none w-16">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center justify-between gap-0.5 rounded border px-2 py-0.5 text-xs font-medium transition-colors',
          current.triggerColor
        )}
      >
        {current.label}
        <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-full rounded-md border border-border bg-popover shadow-md py-1">
          {PRIORITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={cn(
                'w-full text-left px-3 py-1 text-xs font-medium transition-colors',
                opt.optionColor
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TodosPage() {
  return (
    <Suspense>
      <TodosPageContent />
    </Suspense>
  );
}

function TodosPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [lists, setLists] = useState<JsonApiResource[]>([]);
  const [included, setIncluded] = useState<JsonApiResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const [filterAreaId, setFilterAreaId] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');

  // Create-list dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [newListTitle, setNewListTitle] = useState('');
  const [titleHighlighted, setTitleHighlighted] = useState(false);

  function defaultListTitle() {
    const d = new Date();
    const month = d.toLocaleDateString('en-US', { month: 'short' });
    const day = String(d.getDate()).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return `${month}-${day}-${year} Todos`;
  }
  const [creating, setCreating] = useState(false);
  const [createQueued, setCreateQueued] = useState(false);
  const [createListError, setCreateListError] = useState('');

  // Add-item state
  const [newItemText, setNewItemText] = useState('');
  const [addingItem, setAddingItem] = useState(false);
  const [addItemError, setAddItemError] = useState('');
  const [todoSessionMessage, setTodoSessionMessage] = useState('');
  const [listDeleteError, setListDeleteError] = useState('');
  const addItemInputRef = useRef<HTMLInputElement>(null);
  const clickedElsewhereRef = useRef(false);

  // Per-item optimistic toggle tracking
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  // Inline editing — items
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // Inline editing — list title
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingTitleText, setEditingTitleText] = useState('');

  // Per-item notes expansion
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [notesText, setNotesText] = useState<Record<string, string>>({});

  // Refs that stay current inside event listeners / cleanup without stale closures
  const notesTextRef = useRef<Record<string, string>>({});
  const includedRef = useRef<JsonApiResource[]>([]);
  useEffect(() => { notesTextRef.current = notesText; }, [notesText]);
  useEffect(() => { includedRef.current = included; }, [included]);

  function flagTodoSessionExpired(res: Response) {
    if (res.status === 401) {
      setTodoSessionMessage(SESSION_EXPIRED_MESSAGE);
    }
  }

  // Fire-and-forget saves for any notes that differ from what Drupal has stored.
  // Uses keepalive: true so the request survives page unload.
  function flushPendingNotes() {
    for (const [itemId, text] of Object.entries(notesTextRef.current)) {
      const stored = (includedRef.current.find((r) => r.id === itemId)?.attributes.field_notes as string | null) ?? '';
      if (text !== stored) {
        fetch(`/api/todo-items/${itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: text }),
          keepalive: true,
        });
      }
    }
  }

  // Attach to browser unload events AND component unmount (Next.js SPA nav)
  useEffect(() => {
    window.addEventListener('beforeunload', flushPendingNotes);
    window.addEventListener('pagehide', flushPendingNotes);
    return () => {
      window.removeEventListener('beforeunload', flushPendingNotes);
      window.removeEventListener('pagehide', flushPendingNotes);
      flushPendingNotes();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleExpanded(id: string, currentNotes: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        setNotesText((t) => ({ ...t, [id]: t[id] ?? currentNotes }));
      }
      return next;
    });
  }

  async function saveNotes(itemId: string) {
    const text = notesText[itemId] ?? '';
    const original = (includedRef.current.find((r) => r.id === itemId)?.attributes.field_notes as string | null) ?? '';
    if (text === original) return;
    setIncluded((prev) =>
      prev.map((r) =>
        r.id === itemId ? { ...r, attributes: { ...r.attributes, field_notes: text } } : r
      )
    );
    try {
      const res = await fetch(`/api/todo-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: text }),
      });
      flagTodoSessionExpired(res);
    } catch { /* queued */ }
  }

  // Add-item priority state
  const [newItemPriority, setNewItemPriority] = useState<'high' | 'med' | 'low' | ''>('');
  const [newItemNotesOpen, setNewItemNotesOpen] = useState(false);
  const [newItemNotes, setNewItemNotes] = useState('');

  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();
  const { isOnline } = useOnlineStatus();

  useEffect(() => {
    const id = searchParams.get('id');
    if (id) {
      setSelectedId(id);
      setMobileShowDetail(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLists = useCallback(async () => {
    setLoading(true);
    try {
      const res = await Promise.race([
        fetch('/api/todos'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 8000),
        ),
      ]);
      if (res.ok) {
        const data = await res.json();
        setLists(data.data ?? []);
        setIncluded(data.included ?? []);
        setTodoSessionMessage('');
        setListDeleteError('');
      }
    } catch {
      // Offline or timeout — keep whatever state we have
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated) loadLists();
  }, [authenticated, loadLists]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    markSignedOut();
    router.replace('/');
  }

  function selectList(id: string) {
    setSelectedId(id);
    setMobileShowDetail(true);
    setNewItemText('');
    setEditingTitle(false);
    router.replace(`/dashboard/todos?id=${id}`, { scroll: false });
  }

  // ── Create list ─────────────────────────────────────────────────────────────

  async function handleCreateList(e: React.FormEvent) {
    e.preventDefault();
    if (!newListTitle.trim()) return;
    setCreating(true);
    setCreateQueued(false);
    setCreateListError('');
    try {
      const res = await Promise.race([
        fetch('/api/todos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newListTitle.trim() }),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 8000),
        ),
      ]);
      if (res.ok) {
        const data = await res.json();
        if (data.queued) {
          setCreateQueued(true);
          return;
        }
        setCreateOpen(false);
        setNewListTitle('');
        setCreateQueued(false);
        await loadLists();
        selectList(data.data.id);
      } else {
        const data = await res.json().catch(() => ({}));
        setCreateListError(
          userFacingMessageForApiError(res, data, 'Failed to create list.')
        );
      }
    } catch {
      setCreateQueued(true);
    } finally {
      setCreating(false);
    }
  }

  // ── Delete list ─────────────────────────────────────────────────────────────

  async function handleDeleteList(listId: string) {
    if (!confirm('Delete this list and all its items?')) return;
    setListDeleteError('');
    if (!isOnline) {
      setListDeleteError(OFFLINE_ACTION_MESSAGE);
      return;
    }
    try {
      const res = await Promise.race([
        fetch(`/api/todos/${listId}`, { method: 'DELETE' }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
      ]);
      if (res.status === 202) {
        const body = await res.json().catch(() => ({}));
        if ((body as { queued?: boolean }).queued) {
          setListDeleteError(MUTATION_QUEUED_MESSAGE);
          return;
        }
        setListDeleteError('Unexpected response. Please try again.');
        return;
      }
      if (res.status === 204) {
        setLists((prev) => prev.filter((l) => l.id !== listId));
        if (selectedId === listId) {
          setSelectedId(null);
          setMobileShowDetail(false);
          router.replace('/dashboard/todos', { scroll: false });
        }
        return;
      }
      flagTodoSessionExpired(res);
      if (res.status === 401) return;
      const body = await res.json().catch(() => ({}));
      setListDeleteError(
        userFacingMessageForApiError(res, body, 'Failed to delete list.')
      );
    } catch {
      setListDeleteError(messageWhenNetworkRequestThrows());
    }
  }

  // ── Add item ────────────────────────────────────────────────────────────────

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!newItemText.trim() || !selectedId) return;
    setAddingItem(true);
    setAddItemError('');
    clickedElsewhereRef.current = false;

    function onClickElsewhere(ev: MouseEvent) {
      if (addItemInputRef.current && !addItemInputRef.current.contains(ev.target as Node)) {
        clickedElsewhereRef.current = true;
      }
    }
    document.addEventListener('mousedown', onClickElsewhere);

    const text = newItemText.trim();
    const priority = newItemPriority || null;
    const notes = newItemNotes.trim() || null;

    try {
      const res = await Promise.race([
        fetch(`/api/todos/${selectedId}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, priority, notes }),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 8000),
        ),
      ]);
      if (res.ok) {
        const data = await res.json();
        setNewItemText('');
        setNewItemNotes('');
        setNewItemNotesOpen(false);
        setNewItemPriority('');
        if (data.queued) {
          addItemOptimistic(text, priority, notes);
        } else {
          await loadLists();
        }
        if (!clickedElsewhereRef.current) {
          setTimeout(() => addItemInputRef.current?.focus(), 0);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        setAddItemError(
          userFacingMessageForApiError(res, data, 'Could not add item.')
        );
      }
    } catch {
      setNewItemText('');
      setNewItemNotes('');
      setNewItemNotesOpen(false);
      setNewItemPriority('');
      addItemOptimistic(text, priority, notes);
    } finally {
      document.removeEventListener('mousedown', onClickElsewhere);
      setAddingItem(false);
    }
  }

  function addItemOptimistic(text: string, priority: string | null, notes: string | null) {
    if (!selectedId) return;
    const tempId = `temp-${Date.now()}`;
    const tempItem: JsonApiResource = {
      type: 'node--todo_item',
      id: tempId,
      attributes: {
        field_item_text: text,
        field_completed: false,
        field_priority: priority ?? '',
        field_notes: notes ?? '',
      },
      relationships: {},
    };
    setIncluded((prev) => [...prev, tempItem]);
    setLists((prev) =>
      prev.map((l) => {
        if (l.id !== selectedId) return l;
        const existingItems = Array.isArray(l.relationships?.field_items?.data)
          ? l.relationships.field_items.data
          : [];
        return {
          ...l,
          relationships: {
            ...l.relationships,
            field_items: {
              data: [...existingItems, { type: 'node--todo_item', id: tempId }],
            },
          },
        };
      })
    );
  }

  async function commitTitleEdit() {
    const title = editingTitleText.trim();
    setEditingTitle(false);
    if (!title || !selectedList || title === selectedList.attributes.title) return;
    setLists((prev) =>
      prev.map((l) =>
        l.id === selectedList.id ? { ...l, attributes: { ...l.attributes, title } } : l
      )
    );
    try {
      const res = await fetch(`/api/todos/${selectedList.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      flagTodoSessionExpired(res);
    } catch { /* queued */ }
  }

  function startEditing(item: JsonApiResource) {
    setEditingId(item.id);
    setEditingText(item.attributes.field_item_text as string);
  }

  async function commitEdit(itemId: string) {
    const text = editingText.trim();
    setEditingId(null);
    const original = (includedRef.current.find((r) => r.id === itemId)?.attributes.field_item_text as string) ?? '';
    if (!text || text === original) return;
    setIncluded((prev) =>
      prev.map((r) =>
        r.id === itemId ? { ...r, attributes: { ...r.attributes, field_item_text: text } } : r
      )
    );
    try {
      const res = await fetch(`/api/todo-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      flagTodoSessionExpired(res);
    } catch { /* queued */ }
  }

  async function handlePriorityChange(itemId: string, priority: Priority) {
    setIncluded((prev) =>
      prev.map((r) =>
        r.id === itemId
          ? { ...r, attributes: { ...r.attributes, field_priority: priority } }
          : r
      )
    );
    try {
      const res = await fetch(`/api/todo-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority }),
      });
      flagTodoSessionExpired(res);
    } catch { /* queued */ }
  }

  // ── Toggle item ─────────────────────────────────────────────────────────────

  async function handleToggleItem(itemId: string, currentCompleted: boolean) {
    setTogglingIds((s) => new Set(s).add(itemId));
    setIncluded((prev) =>
      prev.map((r) =>
        r.id === itemId
          ? { ...r, attributes: { ...r.attributes, field_completed: !currentCompleted } }
          : r
      )
    );
    try {
      const res = await fetch(`/api/todo-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !currentCompleted }),
      });
      flagTodoSessionExpired(res);
    } catch { /* queued */ } finally {
      setTogglingIds((s) => {
        const next = new Set(s);
        next.delete(itemId);
        return next;
      });
    }
  }

  // ── Delete item ─────────────────────────────────────────────────────────────

  async function handleDeleteItem(itemId: string) {
    if (!selectedId) return;
    const listId = selectedId;
    setDeletingIds((s) => new Set(s).add(itemId));
    setIncluded((prev) => prev.filter((r) => r.id !== itemId));
    setLists((prev) =>
      prev.map((l) => {
        if (l.id !== listId) return l;
        const items = Array.isArray(l.relationships?.field_items?.data)
          ? l.relationships.field_items.data.filter((r: { id: string }) => r.id !== itemId)
          : [];
        return { ...l, relationships: { ...l.relationships, field_items: { data: items } } };
      })
    );
    try {
      const res = await Promise.race([
        fetch(`/api/todo-items/${itemId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listId }),
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
      ]);
      flagTodoSessionExpired(res);
    } catch {
      // Queued by SW for later sync
    } finally {
      setDeletingIds((s) => {
        const next = new Set(s);
        next.delete(itemId);
        return next;
      });
    }
  }

  // ── Filter helpers ───────────────────────────────────────────────────────────

  const uniqueAreas = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    lists.forEach((list) => {
      const rel = list.relationships?.field_area?.data;
      const id = rel && !Array.isArray(rel) ? rel.id : null;
      if (id && !seen.has(id)) {
        seen.add(id);
        const name = included.find((r) => r.id === id)?.attributes.name as string | undefined;
        if (name) result.push({ id, name });
      }
    });
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [lists, included]);

  const uniqueSubjectsForArea = useMemo(() => {
    if (!filterAreaId) return [];
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    lists.forEach((list) => {
      const aRel = list.relationships?.field_area?.data;
      const aId = aRel && !Array.isArray(aRel) ? aRel.id : null;
      if (aId !== filterAreaId) return;
      const sRel = list.relationships?.field_subject?.data;
      const sId = sRel && !Array.isArray(sRel) ? sRel.id : null;
      if (sId && !seen.has(sId)) {
        seen.add(sId);
        const name = included.find((r) => r.id === sId)?.attributes.name as string | undefined;
        if (name) result.push({ id: sId, name });
      }
    });
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [lists, included, filterAreaId]);

  const visibleLists = useMemo(() => {
    if (!filterAreaId && !filterSubjectId) return lists;
    return lists.filter((list) => {
      const aRel = list.relationships?.field_area?.data;
      const sRel = list.relationships?.field_subject?.data;
      const aId = aRel && !Array.isArray(aRel) ? aRel.id : null;
      const sId = sRel && !Array.isArray(sRel) ? sRel.id : null;
      if (filterAreaId && aId !== filterAreaId) return false;
      if (filterSubjectId && sId !== filterSubjectId) return false;
      return true;
    });
  }, [lists, filterAreaId, filterSubjectId]);

  const hasFilters = !!(filterAreaId || filterSubjectId);

  function clearFilters() {
    setFilterAreaId('');
    setFilterSubjectId('');
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !selectedList) return;

    const currentRels = (
      Array.isArray(selectedList.relationships?.field_items?.data)
        ? selectedList.relationships.field_items.data
        : []
    ) as { type: string; id: string; meta?: unknown }[];

    const oldIndex = currentRels.findIndex((r) => r.id === active.id);
    const newIndex = currentRels.findIndex((r) => r.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(currentRels, oldIndex, newIndex);

    // Optimistic update
    setLists((prev) =>
      prev.map((l) =>
        l.id === selectedList.id
          ? { ...l, relationships: { ...l.relationships, field_items: { data: reordered } } }
          : l
      )
    );

    try {
      const res = await fetch(`/api/todos/${selectedList.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemOrder: reordered }),
      });
      flagTodoSessionExpired(res);
    } catch { /* queued */ }
  }

  if (!authenticated) return null;

  // ── Derive selected list & items ─────────────────────────────────────────────

  const selectedList = selectedId ? (lists.find((l) => l.id === selectedId) ?? null) : null;

  const itemRels: { id: string; meta?: { target_revision_id?: number } }[] = selectedList
    ? (Array.isArray(selectedList.relationships?.field_items?.data)
        ? selectedList.relationships.field_items.data
        : [])
    : [];

  const items = itemRels
    .map((rel) => included.find((r) => r.id === rel.id))
    .filter((r): r is JsonApiResource => !!r);

  const areaRel = selectedList?.relationships?.field_area?.data;
  const subjectRel = selectedList?.relationships?.field_subject?.data;
  const areaId = areaRel && !Array.isArray(areaRel) ? areaRel.id : null;
  const subjectId = subjectRel && !Array.isArray(subjectRel) ? subjectRel.id : null;
  const areaName = areaId
    ? (included.find((r) => r.id === areaId)?.attributes.name as string | undefined)
    : undefined;
  const subjectName = subjectId
    ? (included.find((r) => r.id === subjectId)?.attributes.name as string | undefined)
    : undefined;

  const completedCount = items.filter((i) => i.attributes.field_completed).length;

  return (
    <>
      <Header authenticated onSignIn={() => {}} onSignUp={() => {}} onLogout={handleLogout} />

      <div className="fixed inset-x-0 bottom-0 top-16 flex flex-col">
        {todoSessionMessage && (
          <div
            role="alert"
            className="flex shrink-0 items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          >
            <span>{todoSessionMessage}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setTodoSessionMessage('')}
            >
              Dismiss
            </Button>
          </div>
        )}
        {listDeleteError && (
          <div
            role="alert"
            className="flex shrink-0 items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          >
            <span>{listDeleteError}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setListDeleteError('')}
            >
              Dismiss
            </Button>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside
          className={cn(
            'flex min-h-0 flex-col border-r border-border bg-background shrink-0',
            'w-full md:w-72 lg:w-80',
            mobileShowDetail ? 'hidden md:flex' : 'flex'
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
              <h1 className="font-semibold text-sm text-foreground">My Lists</h1>
              {!loading && (
                <span className="text-xs text-muted-foreground">
                  ({hasFilters ? `${visibleLists.length} of ${lists.length}` : lists.length})
                </span>
              )}
            </div>
            <Button size="icon-sm" onClick={() => { setNewListTitle(defaultListTitle()); setCreateOpen(true); }}>
              <Plus className="h-4 w-4" />
              <span className="sr-only">New list</span>
            </Button>
          </div>

          {/* Filters */}
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

          {/* List of lists */}
          <ScrollArea className="flex-1 min-h-0">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="px-4 py-3 border-b border-border">
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted mb-2" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                </div>
              ))
            ) : lists.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-3">
                <CheckSquare className="h-8 w-8 text-muted-foreground/40" />
                <div>
                  <p className="text-sm font-medium text-foreground">No lists yet</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Create your first todo list to get started.
                  </p>
                </div>
                <Button size="sm" onClick={() => { setNewListTitle(defaultListTitle()); setCreateOpen(true); }}>
                  <Plus className="h-4 w-4" />
                  New list
                </Button>
              </div>
            ) : visibleLists.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-3">
                <CheckSquare className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No lists match the selected filters.</p>
                <button
                  onClick={clearFilters}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              visibleLists.map((list) => {
                const lAreaRel = list.relationships?.field_area?.data;
                const lSubjectRel = list.relationships?.field_subject?.data;
                const lAreaId = lAreaRel && !Array.isArray(lAreaRel) ? lAreaRel.id : null;
                const lSubjectId = lSubjectRel && !Array.isArray(lSubjectRel) ? lSubjectRel.id : null;
                const lAreaName = lAreaId
                  ? (included.find((r) => r.id === lAreaId)?.attributes.name as string | undefined)
                  : undefined;
                const lSubjectName = lSubjectId
                  ? (included.find((r) => r.id === lSubjectId)?.attributes.name as string | undefined)
                  : undefined;

                const listItemRels: { id: string }[] = Array.isArray(list.relationships?.field_items?.data)
                  ? list.relationships.field_items.data
                  : [];
                const listItems = listItemRels
                  .map((rel) => included.find((r) => r.id === rel.id))
                  .filter(Boolean);
                const total = listItems.length;
                const done = listItems.filter((i) => i?.attributes.field_completed).length;

                const isSelected = selectedId === list.id;

                return (
                  <button
                    key={list.id}
                    onClick={() => selectList(list.id)}
                    className={cn(
                      'w-full text-left px-4 py-3 border-b border-border transition-colors',
                      isSelected ? 'bg-muted' : 'hover:bg-muted/50'
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                      <span className="text-sm font-medium text-foreground truncate leading-snug">
                        {list.attributes.title as string}
                      </span>
                      {total > 0 && (
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {done}/{total}
                        </span>
                      )}
                    </div>
                    {!!list.attributes.created && (
                      <p className="text-[11px] text-muted-foreground mb-1">
                        {formatDate(list.attributes.created as string)}
                      </p>
                    )}
                    {(lAreaName || lSubjectName) && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {lAreaName && (
                          <Badge variant="secondary" className="text-[10px] py-0 h-4 px-1.5">
                            {lAreaName}
                          </Badge>
                        )}
                        {lSubjectName && (
                          <Badge variant="outline" className="text-[10px] py-0 h-4 px-1.5">
                            {lSubjectName}
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

        {/* ── Detail panel ────────────────────────────────────────────────── */}
        <main
          className={cn(
            'flex min-h-0 flex-1 flex-col bg-background',
            mobileShowDetail ? 'flex' : 'hidden md:flex'
          )}
        >
          {selectedList ? (
            <ScrollArea className="flex-1 min-h-0">
            <div className="max-w-[60rem] mx-auto w-full px-10 py-8">

              {/* Detail header */}
              <div className="flex items-start justify-between gap-4 mb-6">
                <div className="flex items-start gap-2 min-w-0">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setMobileShowDetail(false)}
                    className="md:hidden mt-0.5 shrink-0"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span className="sr-only">Back to lists</span>
                  </Button>
                  <div className="min-w-0">
                    {editingTitle ? (
                      <input
                        autoFocus
                        value={editingTitleText}
                        onChange={(e) => setEditingTitleText(e.target.value)}
                        onBlur={commitTitleEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); commitTitleEdit(); }
                          if (e.key === 'Escape') setEditingTitle(false);
                        }}
                        className="text-2xl font-bold tracking-tight text-foreground leading-tight bg-transparent border-b border-border outline-none w-full"
                      />
                    ) : (
                      <h1
                        onClick={() => { setEditingTitleText(selectedList.attributes.title as string); setEditingTitle(true); }}
                        className="text-2xl font-bold tracking-tight text-foreground leading-tight cursor-text hover:text-foreground/80"
                      >
                        {selectedList.attributes.title as string}
                      </h1>
                    )}
                    {(areaName || subjectName) && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {areaName && <Badge variant="secondary">{areaName}</Badge>}
                        {subjectName && <Badge variant="outline">{subjectName}</Badge>}
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive shrink-0"
                  onClick={() => handleDeleteList(selectedList.id)}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Delete list</span>
                </Button>
              </div>

              {/* Progress bar */}
              {items.length > 0 && (
                <div className="mb-6 space-y-1">
                  <div
                    className="h-1.5 rounded-full bg-muted overflow-hidden transition-all duration-500"
                    style={{ width: `${Math.min(100, (items.length / 8) * 100)}%` }}
                  >
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        completedCount === items.length ? "bg-green-500" : "bg-primary"
                      )}
                      style={{ width: `${Math.round((completedCount / items.length) * 100)}%` }}
                    />
                  </div>
                  <p className={cn(
                    "text-xs transition-colors duration-300",
                    completedCount === items.length ? "text-green-500 font-medium flex items-center gap-1" : "text-muted-foreground"
                  )}>
                    {completedCount === items.length && <Check className="h-3 w-3" />}
                    {completedCount} of {items.length} completed
                  </p>
                </div>
              )}

              {/* Checklist */}
              {items.length > 0 ? (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-1 mb-6">
                  {items.map((item) => {
                    const completed = item.attributes.field_completed as boolean;
                    const text = item.attributes.field_item_text as string;
                    const priority = (item.attributes.field_priority as Priority) ?? '';
                    const isToggling = togglingIds.has(item.id);
                    const isDeleting = deletingIds.has(item.id);

                    const notes = (item.attributes.field_notes as string | null) ?? '';
                    const isExpanded = expandedIds.has(item.id);

                    return (
                      <SortableTodoItem key={item.id} id={item.id} isDeleting={isDeleting} isExpanded={isExpanded}>
                        <div className="flex items-center gap-3 px-3 py-2.5 group">
                        <DragHandle />
                        <button
                          onClick={() => handleToggleItem(item.id, completed)}
                          disabled={isToggling}
                          className={cn(
                            'flex-none w-5 h-5 rounded border-2 transition-colors flex items-center justify-center',
                            completed
                              ? 'bg-primary border-primary'
                              : 'border-muted-foreground/40 hover:border-primary'
                          )}
                          aria-label={completed ? 'Mark incomplete' : 'Mark complete'}
                        >
                          {completed && (
                            <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 12 12">
                              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                        {editingId === item.id ? (
                          <input
                            autoFocus
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onBlur={() => commitEdit(item.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); commitEdit(item.id); }
                              if (e.key === 'Escape') { setEditingId(null); }
                            }}
                            className="flex-1 text-sm bg-transparent border-b border-border outline-none"
                          />
                        ) : (
                          <span
                            onClick={() => !completed && startEditing(item)}
                            className={cn(
                              'flex-1 text-sm',
                              completed
                                ? 'line-through text-muted-foreground'
                                : 'cursor-text hover:text-foreground'
                            )}
                          >
                            {text}
                          </span>
                        )}
                        {completed ? (
                          <span className="flex-none w-16 text-xs font-medium text-green-500">
                            {priority ? PRIORITY_OPTIONS.find((o) => o.value === priority)?.label : ''}
                          </span>
                        ) : (
                          <PriorityDropdown
                            value={priority}
                            onChange={(p) => handlePriorityChange(item.id, p)}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => toggleExpanded(item.id, notes)}
                          className="flex-none opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                          aria-label={isExpanded ? 'Collapse notes' : 'Expand notes'}
                        >
                          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')} />
                        </button>
                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          className="flex-none opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                          aria-label="Delete item"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                        </div>
                        {isExpanded && (
                          <div className="px-3 pb-3">
                            <textarea
                              autoFocus
                              onPointerDown={(e) => e.stopPropagation()}
                              value={notesText[item.id] ?? notes}
                              onChange={(e) => setNotesText((t) => ({ ...t, [item.id]: e.target.value }))}
                              onBlur={() => saveNotes(item.id)}
                              placeholder="Add notes…"
                              rows={3}
                              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
                            />
                          </div>
                        )}
                      </SortableTodoItem>
                    );
                  })}
                </ul>
                  </SortableContext>
                </DndContext>
              ) : (
                <p className="text-sm text-muted-foreground mb-6">No items yet. Add one below.</p>
              )}

              {/* Add item form */}
              <form onSubmit={handleAddItem} className="space-y-2">
                <div className="flex gap-2 items-center">
                  <Input
                    ref={addItemInputRef}
                    value={newItemText}
                    onChange={(e) => setNewItemText(e.target.value)}
                    placeholder="Add an item…"
                    disabled={addingItem}
                    className="flex-1"
                  />
                  <PriorityDropdown value={newItemPriority} onChange={setNewItemPriority} />
                  <button
                    type="button"
                    onClick={() => setNewItemNotesOpen((o) => !o)}
                    className={cn(
                      'flex-none text-muted-foreground transition-colors hover:text-foreground',
                      newItemNotesOpen && 'text-foreground'
                    )}
                    aria-label={newItemNotesOpen ? 'Hide notes' : 'Add notes'}
                  >
                    <ChevronDown className={cn('h-4 w-4 transition-transform', newItemNotesOpen && 'rotate-180')} />
                  </button>
                  <Button type="submit" disabled={!newItemText.trim() || addingItem} size="sm">
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                </div>
                {newItemNotesOpen && (
                  <textarea
                    value={newItemNotes}
                    onChange={(e) => setNewItemNotes(e.target.value)}
                    placeholder="Add notes…"
                    rows={3}
                    autoFocus
                    className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
                  />
                )}
                {addItemError && (
                  <p className="text-sm text-destructive">{addItemError}</p>
                )}
              </form>
            </div>
            </ScrollArea>
          ) : (
            <div className="hidden md:flex flex-col flex-1 items-center justify-center text-center p-8">
              <CheckSquare className="h-10 w-10 text-muted-foreground/25 mb-3" />
              <p className="text-sm text-muted-foreground">Select a list to see its items</p>
            </div>
          )}
        </main>
        </div>
      </div>

      {/* Create list dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          if (!next) {
            setCreateQueued(false);
            setCreateListError('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New todo list</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateList}>
            <div className="py-4 space-y-3">
              <Input
                value={newListTitle}
                onChange={(e) => setNewListTitle(e.target.value)}
                onFocus={(e) => { e.target.select(); setTitleHighlighted(true); }}
                onMouseDown={() => setTitleHighlighted(false)}
                onKeyDown={(e) => {
                  if (!titleHighlighted) return;
                  if (e.key === 'Backspace' || e.key === 'Delete') {
                    e.preventDefault();
                    setNewListTitle('');
                    setTitleHighlighted(false);
                  } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
                    const input = e.currentTarget;
                    input.setSelectionRange(input.value.length, input.value.length);
                    setTitleHighlighted(false);
                  } else {
                    setTitleHighlighted(false);
                  }
                }}
                placeholder="List name…"
                autoFocus
                disabled={creating || createQueued}
              />
              {createListError && !createQueued && (
                <p className="text-sm text-destructive">{createListError}</p>
              )}
              {createQueued && (
                <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-200">
                  List saved offline. It will appear once you reconnect.
                </div>
              )}
            </div>
            <DialogFooter>
              {createQueued ? (
                <Button type="button" onClick={() => { setCreateOpen(false); setCreateQueued(false); }}>
                  Done
                </Button>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={!newListTitle.trim() || creating}
                    className="bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:border-emerald-500/50 focus-visible:ring-emerald-500/30 border-transparent shadow-none [a]:hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    {creating ? 'Creating…' : 'Create'}
                  </Button>
                </>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
