import "server-only";
import { and, asc, eq, gte, lt, sum } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityLog, incomeOptions, type IncomeOption, type IncomeStatus, type IncomeType } from "@/lib/db/schema";
import { CapExceededError, NotFoundError, ValidationError } from "@/lib/errors";
import { weekRange } from "@/lib/domain/time";
import { logActivity } from "./activity";
import { nowOf, type ServiceCtx } from "./context";
import { getSideIncomeCap } from "./targets";

export const INCOME_TYPES: IncomeType[] = ["online_work", "part_time", "freelance", "other"];
export const INCOME_TYPE_LABEL: Record<IncomeType, string> = {
  online_work: "Online work",
  part_time: "Part-time",
  freelance: "Freelance",
  other: "Other",
};
export const INCOME_STATUSES: IncomeStatus[] = ["exploring", "trying", "keep", "drop"];
export const INCOME_STATUS_LABEL: Record<IncomeStatus, string> = {
  exploring: "Exploring",
  trying: "Trying",
  keep: "Keep",
  drop: "Drop",
};

export async function listIncomeOptions(userId: string, f: { status?: IncomeStatus } = {}): Promise<IncomeOption[]> {
  const where = [eq(incomeOptions.userId, userId)];
  if (f.status) where.push(eq(incomeOptions.status, f.status));
  return db.select().from(incomeOptions).where(and(...where)).orderBy(asc(incomeOptions.status), asc(incomeOptions.name));
}

export type UpsertIncomeInput = {
  id?: string;
  name?: string;
  type?: IncomeType;
  expectedHourly?: number | null;
  hoursPerWeek?: number | null;
  status?: IncomeStatus;
  verdictNotes?: string | null;
};

export async function upsertIncomeOption(ctx: ServiceCtx, input: UpsertIncomeInput) {
  const values = Object.fromEntries(Object.entries(input).filter(([k, v]) => k !== "id" && v !== undefined));
  if (input.id) {
    const [prev] = await db
      .select()
      .from(incomeOptions)
      .where(and(eq(incomeOptions.userId, ctx.userId), eq(incomeOptions.id, input.id)));
    if (!prev) throw new NotFoundError("Income option not found.");
    const [row] = await db.update(incomeOptions).set(values).where(eq(incomeOptions.id, input.id)).returning();
    return { option: row, previous: prev };
  }
  if (!input.name) throw new ValidationError("A new income option needs a name.");
  const [row] = await db
    .insert(incomeOptions)
    .values({ userId: ctx.userId, name: input.name, ...values })
    .returning();
  return { option: row, previous: null };
}

export async function sideIncomeHoursThisWeek(ctx: ServiceCtx): Promise<{ hours: number; cap: number; weekStart: string }> {
  const week = weekRange(nowOf(ctx), ctx.tz);
  const [row] = await db
    .select({ total: sum(activityLog.value) })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.userId, ctx.userId),
        eq(activityLog.type, "side_income_hours"),
        gte(activityLog.occurredAt, week.start),
        lt(activityLog.occurredAt, week.end),
      ),
    );
  const cap = await getSideIncomeCap(ctx.userId, week.weekStart);
  return { hours: Number(row?.total ?? 0), cap, weekStart: week.weekStart };
}

/** Logs side-income hours; going over the weekly cap requires `override: true`. */
export async function logSideIncomeHours(ctx: ServiceCtx, input: { hours: number; optionId?: string | null; override?: boolean }) {
  if (!(input.hours > 0 && input.hours <= 24)) throw new ValidationError("Hours must be between 0 and 24.");
  const { hours, cap } = await sideIncomeHoursThisWeek(ctx);
  const after = Math.round((hours + input.hours) * 10) / 10;
  if (after > cap && !input.override) throw new CapExceededError(after, cap);
  const activity = await logActivity(ctx, {
    type: "side_income_hours",
    groupKind: "options",
    value: input.hours,
    refType: input.optionId ? "income_option" : undefined,
    refId: input.optionId ?? undefined,
  });
  return { activity, totalAfter: after, cap, overCap: after > cap };
}
