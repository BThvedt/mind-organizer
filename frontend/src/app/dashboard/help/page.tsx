'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useMarkSignedOut } from '@/hooks/useAuth';
import Link from 'next/link';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, HelpCircle, Sparkles, WandSparkles, PlusCircle, Layers, ImagePlus, Paperclip, Pencil, Trash2 } from 'lucide-react';

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

---

[Link text](https://example.com)

| Column A | Column B |
|----------|----------|
| Value 1  | Value 2  |

---

\`\`\`typescript
// Syntax-highlighted code block
const greet = (name: string): string => \`Hello, \${name}!\`;
console.log(greet("world"));
\`\`\`

\`\`\`mermaid
flowchart LR
    A[Write Markdown] --> B[Live Preview]
    B --> C[Share with anyone]
\`\`\`
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
            <MarkdownRenderer>{source}</MarkdownRenderer>
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
  { syntax: '```ts\\ncode\\n```', description: 'Fenced code block with syntax highlighting (add a language tag)' },
  { syntax: '```mermaid\\n...\\n```', description: 'Mermaid diagram — flowcharts, sequences, and more' },
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

      <CollapsibleSection title="Syntax Highlighting" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            Any fenced code block tagged with a language name is automatically
            syntax-highlighted in the preview using{' '}
            <strong className="text-foreground">VSCode-quality colours</strong> that
            switch between light and dark themes automatically.
          </p>
          <p>
            Write a fenced block and add the language immediately after the opening
            three backticks — no space:
          </p>
          <pre className="rounded-md border border-border bg-muted/40 px-4 py-3 font-mono text-xs leading-relaxed overflow-x-auto">
            {['```typescript', 'const greet = (name: string) => `Hello, ${name}!`;', '```'].join('\n')}
          </pre>
          <p>
            Supported languages include <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">typescript</code>,{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">javascript</code>,{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">python</code>,{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">php</code>,{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">bash</code>,{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">sql</code>,{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">json</code>,{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">css</code>,{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">html</code>,{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">rust</code>,{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">go</code>,{' '}
            and many more. If a language tag is unrecognised it falls back to plain
            text. Fences with no tag at all are shown unformatted, as before.
          </p>
          <p>
            A <strong className="text-foreground">copy button</strong> appears on hover
            in the top-right corner of every code block — click it to copy the raw
            source to the clipboard.
          </p>
          <p>
            Try it in the playground above by pasting a code fence with a language tag.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Diagrams with Mermaid" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            <strong className="text-foreground">Mermaid</strong> is a text-based
            diagramming language. Write a fenced code block tagged{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">mermaid</code>{' '}
            and it is rendered as a diagram in the preview — flowcharts, sequence
            diagrams, entity-relationship diagrams, and more.
          </p>
          <p>
            Example — a simple flowchart:
          </p>
          <pre className="rounded-md border border-border bg-muted/40 px-4 py-3 font-mono text-xs leading-relaxed overflow-x-auto">
            {[
              '```mermaid',
              'flowchart TD',
              '    A[Start] --> B{Decision}',
              '    B -- Yes --> C[Do the thing]',
              '    B -- No  --> D[Skip it]',
              '    C --> E[End]',
              '    D --> E',
              '```',
            ].join('\n')}
          </pre>
          <p>
            Other useful diagram types:
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li>
              <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">sequenceDiagram</code>
              {' '}— show message exchanges between actors
            </li>
            <li>
              <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">erDiagram</code>
              {' '}— entity-relationship diagrams for data modelling
            </li>
            <li>
              <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">gantt</code>
              {' '}— project timelines and task scheduling
            </li>
            <li>
              <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">mindmap</code>
              {' '}— hierarchical mind maps
            </li>
          </ul>
          <p>
            The diagram automatically uses the correct colours for light and dark mode.
            If the Mermaid syntax has an error, a red error card is shown with the
            parser message and your source so you can fix it. The{' '}
            <a
              href="https://mermaid.live"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-2"
            >
              Mermaid Live Editor
            </a>{' '}
            is a handy sandbox for experimenting with syntax before pasting into a note.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Images & Audio" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            You can embed images and audio clips directly in a note by{' '}
            <strong className="text-foreground">dragging and dropping</strong> files onto
            the editor, or by <strong className="text-foreground">pasting</strong> them
            from the clipboard. Supported formats:
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li>
              <strong className="text-foreground">Images</strong> — JPEG, PNG, WebP, GIF,
              AVIF, SVG
            </li>
            <li>
              <strong className="text-foreground">Audio</strong> — MP3, OGG, WAV, M4A, AAC
            </li>
          </ul>
          <p>
            When you drop or paste a file, a{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
              ![Uploading…](pending-…)
            </code>{' '}
            placeholder appears at the cursor while the upload is in progress. Once the
            upload finishes the placeholder is automatically replaced with the correct
            Markdown — an{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
              ![alt text](url)
            </code>{' '}
            for images, which renders as an inline picture in the preview, or the same
            syntax for audio, which renders as an embedded audio player.
          </p>
          <p>
            <strong className="text-foreground">Image compression</strong> is applied
            automatically before upload: images are scaled down to a maximum of 720 px
            wide and 1 200 px tall if they exceed those dimensions, and re-encoded as
            JPEG or WebP. The original file is never modified — only the uploaded copy
            is compressed. Audio files are uploaded as-is.
          </p>
          <p>
            Files are stored privately. A media file is only accessible to{' '}
            <strong className="text-foreground">you</strong> while you are signed in, or
            to anyone you have shared the note with via a share link (the share token is
            automatically included when the note is publicly shared, so embedded media
            loads correctly for readers too).
          </p>
          <p>
            If a previously uploaded file is deleted and a note still references it, the
            preview shows a small{' '}
            <strong className="text-foreground">Media deleted</strong> badge in place of
            the broken image. A warning banner also appears at the top of the editor so
            you know the note contains broken references.
          </p>
          <p>
            Multiple files can be dropped at once — each gets its own placeholder and
            uploads one at a time in the order they were dropped.
          </p>
        </div>
      </CollapsibleSection>
    </div>
  );
}

