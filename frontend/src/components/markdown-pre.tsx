'use client';

import { isValidElement, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SyntaxHighlightedBlock } from './syntax-highlighted-block';

/**
 * Inspects the inner `<code>` element react-markdown produces for a fenced
 * code block. If the fence had a language tag (`\`\`\`ts`, `\`\`\`python`, …)
 * returns `{ language, code }`; otherwise returns null.
 */
function extractFencedCode(child: React.ReactNode): { language: string; code: string } | null {
  if (!isValidElement(child)) return null;
  const props = child.props as Record<string, unknown> | null | undefined;
  if (!props || typeof props !== 'object') return null;
  const className = props.className;
  if (typeof className !== 'string') return null;
  const match = className.match(/\blanguage-([\w-]+)\b/);
  if (!match) return null;
  const inner = props.children;
  let code = '';
  if (typeof inner === 'string') code = inner;
  else if (Array.isArray(inner))
    code = inner.map((c) => (typeof c === 'string' ? c : '')).join('');
  else if (inner != null) code = String(inner);
  // react-markdown adds a trailing newline before the closing fence; strip
  // it so the rendered block doesn't end with a blank line.
  return { language: match[1], code: code.replace(/\n$/, '') };
}

export function MarkdownPre({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLPreElement> & { 'data-source-line'?: number }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const child = Array.isArray(children) ? children[0] : children;
  const fenced = extractFencedCode(child);
  if (fenced) {
    return (
      <SyntaxHighlightedBlock
        source={fenced.code}
        language={fenced.language}
        data-source-line={(props as { 'data-source-line'?: number })['data-source-line']}
      />
    );
  }

  function handleCopy() {
    const text = preRef.current?.querySelector('code')?.innerText ?? '';
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="group relative">
      <pre
        ref={preRef}
        className={cn('whitespace-pre-wrap break-words', className)}
        {...props}
      >
        {children}
      </pre>
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
