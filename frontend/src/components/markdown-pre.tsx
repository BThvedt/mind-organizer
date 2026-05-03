'use client';

import { useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function MarkdownPre({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLPreElement>) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

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
