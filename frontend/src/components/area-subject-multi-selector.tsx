'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ApiUnauthorizedError } from '@/lib/api-client-messages';
import {
  TaxonomyCombobox,
  type TaxonomyTerm,
} from '@/components/area-subject-selector';

/**
 * Multi-select wrapper around the existing single-select TaxonomyCombobox.
 *
 * Behavior:
 *   - The Area combobox stays bound to an "active" area (its visual selection)
 *     so the Subject combobox can filter properly. Picking an area also adds
 *     it to the chip list (no-op if already present).
 *   - Picking a subject adds it as a chip nested under its parent area chip.
 *     If the parent area chip isn't yet present, it's auto-added.
 *   - Removing an area chip removes that area AND any subject chips whose
 *     parent area is that area.
 *   - Removing a subject chip removes only that subject.
 *
 * Two layout modes:
 *   - chipsRender="inline" (default): the selector renders comboboxes followed
 *     by the chip list. Use when the selector lives on its own row (e.g.
 *     decks edit page, deck create dialog).
 *   - chipsRender="none": the selector renders only the comboboxes. Pair with
 *     a sibling <AreaSubjectChipList /> placed wherever you want chips to
 *     appear (e.g. on its own row beneath a horizontal action row, so chip
 *     growth doesn't shove other buttons around).
 */

interface SubjectTerm extends TaxonomyTerm {
  // Parent area UUID (from relationships.field_area.data.id).
  areaId: string | null;
}

interface JsonApiTermData {
  id: string;
  attributes?: { name?: string };
  relationships?: {
    field_area?: { data?: { id?: string } | null };
  };
}

// ── Shared taxonomy store ──────────────────────────────────────────────────────
//
// Lets <AreaSubjectMultiSelector> and <AreaSubjectChipList> share area/subject
// data on the same page without duplicate fetches and without the parent
// having to wire props through. When the selector creates a new term, every
// subscriber re-renders with the updated lists.

interface TaxonomyStoreState {
  areas: TaxonomyTerm[];
  subjects: SubjectTerm[];
  loading: boolean;
}

const EMPTY_STATE: TaxonomyStoreState = {
  areas: [],
  subjects: [],
  loading: true,
};

let storeState: TaxonomyStoreState = EMPTY_STATE;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setStore(next: TaxonomyStoreState) {
  storeState = next;
  listeners.forEach((l) => l());
}

