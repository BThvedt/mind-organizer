'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DetailedHTMLProps,
  type HTMLAttributes,
  type RefObject,
} from 'react';
import type { MathfieldElement } from 'mathlive';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from './markdown-renderer';

/**
 * MathLive ships a `<math-field>` web component but no JSX/React type
 * shims. Declaring it on `React.JSX.IntrinsicElements` (react-19 layout)
 * lets us render it as a regular JSX element with a typed ref.
 */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'math-field': DetailedHTMLProps<HTMLAttributes<MathfieldElement>, MathfieldElement>;
    }
  }
}

interface MathEquationEditorProps {
  onInsert: (latex: string, display: 'inline' | 'block') => void;
  onCancel: () => void;
}

/**
 * Visual editor for a single math equation. Wraps MathLive's `<math-field>`
 * web component (loaded lazily so it stays out of the SSR bundle), lets the
 * user toggle between inline (`$…$`) and block (`$$…$$`) output, and shows
 * a live KaTeX preview of what will be inserted into the note.
 */
export function MathEquationEditor({ onInsert, onCancel }: MathEquationEditorProps) {
  const [latex, setLatex] = useState('');
  const [display, setDisplay] = useState<'inline' | 'block'>('block');
  const [ready, setReady] = useState(false);
  const mathFieldRef = useRef<MathfieldElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await import('mathlive');
      if (cancelled) return;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const el = mathFieldRef.current;
    if (!el) return;
    function handleInput() {
      setLatex(el?.value ?? '');
    }
    el.addEventListener('input', handleInput);
    const focusTimer = window.setTimeout(() => el.focus(), 50);
    return () => {
      window.clearTimeout(focusTimer);
      el.removeEventListener('input', handleInput);
    };
  }, [ready]);

  const trimmed = latex.trim();
  const previewMarkdown = trimmed
    ? display === 'block'
      ? `$$\n${trimmed}\n$$`
      : `Inline preview: $${trimmed}$`
    : '';

  const handleInsert = useCallback(() => {
    if (!trimmed) return;
    onInsert(trimmed, display);
  }, [trimmed, display, onInsert]);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Style:</span>
          <div className="flex items-center rounded-md border border-border overflow-hidden bg-background">
            {(['inline', 'block'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setDisplay(opt)}
                className={cn(
                  'px-2.5 py-1 capitalize transition-colors',
                  display === opt
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {display === 'block' ? 'Renders as a centered block' : 'Renders inline with text'}
        </span>
      </div>

      <div className="rounded-md border border-border bg-background p-2">
        {ready ? (
          <math-field
            ref={mathFieldRef as RefObject<MathfieldElement>}
            className="block w-full text-base outline-none"
            style={{ minHeight: '2.75rem' }}
          />
        ) : (
          <p className="text-xs text-muted-foreground px-2 py-3">Loading editor…</p>
        )}
      </div>

      {previewMarkdown ? (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Preview
          </p>
          <div className="text-sm">
            <MarkdownRenderer>{previewMarkdown}</MarkdownRenderer>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Use the on-screen keyboard or type LaTeX (e.g. <code className="rounded bg-muted px-1 py-0.5 font-mono">x^2 + y^2</code>) to build your equation.
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!trimmed}
          onClick={handleInsert}
        >
          Insert equation
        </Button>
      </div>
    </div>
  );
}
