import { NextRequest, NextResponse } from 'next/server';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 2048;

/**
 * POST /api/decks/[id]/generate
 * Body: { prompt: string, limit?: number }
 *
 * Calls the Anthropic Messages API directly from the Next.js server
 * and returns candidate flashcard pairs.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured.' },
      { status: 500 }
    );
  }

  const body = await request.json();
  const prompt: string = (body.prompt ?? '').trim();
  const limit: number = Math.min(20, Math.max(1, Number(body.limit ?? 10)));
  const existingCards: { front: string; back: string }[] = Array.isArray(body.existingCards)
    ? body.existingCards
    : [];

  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required.' }, { status: 400 });
  }

  const existingCardsSection =
    existingCards.length > 0
      ? [
          '',
          'The deck already contains the following cards. Do NOT generate cards that duplicate or closely restate any of these:',
          ...existingCards.map((c, i) => `${i + 1}. Q: ${c.front} | A: ${c.back}`),
        ].join('\n')
      : '';

  const systemPrompt = [
    'You are a study assistant. The user wants to create flashcards about the following topic or content.',
    `Generate up to ${limit} flashcard pairs that cover the most important concepts.`,
    'Prefer concise, testable questions on the front and clear, direct answers on the back.',
    existingCardsSection,
    '',
    'Return ONLY a valid JSON array with no extra text, where each element is an object with exactly two string keys:',
    '"front" (the question or prompt) and "back" (the answer or explanation).',
    'Example: [{"front": "What is X?", "back": "X is ..."}]',
  ].join('\n');

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'user', content: prompt },
        ],
        system: systemPrompt,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Anthropic API error:', res.status, errText);
      return NextResponse.json(
        { error: 'AI generation failed. Please try again.' },
        { status: 502 }
      );
    }

    const data = await res.json();
    let text: string = data?.content?.[0]?.text ?? '';

    // Strip markdown code fences if present
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    const parsed = JSON.parse(text);

    if (!Array.isArray(parsed)) {
      return NextResponse.json(
        { error: 'AI returned unexpected format. Please try again.' },
        { status: 502 }
      );
    }

    const candidates = parsed
      .filter(
        (item: unknown): item is { front: string; back: string } =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Record<string, unknown>).front === 'string' &&
          typeof (item as Record<string, unknown>).back === 'string' &&
          (item as Record<string, unknown>).front !== '' &&
          (item as Record<string, unknown>).back !== ''
      )
      .slice(0, limit)
      .map(({ front, back }: { front: string; back: string }) => ({
        front: front.trim(),
        back: back.trim(),
      }));

    return NextResponse.json({ candidates });
  } catch (err) {
    console.error('Generate flashcards error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred during generation.' },
      { status: 500 }
    );
  }
}
