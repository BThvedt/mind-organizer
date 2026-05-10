'use client';

import { useCallback, useRef, useState } from 'react';
import { useMediaUpload, type UploadedMedia } from './useMediaUpload';
import { classifyFile } from '@/lib/compress-media';

interface UseMediaDropPasteArgs {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  body: string;
  setBody: (next: string) => void;
}

interface UseMediaDropPasteResult {
  /** True while the user is dragging files over the editor pane. */
  isDragging: boolean;
  /** Number of uploads currently in flight (>0 if any are queued). */
  uploadingCount: number;
  /** Most recent error message from a failed upload, if any. */
  uploadError: string;
  /** Clears the most recent upload error. */
  clearUploadError: () => void;
  /** Handlers to spread on the wrapping element for drag-and-drop. */
  dropZoneProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDragEnter: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  /** Paste handler to attach to the textarea. */
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  /**
   * Inserts arbitrary text at the textarea cursor (or appends to the body
   * if the textarea isn't mounted). Exposed so other toolbar widgets like
   * the AttachmentsMenu can reuse the same insertion path without
   * duplicating bodyRef bookkeeping.
   */
  insertAtCursor: (text: string) => void;
}

// Per-session placeholder ID. We avoid a simple incrementing counter
// because previous-session placeholders can survive in autosaved bodies,
// and `String.prototype.replace` would then target the *old* match instead
// of the freshly-inserted one. A random suffix per pending upload makes
// collisions effectively impossible.
function generatePlaceholderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Wires up drag-drop + paste on a markdown editor textarea so dropped or
 * pasted files (images/audio) get uploaded through `useMediaUpload` and
 * inserted into the body as `![alt](/api/media/<uuid>/<filename>)` markdown.
 *
 * On a multi-file drop, all `![Uploading…](pending-<random>)` placeholders
 * are inserted at the cursor as one block, then the uploads run
 * sequentially (one at a time). Each completion replaces its own uniquely
 * tagged placeholder via string.replace, and every body mutation goes
 * through `commitBody` so `bodyRef.current` stays consistent across writes
 * that happen within a single React tick.
 *
 * Sequential rather than parallel because in development we hit silent
 * stalls when two uploads were in flight at once (likely PHP-FPM
 * worker / session contention in DDEV). Sequential is reliable; for a
 * typical 1-3 file drop the latency difference is negligible.
 */
export function useMediaDropPaste({
  textareaRef,
  body,
  setBody,
}: UseMediaDropPasteArgs): UseMediaDropPasteResult {
  const { upload } = useMediaUpload();
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState('');

  // bodyRef is the source of truth our async helpers read between
  // renders. CRITICAL: every mutation here calls `commitBody()` which
  // updates bodyRef synchronously *and* schedules the React setState.
  // Going through React-render-only updates causes a stale-ref bug when
  // multiple writes happen in the same task (e.g. iter N's replace and
  // iter N+1's insert in a parallel-upload batch — only the last
  // setState wins, silently dropping the earlier replacement).
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const setBodyRef = useRef(setBody);
  setBodyRef.current = setBody;

  const commitBody = useCallback((next: string): void => {
    bodyRef.current = next;
    setBodyRef.current(next);
  }, []);

  const dragDepth = useRef(0);

  const insertAtCursor = useCallback((text: string): void => {
    const ta = textareaRef.current;
    const current = bodyRef.current;
    if (!ta) {
      commitBody(current + text);
      return;
    }
    const start = ta.selectionStart ?? current.length;
    const end = ta.selectionEnd ?? current.length;
    commitBody(current.slice(0, start) + text + current.slice(end));
    // Restore cursor after React re-renders.
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      const pos = start + text.length;
      node.setSelectionRange(pos, pos);
      node.focus();
    });
  }, [commitBody, textareaRef]);

  const replacePlaceholder = useCallback((placeholder: string, replacement: string): void => {
    const current = bodyRef.current;
    if (current.includes(placeholder)) {
      commitBody(current.replace(placeholder, replacement));
    } else {
      // Placeholder lost (user edited it away). Append the resolved markdown
      // so the upload isn't silently discarded.
      commitBody(current + (current.endsWith('\n') ? '' : '\n') + replacement);
    }
  }, [commitBody]);

  const removePlaceholder = useCallback((placeholder: string): void => {
    const current = bodyRef.current;
    commitBody(current.replace(placeholder + '\n', '').replace(placeholder, ''));
  }, [commitBody]);

  const handleFiles = useCallback(async (files: File[]): Promise<void> => {
    const supported = files.filter((f) => classifyFile(f) !== null);
    if (supported.length === 0) return;

    // Allocate placeholders synchronously and insert them as one block at
    // the current cursor position. Doing this in a single state mutation
    // avoids races between insertAtCursor calls and frees us to run the
    // uploads in parallel below.
    const items = supported.map((file) => {
      const id = generatePlaceholderId();
      return { file, id, placeholder: `![Uploading…](pending-${id})` };
    });
    insertAtCursor(items.map((it) => it.placeholder).join('\n') + '\n');
    setUploadingCount((n) => n + items.length);

    // One at a time — see hook docblock for why we don't parallelise.
    for (const { file, placeholder } of items) {
      try {
        const uploaded: UploadedMedia = await upload(file);
        // Files render as plain markdown links (the renderer upgrades them
        // to a styled box on display); images/audio keep the `![]()` embed
        // syntax so they continue to render inline.
        const markdown =
          uploaded.mediaType === 'file'
            ? `[${file.name}](${uploaded.url})`
            : `![${file.name.replace(/\.[^.]+$/, '')}](${uploaded.url})`;
        replacePlaceholder(placeholder, markdown);
      } catch (err) {
        removePlaceholder(placeholder);
        const message =
          err instanceof Error ? err.message : 'Failed to upload media.';
        setUploadError(message);
      } finally {
        setUploadingCount((n) => Math.max(0, n - 1));
      }
    }
  }, [insertAtCursor, removePlaceholder, replacePlaceholder, upload]);

  const onDragEnter = useCallback((e: React.DragEvent): void => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent): void => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent): void => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragging(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent): void => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    void handleFiles(files);
  }, [handleFiles]);

  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = e.clipboardData?.files;
    if (!items || items.length === 0) return;
    const files = Array.from(items).filter((f) => classifyFile(f) !== null);
    if (files.length === 0) return;
    e.preventDefault();
    void handleFiles(files);
  }, [handleFiles]);

  const clearUploadError = useCallback(() => setUploadError(''), []);

  return {
    isDragging,
    uploadingCount,
    uploadError,
    clearUploadError,
    dropZoneProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
    onPaste,
    insertAtCursor,
  };
}
