'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AreaSubjectSelector } from '@/components/area-subject-selector';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import type { JsonApiResource } from '@/lib/drupal';

interface DeckResponse {
  data: JsonApiResource;
  included?: JsonApiResource[];
}

export default function EditDeckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [areaUuid, setAreaUuid] = useState('');
  const [subjectUuid, setSubjectUuid] = useState('');

  const authenticated = useAuth();

  useEffect(() => {
    if (!authenticated) return;
    fetch(`/api/decks/${id}`)
      .then((r) => r.json())
      .then((json: DeckResponse) => {
        const deck = json.data;
        setTitle((deck.attributes.title as string) ?? '');
        setDescription(
          (deck.attributes.body as { value?: string } | null)?.value ?? ''
        );

        const areaRel = deck.relationships?.field_area?.data;
        const subjectRel = deck.relationships?.field_subject?.data;
        const areaId =
          areaRel && !Array.isArray(areaRel) ? (areaRel as { id: string }).id : '';
        const subjectId =
          subjectRel && !Array.isArray(subjectRel)
            ? (subjectRel as { id: string }).id
            : '';

        setAreaUuid(areaId);
        setSubjectUuid(subjectId);
      })
      .finally(() => setLoading(false));
  }, [authenticated, id]);

  const handleAreaChange = (uuid: string) => {
    setAreaUuid(uuid);
    setSubjectUuid('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setSaving(true);
    setError('');

    try {
      const res = await fetch(`/api/decks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          areaUuid: areaUuid || null,
          subjectUuid: subjectUuid || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Failed to save changes.');
        return;
      }

      router.push(`/dashboard/decks/${id}`);
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setSaving(false);
    }
  };

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/decks/${id}`, { method: 'DELETE' });
      if (res.ok || res.status === 204) {
        router.push('/dashboard/decks');
      }
    } finally {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/');
  }

  if (!authenticated) return null;

  return (
    <>
      <Header authenticated onSignIn={() => {}} onSignUp={() => {}} onLogout={handleLogout} />

      <main className="mx-auto max-w-2xl px-6 pt-28 pb-16">
        <div className="mb-8 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href="/dashboard/decks" />}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to decks</span>
          </Button>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Edit deck</h1>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-card border border-border" />
            ))}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="deck-title">Title *</Label>
              <Input
                id="deck-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Biology Fundamentals"
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="deck-desc">Description</Label>
              <Textarea
                id="deck-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this deck about?"
                rows={3}
              />
            </div>

            <AreaSubjectSelector
              areaUuid={areaUuid}
              subjectUuid={subjectUuid}
              onAreaChange={handleAreaChange}
              onSubjectChange={setSubjectUuid}
              layout="col"
            />

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={saving} className="gap-2">
                <Save className="h-4 w-4" />
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                nativeButton={false}
                render={<Link href={`/dashboard/decks/${id}`} />}
              >
                Cancel
              </Button>
            </div>

            <div className="border-t border-border pt-6 mt-2">
              {deleteConfirm ? (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-muted-foreground">This will permanently delete the deck and all its cards.</p>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting…' : 'Confirm delete'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteConfirm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteConfirm(true)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete deck
                </Button>
              )}
            </div>
          </form>
        )}
      </main>
    </>
  );
}
