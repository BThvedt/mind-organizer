import 'server-only';

const DRUPAL_BASE_URL = process.env.NEXT_PUBLIC_DRUPAL_BASE_URL!;

export interface SharedLink {
  type: 'note' | 'deck' | 'todo';
  title: string;
  token: string;
}

export interface SharedTermRef {
  uuid: string;
  name: string;
}

export interface SharedNote {
  type: 'study_note';
  title: string;
  body: string;
  areas: SharedTermRef[];
  subjects: SharedTermRef[];
  links: SharedLink[];
  updated: number;
}

export interface SharedDeckCard {
  uuid: string;
  front: string;
  back: string;
}

export interface SharedDeck {
  type: 'flashcard_deck';
  title: string;
  description: string;
  areas: SharedTermRef[];
  subjects: SharedTermRef[];
  cards: SharedDeckCard[];
  links: SharedLink[];
  updated: number;
}

export interface SharedTodoItem {
  uuid: string;
  text: string;
  completed: boolean;
  priority: 'high' | 'med' | 'low' | null | string;
  notes: string;
}

export interface SharedTodoList {
  type: 'todo_list';
  title: string;
  areas: SharedTermRef[];
  subjects: SharedTermRef[];
  items: SharedTodoItem[];
  links: SharedLink[];
  updated: number;
}

async function fetchShared<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${DRUPAL_BASE_URL}${path}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function fetchSharedNote(token: string) {
  return fetchShared<SharedNote>(`/api/share/note/${encodeURIComponent(token)}`);
}

export function fetchSharedDeck(token: string) {
  return fetchShared<SharedDeck>(`/api/share/deck/${encodeURIComponent(token)}`);
}

export function fetchSharedTodo(token: string) {
  return fetchShared<SharedTodoList>(`/api/share/todo/${encodeURIComponent(token)}`);
}
