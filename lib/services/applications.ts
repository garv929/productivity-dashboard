import "server-only";
import { and, asc, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { applications, type Application, type ApplicationStage, type Company, type CompanyTier } from "@/lib/db/schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { logActivity } from "./activity";
import { findCompanyByName, getCompany, upsertCompany, type UpsertCompanyResult } from "./companies";
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
  /** The company's tier. Required for a new application; on an update it re-tiers the company. */
  tier?: CompanyTier;
};

export type UpsertApplicationResult = {
  application: Application;
  previous: Application | null;
  activityId: string | null;
  /** Set when the company was created or re-tiered, so the change can be undone. */
  companyChange: UpsertCompanyResult | null;
};

/** The company an application belongs to: its linked company, else one with the same name. */
export async function companyForApplication(
  userId: string,
  app: { companyId?: string | null; companyName: string },
): Promise<Company | null> {
  if (app.companyId) {
    try {
      return await getCompany(userId, app.companyId);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
  }
  return findCompanyByName(userId, app.companyName);
}

/**
 * Tier lives on the company (one tier per company, shared by all its applications).
 * Re-tiers the matching company, or adds it to Company Research (status Done: you're
 * already in its pipeline) when there isn't one yet. Returns the company to link to.
 */
async function applyTier(ctx: ServiceCtx, existing: Company | null, companyName: string, tier: CompanyTier) {
  if (existing && existing.tier === tier) return { company: existing, change: null };
  const change = existing
    ? await upsertCompany(ctx, { id: existing.id, tier })
    : await upsertCompany(ctx, { name: companyName, tier, status: "done", notes: "Added from the application pipeline." });
  return { company: change.company, change };
}

/** Create or update; moving into Applied stamps `applied_at` and logs an `application` activity. */
export async function upsertApplication(ctx: ServiceCtx, input: UpsertApplicationInput): Promise<UpsertApplicationResult> {
  const previous = input.id ? await getApplication(ctx.userId, input.id) : null;
  if (!previous && (!input.companyName || !input.role)) throw new ValidationError("A new application needs a company and a role.");
  if (!previous && !input.tier) throw new ValidationError("A new application needs a tier (Tier 1, 2 or 3).");

  // Resolve the company (and its tier) before writing the application so it gets linked.
  let companyChange: UpsertCompanyResult | null = null;
  let companyId = input.companyId;
  const companyName = input.companyName ?? previous!.companyName;
  const renamed = previous !== null && input.companyName !== undefined && input.companyName !== previous.companyName;
  if (input.tier || renamed || (companyId === undefined && !previous?.companyId)) {
    // A renamed application is matched by its new name, not the company it was linked to.
    let company = await companyForApplication(ctx.userId, {
      companyId: companyId ?? (renamed ? null : previous?.companyId),
      companyName,
    });
    if (input.tier) {
      const res = await applyTier(ctx, company, companyName, input.tier);
      company = res.company;
      companyChange = res.change;
    }
    if (companyId === undefined && (company?.id ?? null) !== (previous?.companyId ?? null)) companyId = company?.id ?? null;
  }

  const becomingApplied = input.stage === "applied" && previous?.stage !== "applied";
  const values = {
    ...(input.companyName !== undefined && { companyName: input.companyName }),
    ...(input.role !== undefined && { role: input.role }),
    ...(input.url !== undefined && { url: input.url }),
    ...(input.stage !== undefined && { stage: input.stage }),
    ...(input.nextFollowUpAt !== undefined && { nextFollowUpAt: input.nextFollowUpAt }),
    ...(input.notes !== undefined && { notes: input.notes }),
    ...(companyId !== undefined && { companyId }),
    ...(input.todoistTaskId !== undefined && { todoistTaskId: input.todoistTaskId }),
    ...(input.appliedAt !== undefined
      ? { appliedAt: input.appliedAt }
      : becomingApplied && !previous?.appliedAt
        ? { appliedAt: nowOf(ctx) }
        : {}),
  };

  let application: Application;
  if (previous && Object.keys(values).length === 0) {
    application = previous; // e.g. only the company's tier changed
  } else if (previous) {
    [application] = await db
      .update(applications)
      .set(values)
      .where(and(eq(applications.userId, ctx.userId), eq(applications.id, previous.id)))
      .returning();
  } else {
    [application] = await db
      .insert(applications)
      .values({ userId: ctx.userId, companyName: input.companyName!, role: input.role!, ...values })
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
  return { application, previous, activityId, companyChange };
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
