import { useRef, useCallback } from 'react';

/**
 * Smooth-scrolls `el` to `targetScrollTop` over `duration` ms using an
 * ease-in-out curve driven by requestAnimationFrame.
 */
function smoothScrollTo(el: HTMLElement, targetScrollTop: number, duration = 100) {
  const start = el.scrollTop;
  const delta = targetScrollTop - start;
  if (Math.abs(delta) < 1) return;
  const startTime = performance.now();
  const step = (now: number) => {
    const t = Math.min((now - startTime) / duration, 1);
    const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    el.scrollTop = start + delta * eased;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Returns the cursor's pixel offset from the top of the textarea's content
 * area (i.e. including paddingTop, accounting for wrapped lines) by cloning
 * the textarea's layout into an off-screen mirror div. This is the only
 * reliable way to handle line wrapping in a native textarea.
 *
 * The returned value is the absolute Y of the cursor within the textarea's
 * scrollable content — subtract editor.scrollTop to get the visual Y within
 * the textarea's visible area.
 */
function getCursorContentY(editor: HTMLTextAreaElement, cursorPos: number): number {
  const s = getComputedStyle(editor);

  const mirror = document.createElement('div');
  Object.assign(mirror.style, {
    position: 'fixed',
    top: '0',
    left: '-99999px',
    visibility: 'hidden',
    // Match textarea interior width so wrapping is identical
    width: `${editor.clientWidth}px`,
    // Font
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    lineHeight: s.lineHeight,
    letterSpacing: s.letterSpacing,
    // Padding (textarea padding controls where text starts)
    paddingTop: s.paddingTop,
    paddingRight: s.paddingRight,
    paddingBottom: s.paddingBottom,
    paddingLeft: s.paddingLeft,
    boxSizing: 'border-box',
    // Wrapping must match textarea's soft-wrap behaviour
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    overflow: 'hidden',
  });

  document.body.appendChild(mirror);

  // Text content up to the cursor
  mirror.appendChild(document.createTextNode(editor.value.substring(0, cursorPos)));

  // A zero-width marker at the cursor position; measure its top offset
  const caret = document.createElement('span');
  caret.textContent = '\u200b';
  mirror.appendChild(caret);

  const offsetY = caret.offsetTop;

  document.body.removeChild(mirror);
  return offsetY;
}

/**
 * Returns the 1-based start/end line range of the ```mermaid block the
 * cursor is currently inside, or null.
 */
function getCursorMermaidRange(
  body: string,
  cursorLine: number,
): { start: number; end: number } | null {
  const lines = body.split('\n');
  let openLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    const lineNo = i + 1;
    if (openLine === -1 && /^```mermaid\b/i.test(trimmed)) {
      openLine = lineNo;
    } else if (openLine !== -1 && /^(`{3,}|~{3,})\s*$/.test(trimmed)) {
      if (cursorLine >= openLine && cursorLine <= lineNo) {
        return { start: openLine, end: lineNo };
      }
      openLine = -1;
    }
  }
  return null;
}

/**
 * Returns the 1-based start/end line range of any fenced code block the
 * cursor is currently inside, or null. Mermaid blocks are also matched
 * (callers should check for mermaid first).
 */
function getCursorCodeBlockRange(
  body: string,
  cursorLine: number,
): { start: number; end: number } | null {
  const lines = body.split('\n');
  let openLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    const lineNo = i + 1;
    if (openLine === -1 && /^(`{3,}|~{3,})/.test(trimmed)) {
      openLine = lineNo;
    } else if (openLine !== -1 && /^(`{3,}|~{3,})\s*$/.test(trimmed)) {
      if (cursorLine >= openLine && cursorLine <= lineNo) {
        return { start: openLine, end: lineNo };
      }
      openLine = -1;
    }
  }
  return null;
}

/**
 * Returns only block-level elements annotated with data-source-line,
 * excluding inline nodes (strong, em, a, code, etc.) which are also
 * stamped by the remark plugin but are not useful scroll targets.
 */
function getBlockAnnotatedElements(viewport: HTMLElement): HTMLElement[] {
  const BLOCK_TAGS = /^(P|H[1-6]|PRE|BLOCKQUOTE|UL|OL|LI|TABLE|THEAD|TBODY|TR|TD|TH|DIV|HR|IMG|FIGURE)$/;
  return (Array.from(viewport.querySelectorAll('[data-source-line]')) as HTMLElement[]).filter(
    (el) => {
      if (BLOCK_TAGS.test(el.tagName)) return true;
      // Include span/a only when rendered as a block (custom audio/media wrappers)
      if (el.tagName === 'SPAN' || el.tagName === 'A') {
        const d = getComputedStyle(el).display;
        return d !== 'inline' && !d.startsWith('inline-');
      }
      return false;
    },
  );
}

