/**
 * Undo-friendly text mutations for a controlled <textarea>.
 *
 * Every mutation goes through `emit`, which prefers `document.execCommand
 * ("insertText", ...)` so the browser records the change as a single
 * undoable edit in its native stack. Where execCommand isn't supported
 * (or fails) we fall back to calling the controlled-state setter.
 *
 * Selection-after-edit is queued on a shared ref. The owning hook
 * (`useMarkdownEditor`) restores it in a `useEffect` after React
 * re-renders the controlled textarea — this avoids races where setting
 * the selection before the new value has been painted lands the caret
 * in the old text.
 */

import type { RefObject } from "react";

export interface PendingSelection {
  start: number;
  end: number;
}

export interface EditContext {
  textarea: HTMLTextAreaElement;
  /** Called only when execCommand is unavailable / refused. */
  fallbackSetValue: (next: string) => void;
  /** Queue for the next selectionRange restore (drained in a useEffect). */
  pendingSelectionRef: RefObject<PendingSelection | null>;
}

export function lineStart(text: string, pos: number): number {
  const idx = text.lastIndexOf("\n", pos - 1);
  return idx === -1 ? 0 : idx + 1;
}

export function lineEnd(text: string, pos: number): number {
  const idx = text.indexOf("\n", pos);
  return idx === -1 ? text.length : idx;
}

/**
 * Replace `[replaceStart, replaceEnd)` of the textarea's current value
 * with `replacement`, and queue the caret/selection that should be
 * applied after React's next render.
 */
export function emit(
  ctx: EditContext,
  replaceStart: number,
  replaceEnd: number,
  replacement: string,
  newSelStart: number,
  newSelEnd: number,
): void {
  const { textarea, fallbackSetValue, pendingSelectionRef } = ctx;
  const text = textarea.value;
  textarea.setSelectionRange(replaceStart, replaceEnd);
  const ok = document.execCommand("insertText", false, replacement);
  if (!ok) {
    fallbackSetValue(
      text.slice(0, replaceStart) + replacement + text.slice(replaceEnd),
    );
  }
  pendingSelectionRef.current = { start: newSelStart, end: newSelEnd };
}

/**
 * Wrap the current selection with `before` / `after` markers. With no
 * selection, inserts the markers and lands the caret between them.
 *
 * Intentionally not a toggle — detecting "is this already wrapped" is
 * fiddly (think `**hello _world_**`) and surprising when it fails.
 * Stick to the simple, predictable wrap.
 */
export function wrapSelection(
  ctx: EditContext,
  before: string,
  after: string = before,
): void {
  const { textarea } = ctx;
  const { selectionStart: ss, selectionEnd: se, value: text } = textarea;
  const selected = text.slice(ss, se);
  const replacement = before + selected + after;
  emit(
    ctx,
    ss,
    se,
    replacement,
    ss + before.length,
    ss + before.length + selected.length,
  );
}

interface BlockOps {
  bStart: number;
  bEnd: number;
  lines: string[];
}

function blockSelection(textarea: HTMLTextAreaElement): BlockOps {
  const { selectionStart: ss, selectionEnd: se, value: text } = textarea;
  const hasSelection = ss !== se;
  // If the selection ends right after a \n, don't drag the next line in.
  const effectiveSe =
    hasSelection && se > 0 && text[se - 1] === "\n" ? se - 1 : se;
  const bStart = lineStart(text, ss);
  const bEnd = lineEnd(text, effectiveSe);
  return { bStart, bEnd, lines: text.slice(bStart, bEnd).split("\n") };
}

/**
 * Toggle a per-line prefix (blockquote, bulleted list, task list, …).
 * If every non-empty line in the selection already starts with the
 * prefix, the prefix is removed; otherwise it's added to every
 * non-empty line.
 */
