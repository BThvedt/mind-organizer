export type ShareableType = 'study_note' | 'flashcard_deck' | 'todo_list';

interface ShareLabels {
  noun: string;
  publicVerbDescription: string;
  publicPathSegment: string;
  apiBasePath: string;
}

export const SHARE_LABELS: Record<ShareableType, ShareLabels> = {
  study_note: {
    noun: 'note',
    publicVerbDescription: 'view',
    publicPathSegment: 'note',
    apiBasePath: '/api/notes',
  },
  flashcard_deck: {
    noun: 'deck',
    publicVerbDescription: 'study its cards',
    publicPathSegment: 'deck',
    apiBasePath: '/api/decks',
  },
  todo_list: {
    noun: 'list',
    publicVerbDescription: 'view and check off items',
    publicPathSegment: 'todo',
    apiBasePath: '/api/todos',
  },
};

export function publicShareUrl(type: ShareableType, token: string): string {
  if (typeof window === 'undefined') {
    return `/share/${SHARE_LABELS[type].publicPathSegment}/${token}`;
  }
  return `${window.location.origin}/share/${SHARE_LABELS[type].publicPathSegment}/${token}`;
}
