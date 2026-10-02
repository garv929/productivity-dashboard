import "server-only";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { companyKey, planImport, pickSuggestion, searchName, type ImportPlan, type ImportRow } from "@/lib/domain/company-import";
import { describeCompany, suggestCompanies } from "./company-lookup";
import { listCompanies, upsertCompany, type UpsertCompanyResult } from "./companies";
import type { ServiceCtx } from "./context";

export async function previewImport(userId: string, rows: ImportRow[]): Promise<ImportPlan> {
  return planImport(rows, await listCompanies(userId));
}

export type ImportResult = {
  plan: ImportPlan;
  created: UpsertCompanyResult[];
  updated: UpsertCompanyResult[];
};

/** Applies an import. The plan is recomputed against live data so a re-run never duplicates companies. */
export async function applyImport(ctx: ServiceCtx, rows: ImportRow[]): Promise<ImportResult> {
  const plan = await previewImport(ctx.userId, rows);
  const created: UpsertCompanyResult[] = [];
  const updated: UpsertCompanyResult[] = [];
  for (const row of plan.creates) {
    // Always Researching: "Ready" statuses create Todoist to-dos, which an import shouldn't do silently.
    created.push(await upsertCompany(ctx, { ...row, status: "researching" }));
  }
  for (const u of plan.updates) {
    updated.push(await upsertCompany(ctx, { id: u.id, ...u.patch }));
  }
  return { plan, created, updated };
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    }),
  );
}

/**
 * Fills in a missing website (only on an exact-name autocomplete match) and a missing
 * description (from the homepage) for the given companies, or for every company missing
 * either when `ids` is omitted. Never overwrites a value that's already there.
 */
export async function enrichCompanies(userId: string, ids?: string[], max = 100): Promise<{ checked: number; filled: number }> {
  const missing = or(isNull(companies.domain), isNull(companies.description));
  const rows = await db
    .select()
    .from(companies)
    .where(and(eq(companies.userId, userId), missing, ids ? inArray(companies.id, ids.length ? ids : [""]) : undefined))
    .limit(max);

  let filled = 0;
  await mapLimit(rows, 4, async (c) => {
    try {
      let domain = c.domain;
      // Search as written minus "Inc."-style endings, then the simplified key; only exact-name matches count.
      if (!domain) {
        domain = pickSuggestion(c.name, await suggestCompanies(searchName(c.name)))?.domain ?? null;
        if (!domain && companyKey(c.name) !== searchName(c.name).toLowerCase()) {
          domain = pickSuggestion(c.name, await suggestCompanies(companyKey(c.name)))?.domain ?? null;
        }
      }
      const description = !c.description && domain ? (await describeCompany(domain)).description : null;
      const patch: { domain?: string; description?: string } = {};
      if (!c.domain && domain) patch.domain = domain;
      if (!c.description && description) patch.description = description;
      if (!Object.keys(patch).length) return;
      // Re-check emptiness at write time so an edit made meanwhile wins.
      const conds = [eq(companies.id, c.id), eq(companies.userId, userId)];
      if (patch.domain) conds.push(isNull(companies.domain));
      if (patch.description) conds.push(isNull(companies.description));
      const res = await db.update(companies).set(patch).where(and(...conds)).returning({ id: companies.id });
      if (res.length) filled++;
    } catch (err) {
      console.warn(`enrich ${c.name} failed`, err);
    }
  });
  return { checked: rows.length, filled };
}