export function togglePrefix(ctx: EditContext, prefix: string): void {
  const { bStart, bEnd, lines } = blockSelection(ctx.textarea);
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  const allHavePrefix =
    nonEmpty.length > 0 && nonEmpty.every((l) => l.startsWith(prefix));
  const newLines = allHavePrefix
    ? lines.map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : l))
    : lines.map((l) => (l.trim() === "" ? l : prefix + l));
  const newBlock = newLines.join("\n");
  emit(ctx, bStart, bEnd, newBlock, bStart, bStart + newBlock.length);
}

/**
 * Apply (or remove) a heading level on the line(s) under the cursor.
 * Existing leading `#`s of any depth are stripped first, so jumping
 * H2 → H3 → H1 → off works cleanly.
 *
 * Passing the current level removes the heading entirely.
 */
export function setHeading(ctx: EditContext, level: 1 | 2 | 3): void {
  const { bStart, bEnd, lines } = blockSelection(ctx.textarea);
  const marker = "#".repeat(level) + " ";
  const allAtLevel =
    lines.length > 0 &&
    lines.every((l) => l === "" || l.startsWith(marker));
  const newLines = lines.map((line) => {
    if (line.trim() === "") return line;
    const stripped = line.replace(/^#{1,6}\s+/, "");
    return allAtLevel ? stripped : marker + stripped;
  });
  const newBlock = newLines.join("\n");
  emit(ctx, bStart, bEnd, newBlock, bStart, bStart + newBlock.length);
}

/** Numbered list — `1. `, `2. `, … Toggles off if every line already starts with a number. */
export function toggleNumberedList(ctx: EditContext): void {
  const { bStart, bEnd, lines } = blockSelection(ctx.textarea);
  const numberRe = /^\d+\.\s+/;
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  const allNumbered =
    nonEmpty.length > 0 && nonEmpty.every((l) => numberRe.test(l));
  let counter = 0;
  const newLines = lines.map((line) => {
    if (line.trim() === "") return line;
    if (allNumbered) return line.replace(numberRe, "");
    counter += 1;
    return `${counter}. ${line}`;
  });
  const newBlock = newLines.join("\n");
  emit(ctx, bStart, bEnd, newBlock, bStart, bStart + newBlock.length);
}

/**
 * Fenced code block. Mirrors the existing multi-line `\`` keybinding —
 * with no selection we insert an empty fence and land the caret on the
 * empty middle line.
 */
export function insertCodeBlock(ctx: EditContext): void {
  const { textarea } = ctx;
  const { selectionStart: ss, selectionEnd: se, value: text } = textarea;
  const selected = text.slice(ss, se);
  const before = ss > 0 && text[ss - 1] !== "\n" ? "\n" : "";
  const wrapped = `${before}\`\`\`\n${selected}\n\`\`\`\n`;
  const innerStart = ss + before.length + 4; // after "```\n"
  emit(ctx, ss, se, wrapped, innerStart, innerStart + selected.length);
}

/**
 * `[text](url)` — selection (if any) becomes the link label and the
 * caret lands inside `url` ready to paste.
 */
export function insertLink(ctx: EditContext): void {
  const { textarea } = ctx;
  const { selectionStart: ss, selectionEnd: se, value: text } = textarea;
  const selected = text.slice(ss, se);
  const label = selected.length > 0 ? selected : "text";
  const url = "url";
  const replacement = `[${label}](${url})`;
  const urlStart = ss + 1 + label.length + 2; // skip `[label](`
  emit(ctx, ss, se, replacement, urlStart, urlStart + url.length);
}

/** `---` on its own line, padded with surrounding newlines as needed. */
export function insertHorizontalRule(ctx: EditContext): void {
  const { textarea } = ctx;
  const { selectionStart: ss, selectionEnd: se, value: text } = textarea;
  const lead = ss > 0 && text[ss - 1] !== "\n" ? "\n" : "";
  const tail = ss < text.length && text[ss] !== "\n" ? "\n" : "";
  const replacement = `${lead}---\n${tail}`;
  const cursor = ss + replacement.length;
  emit(ctx, ss, se, replacement, cursor, cursor);
}
