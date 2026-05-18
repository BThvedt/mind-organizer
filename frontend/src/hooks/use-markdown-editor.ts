import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  emit,
  insertCodeBlock,
  insertHorizontalRule,
  insertLink,
  lineEnd,
  lineStart,
  setHeading,
  togglePrefix,
  toggleNumberedList,
  wrapSelection,
  type EditContext,
  type PendingSelection,
} from "@/lib/textarea-edits";

const INDENT = "    "; // 4 spaces = one indent level

/**
 * Bound, no-arg action handlers exposed for toolbars (and anywhere
 * else that needs to drive a textarea edit programmatically). Every
 * action goes through the same execCommand-backed `emit` path as the
 * built-in keybindings, so a Bold from the toolbar lands in the same
 * undo step as a Bold typed via Cmd+B.
 */
export interface MarkdownEditorActions {
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleStrikethrough: () => void;
  toggleInlineCode: () => void;
  setHeading: (level: 1 | 2 | 3) => void;
  toggleBulletedList: () => void;
  toggleNumberedList: () => void;
  toggleTaskList: () => void;
  toggleBlockquote: () => void;
  insertCodeBlock: () => void;
  insertLink: () => void;
  insertHorizontalRule: () => void;
}

export function useMarkdownEditor(
  _value: string,
  onChange: (value: string) => void,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<PendingSelection | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Restore cursor/selection after React re-renders the controlled textarea.
  useEffect(() => {
    if (pendingSelection.current && ref.current) {
      ref.current.setSelectionRange(
        pendingSelection.current.start,
        pendingSelection.current.end,
      );
      pendingSelection.current = null;
    }
  });

  const getCtx = useCallback((): EditContext | null => {
    const textarea = ref.current;
    if (!textarea) return null;
    return {
      textarea,
      fallbackSetValue: (next) => onChangeRef.current(next),
      pendingSelectionRef: pendingSelection,
    };
  }, []);

  const actions = useMemo<MarkdownEditorActions>(() => {
    const run = (fn: (ctx: EditContext) => void) => () => {
      const ctx = getCtx();
      if (!ctx) return;
      ctx.textarea.focus();
      fn(ctx);
    };
    return {
      toggleBold: run((ctx) => wrapSelection(ctx, "**")),
      toggleItalic: run((ctx) => wrapSelection(ctx, "*")),
      toggleStrikethrough: run((ctx) => wrapSelection(ctx, "~~")),
      toggleInlineCode: run((ctx) => wrapSelection(ctx, "`")),
      setHeading: (level) => {
        const ctx = getCtx();
        if (!ctx) return;
        ctx.textarea.focus();
        setHeading(ctx, level);
      },
      toggleBulletedList: run((ctx) => togglePrefix(ctx, "- ")),
      toggleNumberedList: run(toggleNumberedList),
      toggleTaskList: run((ctx) => togglePrefix(ctx, "- [ ] ")),
      toggleBlockquote: run((ctx) => togglePrefix(ctx, "> ")),
      insertCodeBlock: run(insertCodeBlock),
      insertLink: run(insertLink),
      insertHorizontalRule: run(insertHorizontalRule),
    };
  }, [getCtx]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const textarea = e.currentTarget;
      const { selectionStart: ss, selectionEnd: se, value: text } = textarea;
      const hasSelection = ss !== se;

      // ── Standard shortcut bindings (Cmd on macOS, Ctrl elsewhere) ──
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && !e.shiftKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "b") {
          e.preventDefault();
          actions.toggleBold();
          return;
        }
        if (key === "i") {
          e.preventDefault();
          actions.toggleItalic();
          return;
        }
        if (key === "k") {
          e.preventDefault();
          actions.insertLink();
          return;
        }
        if (key === "e") {
          e.preventDefault();
          actions.toggleInlineCode();
          return;
        }
      }

      const isIndent =
        (e.key === "Tab" && !e.shiftKey) ||
        (e.key === " " && e.ctrlKey && hasSelection);
      const isUnindent = e.key === "Tab" && e.shiftKey;
      const isBlockquote = e.key === ">" && hasSelection;
      const isBacktick = e.key === "`" && hasSelection;

      if (!isIndent && !isUnindent && !isBlockquote && !isBacktick) return;

      e.preventDefault();

      const ctx: EditContext = {
        textarea,
        fallbackSetValue: (next) => onChangeRef.current(next),
        pendingSelectionRef: pendingSelection,
      };

      // When the selection ends exactly at the start of a line (right after \n),
      // exclude that line so only lines that have selected text are affected.
      const effectiveSe =
        hasSelection && se > 0 && text[se - 1] === "\n" ? se - 1 : se;

      // ── Indent ────────────────────────────────────────────────────────────
      if (isIndent) {
        if (!hasSelection) {
          emit(ctx, ss, ss, INDENT, ss + INDENT.length, ss + INDENT.length);
        } else {
          const bStart = lineStart(text, ss);
          const bEnd = lineEnd(text, effectiveSe);
          const lines = text.slice(bStart, bEnd).split("\n");
          const newBlock = lines.map((l) => INDENT + l).join("\n");
          emit(
            ctx,
            bStart,
            bEnd,
            newBlock,
            ss + INDENT.length,
            se + INDENT.length * lines.length,
          );
        }
        return;
      }

      // ── Un-indent ─────────────────────────────────────────────────────────
      if (isUnindent) {
        if (!hasSelection) {
          const bStart = lineStart(text, ss);
          const bEnd = lineEnd(text, ss);
          const line = text.slice(bStart, bEnd);
          const m = line.match(/^ {1,4}/);
          const spaces = m ? m[0].length : 0;
          if (spaces === 0) return;
          emit(
            ctx,
            bStart,
            bEnd,
            line.slice(spaces),
            Math.max(bStart, ss - spaces),
            Math.max(bStart, ss - spaces),
          );
        } else {
          const bStart = lineStart(text, ss);
          const bEnd = lineEnd(text, effectiveSe);
          const lines = text.slice(bStart, bEnd).split("\n");
          const removed = lines.map((l) => l.match(/^ {1,4}/)?.[0].length ?? 0);
          const newBlock = lines.map((l, i) => l.slice(removed[i])).join("\n");
          const totalRemoved = removed.reduce((a, b) => a + b, 0);
          emit(
            ctx,
            bStart,
            bEnd,
            newBlock,
            Math.max(bStart, ss - removed[0]),
            se - totalRemoved,
          );
        }
        return;
      }

      // ── Backtick wrap ─────────────────────────────────────────────────────
      if (isBacktick) {
        const selected = text.slice(ss, se);
        if (selected.includes("\n")) {
          const wrapped = "```\n" + selected + "\n```";
          emit(ctx, ss, se, wrapped, ss + 4, ss + 4 + selected.length);
        } else {
          const wrapped = "`" + selected + "`";
          emit(ctx, ss, se, wrapped, ss + 1, ss + 1 + selected.length);
        }
        return;
      }

      // ── Blockquote ────────────────────────────────────────────────────────
      if (isBlockquote) {
        const bStart = lineStart(text, ss);
        const bEnd = lineEnd(text, effectiveSe);
        const lines = text.slice(bStart, bEnd).split("\n");
        const newBlock = lines.map((l) => "> " + l).join("\n");
        emit(ctx, bStart, bEnd, newBlock, ss + 2, se + 2 * lines.length);
        return;
      }
    },
    [actions],
  );

  return { ref, onKeyDown: handleKeyDown, actions };
}