export function usePreviewScrollSync(
  editorRef: React.RefObject<HTMLTextAreaElement | null>,
  previewViewportRef: React.RefObject<HTMLDivElement | null>,
  body: string,
) {
  // Stores the opening fence line of the currently-locked code/mermaid block,
  // or null when no block is locked. Once the cursor enters a block, one scroll
  // is performed and then sync is suppressed until the cursor leaves.
  const blockLockRef = useRef<number | null>(null);

  const syncPreview = useCallback(() => {
    const editor = editorRef.current;
    const viewport = previewViewportRef.current;
    if (!editor || !viewport) return;

    // Mobile: panes are tabs, viewport has no visible height — skip.
    if (viewport.clientHeight === 0) return;

    const cursorPos = editor.selectionStart ?? 0;

    // ── Accurate cursor Y via mirror div (handles wrapped lines) ────────────
    const cursorContentY = getCursorContentY(editor, cursorPos);
    const editorRect = editor.getBoundingClientRect();
    const cursorScreenY = editorRect.top + cursorContentY - editor.scrollTop;

    const cursorLine = body.substring(0, cursorPos).split('\n').length;

    // ── Mermaid block check ──────────────────────────────────────────────────
    const mermaidRange = getCursorMermaidRange(body, cursorLine);
    if (mermaidRange) {
      if (blockLockRef.current === mermaidRange.start) return; // same block, locked

      const mermaidEl = viewport.querySelector(
        `[data-source-line="${mermaidRange.start}"]`,
      ) as HTMLElement | null;
      if (mermaidEl) {
        blockLockRef.current = mermaidRange.start;
        const mermaidScreenY = mermaidEl.getBoundingClientRect().top;
        const viewportRect = viewport.getBoundingClientRect();
        const targetY = viewportRect.top + viewport.clientHeight * 0.2;
        smoothScrollTo(viewport, viewport.scrollTop + (mermaidScreenY - targetY));
      }
      return;
    }

    // ── General code block check ─────────────────────────────────────────────
    const codeRange = getCursorCodeBlockRange(body, cursorLine);
    if (codeRange) {
      if (blockLockRef.current === codeRange.start) return; // same block, locked

      // New code block entered — scroll once so the top of the rendered code
      // block in the preview aligns with the opening fence line in the editor,
      // then lock. No dead-zone: we always want this alignment on first entry.
      const all = getBlockAnnotatedElements(viewport);
      const codeEl = all.find(
        (node) => Number(node.getAttribute('data-source-line')) === codeRange.start,
      ) ?? null;

      if (codeEl) {
        blockLockRef.current = codeRange.start;

        // Character offset of the opening fence line's first character.
        const bodyLines = body.split('\n');
        const charsBeforeFence =
          bodyLines.slice(0, codeRange.start - 1).join('\n').length +
          (codeRange.start > 1 ? 1 : 0);

        // Screen Y of the opening ``` line in the editor.
        const fenceContentY = getCursorContentY(editor, charsBeforeFence);
        const fenceScreenY = editorRect.top + fenceContentY - editor.scrollTop;

        // Scroll preview so the top of the code block div sits at fenceScreenY.
        const codeTop = codeEl.getBoundingClientRect().top;
        smoothScrollTo(viewport, viewport.scrollTop + (codeTop - fenceScreenY));
      }
      return;
    }

    // Cursor is outside all code/mermaid blocks — release any lock.
    blockLockRef.current = null;

    // ── Find the closest block element at or before the cursor line ──────────
    const all = getBlockAnnotatedElements(viewport);
    const el = all.reduce<HTMLElement | null>((best, node) => {
      const line = Number(node.getAttribute('data-source-line'));
      if (line > cursorLine) return best;
      if (!best || line > Number(best.getAttribute('data-source-line'))) return node;
      return best;
    }, null);
    if (!el) return;

    // ── Alignment fraction within the element ────────────────────────────────
    const isMedia = el.tagName === 'IMG' || el.querySelector('audio') !== null;
    const alignmentFraction = isMedia ? 0.5 : 0;

    // ── Compare in absolute screen coordinates ───────────────────────────────
    const elRect = el.getBoundingClientRect();
    const elAlignmentScreenY = elRect.top + alignmentFraction * elRect.height;

    const margin = viewport.clientHeight * 0.15;
    const diff = elAlignmentScreenY - cursorScreenY;
    if (Math.abs(diff) <= margin) return;

    smoothScrollTo(viewport, viewport.scrollTop + diff);
  }, [editorRef, previewViewportRef, body]);

  const onEditorMouseUp = useCallback(() => {
    syncPreview();
  }, [syncPreview]);

  /**
   * Called on mouseUp inside the preview pane. Finds the source line of the
   * clicked element, then scrolls the editor so that line sits at the same
   * screen Y as the click.
   */
  const onPreviewMouseUp = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const editor = editorRef.current;
      if (!editor) return;

      // Walk up from the click target to find the nearest element annotated
      // with data-source-line (could be the element itself or an ancestor).
      let node = e.target as HTMLElement | null;
      let sourceLine: number | null = null;
      while (node && node !== (e.currentTarget as HTMLElement).parentElement) {
        const attr = node.getAttribute('data-source-line');
        if (attr) {
          sourceLine = Number(attr);
          break;
        }
        node = node.parentElement;
      }
      if (!sourceLine) return;

      const clickScreenY = e.clientY;
      const editorRect = editor.getBoundingClientRect();

      // Char offset of the first character of sourceLine (1-based).
      const bodyLines = body.split('\n');
      const charOffset =
        bodyLines.slice(0, sourceLine - 1).join('\n').length + (sourceLine > 1 ? 1 : 0);

      // Absolute Y of that line within the textarea's scrollable content.
      const contentY = getCursorContentY(editor, charOffset);

      // Scroll so the line appears at clickScreenY relative to the editor.
      // Derivation: screenY = editorRect.top + contentY - scrollTop
      //   → scrollTop = editorRect.top + contentY - clickScreenY
      // But clamp clickScreenY to the editor's visible region first so we
      // don't scroll wildly when the click is outside the editor bounds.
      const clampedClickY = Math.max(
        editorRect.top,
        Math.min(editorRect.bottom, clickScreenY),
      );
      const targetScrollTop = editorRect.top + contentY - clampedClickY;
      smoothScrollTo(editor, Math.max(0, targetScrollTop));
    },
    [editorRef, body],
  );

  return { onEditorMouseUp, onPreviewMouseUp };
}