function ensureLoaded(): Promise<void> {
  if (!storeState.loading) return Promise.resolve();
  if (inflight) return inflight;
  inflight = Promise.all([
    fetch('/api/taxonomy?type=areas')
      .then((r) => r.json())
      .then((d) => (d.data ?? []) as TaxonomyTerm[])
      .catch(() => [] as TaxonomyTerm[]),
    fetch('/api/taxonomy?type=subjects')
      .then((r) => r.json())
      .then((d) => {
        const list = (d.data ?? []) as JsonApiTermData[];
        return list.map<SubjectTerm>((t) => ({
          id: t.id,
          attributes: { name: t.attributes?.name ?? '' },
          areaId: t.relationships?.field_area?.data?.id ?? null,
        }));
      })
      .catch(() => [] as SubjectTerm[]),
  ])
    .then(([areas, subjects]) => {
      setStore({ areas, subjects, loading: false });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function addAreaToStore(term: TaxonomyTerm) {
  setStore({
    ...storeState,
    areas: [...storeState.areas, term].sort((a, b) =>
      a.attributes.name.localeCompare(b.attributes.name),
    ),
  });
}

function addSubjectToStore(subject: SubjectTerm) {
  setStore({
    ...storeState,
    subjects: [...storeState.subjects, subject].sort((a, b) =>
      a.attributes.name.localeCompare(b.attributes.name),
    ),
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  return storeState;
}

function useTaxonomyStore(): TaxonomyStoreState {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void ensureLoaded();
  }, []);
  return state;
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

interface ChipGroup {
  areaId: string;
  areaName: string;
  subjects: { id: string; name: string }[];
}

function buildOrderedGroups(
  areaUuids: string[],
  subjectUuids: string[],
  areas: TaxonomyTerm[],
  subjects: SubjectTerm[],
): ChipGroup[] {
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const subjectById = new Map(subjects.map((s) => [s.id, s]));

  const groups: ChipGroup[] = [];
  const indexByArea = new Map<string, number>();

  for (const aId of areaUuids) {
    const term = areaById.get(aId);
    indexByArea.set(aId, groups.length);
    groups.push({
      areaId: aId,
      areaName: term?.attributes.name ?? '…',
      subjects: [],
    });
  }

  for (const sId of subjectUuids) {
    const subj = subjectById.get(sId);
    const parentAreaId = subj?.areaId ?? null;
    if (!parentAreaId) continue;
    const idx = indexByArea.get(parentAreaId);
    if (idx === undefined) continue;
    groups[idx].subjects.push({
      id: sId,
      name: subj?.attributes.name ?? '…',
    });
  }
  return groups;
}

// ── <AreaSubjectMultiSelector> ────────────────────────────────────────────────

export interface AreaSubjectMultiSelectorProps {
  areaUuids: string[];
  subjectUuids: string[];
  onChange: (next: { areaUuids: string[]; subjectUuids: string[] }) => void;
  layout?: 'row' | 'col';
  hideLabels?: boolean;
  compact?: boolean;
  /**
   * Where to render the chip list.
   *   - 'inline' (default): below the comboboxes, inside this component.
   *   - 'none': don't render chips here; pair with <AreaSubjectChipList />
   *     placed elsewhere in the page layout.
   */
  chipsRender?: 'inline' | 'none';
}

export function AreaSubjectMultiSelector({
  areaUuids,
  subjectUuids,
  onChange,
  layout = 'row',
  hideLabels = false,
  compact = false,
  chipsRender = 'inline',
}: AreaSubjectMultiSelectorProps) {
  const { areas, subjects: allSubjects, loading } = useTaxonomyStore();
  const [taxonomyError, setTaxonomyError] = useState('');

  // Active dropdown selection — drives which subjects show in the subject
  // combobox. Not the source of truth for chips.
  const [activeAreaUuid, setActiveAreaUuid] = useState('');

  const subjectsForActiveArea = useMemo(
    () =>
      activeAreaUuid
        ? allSubjects.filter((s) => s.areaId === activeAreaUuid)
        : [],
    [allSubjects, activeAreaUuid],
  );

  const subjectById = useMemo(() => {
    const m = new Map<string, SubjectTerm>();
    for (const s of allSubjects) m.set(s.id, s);
    return m;
  }, [allSubjects]);

  const orderedGroups = useMemo(
    () => buildOrderedGroups(areaUuids, subjectUuids, areas, allSubjects),
    [areaUuids, subjectUuids, areas, allSubjects],
  );

  function handleAreaPick(uuid: string) {
    if (!uuid) {
      setActiveAreaUuid('');
      return;
    }
    setActiveAreaUuid(uuid);
    if (!areaUuids.includes(uuid)) {
      onChange({ areaUuids: [...areaUuids, uuid], subjectUuids });
    }
  }

  function handleSubjectPick(uuid: string) {
    if (!uuid) return;
    if (subjectUuids.includes(uuid)) return;
    const subj = subjectById.get(uuid);
    const parentAreaId = subj?.areaId ?? activeAreaUuid;
    const nextAreas =
      parentAreaId && !areaUuids.includes(parentAreaId)
        ? [...areaUuids, parentAreaId]
        : areaUuids;
    onChange({
      areaUuids: nextAreas,
      subjectUuids: [...subjectUuids, uuid],
    });
  }

  function removeArea(areaId: string) {
    const remainingSubjects = subjectUuids.filter((sId) => {
      const subj = subjectById.get(sId);
      return subj?.areaId !== areaId;
    });
    onChange({
      areaUuids: areaUuids.filter((id) => id !== areaId),
      subjectUuids: remainingSubjects,
    });
    if (activeAreaUuid === areaId) setActiveAreaUuid('');
  }

  function removeSubject(subjectId: string) {
    onChange({
      areaUuids,
      subjectUuids: subjectUuids.filter((id) => id !== subjectId),
    });
  }

  async function createArea(name: string): Promise<string | null> {
    try {
      const res = await Promise.race([
        fetch('/api/taxonomy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'area', name }),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5000),
        ),
      ]);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) throw new ApiUnauthorizedError();
        return null;
      }
      if (data.queued) return null;
      const newTerm: TaxonomyTerm = { id: data.data.id, attributes: { name } };
      addAreaToStore(newTerm);
      return data.data.id;
    } catch (e) {
      if (e instanceof ApiUnauthorizedError) throw e;
      return null;
    }
  }

  async function createSubject(name: string): Promise<string | null> {
    if (!activeAreaUuid) return null;
    try {
      const res = await Promise.race([
        fetch('/api/taxonomy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'subject',
            name,
            areaUuid: activeAreaUuid,
          }),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5000),
        ),
      ]);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) throw new ApiUnauthorizedError();
        return null;
      }
      if (data.queued) return null;
      const newSubject: SubjectTerm = {
        id: data.data.id,
        attributes: { name },
        areaId: activeAreaUuid,
      };
      addSubjectToStore(newSubject);
      return data.data.id;
    } catch (e) {
      if (e instanceof ApiUnauthorizedError) throw e;
      return null;
    }
  }

  const containerClass = compact
    ? 'flex flex-row gap-2 flex-wrap'
    : layout === 'row'
      ? 'flex flex-col sm:flex-row gap-3 flex-wrap'
      : 'flex flex-col gap-3';

  return (
    <div className="flex flex-col gap-2">
      <div className={containerClass}>
        <div className="flex flex-col gap-1.5">
          {!hideLabels && <Label>Area</Label>}
          <TaxonomyCombobox
            value={activeAreaUuid}
            onChange={handleAreaPick}
            options={areas}
            loading={loading}
            placeholder="Add area"
            onCreate={createArea}
            compact={compact}
            onError={setTaxonomyError}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          {!hideLabels && <Label>Subject</Label>}
          <TaxonomyCombobox
            value=""
            onChange={handleSubjectPick}
            options={subjectsForActiveArea}
            loading={loading && !!activeAreaUuid}
            disabled={!activeAreaUuid}
            placeholder={!activeAreaUuid ? 'Select area' : 'Add subject'}
            onCreate={activeAreaUuid ? createSubject : undefined}
            compact={compact}
            onError={setTaxonomyError}
          />
        </div>
      </div>

      {chipsRender === 'inline' && orderedGroups.length > 0 && (
        <ChipGroups
          groups={orderedGroups}
          onRemoveArea={removeArea}
          onRemoveSubject={removeSubject}
          compact={compact}
        />
      )}

      {taxonomyError && (
        <p className="text-sm text-destructive">{taxonomyError}</p>
      )}
    </div>
  );
}

