import { NextResponse } from 'next/server';

const DRUPAL_BASE_URL = process.env.NEXT_PUBLIC_DRUPAL_BASE_URL!;

interface DrupalQuote {
  id: string;
  attributes: {
    title: string;
    field_author: string | null;
  };
}

interface DrupalQuoteResponse {
  data: DrupalQuote[];
}

export interface RandomQuote {
  id: string;
  text: string;
  author: string | null;
}

export async function GET() {
  try {
    const res = await fetch(
      `${DRUPAL_BASE_URL}/jsonapi/node/quote` +
        `?fields[node--quote]=title,field_author` +
        `&page[limit]=200`,
      {
        headers: { Accept: 'application/vnd.api+json' },
        cache: 'no-store',
      }
    );

    if (!res.ok || res.status >= 400) {
      return NextResponse.json({ quote: null }, { status: 200 });
    }

    const json = (await res.json()) as DrupalQuoteResponse;
    if (!json.data || json.data.length === 0) {
      return NextResponse.json({ quote: null });
    }

    const pick = json.data[Math.floor(Math.random() * json.data.length)];
    const author = pick.attributes.field_author?.trim() || null;
    const quote: RandomQuote = {
      id: pick.id,
      text: pick.attributes.title,
      author,
    };

    return NextResponse.json(
      { quote },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json({ quote: null }, { status: 200 });
  }
}
