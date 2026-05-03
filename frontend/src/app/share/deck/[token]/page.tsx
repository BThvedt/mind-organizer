import { notFound } from 'next/navigation';
import { fetchSharedDeck } from '@/app/share/_lib/fetch-share';
import { LinkedItems } from '@/app/share/_components/linked-items';
import { StudyDeckClient } from './study-deck-client';

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps) {
  const { token } = await params;
  const deck = await fetchSharedDeck(token);
  return {
    title: deck?.title ?? 'Shared deck',
  };
}

export default async function SharedDeckPage({ params }: PageProps) {
  const { token } = await params;
  const deck = await fetchSharedDeck(token);
  if (!deck) notFound();

  return (
    <>
      {deck.links.length > 0 && (
        <div className="mx-auto max-w-screen-md px-4 sm:px-6 pt-4">
          <LinkedItems links={deck.links} />
        </div>
      )}
      <StudyDeckClient deck={deck} />
    </>
  );
}
