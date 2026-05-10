'use client';

import { useEffect, useRef, useState } from 'react';

// Lazy/singleton loader for the mermaid bundle (~600 KB). Imported once on
// first use so notes without diagrams don't pay the cost.
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default);
  }
  return mermaidPromise;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `mermaid-${idCounter}`;
}

function detectTheme(): 'dark' | 'default' {
  if (typeof document === 'undefined') return 'default';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'default';
}

interface MermaidBlockProps {
  source: string;
}

/**
 * Renders a Mermaid diagram from raw source text. Used as the replacement
 * for ```mermaid``` fenced code blocks inside `MarkdownRenderer`.
 *
 * The Mermaid library is dynamically imported on first render so it doesn't
 * bloat the initial bundle. Each instance re-renders only when its `source`
 * prop changes.
 */
export function MermaidBlock({ source }: MermaidBlockProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Stable per-instance id; mermaid requires unique DOM ids for each render.
  const idRef = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSvg(null);

    const trimmed = source.trim();
    if (trimmed === '') {
      return;
    }

    loadMermaid()
      .then(async (mermaid) => {
        try {
          // initialize before every render so theme stays in sync if the
          // user toggled light/dark since last paint.
          mermaid.initialize({
            startOnLoad: false,
            theme: detectTheme(),
            securityLevel: 'strict',
          });
          idRef.current = nextId();
          const { svg: rendered } = await mermaid.render(idRef.current, trimmed);
          if (!cancelled) setSvg(rendered);
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) {
    return (
      <div className="my-4 rounded-md border border-destructive/40 bg-destructive/5 p-3">
        <p className="mb-2 text-sm font-medium text-destructive">
          Mermaid render error
        </p>
        <pre className="mb-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-destructive/80">
          {error}
        </pre>
        <pre className="overflow-x-auto whitespace-pre rounded bg-muted/60 p-2 text-xs text-muted-foreground">
          {source}
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-4 rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        Loading diagram…
      </div>
    );
  }

  return (
    <div
      className="my-4 overflow-x-auto rounded-md border border-border bg-muted/40 p-3 [&>svg]:mx-auto [&>svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
