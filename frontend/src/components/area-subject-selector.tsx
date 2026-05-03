'use client';

import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { ChevronsUpDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ApiUnauthorizedError } from '@/lib/api-client-messages';

interface TaxonomyTerm {
  id: string;
  attributes: { name: string };
}

// ── Internal combobox ────────────────────────────────────────────────────────

interface TaxonomyComboboxProps {
  value: string;
  onChange: (uuid: string) => void;
  options: TaxonomyTerm[];
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  onCreate?: (name: string) => Promise<string | null>;
  compact?: boolean;
  onError?: (msg: string) => void;
}

function TaxonomyCombobox({
  value,
  onChange,
  options,
  loading = false,
  disabled = false,
  placeholder = 'None',
  onCreate,
  compact = false,
  onError,
}: TaxonomyComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const selectedLabel = value
    ? (options.find((o) => o.id === value)?.attributes.name ?? placeholder)
    : placeholder;

  const filtered = search.trim()
    ? options.filter((o) =>
        o.attributes.name.toLowerCase().includes(search.toLowerCase())
      )
    : options;

  const exactMatch = options.some(
    (o) => o.attributes.name.toLowerCase() === search.trim().toLowerCase()
  );

  const canCreate = !!onCreate && search.trim().length > 0 && !exactMatch && !creating;

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen);
    if (!isOpen) {
      setSearch('');
      setCreateError('');
    }
  }

  function handleSelect(uuid: string) {
    onChange(uuid);
    setOpen(false);
    setSearch('');
  }

  async function handleCreate() {
    if (!canCreate || !onCreate) return;
    setCreating(true);
    setCreateError('');
    onError?.('');
    try {
      const newId = await onCreate(search.trim());
      if (newId) {
        handleSelect(newId);
      } else {
        const msg = 'Failed to create. You may be offline.';
        setCreateError(msg);
        onError?.(msg);
      }
    } catch (e) {
      if (e instanceof ApiUnauthorizedError) {
        setCreateError(e.message);
        onError?.(e.message);
      } else {
        const msg = 'You appear to be offline. Please try again later.';
        setCreateError(msg);
        onError?.(msg);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        disabled={disabled || loading}
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'justify-between font-normal',
              compact ? 'w-32' : 'w-full sm:w-48'
            )}
          />
        }
      >
        <span className={cn('truncate', !value && 'text-muted-foreground')}>
          {loading ? 'Loading…' : selectedLabel}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>

      <PopoverContent className="w-[var(--anchor-width,12rem)] min-w-[12rem] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search…"
          />
          <CommandList>
            <CommandGroup>
              <CommandItem
                value="__none__"
                data-checked={!value}
                onSelect={() => handleSelect('')}
              >
                <span className="text-muted-foreground">None</span>
              </CommandItem>
              {filtered.map((term) => (
                <CommandItem
                  key={term.id}
                  value={term.id}
                  data-checked={value === term.id}
                  onSelect={() => handleSelect(term.id)}
                >
                  {term.attributes.name}
                </CommandItem>
              ))}
              {filtered.length === 0 && !canCreate && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No results.
                </p>
              )}
            </CommandGroup>

            {createError && (
              <p className="px-3 py-2 text-xs text-destructive">{createError}</p>
            )}

            {canCreate && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem disabled={creating} onSelect={handleCreate}>
                    <Plus className="h-3.5 w-3.5" />
                    {creating ? 'Creating…' : `Create "${search.trim()}"`}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── AreaSubjectSelector ──────────────────────────────────────────────────────

interface AreaSubjectSelectorProps {
  areaUuid: string;
  subjectUuid: string;
  onAreaChange: (uuid: string) => void;
  onSubjectChange: (uuid: string) => void;
  layout?: 'row' | 'col';
  hideLabels?: boolean;
  compact?: boolean;
}

export function AreaSubjectSelector({
  areaUuid,
  subjectUuid,
  onAreaChange,
  onSubjectChange,
  layout = 'row',
  hideLabels = false,
  compact = false,
}: AreaSubjectSelectorProps) {
  const [areas, setAreas] = useState<TaxonomyTerm[]>([]);
  const [subjects, setSubjects] = useState<TaxonomyTerm[]>([]);
  const [loadingAreas, setLoadingAreas] = useState(true);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [taxonomyError, setTaxonomyError] = useState('');

  useEffect(() => {
    fetch('/api/taxonomy?type=areas')
      .then((r) => r.json())
      .then((d) => setAreas(d.data ?? []))
      .finally(() => setLoadingAreas(false));
  }, []);

  useEffect(() => {
    if (!areaUuid) {
      setSubjects([]);
      return;
    }
    setLoadingSubjects(true);
    fetch(`/api/taxonomy?type=subjects&area=${areaUuid}`)
      .then((r) => r.json())
      .then((d) => setSubjects(d.data ?? []))
      .finally(() => setLoadingSubjects(false));
  }, [areaUuid]);

  async function createArea(name: string): Promise<string | null> {
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
    setAreas((prev) =>
      [...prev, newTerm].sort((a, b) =>
        a.attributes.name.localeCompare(b.attributes.name)
      )
    );
    return data.data.id;
  }

  async function createSubject(name: string): Promise<string | null> {
    if (!areaUuid) return null;
    const res = await Promise.race([
      fetch('/api/taxonomy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'subject', name, areaUuid }),
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
    setSubjects((prev) =>
      [...prev, newTerm].sort((a, b) =>
        a.attributes.name.localeCompare(b.attributes.name)
      )
    );
    return data.data.id;
  }

  function handleAreaChange(uuid: string) {
    onAreaChange(uuid);
    onSubjectChange('');
  }

  const containerClass = compact
    ? 'flex flex-row gap-2'
    : layout === 'row'
    ? 'flex flex-col sm:flex-row gap-3'
    : 'flex flex-col gap-3';

  return (
    <div className={containerClass}>
      <div className="flex flex-col gap-1.5">
        {!hideLabels && <Label>Area</Label>}
        <TaxonomyCombobox
          value={areaUuid}
          onChange={handleAreaChange}
          options={areas}
          loading={loadingAreas}
          placeholder="No area"
          onCreate={createArea}
          compact={compact}
          onError={setTaxonomyError}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        {!hideLabels && <Label>Subject</Label>}
        <TaxonomyCombobox
          value={subjectUuid}
          onChange={onSubjectChange}
          options={subjects}
          loading={loadingSubjects}
          disabled={!areaUuid}
          placeholder={!areaUuid ? 'Select area' : 'No subject'}
          onCreate={areaUuid ? createSubject : undefined}
          compact={compact}
          onError={setTaxonomyError}
        />
      </div>

      {taxonomyError && (
        <p className="text-sm text-destructive">{taxonomyError}</p>
      )}
    </div>
  );
}
