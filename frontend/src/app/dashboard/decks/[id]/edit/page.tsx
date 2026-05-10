'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AreaSubjectMultiSelector,
  AreaSubjectChipList,
} from '@/components/area-subject-multi-selector';
import { ShareButton } from '@/components/share/share-button';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JsonApiResource } from '@/lib/json-api';
import { toRelIds } from '@/lib/json-api';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import {
  MUTATION_QUEUED_MESSAGE,
  OFFLINE_ACTION_MESSAGE,
  messageWhenNetworkRequestThrows,
  userFacingMessageForApiError,
} from '@/lib/api-client-messages';

interface DeckResponse {
  data: JsonApiResource;
  included?: JsonApiResource[];
}

function idListsEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
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
  const [deleteError, setDeleteError] = useState('');

  const { isOnline } = useOnlineStatus();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [areaUuids, setAreaUuids] = useState<string[]>([]);
  const [subjectUuids, setSubjectUuids] = useState<string[]>([]);
  const [isShared, setIsShared] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<{
    title: string; description: string; areaUuids: string[]; subjectUuids: string[];
  } | null>(null);

  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();

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

        const areaIds = toRelIds(deck.relationships?.field_area?.data);
        const subjectIds = toRelIds(deck.relationships?.field_subject?.data);

        setAreaUuids(areaIds);
        setSubjectUuids(subjectIds);
        setIsShared(Boolean(deck.attributes.field_is_shared));
        setShareToken((deck.attributes.field_share_token as string | null) ?? null);
        setSavedSnapshot({
          title: (deck.attributes.title as string) ?? '',
          description: (deck.attributes.body as { value?: string } | null)?.value ?? '',
          areaUuids: areaIds,
          subjectUuids: subjectIds,
        });
      })
      .finally(() => setLoading(false));
  }, [authenticated, id]);

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
          areaUuids,
          subjectUuids,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          userFacingMessageForApiError(res, data, 'Failed to save changes.')
        );
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
    setDeleteError('');
    if (!isOnline) {
      setDeleteError(OFFLINE_ACTION_MESSAGE);
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/decks/${id}`, { method: 'DELETE' });
      if (res.status === 202) {
        const data = await res.json().catch(() => ({}));
        if ((data as { queued?: boolean }).queued) {
          setDeleteError(MUTATION_QUEUED_MESSAGE);
          return;
        }
        setDeleteError('Unexpected response. Please try again.');
        return;
      }
      if (res.status === 204) {
        setDeleteConfirm(false);
        setDeleteError('');
        router.push('/dashboard/decks');
        return;
      }
      const data = await res.json().catch(() => ({}));
      setDeleteError(
        userFacingMessageForApiError(res, data, 'Failed to delete deck.')
      );
    } catch {
      setDeleteError(messageWhenNetworkRequestThrows());
    } finally {
      setDeleting(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    markSignedOut();
    router.replace('/');
  }

  if (!authenticated) return null;

  const isDirty = !!savedSnapshot && !loading && (
    title !== savedSnapshot.title ||
    description !== savedSnapshot.description ||
    !idListsEqual(areaUuids, savedSnapshot.areaUuids) ||
    !idListsEqual(subjectUuids, savedSnapshot.subjectUuids)
  );

  return (
    <>
      <Header authenticated onSignIn={() => {}} onSignUp={() => {}} onLogout={handleLogout} />

      <main className="mx-auto max-w-2xl px-6 pt-28 pb-16">
        <div className="mb-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon-sm"
              nativeButton={false}
              render={<Link href="/dashboard/decks" />}
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to decks</span>
            </Button>
            <h1 className="text-3xl font-bold tracking-tight text-foreground truncate">Edit deck</h1>
          </div>
          {!loading && (
            <ShareButton
              type="flashcard_deck"
              nodeUuid={id}
              isShared={isShared}
              shareToken={shareToken}
              onChange={({ isShared: next, shareToken: nextToken }) => {
                setIsShared(next);
                setShareToken(nextToken);
              }}
            />
          )}
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

            <div className="flex flex-col gap-2">
              <AreaSubjectMultiSelector
                areaUuids={areaUuids}
                subjectUuids={subjectUuids}
                onChange={(next) => {
                  setAreaUuids(next.areaUuids);
                  setSubjectUuids(next.subjectUuids);
                }}
                layout="row"
                hideLabels
                compact
                chipsRender="none"
              />
              {(areaUuids.length > 0 || subjectUuids.length > 0) && (
                <AreaSubjectChipList
                  areaUuids={areaUuids}
                  subjectUuids={subjectUuids}
                  onChange={(next) => {
                    setAreaUuids(next.areaUuids);
                    setSubjectUuids(next.subjectUuids);
                  }}
                  compact
                />
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex items-center gap-3 pt-2">
              <Button
                type="submit"
                disabled={saving}
                className="gap-2"
              >
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
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm text-muted-foreground">
                      This will permanently delete the deck and all its cards.
                    </p>
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
                      onClick={() => {
                        setDeleteConfirm(false);
                        setDeleteError('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                  {deleteError && (
                    <p className="text-sm text-destructive">{deleteError}</p>
                  )}
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDeleteError('');
                    setDeleteConfirm(true);
                  }}
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
