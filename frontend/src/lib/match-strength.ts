/** Shared match-strength slider bounds (cosine score on voyage-3-lite). */
export const MATCH_STRENGTH_DEFAULT = 0.4;
export const MATCH_STRENGTH_MIN = 0;
export const MATCH_STRENGTH_MAX = 0.95;
export const MATCH_STRENGTH_STEP = 0.05;

export function clampMatchStrength(value: number): number {
  const rounded = Math.round(value / MATCH_STRENGTH_STEP) * MATCH_STRENGTH_STEP;
  return Math.min(MATCH_STRENGTH_MAX, Math.max(MATCH_STRENGTH_MIN, rounded));
}

/** Parse a Drupal decimal / JSON number into a clamped slider value. */
export function parseMatchStrength(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clampMatchStrength(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return clampMatchStrength(parsed);
    }
  }
  return null;
}

export function resolveMatchStrength(value: unknown): number {
  return parseMatchStrength(value) ?? MATCH_STRENGTH_DEFAULT;
}

export interface MatchStrengthPreferences {
  linkMatchStrength: number;
  askMatchStrength: number;
}

export function preferencesFromProfile(data: {
  linkMatchStrength?: unknown;
  askMatchStrength?: unknown;
}): MatchStrengthPreferences {
  return {
    linkMatchStrength: resolveMatchStrength(data.linkMatchStrength),
    askMatchStrength: resolveMatchStrength(data.askMatchStrength),
  };
}