// ── <AreaSubjectChipList> ─────────────────────────────────────────────────────

export interface AreaSubjectChipListProps {
  areaUuids: string[];
  subjectUuids: string[];
  onChange: (next: { areaUuids: string[]; subjectUuids: string[] }) => void;
  compact?: boolean;
  className?: string;
}

/**
 * Standalone chip list — meant to live on its own row, paired with an
 * <AreaSubjectMultiSelector chipsRender="none" /> elsewhere on the page.
 * Reads area/subject names from the same shared store as the selector.
 */
export function AreaSubjectChipList({
  areaUuids,
  subjectUuids,
  onChange,
  compact = false,
  className,
}: AreaSubjectChipListProps) {
  const { areas, subjects: allSubjects } = useTaxonomyStore();

  const subjectById = useMemo(() => {
    const m = new Map<string, SubjectTerm>();
    for (const s of allSubjects) m.set(s.id, s);
    return m;
  }, [allSubjects]);

  const orderedGroups = useMemo(
    () => buildOrderedGroups(areaUuids, subjectUuids, areas, allSubjects),
    [areaUuids, subjectUuids, areas, allSubjects],
  );

  if (orderedGroups.length === 0) return null;

  function removeArea(areaId: string) {
    const remainingSubjects = subjectUuids.filter((sId) => {
      const subj = subjectById.get(sId);
      return subj?.areaId !== areaId;
    });
    onChange({
      areaUuids: areaUuids.filter((id) => id !== areaId),
      subjectUuids: remainingSubjects,
    });
  }

  function removeSubject(subjectId: string) {
    onChange({
      areaUuids,
      subjectUuids: subjectUuids.filter((id) => id !== subjectId),
    });
  }

  return (
    <ChipGroups
      groups={orderedGroups}
      onRemoveArea={removeArea}
      onRemoveSubject={removeSubject}
      compact={compact}
      className={className}
    />
  );
}

// ── Internal chip-group renderer ──────────────────────────────────────────────

function ChipGroups({
  groups,
  onRemoveArea,
  onRemoveSubject,
  compact,
  className,
}: {
  groups: ChipGroup[];
  onRemoveArea: (areaId: string) => void;
  onRemoveSubject: (subjectId: string) => void;
  compact: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-col gap-1.5', compact && 'gap-1', className)}
    >
      {groups.map((group) => (
        <div
          key={group.areaId}
          className="flex flex-wrap items-center gap-1.5"
        >
          <Badge variant="secondary" className="gap-1 pl-2 pr-1 py-0.5">
            <span className="truncate max-w-[14rem] font-semibold">
              {group.areaName}
            </span>
            <button
              type="button"
              onClick={() => onRemoveArea(group.areaId)}
              className="rounded-sm p-0.5 hover:bg-foreground/10 transition-colors"
              aria-label={`Remove area ${group.areaName}`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
          {group.subjects.map((s) => (
            <Badge
              key={s.id}
              variant="outline"
              className="gap-1 pl-2 pr-1 py-0.5"
            >
              <span className="truncate max-w-[14rem]">{s.name}</span>
              <button
                type="button"
                onClick={() => onRemoveSubject(s.id)}
                className="rounded-sm p-0.5 hover:bg-foreground/10 transition-colors"
                aria-label={`Remove subject ${s.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ))}
    </div>
  );
}