function AITab() {
  return (
    <div className="flex flex-col gap-6 pt-6">
      <p className="text-sm text-muted-foreground leading-relaxed">
        AI features in Mind Organizer are powered by Claude and require an internet
        connection. They are accessed via the{' '}
        <strong className="text-foreground">AI</strong> button that appears in the toolbar
        of any note or deck. All AI actions show a preview before making any changes — nothing
        is applied until you confirm.
      </p>

      <CollapsibleSection title="Generating cards for a deck" defaultOpen={false}>
        <div className="flex flex-col gap-4 text-sm text-muted-foreground leading-relaxed">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
            <Sparkles className="h-5 w-5 mt-0.5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground mb-0.5">Generate cards with AI</p>
              <p className="text-xs text-muted-foreground">Available on any deck via the AI button in the deck toolbar.</p>
            </div>
          </div>
          <p>
            Open a deck and click the <strong className="text-foreground">AI</strong> button in
            the toolbar. You&apos;ll be asked to describe the topic or paste some source text —
            this is the material the AI uses to write the cards. For example:{' '}
            <em>&ldquo;The water cycle, including evaporation, condensation, and precipitation&rdquo;</em>.
          </p>
          <p>
            Set the <strong className="text-foreground">number of cards</strong> you want (1–15),
            or toggle <strong className="text-foreground">Auto</strong> to let the AI decide
            (it will generate up to 10). Then click Generate.
          </p>
          <p>
            A review screen shows each generated card with editable{' '}
            <strong className="text-foreground">Front</strong> and{' '}
            <strong className="text-foreground">Back</strong> fields. You can edit the text directly
            or click <strong className="text-foreground">Selected / Skipped</strong> to toggle
            individual cards in or out. Only selected cards are saved when you click Save.
          </p>
          <p>
            The new cards are added to the existing deck — they don&apos;t replace what&apos;s
            already there. You can run the generator multiple times to build up a deck over several sessions.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Format note with AI" defaultOpen={false}>
        <div className="flex flex-col gap-4 text-sm text-muted-foreground leading-relaxed">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
            <WandSparkles className="h-5 w-5 mt-0.5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground mb-0.5">Format with AI</p>
              <p className="text-xs text-muted-foreground">Available on any note via the AI button in the note toolbar.</p>
            </div>
          </div>
          <p>
            Open a note, click <strong className="text-foreground">AI</strong>, then choose{' '}
            <strong className="text-foreground">Format with AI</strong>. The AI rewrites the
            note&apos;s Markdown to improve its structure — cleaning up headings, lists, and
            spacing — without changing the actual content or meaning.
          </p>
          <p>
            A preview of the reformatted Markdown is shown before anything is applied. If you&apos;re
            happy with the result, click <strong className="text-foreground">Apply</strong> to
            replace the note body. If not, click Back to return to the menu without making any changes.
          </p>
          <p>
            This is useful for notes that were jotted down quickly and need tidying up before sharing
            or reviewing.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Add content to a note with AI" defaultOpen={false}>
        <div className="flex flex-col gap-4 text-sm text-muted-foreground leading-relaxed">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
            <PlusCircle className="h-5 w-5 mt-0.5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground mb-0.5">Add content with AI</p>
              <p className="text-xs text-muted-foreground">Available on any note via the AI button in the note toolbar.</p>
            </div>
          </div>
          <p>
            Open a note, click <strong className="text-foreground">AI</strong>, then choose{' '}
            <strong className="text-foreground">Add content with AI</strong>. You&apos;ll be
            prompted to describe what you&apos;d like added — examples, facts, explanations, a new
            section, and so on. The AI reads your existing note for context and appends the new
            material.
          </p>
          <p>
            Examples of useful prompts:
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li><em>&ldquo;Add three worked examples for each concept&rdquo;</em></li>
            <li><em>&ldquo;Add a section on common misconceptions&rdquo;</em></li>
            <li><em>&ldquo;Expand the introduction with more background&rdquo;</em></li>
          </ul>
          <p>
            A preview of the full updated note is shown before anything is saved. Click{' '}
            <strong className="text-foreground">Apply</strong> to replace the note body, or Back
            to return to the prompt and try a different instruction.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Generate a deck from a note" defaultOpen={false}>
        <div className="flex flex-col gap-4 text-sm text-muted-foreground leading-relaxed">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
            <Layers className="h-5 w-5 mt-0.5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground mb-0.5">Generate deck from note</p>
              <p className="text-xs text-muted-foreground">Available on any note via the AI button in the note toolbar.</p>
            </div>
          </div>
          <p>
            Open a note, click <strong className="text-foreground">AI</strong>, then choose{' '}
            <strong className="text-foreground">Generate deck from note</strong>. The AI reads the
            full note body and produces flashcard candidates based on the key concepts it finds.
          </p>
          <p>
            Set how many cards to generate (1–15) or use{' '}
            <strong className="text-foreground">Auto</strong> (up to 10). A review screen then
            shows each candidate with editable Front and Back fields. Toggle cards in or out, edit
            any text, then give the new deck a title before saving.
          </p>
          <p>
            The <strong className="text-foreground">Link this deck to the note</strong> checkbox
            (on by default) automatically adds the new deck to the note&apos;s linked decks when
            saved, so the connection is immediately visible in the note reader.
          </p>
          <p>
            The note itself is not modified by this action — only a new deck is created.
          </p>
        </div>
      </CollapsibleSection>
    </div>
  );
}

