/**
 * Helpers for grouping a sorted list of items into chronological
 * section labels (Today / Yesterday / Previous 7 Days / etc.)
 * matching the Apple Notes / Outlook visual style.
 */

/**
 * Returns a human-readable section label for a given ISO date string.
 * Null / undefined dates map to "Never viewed" (used for items that have
 * never been opened when sorting by Last Viewed).
 */
export function getDateGroupLabel(
  dateString: string | null | undefined,
  now = new Date(),
): string {
  if (!dateString) return 'Never Viewed';

  const d = new Date(dateString);
  if (isNaN(d.getTime())) return 'Never Viewed';

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const itemStart = new Date(d);
  itemStart.setHours(0, 0, 0, 0);

  const diffDays = Math.round(
    (todayStart.getTime() - itemStart.getTime()) / 86_400_000,
  );

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays <= 7) return 'Previous 7 Days';
  if (diffDays <= 30) return 'Previous 30 Days';

  // "April 2026", "January 2025", etc.
  return d.toLocaleString('default', { month: 'long', year: 'numeric' });
}

/**
 * Groups a pre-sorted array of items into labelled sections, preserving
 * the existing order within each group.
 *
 * Items with the same label are placed in the same section. Because the
 * input is sorted server-side (e.g. `-changed` or `-field_last_viewed`),
 * all items for a given label will already be contiguous — no re-sorting
 * is needed.
 */
export function groupByDateLabel<T>(
  items: T[],
  getDate: (item: T) => string | null | undefined,
  now = new Date(),
): Array<{ label: string; items: T[] }> {
  const groups: Array<{ label: string; items: T[] }> = [];
  const labelIndex = new Map<string, number>();

  for (const item of items) {
    const label = getDateGroupLabel(getDate(item), now);
    const existing = labelIndex.get(label);
    if (existing === undefined) {
      labelIndex.set(label, groups.length);
      groups.push({ label, items: [item] });
    } else {
      groups[existing].items.push(item);
    }
  }

  return groups;
}
