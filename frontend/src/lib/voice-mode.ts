/** Parse Drupal `field_voice_mode` or API `voiceMode` payload. */
export function parseVoiceMode(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return null;
}

export function voiceModeFromProfile(data: {
  voiceMode?: unknown;
  field_voice_mode?: unknown;
}): boolean {
  const direct = parseVoiceMode(data.voiceMode);
  if (direct !== null) return direct;
  const field = parseVoiceMode(data.field_voice_mode);
  if (field !== null) return field;
  return false;
}

/** Selector for text fields that participate in voice mode highlighting. */
export const VOICE_INPUT_SELECTOR = '[data-voice-input]';

/** Props to mark a textarea as a voice-mode input target. */
export function voiceInputProps(enabled: boolean): { 'data-voice-input'?: true } {
  return enabled ? { 'data-voice-input': true } : {};
}

/** Subtle emerald focus ring + glow on the field itself (mouse and keyboard). */
export function voiceModeFocusClassName(enabled: boolean): string {
  if (!enabled) return '';
  return [
    'transition-[box-shadow,border-color,ring-color] duration-150',
    'focus:outline-none focus-visible:outline-none',
    'focus:border-emerald-500/50 focus-visible:border-emerald-500/50',
    'focus:ring-2 focus:ring-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/40',
    'focus:shadow-[0_0_0_2px_rgba(16,185,129,0.22),0_0_12px_3px_rgba(16,185,129,0.12)]',
    'focus-visible:shadow-[0_0_0_2px_rgba(16,185,129,0.22),0_0_12px_3px_rgba(16,185,129,0.12)]',
  ].join(' ');
}

/**
 * Inset glow on a parent wrapper — used for note editors where overflow-hidden
 * clips outer box-shadow on the textarea.
 */
export function voiceModeEditorWrapClassName(enabled: boolean): string {
  if (!enabled) return '';
  return [
    'transition-shadow duration-150',
    'focus-within:ring-2 focus-within:ring-inset focus-within:ring-emerald-500/45',
    'focus-within:shadow-[inset_0_0_0_1px_rgba(16,185,129,0.3),inset_0_0_28px_6px_rgba(16,185,129,0.1)]',
  ].join(' ');
}

/** Override shadcn Textarea default focus ring when voice mode highlight is active. */
export function voiceModeTextareaOverrideClassName(enabled: boolean): string {
  if (!enabled) return '';
  return 'focus-visible:ring-2 focus-visible:ring-emerald-500/40';
}

/** Routes where the voice FAB is shown when voice mode is on. */
export function isVoiceFabRoute(pathname: string): boolean {
  if (pathname === '/dashboard/notes/new') return true;
  if (pathname === '/dashboard/todos') return true;
  if (pathname === '/dashboard/ask') return true;
  if (/^\/dashboard\/notes\/[^/]+$/.test(pathname)) return true;
  if (/^\/dashboard\/decks\/[^/]+$/.test(pathname) && !pathname.endsWith('/edit')) {
    return true;
  }
  return false;
}

export function shouldShowVoiceFab(pathname: string, searchDialogOpen: boolean): boolean {
  return isVoiceFabRoute(pathname) || searchDialogOpen;
}
