'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import { Header } from '@/components/header';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardAction, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { FolderOpen, Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import Link from 'next/link';
import { toSlug } from '@/lib/utils';
import type { JsonApiResource } from '@/lib/drupal';

interface TaxonomyResponse {
  data: JsonApiResource[];
}

const SUBJECTS_PREVIEW = 5;

export default function AreasPage() {
  const [areas, setAreas] = useState<JsonApiResource[]>([]);
  const [subjectsByArea, setSubjectsByArea] = useState<Record<string, JsonApiResource[]>>({});
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<JsonApiResource | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Add state
  const [adding, setAdding] = useState(false);
  const [addName, setAddName] = useState('');
  const [addError, setAddError] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();

  useEffect(() => {
    if (!authenticated) return;

    async function load() {
      setLoading(true);
      try {
        const [areasRes, subjectsRes] = await Promise.all([
          fetch('/api/taxonomy?type=areas'),
          fetch('/api/taxonomy?type=subjects'),
        ]);

        const areasData: TaxonomyResponse = areasRes.ok ? await areasRes.json() : { data: [] };
        const subjectsData: TaxonomyResponse = subjectsRes.ok ? await subjectsRes.json() : { data: [] };

        setAreas(areasData.data ?? []);

        const grouped: Record<string, JsonApiResource[]> = {};
        for (const subject of subjectsData.data ?? []) {
          const areaId = (subject.relationships?.field_area?.data as { id?: string } | null)?.id;
          if (areaId) {
            if (!grouped[areaId]) grouped[areaId] = [];
            grouped[areaId].push(subject);
          }
        }
        setSubjectsByArea(grouped);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authenticated]);

  useEffect(() => { if (adding) addInputRef.current?.focus(); }, [adding]);
  useEffect(() => { if (editingId) editInputRef.current?.focus(); }, [editingId]);

  function isDuplicate(name: string, excludeId?: string) {
    return areas.some(
      (a) => a.id !== excludeId &&
        (a.attributes?.name as string).toLowerCase() === name.trim().toLowerCase()
    );
  }

  function startEdit(area: JsonApiResource) {
    setEditingId(area.id);
    setEditName(area.attributes?.name as string);
    setEditError('');
  }

  async function handleEdit() {
    if (!editingId) return;
    const name = editName.trim();
    if (!name) { setEditError('Name is required.'); return; }
    if (isDuplicate(name, editingId)) { setEditError('An area with this name already exists.'); return; }
    setEditSaving(true);
    try {
      const res = await fetch(`/api/taxonomy/${editingId}?type=area`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setAreas((prev) =>
          prev.map((a) => a.id === editingId ? { ...a, attributes: { ...a.attributes, name } } : a)
        );
        setEditingId(null);
        setEditError('');
      }
    } finally {
      setEditSaving(false);
    }
  }

  async function handleAdd() {
    const name = addName.trim();
    if (!name) { setAddError('Name is required.'); return; }
    if (isDuplicate(name)) { setAddError('An area with this name already exists.'); return; }
    setAddSaving(true);
    try {
      const res = await fetch('/api/taxonomy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'area', name }),
      });
      if (res.ok) {
        const data = await res.json();
        setAreas((prev) => [...prev, data.data]);
        setAddName('');
        setAdding(false);
        setAddError('');
      }
    } finally {
      setAddSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/taxonomy/${confirmDelete.id}?type=area`, { method: 'DELETE' });
      if (res.ok || res.status === 204) {
        setAreas((prev) => prev.filter((a) => a.id !== confirmDelete.id));
        setSubjectsByArea((prev) => {
          const next = { ...prev };
          delete next[confirmDelete.id];
          return next;
        });
        setConfirmDelete(null);
      }
    } finally {
      setDeleting(false);
    }
  }

  if (authenticated === null) return null;

  return (
    <div className="min-h-screen bg-background">
      <Header
        authenticated={!!authenticated}
        onSignIn={() => {}}
        onSignUp={() => {}}
        onLogout={markSignedOut}
      />

      <main className="mx-auto max-w-3xl px-6 pt-24 pb-16">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <FolderOpen className="h-6 w-6 text-primary shrink-0" />
            <h1 className="text-2xl font-semibold tracking-tight">Areas</h1>
          </div>
          <Button size="icon-sm" onClick={() => { setAdding(true); setAddError(''); }}>
            <Plus className="h-4 w-4" />
            <span className="sr-only">Add area</span>
          </Button>
        </div>

        {adding && (
          <div className="mb-4">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3">
              <input
                ref={addInputRef}
                value={addName}
                onChange={(e) => { setAddName(e.target.value); setAddError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setAdding(false); setAddName(''); } }}
                placeholder="Area name"
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/60"
              />
              <button onClick={handleAdd} disabled={addSaving} className="text-primary hover:text-primary/80 transition-colors p-0.5">
                <Check className="h-4 w-4" />
              </button>
              <button onClick={() => { setAdding(false); setAddName(''); setAddError(''); }} className="text-muted-foreground hover:text-foreground transition-colors p-0.5">
                <X className="h-4 w-4" />
              </button>
            </div>
            {addError && <p className="text-xs text-destructive mt-1.5 pl-1">{addError}</p>}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : areas.length === 0 && !adding ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
            <FolderOpen className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground text-sm">No areas yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {areas.map((area) => {
              const subjects = subjectsByArea[area.id] ?? [];
              const preview = subjects.slice(0, SUBJECTS_PREVIEW);
              const overflow = subjects.length - preview.length;

              return (
                <Card key={area.id}>
                  <CardHeader>
                    <CardTitle className="text-base font-semibold min-w-0">
                      {editingId === area.id ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <input
                              ref={editInputRef}
                              value={editName}
                              onChange={(e) => { setEditName(e.target.value); setEditError(''); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleEdit(); if (e.key === 'Escape') setEditingId(null); }}
                              className="flex-1 text-sm font-semibold bg-background border border-border rounded-md px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
                            />
                            <button onClick={handleEdit} disabled={editSaving} className="text-primary hover:text-primary/80 transition-colors p-0.5">
                              <Check className="h-4 w-4" />
                            </button>
                            <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground transition-colors p-0.5">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          {editError && <p className="text-xs text-destructive font-normal pl-1">{editError}</p>}
                        </div>
                      ) : (
                        <Link
                          href={`/dashboard/areas/${toSlug(area.attributes?.name as string)}`}
                          className="hover:text-primary transition-colors"
                        >
                          {area.attributes?.name as string}
                        </Link>
                      )}
                    </CardTitle>
                    <CardAction>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => startEdit(area)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setConfirmDelete(area)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardAction>
                  </CardHeader>

                  {preview.length > 0 && (
                    <CardContent className="pt-0 pb-1">
                      <div className="flex flex-wrap gap-1.5">
                        {preview.map((s) => (
                          <Link
                            key={s.id}
                            href={`/dashboard/areas/${toSlug(area.attributes?.name as string)}?subject=${s.id}`}
                            className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors"
                          >
                            {s.attributes?.name as string}
                          </Link>
                        ))}
                        {overflow > 0 && (
                          <Link
                            href={`/dashboard/areas/${toSlug(area.attributes?.name as string)}`}
                            className="inline-flex items-center rounded-md px-2.5 py-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                          >
                            +{overflow} more
                          </Link>
                        )}
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </main>

      <Dialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete area?</DialogTitle>
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
