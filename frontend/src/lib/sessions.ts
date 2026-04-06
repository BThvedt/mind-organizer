const STORAGE_KEY = 'session_log';
const MAX_AGE_DAYS = 183; // ~6 months

export interface StudySession {
  id: string;
  date: string;           // YYYY-MM-DD
  startedAt: string;      // ISO timestamp
  endedAt: string;        // ISO timestamp
  durationMs: number;
  cardsReviewed: number;
  correctCount: number;
  incorrectCount: number;
  type: 'srs' | 'deck';
  deckId?: string;
}

export interface DailyStat {
  date: string;
  cardsReviewed: number;
  correctCount: number;
  incorrectCount: number;
  sessionCount: number;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function cutoffDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - MAX_AGE_DAYS);
  return d.toISOString().slice(0, 10);
}

export function loadSessions(): StudySession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StudySession[]) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: StudySession[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function logSession(
  data: Omit<StudySession, 'id' | 'date' | 'durationMs'>
): StudySession {
  const session: StudySession = {
    ...data,
    id: crypto.randomUUID(),
    date: data.startedAt.slice(0, 10),
    durationMs: new Date(data.endedAt).getTime() - new Date(data.startedAt).getTime(),
  };

  const cutoff = cutoffDate();
  const sessions = loadSessions().filter((s) => s.date >= cutoff);
  sessions.push(session);
  saveSessions(sessions);
  return session;
}

// ── Derived stats ─────────────────────────────────────────────────────────────

export function getStreak(): number {
  const sessions = loadSessions();
  if (sessions.length === 0) return 0;

  const daysWithSessions = new Set(sessions.map((s) => s.date));
  let streak = 0;
  const d = new Date();

  // Start from today, walk backwards
  while (true) {
    const dateStr = d.toISOString().slice(0, 10);
    if (daysWithSessions.has(dateStr)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

export function getTotalMinutes(): number {
  const sessions = loadSessions();
  const totalMs = sessions.reduce((sum, s) => sum + s.durationMs, 0);
  return Math.round(totalMs / 60_000);
}

export function getRetentionRate(days?: number): number | null {
  let sessions = loadSessions();
  if (days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    sessions = sessions.filter((s) => s.date >= cutoffStr);
  }

  const totalReviewed = sessions.reduce((sum, s) => sum + s.cardsReviewed, 0);
  if (totalReviewed === 0) return null;

  const totalCorrect = sessions.reduce((sum, s) => sum + s.correctCount, 0);
  return totalCorrect / totalReviewed;
}

export function getDailyStats(days: number): DailyStat[] {
  const sessions = loadSessions();
  const result: DailyStat[] = [];

  const d = new Date();
  d.setDate(d.getDate() - days + 1);

  for (let i = 0; i < days; i++) {
    const dateStr = d.toISOString().slice(0, 10);
    const daySessions = sessions.filter((s) => s.date === dateStr);

    result.push({
      date: dateStr,
      cardsReviewed: daySessions.reduce((sum, s) => sum + s.cardsReviewed, 0),
      correctCount: daySessions.reduce((sum, s) => sum + s.correctCount, 0),
      incorrectCount: daySessions.reduce((sum, s) => sum + s.incorrectCount, 0),
      sessionCount: daySessions.length,
    });

    d.setDate(d.getDate() + 1);
  }

  return result;
}
