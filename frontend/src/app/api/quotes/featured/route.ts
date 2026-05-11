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

export interface FeaturedQuote {
  id: string;
  text: string;
  author: string | null;
}

export async function GET() {
  try {
    const res = await fetch(
      `${DRUPAL_BASE_URL}/jsonapi/node/quote` +
        `?filter[field_featured][value]=1` +
        `&fields[node--quote]=title,field_author`,
      {
        headers: { Accept: 'application/vnd.api+json' },
        next: { revalidate: 60 },
      }
    );

    if (!res.ok) {
      return NextResponse.json({ quotes: [] }, { status: 200 });
    }

    const json = (await res.json()) as DrupalQuoteResponse;
    const quotes: FeaturedQuote[] = json.data.map((d) => ({
      id: d.id,
      text: d.attributes.title,
      author: d.attributes.field_author?.trim() || null,
    }));

    for (let i = quotes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [quotes[i], quotes[j]] = [quotes[j], quotes[i]];
    }

    return NextResponse.json(
      { quotes },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch {
    return NextResponse.json({ quotes: [] }, { status: 200 });
  }
}
