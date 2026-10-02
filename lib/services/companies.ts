import "server-only";
import { and, eq, ilike, isNull, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies, type Company, type CompanyStatus, type CompanyTier } from "@/lib/db/schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getGroupByKind } from "@/lib/domain/groups";
import { targetForGroup } from "@/lib/domain/group-mapping";
import { normalizeDomain } from "@/lib/domain/company-lookup";
import { compareCompanies } from "@/lib/domain/company-tier";
import { createTask, listOpenTasks } from "@/lib/todoist";
import type { ServiceCtx } from "./context";

export const COMPANY_STATUSES: CompanyStatus[] = ["researching", "ready_to_apply", "ready_to_reach_out", "done"];
export const COMPANY_STATUS_LABEL: Record<CompanyStatus, string> = {
  researching: "Researching",
  ready_to_apply: "Ready to apply",
  ready_to_reach_out: "Ready to reach out",
  done: "Done",
};

/** Sorted Tier 1 → Tier 3 → unrated; within a tier, ready ones first. `tier: "unrated"` finds companies with no tier. */
export async function listCompanies(
  userId: string,
  f: { status?: CompanyStatus; name?: string; tier?: CompanyTier | "unrated" } = {},
): Promise<Company[]> {
  const where: SQL[] = [eq(companies.userId, userId)];
  if (f.status) where.push(eq(companies.status, f.status));
  if (f.name) where.push(ilike(companies.name, `%${f.name}%`));
  if (f.tier) where.push(f.tier === "unrated" ? isNull(companies.tier) : eq(companies.tier, f.tier));
  const rows = await db.select().from(companies).where(and(...where));
  return rows.sort(compareCompanies);
}

export async function getCompany(userId: string, id: string): Promise<Company> {
  const [row] = await db.select().from(companies).where(and(eq(companies.userId, userId), eq(companies.id, id))).limit(1);
  if (!row) throw new NotFoundError("Company not found.");
  return row;
}

export type UpsertCompanyInput = {
  id?: string;
  name?: string;
  domain?: string | null;
  description?: string | null;
  why?: string | null;
  rolesOfInterest?: string | null;
  status?: CompanyStatus;
  tier?: CompanyTier | null;
  notes?: string | null;
};

export type UpsertCompanyResult = {
  company: Company;
  previous: Company | null;
  createdTask: { id: string; content: string; groupName: string } | null;
};

/** What a pending assistant change to a company was based on; a mismatch at confirm time makes it stale. */
export function companyFingerprint(c: Pick<Company, "status" | "tier">): string {
  return `${c.status}:${c.tier ?? "unrated"}`;
}

/** Title of the to-do auto-created when a company becomes "Ready". */
export function readyTaskTitle(company: Pick<Company, "name" | "rolesOfInterest">, status: CompanyStatus): string | null {
  const role = company.rolesOfInterest?.split(/[,;\n]/)[0]?.trim();
  if (status === "ready_to_apply") return role ? `Apply to ${company.name} – ${role}` : `Apply to ${company.name}`;
  if (status === "ready_to_reach_out") return `Reach out to someone at ${company.name}`;
  return null;
}

export async function upsertCompany(ctx: ServiceCtx, input: UpsertCompanyInput): Promise<UpsertCompanyResult> {
  const previous = input.id ? await getCompany(ctx.userId, input.id) : null;
  const values = Object.fromEntries(
    Object.entries({
      name: input.name,
      domain: input.domain === undefined ? undefined : normalizeDomain(input.domain),
      description: input.description,
      why: input.why,
      rolesOfInterest: input.rolesOfInterest,
      status: input.status,
      tier: input.tier,
      notes: input.notes,
    }).filter(([, v]) => v !== undefined),
  );

  let company: Company;
  if (previous) {
    [company] = await db
      .update(companies)
      .set(values)
      .where(and(eq(companies.userId, ctx.userId), eq(companies.id, previous.id)))
      .returning();
  } else {
    if (!input.name) throw new ValidationError("A new company needs a name.");
    [company] = await db.insert(companies).values({ userId: ctx.userId, name: input.name, ...values }).returning();
  }

  let createdTask: UpsertCompanyResult["createdTask"] = null;
  const becameReady =
    (company.status === "ready_to_apply" || company.status === "ready_to_reach_out") && previous?.status !== company.status;
  if (becameReady) {
    const alreadyLinked =
      company.todoistTaskId && (await listOpenTasks()).some((t) => t.id === company.todoistTaskId);
    if (!alreadyLinked) {
      const kind = company.status === "ready_to_apply" ? "pipeline" : "people";
      const group = await getGroupByKind(ctx.userId, kind);
      const target = group ? targetForGroup(group) : null;
      if (!group || !target) {
        throw new ValidationError(
          `No active ${kind === "pipeline" ? "Applications" : "Networking & Follow-ups"} group is mapped to Todoist, so the linked to-do can't be created.`,
        );
      }
      const title = readyTaskTitle(company, company.status)!;
      const task = await createTask(ctx.userId, target, {
        content: title,
        description: `Linked to company research: ${company.name}`,
      });
      [company] = await db
        .update(companies)
        .set({ todoistTaskId: task.id })
        .where(eq(companies.id, company.id))
        .returning();
      createdTask = { id: task.id, content: task.content, groupName: group.name };
    }
  }
  return { company, previous, createdTask };
}

export async function restoreCompany(userId: string, snapshot: Company | null, createdId?: string) {
  if (snapshot) {
    const { id, userId: _u, createdAt: _c, updatedAt: _up, ...rest } = snapshot;
    void _u;
    void _c;
    void _up;
    await db.update(companies).set(rest).where(and(eq(companies.userId, userId), eq(companies.id, id)));
  } else if (createdId) {
    await db.delete(companies).where(and(eq(companies.userId, userId), eq(companies.id, createdId)));
  }
}