function AreasTab() {
  return (
    <div className="flex flex-col gap-6 pt-6">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Areas and subjects are optional labels you can attach to your notes, decks, and todo
        lists to keep them organised. They work as a two-level hierarchy: an{' '}
        <strong className="text-foreground">area</strong> is the broad topic, and a{' '}
        <strong className="text-foreground">subject</strong> is a more specific category within
        that area. Any item can be tagged with{' '}
        <strong className="text-foreground">as many areas and subjects as you like</strong>,
        which is handy for content that spans multiple disciplines.
      </p>

      <CollapsibleSection title="Areas and subjects explained" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            Think of an <strong className="text-foreground">area</strong> as a course or broad
            discipline — for example <em>Biology</em>, <em>History</em>, or{' '}
            <em>Web Development</em>. A <strong className="text-foreground">subject</strong>{' '}
            belongs to an area and narrows the focus further — for example, a Biology area might
            have subjects like <em>Cell Biology</em>, <em>Genetics</em>, and <em>Ecology</em>.
          </p>
          <p>
            Both are entirely optional, and both are{' '}
            <strong className="text-foreground">multi-value</strong> — a single note, deck, or
            todo list can carry any combination of areas and subjects, including:
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li>One or more areas only</li>
            <li>One or more subjects only (each subject&apos;s parent area is implied)</li>
            <li>
              A mix of areas and subjects — for example, an item tagged with{' '}
              <em>Biology · Cell Biology · Genetics</em> and{' '}
              <em>Chemistry · Organic Chemistry</em>
            </li>
            <li>Neither — content without any category label is perfectly fine</li>
          </ul>
          <p>
            Areas and subjects are <strong className="text-foreground">personal</strong> — only
            you can see your own, and they are separate from other users&apos; taxonomies.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Assigning areas and subjects to content" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            When creating or editing a note, deck, or todo list, two dropdown selectors appear
            in the toolbar or settings panel:{' '}
            <strong className="text-foreground">Area</strong> and{' '}
            <strong className="text-foreground">Subject</strong>. Pick an area first; the
            Subject dropdown then lists only the subjects that belong to it.
          </p>
          <p>
            Each selection appears as a removable{' '}
            <strong className="text-foreground">chip</strong> beneath the dropdowns. Area chips
            are filled and bold; subject chips sit beside their parent area on the same row, in
            a lighter outlined style — so a glance tells you which area each subject is grouped
            under.
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            <li>
              Pick another area to add a second area chip (with its own row of subjects).
              Picking the same area again is a no-op.
            </li>
            <li>
              Picking a subject{' '}
              <strong className="text-foreground">automatically adds its parent area</strong>{' '}
              if you haven&apos;t already selected it.
            </li>
            <li>
              Click the <strong className="text-foreground">×</strong> on a subject chip to
              remove just that subject. Click the × on an area chip to remove the area{' '}
              <em>and</em> every subject grouped under it.
            </li>
            <li>
              Need a category that doesn&apos;t exist yet? Type a new name into either dropdown
              and confirm the &ldquo;Create…&rdquo; suggestion to add it on the spot. New
              subjects are created under whichever area is currently active in the Area
              dropdown.
            </li>
          </ul>
          <p>
            You can revisit the selector at any time. Changes save with the rest of the item.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Filtering by area and subject" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            The Notes, Decks, and Todos pages each have an Area / Subject{' '}
            <strong className="text-foreground">filter</strong> at the top of the list. The
            filters are single-select — pick one area (and optionally one subject within it) to
            narrow the list.
          </p>
          <p>
            Because items can have multiple areas and subjects, an item shows up in a filtered
            view as long as the chosen filter is{' '}
            <strong className="text-foreground">one of</strong> its tags. For example, an item
            tagged with both <em>Biology</em> and <em>Chemistry</em> appears in the Biology
            filter and in the Chemistry filter.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="The Areas page" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            The <strong className="text-foreground">Areas</strong> page (accessible from the user
            menu in the top-right) is where you create, rename, and delete areas and subjects.
            Each area is shown as a card, with its subjects listed as small chips below the title.
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            <li>
              Click the <strong className="text-foreground">+</strong> button at the top of the
              page to add a new area.
            </li>
            <li>
              Click the <strong className="text-foreground">pencil icon</strong> on an area card
              to rename it inline.
            </li>
            <li>
              Click the <strong className="text-foreground">trash icon</strong> to delete an area.
              This also permanently deletes all subjects that belong to it — a confirmation is
              shown before anything is removed.
            </li>
          </ul>
          <p>
            Clicking an area&apos;s name opens its detail page, which lists all the subjects in
            that area and all the notes and decks tagged with it. You can filter by subject or
            content type (Decks / Notes), and add or delete subjects directly from this page too.
          </p>
          <p>
            The <strong className="text-foreground">Uncategorized Content</strong> card at the
            bottom of the Areas page links to a view of all your items that have no area or
            subject assigned.
          </p>
        </div>
      </CollapsibleSection>
    </div>
  );
}

