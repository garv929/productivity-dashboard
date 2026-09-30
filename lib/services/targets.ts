import "server-only";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { weeklyReviews, weeklyTargets, type WeeklyReview } from "@/lib/db/schema";
import { resolveTargets, DEFAULT_SIDE_INCOME_CAP, type MetricKey, type ResolvedTarget } from "@/lib/domain/scorecard";
import type { ServiceCtx } from "./context";

export async function getTargets(userId: string, weekStart: string): Promise<Record<MetricKey, ResolvedTarget>> {
  const rows = await db
    .select()
    .from(weeklyTargets)
    .where(
      and(
        eq(weeklyTargets.userId, userId),
        or(isNull(weeklyTargets.weekStart), eq(weeklyTargets.weekStart, weekStart)),
      ),
    );
  return resolveTargets(rows, weekStart);
}

/** Defaults only (ignores any per-week overrides). */
export async function getDefaultTargets(userId: string): Promise<Record<MetricKey, ResolvedTarget>> {
  const rows = await db
    .select()
    .from(weeklyTargets)
    .where(and(eq(weeklyTargets.userId, userId), isNull(weeklyTargets.weekStart)));
  return resolveTargets(rows, "");
}

export async function getSideIncomeCap(userId: string, weekStart: string): Promise<number> {
  const t = await getTargets(userId, weekStart);
  return t.side_income_hours.max ?? DEFAULT_SIDE_INCOME_CAP;
}

/** weekStart null = the default for every week. */
export async function setTarget(
  userId: string,
  weekStart: string | null,
  metric: MetricKey,
  min: number | null,
  max: number | null,
) {
  await db
    .insert(weeklyTargets)
    .values({ userId, weekStart, metric, min, max })
    .onConflictDoUpdate({
      target: [weeklyTargets.userId, weeklyTargets.weekStart, weeklyTargets.metric],
      set: { min, max },
    });
}

export async function clearWeekOverrides(userId: string, weekStart: string) {
  await db.delete(weeklyTargets).where(and(eq(weeklyTargets.userId, userId), eq(weeklyTargets.weekStart, weekStart)));
}

export type ReviewInput = {
  accomplished?: string | null;
  productive?: string | null;
  notProductive?: string | null;
  demandRating?: number | null;
  routines?: "yes" | "partly" | "no" | null;
  changes?: string | null;
};

export async function saveWeeklyReview(ctx: ServiceCtx, weekStart: string, input: ReviewInput): Promise<WeeklyReview> {
  const [row] = await db
    .insert(weeklyReviews)
    .values({ userId: ctx.userId, weekStart, ...input })
    .onConflictDoUpdate({ target: [weeklyReviews.userId, weeklyReviews.weekStart], set: input })
    .returning();
  return row;
}

export async function getWeeklyReview(userId: string, weekStart: string): Promise<WeeklyReview | null> {
  const [row] = await db
    .select()
    .from(weeklyReviews)
    .where(and(eq(weeklyReviews.userId, userId), eq(weeklyReviews.weekStart, weekStart)))
    .limit(1);
  return row ?? null;
}

export async function listWeeklyReviews(userId: string, limit = 12): Promise<WeeklyReview[]> {
  return db
    .select()
    .from(weeklyReviews)
    .where(eq(weeklyReviews.userId, userId))
    .orderBy(desc(weeklyReviews.weekStart))
    .limit(limit);
}
