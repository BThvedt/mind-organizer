import { NextRequest, NextResponse } from 'next/server';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 4096;

const SYSTEM_PROMPTS = {
  format: [
    'You are a markdown formatting assistant.',
    'The user will provide a markdown note. Reformat it to improve structure, fix headings, clean up lists, and improve spacing and readability.',
    'Do not add new information — only reformat what is already there.',
    'Return ONLY the improved markdown with no explanation or preamble.',
  ].join('\n'),

  'add-content': [
    'You are a study assistant that helps expand notes.',
    'The user will provide a markdown note followed by an instruction describing what content to add.',
    'Add the requested content naturally into the note and return the FULL updated note in markdown.',
    'Do not include any explanation or preamble — return only the complete updated markdown.',
  ].join('\n'),

  'generate-deck': [
    'You are a study assistant. The user will provide the body of a study note.',
    'Generate flashcard pairs that cover the most important concepts from the note.',
    'Prefer concise, testable questions on the front and clear, direct answers on the back.',
    '',
    'Return ONLY a valid JSON array with no extra text, where each element is an object with exactly two string keys:',
    '"front" (the question or prompt) and "back" (the answer or explanation).',
    'Example: [{"front": "What is X?", "back": "X is ..."}]',
  ].join('\n'),
};

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
  const action: string = body.action ?? '';
  const noteBody: string = (body.noteBody ?? '').trim();
  const prompt: string = (body.prompt ?? '').trim();
  const limit: number = Math.min(20, Math.max(1, Number(body.limit ?? 10)));

  if (!['format', 'add-content', 'generate-deck'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
  }
  if (!noteBody) {
    return NextResponse.json({ error: 'noteBody is required.' }, { status: 400 });
  }
  if (action === 'add-content' && !prompt) {
    return NextResponse.json({ error: 'prompt is required for add-content.' }, { status: 400 });
  }

  const userMessage =
    action === 'add-content'
      ? `Note:\n${noteBody}\n\nInstruction: ${prompt}`
      : noteBody;

  const systemPrompt =
    action === 'generate-deck'
      ? [
          'You are a study assistant. The user will provide the body of a study note.',
          `Generate up to ${limit} flashcard pairs that cover the most important concepts from the note.`,
          'Prefer concise, testable questions on the front and clear, direct answers on the back.',
          '',
          'Return ONLY a valid JSON array with no extra text, where each element is an object with exactly two string keys:',
          '"front" (the question or prompt) and "back" (the answer or explanation).',
          'Example: [{"front": "What is X?", "back": "X is ..."}]',
        ].join('\n')
      : SYSTEM_PROMPTS[action as keyof typeof SYSTEM_PROMPTS];

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
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Anthropic API error:', res.status, errText);
      return NextResponse.json(
        { error: 'AI request failed. Please try again.' },
        { status: 502 }
      );
    }

    const data = await res.json();
    let text: string = data?.content?.[0]?.text ?? '';

    if (action === 'generate-deck') {
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return NextResponse.json(
          { error: 'AI returned unexpected format. Please try again.' },
          { status: 502 }
        );
      }
      if (!Array.isArray(parsed)) {
        return NextResponse.json(
          { error: 'AI returned unexpected format. Please try again.' },
          { status: 502 }
        );
      }
      const candidates = (parsed as unknown[])
        .filter(
          (item): item is { front: string; back: string } =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as Record<string, unknown>).front === 'string' &&
            typeof (item as Record<string, unknown>).back === 'string' &&
            (item as Record<string, unknown>).front !== '' &&
            (item as Record<string, unknown>).back !== ''
        )
        .slice(0, limit)
        .map(({ front, back }) => ({ front: front.trim(), back: back.trim() }));

      return NextResponse.json({ candidates });
    }

    return NextResponse.json({ result: text.trim() });
  } catch (err) {
    console.error('Note AI error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred.' },
      { status: 500 }
    );
  }
}
