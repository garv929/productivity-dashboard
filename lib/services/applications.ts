import "server-only";
import { and, asc, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { applications, type Application, type ApplicationStage } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/errors";
import { logActivity } from "./activity";
import { nowOf, type ServiceCtx } from "./context";

export const STAGES: ApplicationStage[] = ["researching", "tailoring", "applied", "screen", "interview", "offer", "closed"];

export const STAGE_LABEL: Record<ApplicationStage, string> = {
  researching: "Researching",
  tailoring: "Tailoring",
  applied: "Applied",
  screen: "Screen",
  interview: "Interview",
  offer: "Offer",
  closed: "Closed",
};

export type ApplicationFilter = {
  stage?: ApplicationStage;
  company?: string;
  appliedFrom?: Date;
  appliedTo?: Date;
};

export async function listApplications(userId: string, f: ApplicationFilter = {}): Promise<Application[]> {
  const where: SQL[] = [eq(applications.userId, userId)];
  if (f.stage) where.push(eq(applications.stage, f.stage));
  if (f.company) {
    const q = `%${f.company}%`;
    where.push(or(ilike(applications.companyName, q), ilike(applications.role, q))!);
  }
  if (f.appliedFrom) where.push(gte(applications.appliedAt, f.appliedFrom));
  if (f.appliedTo) where.push(lte(applications.appliedAt, f.appliedTo));
  return db
    .select()
    .from(applications)
    .where(and(...where))
    .orderBy(asc(applications.stage), desc(applications.updatedAt));
}

export async function getApplication(userId: string, id: string): Promise<Application> {
  const [row] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError("Application not found.");
  return row;
}

export type UpsertApplicationInput = {
  id?: string;
  companyName?: string;
  role?: string;
  url?: string | null;
  stage?: ApplicationStage;
  appliedAt?: Date | null;
  nextFollowUpAt?: Date | null;
  notes?: string | null;
  companyId?: string | null;
  todoistTaskId?: string | null;
};

export type UpsertApplicationResult = {
  application: Application;
  previous: Application | null;
  activityId: string | null;
};

/** Create or update; moving into Applied stamps `applied_at` and logs an `application` activity. */
export async function upsertApplication(ctx: ServiceCtx, input: UpsertApplicationInput): Promise<UpsertApplicationResult> {
  const previous = input.id ? await getApplication(ctx.userId, input.id) : null;
  const becomingApplied = input.stage === "applied" && previous?.stage !== "applied";
  const values = {
    ...(input.companyName !== undefined && { companyName: input.companyName }),
    ...(input.role !== undefined && { role: input.role }),
    ...(input.url !== undefined && { url: input.url }),
    ...(input.stage !== undefined && { stage: input.stage }),
    ...(input.nextFollowUpAt !== undefined && { nextFollowUpAt: input.nextFollowUpAt }),
    ...(input.notes !== undefined && { notes: input.notes }),
    ...(input.companyId !== undefined && { companyId: input.companyId }),
    ...(input.todoistTaskId !== undefined && { todoistTaskId: input.todoistTaskId }),
    ...(input.appliedAt !== undefined
      ? { appliedAt: input.appliedAt }
      : becomingApplied && !previous?.appliedAt
        ? { appliedAt: nowOf(ctx) }
        : {}),
  };

  let application: Application;
  if (previous) {
    [application] = await db
      .update(applications)
      .set(values)
      .where(and(eq(applications.userId, ctx.userId), eq(applications.id, previous.id)))
      .returning();
  } else {
    if (!input.companyName || !input.role) throw new NotFoundError("A new application needs a company and a role.");
    [application] = await db
      .insert(applications)
      .values({ userId: ctx.userId, companyName: input.companyName, role: input.role, ...values })
      .returning();
  }

  let activityId: string | null = null;
  if (becomingApplied) {
    const act = await logActivity(ctx, {
      type: "application",
      groupKind: "pipeline",
      refType: "application",
      refId: application.id,
    });
    activityId = act.id;
  }
  return { application, previous, activityId };
}

/** Undo helper: restore a previous snapshot, or remove a row created in the same operation. */
export async function restoreApplication(userId: string, snapshot: Application | null, createdId?: string) {
  if (snapshot) {
    const { id, userId: _u, createdAt: _c, updatedAt: _up, ...rest } = snapshot;
    void _u;
    void _c;
    void _up;
    await db.update(applications).set(rest).where(and(eq(applications.userId, userId), eq(applications.id, id)));
  } else if (createdId) {
    await db.delete(applications).where(and(eq(applications.userId, userId), eq(applications.id, createdId)));
  }
}
