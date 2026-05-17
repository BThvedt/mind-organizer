# Study Semantic

Semantic search and RAG over the user-scoped study corpus
(`study_note`, `flashcard_deck`, `flashcard`, `todo_list`).

This module owns:

- The embedding pipeline (Voyage AI -> Qdrant).
- The `/api/search/semantic` and `/api/search/related/...` endpoints used
  by the unified search dialog and the "More like this" widget.
- The `/api/ai/ask` SSE endpoint that powers the **Ask AI** page (RAG over
  the user's content, streamed via Anthropic Claude).
- The `field_include_in_rag` gating flag and its enforcement semantics.

## High-level data flow

```
  Drupal entity save / delete
            │
            ▼
  hook_entity_(insert|update|delete) in study_semantic.module
            │
            ▼
  Drupal Queue: study_semantic_embed
            │
            ▼  (drush queue:run study_semantic_embed, or cron)
  QueueWorker\EmbedEntity
            │
            ├─ TextExtractor: flatten entity to one chunk of text
            ├─ EmbeddingClient: call Voyage AI voyage-3-lite
            ├─ QdrantClient::upsertPoint: store vector + payload
            └─ content_embeddings table: bookkeeping (model_version, hash)
```

Queries:

```
  POST /api/search/semantic                       (search dialog)
  GET  /api/search/related/{note|deck|todo}/{uuid} (More like this)
  POST /api/ai/ask                                (Ask AI page)
            │
            ▼
  SemanticSearchService
            ├─ EmbeddingClient.embedQuery(...) for free-text queries
            ├─ QdrantClient::search or ::recommend
            └─ resolveHits: hydrate Drupal nodes, drop dead points,
                            optionally enforce RAG inclusion (Option B)
```

## `field_include_in_rag` semantics

A single boolean field, shared across the three top-level bundles, with
bundle-specific defaults:

| Bundle             | Default | Rationale                                          |
|--------------------|---------|----------------------------------------------------|
| `study_note`       | **ON**  | Long-form prose — the canonical RAG corpus.       |
| `flashcard_deck`   | OFF     | Decks are summaries; opting in is a deliberate act. |
| `flashcard`        | n/a     | Inherits from parent deck via `field_deck`.        |
| `todo_list`        | OFF     | Short, transient items; rarely useful as context.   |

Storage definition lives at
`config/sync/field.storage.node.field_include_in_rag.yml`, with one
`field.field.node.<bundle>.field_include_in_rag.yml` per bundle for the
defaults.

The flag is **only consulted on the Ask AI (RAG) path**. The unified
search dialog and "More like this" widget show all owned content
regardless of the flag — those are discovery surfaces, not generation.

### Filter location: Option B (live Drupal value)

The flag is enforced at query time in
`SemanticSearchService::resolveHits()`, by reading the live Drupal field
value during result hydration. The Qdrant payload also carries an
`include_in_rag` boolean, but **the payload is informational only** — it
is not the source of truth for RAG eligibility.

Why not filter inside the Qdrant search request? Three reasons:

1. **Eventual consistency.** Toggling the flag in the UI updates Drupal
   immediately, but the Qdrant payload only refreshes when the entity is
   re-embedded. The content-hash skip in `EmbedEntity` means an unchanged
   note whose flag was just toggled would *not* refresh its payload until
   its text changed. Reading the live value sidesteps this entirely.
2. **Flashcard inheritance.** Cards inherit `include_in_rag` from their
   parent deck. Modelling that in a Qdrant filter would require a
   denormalised copy on every card, which would drift on deck toggles.
   Resolving against the parent deck node at hydration time keeps the
   inheritance rule in one place (see `isIncludedInRag` in the service).
3. **Cheap to enforce.** RAG queries return at most ~40 candidates
   (`limit * 5` over-fetch), and the nodes are already being loaded for
   hydration. The extra cost of one field read per hit is negligible.

The trade-off: a RAG query may need to over-fetch to find enough eligible
hits. The service multiplies the requested `limit` by `5` (instead of
`3` on the non-RAG path) for headroom; if a user has a lot of opted-out
content, very tail-end results may be missing. That's acceptable for a
discovery feature with citations.

The Qdrant payload flag is kept around because it's useful for ad-hoc
analytics and would let us switch to payload-based pre-filtering later
if the corpus grows enough that the over-fetch becomes wasteful.

## RAG retrieval contract (`/api/ai/ask`)

Request body:

```json
{ "question": "...", "limit": 8 }
```

Server flow:

1. Embed the question with `EmbeddingClient` (`voyage-3-lite`, 512-dim).
2. `SemanticSearchService::findSimilar(..., requireIncludeInRag: TRUE)`.
3. If zero eligible hits → return a non-streaming JSON sentinel:
   ```json
   { "answer": null, "reason": "no_rag_content" }
   ```
   The frontend renders a dedicated empty state pointing users at their
   note/deck/todo lists with toggle hints.
4. Otherwise stream SSE events:
   - `event: citations` once at the top with `{ "items": [...] }`.
   - `event: token` repeated, each carrying `{ "text": "..." }`.
   - `event: done` at the end of a clean stream.
   - `event: error` (with `{ "message": "..." }`) on failure.

`AnthropicStreamClient` translates Claude's `message_delta` /
`content_block_delta` SSE payloads into the simpler four-event vocabulary
above. The controller is responsible for explicit PHP output buffering
control so tokens flush incrementally; see `RagController::ask`.

## Routes

| Route                              | Method | Purpose                          |
|------------------------------------|--------|----------------------------------|
| `/api/search/semantic`             | POST   | Free-text semantic search.       |
| `/api/search/related/{type}/{uuid}`| GET    | "More like this" for an entity.  |
| `/api/ai/ask`                      | POST   | Streaming RAG Q&A.               |

All three require an authenticated session (OAuth or cookie) and respect
per-user ownership: results are filtered server-side to entities whose
`uid` matches the requesting user.

## Drush

```
drush study:semantic-backfill              # enqueue everything embeddable
drush study:semantic-backfill --only-stale # only entities on an older model
drush study:semantic-backfill --bundle=study_note
drush study:semantic-status                # counts + queue depth + RAG eligibility
drush queue:run study_semantic_embed       # drain the embed queue
```

`study:semantic-status` reports:

- Embeddings count per bundle.
- RAG-eligible / total per bundle (with flashcards counted via their
  parent deck's flag).
- Embeddings by `model_version` (handy after bumping
  `EmbeddingClient::MODEL_VERSION`).
- Pending queue depth.

## Configuration knobs

- `ANTHROPIC_API_KEY` env var: required for `/api/ai/ask`.
- `VOYAGE_API_KEY` env var: required for embedding writes & queries.
- `QDRANT_URL` / `QDRANT_API_KEY` env vars: vector DB connection.
- `EmbeddingClient::MODEL_VERSION` constant: bump to force re-embed of
  the whole corpus via `--only-stale`.

## Adding a new embeddable bundle

1. Add it to `EMBEDDED_BUNDLES` in `SemanticCommands`.
2. Teach `TextExtractor` how to flatten it.
3. Decide its default for `field_include_in_rag` (mostly a UX call),
   add a `field.field.node.<bundle>.field_include_in_rag.yml`, and ship
   a `hook_update_N` backfill if there is existing content.
4. Teach `resolveHits` how to read the new bundle's RAG flag (or rely on
   `isIncludedInRag`'s generic field probe — it's bundle-agnostic for
   anything that carries `field_include_in_rag` directly).
5. Add the bundle to the `RAG_BUNDLES` list in `SemanticCommands::status`
   so the status command keeps reporting an honest picture.