function SharingTab() {
  return (
    <div className="flex flex-col gap-6 pt-6">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Sharing lets you generate a public link for any note, deck, or todo list so anyone —
        even without an account — can view or interact with it. Sharing is opt-in and
        controlled per item.
      </p>

      <CollapsibleSection title="Enabling and disabling sharing" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            Open any note, deck, or todo list and look for the{' '}
            <strong className="text-foreground">Share</strong> button in the toolbar. Clicking it
            toggles sharing on or off for that item.
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            <li>
              When sharing is <strong className="text-foreground">enabled</strong>, a unique public
              link is generated. Copy it from the Share button popover, or open it directly.
            </li>
            <li>
              When sharing is <strong className="text-foreground">disabled</strong>, the link is
              immediately invalidated. Anyone visiting the old URL will see a "not found" page.
              Re-enabling sharing generates a brand-new link.
            </li>
            <li>
              Sharing does not affect who can edit the content — only you can make changes,
              regardless of who has the link.
            </li>
          </ul>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="What the shared view looks like" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            Each content type has a tailored public view:
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-2">
            <li>
              <strong className="text-foreground">Notes</strong> — Rendered as formatted Markdown.
              The reader sees the title, any area/subject labels, and the full note body.
              The view is read-only.
            </li>
            <li>
              <strong className="text-foreground">Decks</strong> — An interactive study session.
              The reader can flip through every card in the deck exactly as you would in your own
              dashboard.
            </li>
            <li>
              <strong className="text-foreground">Todo lists</strong> — The full list with all
              items. Readers can check items off, but those changes are temporary (they do not
              affect your own list).
            </li>
          </ul>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Linked content in shared views" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            Notes and todo lists can have other items linked to them (decks, notes, other lists).
            When a linked item is{' '}
            <strong className="text-foreground">also shared</strong>, it appears as a clickable
            chip at the bottom of the shared view, letting the reader jump to that item&apos;s own
            public link.
          </p>
          <p>
            If a linked item is <strong className="text-foreground">not shared</strong>, it is
            simply omitted from the public view — its title and content are never exposed.
          </p>
          <p>
            You don&apos;t need to share everything in a chain. Share only the items you want to
            be publicly reachable.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="The Shared page" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            The <strong className="text-foreground">Shared</strong> page (accessible from the user
            menu in the top-right) gives you a single place to see everything you&apos;ve currently
            shared, organised into three sections: Notes, Decks, and Todo Lists.
          </p>
          <p>
            Each item appears as a chip. Clicking the{' '}
            <strong className="text-foreground">title</strong> part of the chip opens the item in
            your dashboard so you can edit it. Clicking the small{' '}
            <strong className="text-foreground">arrow icon</strong> on the right opens the live
            public link in a new tab — useful for checking what your recipients actually see, or
            for copying the URL to share again.
          </p>
          <p>
            Items only appear here while sharing is active. Disabling sharing on an item removes
            it from this list immediately.
          </p>
        </div>
      </CollapsibleSection>
    </div>
  );
}

