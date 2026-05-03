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
import { ArrowLeft, HelpCircle, Sparkles, WandSparkles, PlusCircle, Layers } from 'lucide-react';

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
        that area.
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
            Both are entirely optional. Any note, deck, or todo list can have:
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li>An area only</li>
            <li>A subject only (the subject&apos;s area is implied)</li>
            <li>Both an area and a subject</li>
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
            When creating or editing a note, deck, or todo list, an area/subject selector appears
            in the toolbar or settings panel. Click it to pick from your existing areas and
            subjects, or leave it blank to keep the item uncategorised.
          </p>
          <p>
            You can change or remove the area/subject at any time by editing the item and
            updating the selector.
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

        <Tabs defaultValue="notes">
          <TabsList>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="flashcards">Flashcards</TabsTrigger>
            <TabsTrigger value="todos">Todos</TabsTrigger>
            <TabsTrigger value="areas">Areas</TabsTrigger>
            <TabsTrigger value="sharing">Sharing</TabsTrigger>
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
        </Tabs>
      </main>
    </>
  );
}
