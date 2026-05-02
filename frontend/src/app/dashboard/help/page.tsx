'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, HelpCircle } from 'lucide-react';

// ── Shared sub-components ─────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-border bg-card"
    >
      <summary className="flex cursor-pointer select-none list-none items-center justify-between px-6 py-4">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {/* Chevron rotates when open */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="px-6 pb-6">{children}</div>
    </details>
  );
}

function ReferenceTable({
  rows,
}: {
  rows: { syntax: React.ReactNode; description: string }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="pb-2 pr-6 text-left font-medium text-muted-foreground">Syntax</th>
            <th className="pb-2 text-left font-medium text-muted-foreground">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ syntax, description }, i) => (
            <tr key={i} className="border-b border-border/50 last:border-0">
              <td className="py-2 pr-6 font-mono text-xs text-foreground">{syntax}</td>
              <td className="py-2 text-muted-foreground">{description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ShortcutsTable({
  rows,
}: {
  rows: { keys: React.ReactNode; action: string }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="pb-2 pr-6 text-left font-medium text-muted-foreground">Keys</th>
            <th className="pb-2 text-left font-medium text-muted-foreground">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ keys, action }, i) => (
            <tr key={i} className="border-b border-border/50 last:border-0">
              <td className="py-2 pr-6">{keys}</td>
              <td className="py-2 text-muted-foreground">{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </kbd>
  );
}

// ── Markdown playground ───────────────────────────────────────────────────────

const PLAYGROUND_DEFAULT = `# Heading 1
## Heading 2
### Heading 3

**Bold** and *italic* and ~~strikethrough~~

- Unordered list item
  - Nested item

1. Ordered list
2. Second item

> This is a blockquote.

\`inline code\` inside a sentence

    code block (4-space indent)

---

[Link text](https://example.com)

| Column A | Column B |
|----------|----------|
| Value 1  | Value 2  |
`;

function MarkdownPlayground() {
  const [source, setSource] = useState(PLAYGROUND_DEFAULT);

  return (
    <div className="flex h-[420px] overflow-hidden rounded-lg border border-border">
      {/* Editor pane */}
      <textarea
        value={source}
        onChange={(e) => setSource(e.target.value)}
        spellCheck={false}
        className="h-full w-1/2 resize-none border-0 border-r border-border bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground outline-none [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] placeholder:text-muted-foreground focus:outline-none"
        placeholder="Type Markdown here…"
      />
      {/* Preview pane */}
      <ScrollArea className="h-full w-1/2">
        {source.trim() ? (
          <div className="prose prose-sm max-w-none p-4 dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
            Preview will appear here.
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ── Tab content ───────────────────────────────────────────────────────────────

const markdownRows = [
  { syntax: '# Heading 1', description: 'Top-level heading' },
  { syntax: '## Heading 2', description: 'Second-level heading' },
  { syntax: '### Heading 3', description: 'Third-level heading' },
  { syntax: '**bold**', description: 'Bold text' },
  { syntax: '*italic*', description: 'Italic text' },
  { syntax: '~~strikethrough~~', description: 'Strikethrough text' },
  { syntax: '- item', description: 'Unordered list item (also works with *)' },
  { syntax: '1. item', description: 'Ordered list item' },
  { syntax: '[text](url)', description: 'Hyperlink' },
  { syntax: '![alt](url)', description: 'Image' },
  { syntax: '> quote', description: 'Blockquote' },
  { syntax: '`code`', description: 'Inline code' },
  { syntax: '```\\nlanguage\\n```', description: 'Fenced code block' },
  { syntax: '---', description: 'Horizontal rule' },
  {
    syntax: '| Col | Col |\\n|-----|-----|\\n| val | val |',
    description: 'Table (GFM)',
  },
];

const shortcutRows: { keys: React.ReactNode; action: string }[] = [
  {
    keys: <Kbd>Tab</Kbd>,
    action: 'Insert 4 spaces at cursor',
  },
  {
    keys: (
      <span className="flex items-center gap-1">
        <Kbd>Tab</Kbd>
        <span className="text-xs text-muted-foreground">(selection)</span>
      </span>
    ),
    action: 'Indent all selected lines by 4 spaces',
  },
  {
    keys: (
      <span className="flex items-center gap-1">
        <Kbd>Shift</Kbd>+<Kbd>Tab</Kbd>
      </span>
    ),
    action: 'Remove up to 4 leading spaces from current line',
  },
  {
    keys: (
      <span className="flex items-center gap-1">
        <Kbd>Shift</Kbd>+<Kbd>Tab</Kbd>
        <span className="text-xs text-muted-foreground">(selection)</span>
      </span>
    ),
    action: 'Un-indent all selected lines',
  },
  {
    keys: (
      <span className="flex items-center gap-1">
        <Kbd>Ctrl</Kbd>+<Kbd>Space</Kbd>
        <span className="text-xs text-muted-foreground">(selection)</span>
      </span>
    ),
    action: 'Indent selected lines (same as Tab)',
  },
  {
    keys: (
      <span className="flex items-center gap-1">
        <Kbd>`</Kbd>
        <span className="text-xs text-muted-foreground">(single-line selection)</span>
      </span>
    ),
    action: 'Wrap selection as inline code',
  },
  {
    keys: (
      <span className="flex items-center gap-1">
        <Kbd>`</Kbd>
        <span className="text-xs text-muted-foreground">(multi-line selection)</span>
      </span>
    ),
    action: 'Wrap selection in a fenced code block',
  },
  {
    keys: (
      <span className="flex items-center gap-1">
        <Kbd>&gt;</Kbd>
        <span className="text-xs text-muted-foreground">(selection)</span>
      </span>
    ),
    action: 'Add > blockquote prefix to every selected line',
  },
];

function NotesTab() {
  return (
    
    <div className="flex flex-col gap-6 pt-6">
      <p className="text-sm text-muted-foreground leading-relaxed">
        This help text is for large screen display layouts. The layout on mobile displays is slightly different. 
      </p>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Notes are found under the <strong className="text-foreground">Notes</strong> section in the
        top navigation. Once you're there, to open a note, click its title in the sidebar list. To edit it, click the{' '}
        <strong className="text-foreground">Edit</strong> button, or go directly to{' '}
        <strong className="text-foreground">New Note</strong> to create one from scratch. The editor
        is a plain-text area on the left; a live preview renders on the right. Notes are written in{' '}
        <strong className="text-foreground">Markdown</strong> — a lightweight formatting syntax where
        simple characters like <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">**bold**</code>,{' '}
        <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded"># Heading</code>, and{' '}
        <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">- list item</code> are
        automatically rendered as formatted text in the preview. See the reference tables below. 
      </p>
      <CollapsibleSection title="Markdown Quick Reference" defaultOpen={false}>
        <ReferenceTable rows={markdownRows} />
      </CollapsibleSection>
      <CollapsibleSection title="Markdown Examples and Playground" defaultOpen={false}>
        <p className="mb-4 text-sm text-muted-foreground">
          Edit the Markdown on the left and see it rendered on the right. Feel free to experiment.
        </p>
        <MarkdownPlayground />
      </CollapsibleSection>
      <CollapsibleSection title="Keyboard Shortcuts" defaultOpen={false}>
        <p className="mb-4 text-sm text-muted-foreground">
          These shortcuts work inside the note editor.
        </p>
        <ShortcutsTable rows={shortcutRows} />
      </CollapsibleSection>
    </div>
  );
}

function PlaceholderTab({ label }: { label: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center pt-6">
      <p className="text-sm text-muted-foreground italic">
        {label} — Unfinished, waiting until features are finalized.
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HelpPage() {
  const router = useRouter();
  const authenticated = useAuth();
  const markSignedOut = useMarkSignedOut();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    markSignedOut();
    router.replace('/');
  }

  if (!authenticated) return null;

  return (
    <>
      <Header
        authenticated
        onSignIn={() => {}}
        onSignUp={() => {}}
        onLogout={handleLogout}
      />

      <main className="mx-auto max-w-4xl px-6 pt-28 pb-16">
        {/* Page header */}
        <div className="mb-8 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href="/dashboard" />}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to dashboard</span>
          </Button>
          <div className="flex items-center gap-2">
            <HelpCircle className="h-7 w-7 text-primary shrink-0" />
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">Help</h1>
              <p className="mt-1 text-muted-foreground">
                Reference documentation for Mind Organizer features.
              </p>
            </div>
          </div>
        </div>

        <Tabs defaultValue="notes">
          <TabsList>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="flashcards">Flashcards</TabsTrigger>
            <TabsTrigger value="todos">Todos</TabsTrigger>
          </TabsList>

          <TabsContent value="notes">
            <NotesTab />
          </TabsContent>

          <TabsContent value="flashcards">
            <PlaceholderTab label="Flashcards" />
          </TabsContent>

          <TabsContent value="todos">
            <PlaceholderTab label="Todos" />
          </TabsContent>
        </Tabs>
      </main>
    </>
  );
}
