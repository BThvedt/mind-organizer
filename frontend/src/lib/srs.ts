const STORAGE_KEY = 'srs_data';
const POOL_CAP = 500;
export const RETIREMENT_STREAK = 5;

export interface CardSRSData {
  interval: number;
  easeFactor: number;
  repetitions: number;
  nextReviewAt: string;    // "YYYY-MM-DD"
  lastReviewedAt: string;  // ISO timestamp
  addedToQueueAt: string;  // ISO timestamp — eviction order
  retired: boolean;
}

export type SRSPool = Record<string, CardSRSData>;

// ── Storage helpers ───────────────────────────────────────────────────────────

export function loadSRSPool(): SRSPool {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SRSPool) : {};
  } catch {
    return {};
  }
}

export function saveSRSPool(pool: SRSPool): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pool));
}

// ── SM-2 ─────────────────────────────────────────────────────────────────────

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateInNDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function computeNextReview(
  data: CardSRSData,
  quality: 1 | 4  // 1 = incorrect, 4 = correct
): CardSRSData {
  let { interval, easeFactor, repetitions } = data;

  if (quality < 3) {
    repetitions = 0;
    interval = 1;
  } else {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * easeFactor);
    repetitions += 1;
  }

  easeFactor = Math.max(
    1.3,
    easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
  );

  return {
    ...data,
    interval,
    easeFactor,
    repetitions,
    nextReviewAt: dateInNDays(interval),
    lastReviewedAt: new Date().toISOString(),
    retired: repetitions >= RETIREMENT_STREAK,
  };
}

export function retireCard(data: CardSRSData): CardSRSData {
  return { ...data, retired: true };
}

// ── Pool management ───────────────────────────────────────────────────────────

export interface EnrollableCard {
  id: string;
  created: string; // ISO timestamp — oldest enrolled first when pool is full
}

/**
 * Enrols cards not yet in the pool, oldest Drupal-created first.
 * When at capacity, evicts retired cards before active ones (both oldest-first).
 */
export function enrollNewCards(
  pool: SRSPool,
  incomingCards: EnrollableCard[]
): SRSPool {
  const newCards = incomingCards
    .filter((c) => !(c.id in pool))
    .sort((a, b) => a.created.localeCompare(b.created));

  if (newCards.length === 0) return pool;

  const updated = { ...pool };

  for (const card of newCards) {
    const currentSize = Object.keys(updated).length;

    if (currentSize >= POOL_CAP) {
      const entries = Object.entries(updated).sort(
        ([, a], [, b]) => a.addedToQueueAt.localeCompare(b.addedToQueueAt)
      );
      const retiredEntry = entries.find(([, d]) => d.retired);
      const evictId = retiredEntry ? retiredEntry[0] : entries[0][0];
      delete updated[evictId];
    }

    const now = new Date().toISOString();
    updated[card.id] = {
      interval: 1,
      easeFactor: 2.5,
      repetitions: 0,
      nextReviewAt: todayString(),
      lastReviewedAt: now,
      addedToQueueAt: now,
      retired: false,
    };
  }

  return updated;
}

// ── Session queue ─────────────────────────────────────────────────────────────

export interface StudyCard {
  id: string;
  front: string;
  back: string;
  deckId: string;
  deckAreaIds: string[];
  deckSubjectIds: string[];
  created: string;
}

/**
 * Returns due, non-retired cards for a session, sorted most-overdue first.
 * Optionally scoped to an area and/or subject via the card's deck taxonomy.
 * A card matches the area filter when any of its deck's areas equal the
 * filter (same for subject).
 */
export function buildSessionQueue(
  pool: SRSPool,
  allCards: StudyCard[],
  filterAreaId?: string,
  filterSubjectId?: string
): (StudyCard & { srs: CardSRSData })[] {
  const today = todayString();

  return allCards
    .filter((c) => {
      const srs = pool[c.id];
      if (!srs || srs.retired) return false;
      if (srs.nextReviewAt > today) return false;
      if (filterAreaId && !c.deckAreaIds.includes(filterAreaId)) return false;
      if (filterSubjectId && !c.deckSubjectIds.includes(filterSubjectId)) return false;
      return true;
    })
    .map((c) => ({ ...c, srs: pool[c.id] }))
    .sort((a, b) => a.srs.nextReviewAt.localeCompare(b.srs.nextReviewAt));
}

/** Cards mastered count for the dashboard stat. */
export function countMastered(pool: SRSPool): number {
  return Object.values(pool).filter((d) => d.retired).length;
}

/** Nearest future due date across the pool, or null if nothing is scheduled. */
export function nextDueDate(pool: SRSPool): string | null {
  const today = todayString();
  const upcoming = Object.values(pool)
    .filter((d) => !d.retired && d.nextReviewAt > today)
    .map((d) => d.nextReviewAt)
    .sort();
  return upcoming[0] ?? null;
}
