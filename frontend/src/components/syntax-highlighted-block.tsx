'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BundledLanguage } from 'shiki';

// Lazy/singleton loader for the shiki bundle. Imported once on first use so
// notes without code blocks (or only fenced blocks without a language)
// don't pay the cost.
let shikiPromise: Promise<typeof import('shiki')> | null = null;

function loadShiki(): Promise<typeof import('shiki')> {
  if (!shikiPromise) {
    shikiPromise = import('shiki');
  }
  return shikiPromise;
}

interface SyntaxHighlightedBlockProps {
  source: string;
  language: string;
  'data-source-line'?: number;
}

const SHIKI_THEMES = {
  light: 'github-light',
  dark: 'github-dark',
} as const;

/**
 * Renders a fenced code block with Shiki syntax highlighting. Used as the
 * replacement for `<pre><code class="language-X">` blocks inside
 * `MarkdownPre`.
 *
 * Shiki is dynamically imported on first render so it doesn't bloat the
 * initial bundle. The output uses Shiki's dual-theme mode so the same HTML
 * shows the right colors for both light and dark mode (see globals.css for
 * the matching CSS variables).
 *
 * Unknown / misspelled language fences fall back to plaintext highlighting
 * rather than throwing.
 */
export function SyntaxHighlightedBlock({ source, language, 'data-source-line': sourceLine }: SyntaxHighlightedBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    let cancelled = false;
    setHtml(null);

    loadShiki()
      .then(async ({ codeToHtml }) => {
        const tryRender = async (lang: string): Promise<string> =>
          codeToHtml(source, {
            lang: lang as BundledLanguage,
            themes: SHIKI_THEMES,
            defaultColor: false,
          });
        try {
          const out = await tryRender(language);
          if (!cancelled) setHtml(out);
        } catch {
          // Unknown / unsupported language → fall back to plaintext.
          try {
            const out = await tryRender('text');
            if (!cancelled) setHtml(out);
          } catch {
            if (!cancelled) {
              // Give up on highlighting; the unhighlighted fallback below
              // will keep showing.
              setHtml(null);
            }
          }
        }
      })
      .catch(() => {
        // Highlighter failed to load; keep the unhighlighted fallback.
        if (!cancelled) setHtml(null);
      });

    return () => {
      cancelled = true;
    };
  }, [source, language]);

  function handleCopy(): void {
    navigator.clipboard
      .writeText(sourceRef.current)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // ignore — clipboard may be unavailable in insecure contexts
      });
  }

  return (
    <div data-source-line={sourceLine} className="group relative my-4">
      {html ? (
        <div className="syntax-block" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-sm">
          <code>{source}</code>
        </pre>
      )}
      <button
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className={cn(
          'absolute top-2 right-2 flex items-center gap-1 rounded px-1.5 py-1 text-xs',
          'bg-muted/80 text-muted-foreground backdrop-blur-sm',
          'border border-border/50',
          'transition-opacity duration-150',
          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          copied && 'text-green-400',
        )}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