function MediaTab() {
  return (
    <div className="flex flex-col gap-6 pt-6">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Mind Organizer separates uploaded assets into two classes:{' '}
        <strong className="text-foreground">media</strong> (images and audio)
        renders inline inside the preview, while{' '}
        <strong className="text-foreground">files</strong> (PDFs, spreadsheets,
        documents, archives) renders as a tidy link box that opens in a new
        tab. Both are uploaded the same way, stored privately, and listed on
        their own management page.
      </p>

      <CollapsibleSection title="Adding media and files to your editor" defaultOpen={false}>
        <div className="flex flex-col gap-4 text-sm text-muted-foreground leading-relaxed">
          <p>
            Inside any note editor you have three ways to attach an asset:
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-2">
            <li>
              <strong className="text-foreground">Drag and drop</strong> a file
              from your computer onto the editor pane. A{' '}
              <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                ![Uploading…](pending-…)
              </code>{' '}
              placeholder appears at the cursor while the upload runs and is
              automatically replaced once it finishes.
            </li>
            <li>
              <strong className="text-foreground">Paste</strong> an image
              copied to the clipboard (e.g. from a screenshot tool) directly
              into the editor.
            </li>
            <li>
              Use the{' '}
              <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
                <Paperclip className="h-3 w-3" />
                Attach
              </span>{' '}
              toolbar button to upload a fresh file via the system picker, or
              the{' '}
              <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
                <ImagePlus className="h-3 w-3" />
                Insert
              </span>{' '}
              button to search your already-uploaded library and insert an
              existing asset at the cursor.
            </li>
          </ul>
          <p>
            Image embeds use{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
              ![alt](url)
            </code>{' '}
            (rendered inline). Audio uses the same syntax but renders as an
            embedded player. Files use the plain link form{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
              [name](url)
            </code>
            , which the renderer upgrades to a styled file box with an icon,
            filename, and an &ldquo;Open in new tab&rdquo; affordance.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Supported types and size limits" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            Mind Organizer accepts a curated whitelist of formats. Anything not
            on the list is rejected with an &ldquo;unsupported file
            type&rdquo; error to keep your library predictable.
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            <li>
              <strong className="text-foreground">Images</strong> (max 20 MB)
              — JPEG, PNG, WebP, GIF. Large images are auto-scaled to a
              maximum of 720&nbsp;×&nbsp;1200 px and re-encoded before upload;
              the original on disk is never touched.
            </li>
            <li>
              <strong className="text-foreground">Audio</strong> (max 20 MB)
              — MP3, OGG, WAV, M4A, AAC. Audio is uploaded byte-for-byte with
              no re-encoding.
            </li>
            <li>
              <strong className="text-foreground">Files</strong> (max 50 MB)
              — PDF, plain text, Markdown, CSV, Word (doc/docx), Excel
              (xls/xlsx), PowerPoint (ppt/pptx), OpenDocument (odt/ods/odp),
              JSON, XML, ZIP.
            </li>
          </ul>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="The Media page" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            The <strong className="text-foreground">Media</strong> page
            (accessible from the user menu in the top-right) shows every
            image and audio file in your library as a grid of thumbnails.
            Above the grid is a stats bar with the total file count and
            the storage used.
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            <li>
              <strong className="text-foreground">Image cards</strong> show
              the thumbnail; <strong className="text-foreground">audio
              cards</strong> show a speaker icon.
            </li>
            <li>
              Hovering a card reveals two action buttons: a{' '}
              <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
                <Pencil className="h-3 w-3" />
                pencil
              </span>{' '}
              for editing metadata and a{' '}
              <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
                <Trash2 className="h-3 w-3" />
                trash
              </span>{' '}
              for deleting.
            </li>
          </ul>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="The Files page" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            The <strong className="text-foreground">Files</strong> page (also
            in the user menu) is the same management UI but rendered as a
            list rather than a grid, since file types don&apos;t have visual
            thumbnails. Each row shows a format-specific icon, the filename,
            and the size, with edit / delete / open-in-new-tab actions on
            hover.
          </p>
          <p>
            The icon shape follows the file extension — spreadsheets, slide
            decks, archives, code files, and generic documents each get their
            own variant so you can scan for a particular file at a glance.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Editing metadata" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            Click the <strong className="text-foreground">pencil</strong> on
            any media or file card to open the edit dialog. You can:
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            <li>
              <strong className="text-foreground">Rename</strong> the
              displayed filename. The underlying URL stays stable (it&apos;s
              keyed by UUID), so renaming never breaks references in your
              notes, decks, or todos.
            </li>
            <li>
              Add a short{' '}
              <strong className="text-foreground">description</strong> (up to
              2,000 characters). Descriptions are searchable from the Insert
              dialog so you can find an asset by what it&apos;s about, not
              just its filename.
            </li>
            <li>
              For images only, click the{' '}
              <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
                <Sparkles className="h-3 w-3" />
                AI
              </span>{' '}
              button next to the description label to have Claude write a
              one or two sentence description of the image automatically.
            </li>
          </ul>
          <p>
            The dialog also lists every note, deck, flashcard, and todo list
            that currently references this asset, with a clickable arrow to
            jump to each one in a new tab.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Deleting media and files" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            Clicking the trash icon opens a confirmation dialog that lists
            every piece of content currently using the asset, so you know
            exactly what will be affected. The two asset classes behave
            differently after deletion:
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-2">
            <li>
              <strong className="text-foreground">Media (images / audio)</strong>{' '}
              — The asset is soft-deleted, and any note, deck, flashcard, or
              todo list that referenced it shows a small{' '}
              <strong className="text-foreground">Media deleted</strong>{' '}
              badge in place of the broken embed. A broken-file icon also
              appears next to the affected item&apos;s title in list views.
              Editing the markdown reference out of the body removes the
              flag on the next save.
            </li>
            <li>
              <strong className="text-foreground">Files</strong> — The link
              is automatically stripped from every body that references it,
              so there&apos;s no broken-link UI to clean up. The next save
              of any affected entity also clears the title indicator.
            </li>
          </ul>
          <p>
            When you delete a <strong className="text-foreground">parent
            entity</strong> (a note, deck, or todo list) that exclusively
            owns some media files, the confirmation dialog offers a{' '}
            <strong className="text-foreground">Also delete N media file(s)
            only used here</strong> checkbox so you can clean up the
            orphans in one step.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Title indicators" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            List views (Notes, Decks, Todos, the per-card flashcard list)
            show small icons next to titles to summarise an item&apos;s
            attachment state at a glance:
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            <li>
              A{' '}
              <span className="inline-flex h-4 w-4 items-center justify-center text-foreground/80">
                <Paperclip className="h-3.5 w-3.5" />
              </span>{' '}
              <strong className="text-foreground">paperclip</strong> means
              the item references at least one file-class attachment.
            </li>
            <li>
              A red{' '}
              <strong className="text-foreground">broken-file</strong> icon
              means the item references a media asset that has been
              soft-deleted. Hover for the count of missing files.
            </li>
            <li>
              A green{' '}
              <strong className="text-foreground">share</strong> icon means
              the item is publicly shared.
            </li>
          </ul>
          <p>
            Indicators are recomputed automatically every time you save the
            entity, so they stay in sync with the body content with no
            manual maintenance.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="The Insert picker" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            The{' '}
            <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
              <ImagePlus className="h-3 w-3" />
              Insert
            </span>{' '}
            toolbar button on the note editor opens a search picker for
            assets you&apos;ve already uploaded. Type at least two
            characters and matches appear after a short debounce.
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            <li>
              The <strong className="text-foreground">Images</strong>,{' '}
              <strong className="text-foreground">Audio</strong>, and{' '}
              <strong className="text-foreground">Files</strong> pills at
              the top filter the search by asset class.
            </li>
            <li>
              Search matches against the filename and the description, so
              an image with description &ldquo;water cycle diagram&rdquo;
              will be found by &ldquo;cycle&rdquo; or &ldquo;diagram&rdquo;
              even if the filename is just{' '}
              <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                IMG_4521.jpg
              </code>
              .
            </li>
            <li>
              Press <Kbd>Esc</Kbd> or click outside the panel to dismiss it
              without inserting anything.
            </li>
          </ul>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="The Attach menu" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            The{' '}
            <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
              <Paperclip className="h-3 w-3" />
              Attach
            </span>{' '}
            toolbar button does two things: it lets you{' '}
            <strong className="text-foreground">upload a new file</strong>{' '}
            via the system file picker, and it acts as a{' '}
            <strong className="text-foreground">viewer</strong> for files
            currently attached to whatever you&apos;re looking at.
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            <li>
              On a <strong className="text-foreground">note</strong>, the
              menu shows files referenced from that note&apos;s body and
              the upload action inserts a link at the cursor.
            </li>
            <li>
              On a <strong className="text-foreground">deck</strong>, the
              menu lists files referenced from the deck description or any
              flashcard front/back. It&apos;s viewer-only here — to add a
              new file, drop or paste it directly into a card editor.
            </li>
            <li>
              On a <strong className="text-foreground">todo list</strong>,
              the menu lists files referenced anywhere in any item&apos;s
              text or notes. Also viewer-only.
            </li>
          </ul>
          <p>
            On notes, a small trash icon appears beside each attachment row
            on hover. Clicking it strips that file&apos;s markdown link
            from the body — handy for tidying up without scrolling through
            the source to find it.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Sharing assets" defaultOpen={false}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            Media and files are private by default — only you can access
            them. When you{' '}
            <strong className="text-foreground">share</strong> a note,
            deck, or todo list, any assets embedded in it become accessible
            to people who have that share link, but only via that link.
            Removing the share invalidates access immediately.
          </p>
          <p>
            The renderer automatically appends the active share token to
            every{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
              /api/media/&lt;uuid&gt;
            </code>{' '}
            URL on the public share view, so embedded images, audio, and
            file links all load correctly for your readers without you
            needing to share the assets individually.
          </p>
        </div>
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
        <div className="mb-8 flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href="/dashboard" />}
            className="mt-1"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to dashboard</span>
          </Button>
          <div className="flex-1">
            <div className="flex items-start gap-2">
              <HelpCircle className="mt-1 h-7 w-7 text-primary shrink-0" />
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Help</h1>
                <p className="mt-1 text-muted-foreground">
                  Reference documentation for Mind Organizer features.
                </p>
              </div>
            </div>
          </div>
        </div>

        <Tabs defaultValue="notes">
          <TabsList>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="flashcards">Flashcards</TabsTrigger>
            <TabsTrigger value="todos">Todos</TabsTrigger>
            <TabsTrigger value="areas">Areas</TabsTrigger>
            <TabsTrigger value="sharing">Sharing</TabsTrigger>
            <TabsTrigger value="media">Media &amp; Files</TabsTrigger>
            <TabsTrigger value="ai">AI</TabsTrigger>
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

          <TabsContent value="areas">
            <AreasTab />
          </TabsContent>

          <TabsContent value="ai">
            <AITab />
          </TabsContent>

          <TabsContent value="sharing">
            <SharingTab />
          </TabsContent>

          <TabsContent value="media">
            <MediaTab />
          </TabsContent>
        </Tabs>
      </main>
    </>
  );
}
