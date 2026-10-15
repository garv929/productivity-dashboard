/** Order of applications on the pipeline board and table (pure; safe on client and server). */

type Sortable = { nextFollowUpAt: Date | string | null; updatedAt: Date | string };

const time = (d: Date | string) => new Date(d).getTime();

/**
 * 1. Applications with a follow-up date come first, nearest date first (overdue ones are
 *    the earliest, so they lead).
 * 2. Then the rest, least recently updated first, so the ones going stale surface.
 * Ties within a follow-up date also go least recently updated first.
 */
export function compareApplications(a: Sortable, b: Sortable): number {
  if (a.nextFollowUpAt && b.nextFollowUpAt) {
    return time(a.nextFollowUpAt) - time(b.nextFollowUpAt) || time(a.updatedAt) - time(b.updatedAt);
  }
  if (a.nextFollowUpAt) return -1;
  if (b.nextFollowUpAt) return 1;
  return time(a.updatedAt) - time(b.updatedAt);
}
