'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Loader2,
  Pencil,
  Presentation,
  Trash2,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import {
  MediaDeleteDialog,
  type MediaDeleteAsset,
} from '@/components/media-delete-dialog';
import {
  MediaRenameDialog,
  type MediaRenameAsset,
} from '@/components/media-rename-dialog';

interface FileAsset {
  uuid: string;
  mediaType: 'file';
  mimeType: string;
  originalFilename: string;
  description: string;
  fileSize: number;
  created: number;
  url: string;
}

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function extOf(filename: string): string {
  return filename.toLowerCase().split('.').pop() ?? '';
}

/**
 * Picks a Lucide icon based on the filename extension. Falls back to a
 * generic file icon for unrecognized extensions.
 */
function iconForFilename(filename: string): IconComponent {
  const ext = extOf(filename);
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return FileSpreadsheet;
  if (['ppt', 'pptx', 'odp'].includes(ext)) return Presentation;
  if (['json', 'xml'].includes(ext)) return FileCode;
  if (ext === 'zip') return FileArchive;
  if (['pdf', 'doc', 'docx', 'odt', 'txt', 'md', 'markdown'].includes(ext)) return FileText;
  return FileIcon;
}

export default function FilesPage() {
  const router = useRouter();
  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();

  const [assets, setAssets] = useState<FileAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<MediaDeleteAsset | null>(null);
  const [renameTarget, setRenameTarget] = useState<MediaRenameAsset | null>(null);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/media?type=file')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load files (HTTP ${res.status})`);
        return (await res.json()) as { data: FileAsset[] };
      })
      .then((body) => {
        if (cancelled) return;
        setAssets(body.data ?? []);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  const stats = useMemo(() => {
    if (!assets) return null;
    return {
      count: assets.length,
      totalBytes: assets.reduce((sum, a) => sum + a.fileSize, 0),
    };
  }, [assets]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    markSignedOut();
    router.replace('/');
  }

  function handleDeleted(uuid: string) {
    setAssets((prev) => (prev ? prev.filter((a) => a.uuid !== uuid) : prev));
  }

  function handleRenamed(
    uuid: string,
    updates: { originalFilename: string; description: string },
  ) {
    setAssets((prev) =>
      prev
        ? prev.map((a) => (a.uuid === uuid ? { ...a, ...updates } : a))
        : prev,
    );
  }

  if (!authenticated) return null;

  return (
    <>
      <Header
        authenticated
        onSignIn={() => {}}
        onSignUp={() => {}}
        onLogout={handleLogout}
      />

      <main className="mx-auto max-w-5xl px-6 pt-28 pb-16">
        <div className="mb-6 flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href="/dashboard" />}
            className="mt-1"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to dashboard</span>
          </Button>
          <div className="flex-1">
            <div className="flex items-start gap-2">
              <FileText className="mt-1 h-7 w-7 text-primary shrink-0" />
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Files</h1>
                <p className="mt-1 text-muted-foreground">
                  Manage PDFs, spreadsheets, and documents attached to your notes,
                  decks, and todos.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        {stats && (
          <div className="mb-6 ml-12 flex items-center gap-3 text-sm text-muted-foreground">
            <span>
              {stats.count} {stats.count === 1 ? 'file' : 'files'}
            </span>
            <span aria-hidden>·</span>
            <span>{formatBytes(stats.totalBytes)} used</span>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading files…</span>
          </div>
        )}

        {error && !loading && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-6 py-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && assets && assets.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card/50 px-8 py-16 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-1">No files yet</h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Drop PDFs, spreadsheets, or documents into a note, deck, or todo and
              they&apos;ll appear here.
            </p>
          </div>
        )}

        {!loading && !error && assets && assets.length > 0 && (
          <ul className="flex flex-col gap-2">
            {assets.map((asset) => (
              <FileRow
                key={asset.uuid}
                asset={asset}
                onDelete={() => setDeleteTarget(asset)}
                onRename={() => setRenameTarget(asset)}
              />
            ))}
          </ul>
        )}
      </main>

      <MediaDeleteDialog
        asset={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={handleDeleted}
      />

      <MediaRenameDialog
        asset={renameTarget}
        onClose={() => setRenameTarget(null)}
        onRenamed={handleRenamed}
      />
    </>
  );
}

function FileRow({
  asset,
  onDelete,
  onRename,
}: {
  asset: FileAsset;
  onDelete: () => void;
  onRename: () => void;
}) {
  const Icon = iconForFilename(asset.originalFilename);
  return (
    <li className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-ring/50">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <p
          className="truncate text-sm font-medium text-foreground"
          title={asset.originalFilename}
        >
          {asset.originalFilename}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(asset.fileSize)}
          {asset.description ? ` \u00B7 ${asset.description}` : ''}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <a
          href={asset.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={`Open ${asset.originalFilename} in new tab`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <button
          type="button"
          onClick={onRename}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={`Rename ${asset.originalFilename}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Delete ${asset.originalFilename}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}
