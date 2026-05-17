import { NextRequest, NextResponse } from 'next/server';
import { drupalBaseUrl, getBearerToken, getCurrentUserUuid } from '@/lib/drupal';

/**
 * POST /api/ai/ask
 *
 * Forwards a RAG question to Drupal's POST /api/ai/ask endpoint and pipes
 * the SSE response straight through to the browser.
 *
 * Drupal returns one of:
 *   - 200 application/json with { answer: null, reason: 'no_rag_content' }
 *     when the user has no RAG-eligible content. We pass that JSON through
 *     so the page renders an empty state.
 *   - 200 text/event-stream with events `citations`, `token`, optionally
 *     `error`, then `done`. We stream that body as-is.
 *
 * We use the Node runtime because we need the cookie-bound bearer token,
 * and we deliberately stream response.body without consuming it. The
 * `X-Accel-Buffering: no` header tells the production nginx upstream to
 * skip buffering, matching the header Drupal already sets.
 */

export const runtime = 'nodejs';
// Streaming a long Claude response can take longer than the default
// serverless function timeout; mark the route as dynamic and bump the
// max duration for managed deployments.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const userUuid = await getCurrentUserUuid();
  if (!userUuid) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const token = await getBearerToken();
  if (!token) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const upstream = await fetch(`${drupalBaseUrl()}/api/ai/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body ?? {}),
    // Disable Node's response caching for streamed bodies.
    cache: 'no-store',
  });

  // Error path: forward the JSON error body and status.
  if (!upstream.ok) {
    const text = await upstream.text();
    let detail: unknown = text;
    try {
      detail = JSON.parse(text);
    } catch {
      // keep raw text
    }
    return NextResponse.json(
      { error: 'RAG request failed', detail },
      { status: upstream.status },
    );
  }

  // Non-streaming sentinel: empty-RAG-content response. Forward as JSON.
  const contentType = upstream.headers.get('content-type') ?? '';
  if (!contentType.startsWith('text/event-stream')) {
    const json = await upstream.json().catch(() => ({}));
    return NextResponse.json(json, { status: upstream.status });
  }

  // Streaming path: pipe the body through as SSE.
  if (!upstream.body) {
    return NextResponse.json({ error: 'Upstream returned no body' }, { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
