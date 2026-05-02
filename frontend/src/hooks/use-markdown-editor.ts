import { useCallback, useEffect, useRef } from "react";

const INDENT = "    "; // 4 spaces = one indent level

export function useMarkdownEditor(
  _value: string,
  onChange: (value: string) => void
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Restore cursor/selection after React re-renders the controlled textarea
  useEffect(() => {
    if (pendingSelection.current && ref.current) {
      ref.current.setSelectionRange(
        pendingSelection.current.start,
        pendingSelection.current.end
      );
      pendingSelection.current = null;
    }
  });

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const textarea = e.currentTarget;
      const { selectionStart: ss, selectionEnd: se, value: text } = textarea;
      const hasSelection = ss !== se;

      const isIndent =
        (e.key === "Tab" && !e.shiftKey) ||
        (e.key === " " && e.ctrlKey && hasSelection);
      const isUnindent = e.key === "Tab" && e.shiftKey;
      const isBlockquote = e.key === ">" && hasSelection;
      const isBacktick = e.key === "`" && hasSelection;

      if (!isIndent && !isUnindent && !isBlockquote && !isBacktick) return;

      e.preventDefault();

      // Index of the first character on the line containing `pos`
      function lineStart(pos: number): number {
        const idx = text.lastIndexOf("\n", pos - 1);
        return idx === -1 ? 0 : idx + 1;
      }

      // Index of the \n terminating the line containing `pos` (or text.length)
      function lineEnd(pos: number): number {
        const idx = text.indexOf("\n", pos);
        return idx === -1 ? text.length : idx;
      }

      // When the selection ends exactly at the start of a line (right after \n),
      // exclude that line so only lines that have selected text are affected.
      const effectiveSe =
        hasSelection && se > 0 && text[se - 1] === "\n" ? se - 1 : se;

      // Replace text[replaceStart..replaceEnd] with `replacement` via execCommand
      // so the browser records it as a single undoable edit.
      const emit = (
        replaceStart: number,
        replaceEnd: number,
        replacement: string,
        newSelStart: number,
        newSelEnd: number
      ) => {
        textarea.setSelectionRange(replaceStart, replaceEnd);
        const ok = document.execCommand("insertText", false, replacement);
        if (!ok) {
          // Fallback for environments where execCommand is unavailable
          const newText =
            text.slice(0, replaceStart) + replacement + text.slice(replaceEnd);
          onChangeRef.current(newText);
        }
        pendingSelection.current = { start: newSelStart, end: newSelEnd };
      };

      // ── Indent ────────────────────────────────────────────────────────────
      if (isIndent) {
        if (!hasSelection) {
          emit(ss, ss, INDENT, ss + INDENT.length, ss + INDENT.length);
        } else {
          const bStart = lineStart(ss);
          const bEnd = lineEnd(effectiveSe);
          const lines = text.slice(bStart, bEnd).split("\n");
          const newBlock = lines.map((l) => INDENT + l).join("\n");
          emit(
            bStart,
            bEnd,
            newBlock,
            ss + INDENT.length,
            se + INDENT.length * lines.length
          );
        }
        return;
      }

      // ── Un-indent ─────────────────────────────────────────────────────────
      if (isUnindent) {
        if (!hasSelection) {
          const bStart = lineStart(ss);
          const bEnd = lineEnd(ss);
          const line = text.slice(bStart, bEnd);
          const m = line.match(/^ {1,4}/);
          const spaces = m ? m[0].length : 0;
          if (spaces === 0) return;
          emit(
            bStart,
            bEnd,
            line.slice(spaces),
            Math.max(bStart, ss - spaces),
            Math.max(bStart, ss - spaces)
          );
        } else {
          const bStart = lineStart(ss);
          const bEnd = lineEnd(effectiveSe);
          const lines = text.slice(bStart, bEnd).split("\n");
          const removed = lines.map((l) => l.match(/^ {1,4}/)?.[0].length ?? 0);
          const newBlock = lines.map((l, i) => l.slice(removed[i])).join("\n");
          const totalRemoved = removed.reduce((a, b) => a + b, 0);
          emit(
            bStart,
            bEnd,
            newBlock,
            Math.max(bStart, ss - removed[0]),
            se - totalRemoved
          );
        }
        return;
      }

      // ── Backtick wrap ─────────────────────────────────────────────────────
      if (isBacktick) {
        const selected = text.slice(ss, se);
        if (selected.includes("\n")) {
          // Multi-line → fenced code block
          const wrapped = "```\n" + selected + "\n```";
          emit(ss, se, wrapped, ss + 4, ss + 4 + selected.length); // ss+4: after opening ```\n
        } else {
          // Single line → inline code
          const wrapped = "`" + selected + "`";
          emit(ss, se, wrapped, ss + 1, ss + 1 + selected.length);
        }
        return;
      }

      // ── Blockquote ────────────────────────────────────────────────────────
      if (isBlockquote) {
        const bStart = lineStart(ss);
        const bEnd = lineEnd(effectiveSe);
        const lines = text.slice(bStart, bEnd).split("\n");
        const newBlock = lines.map((l) => "> " + l).join("\n");
        emit(bStart, bEnd, newBlock, ss + 2, se + 2 * lines.length);
        return;
      }
    },
    [] // deps intentionally empty — reads textarea DOM state directly; onChange via ref
  );

  return { ref, onKeyDown: handleKeyDown };
}
