/** Planning a bulk company import (pure; the service applies the plan). */

import type { Tier } from "./company-tier";
import { normalizeDomain, type CompanySuggestion } from "./company-lookup";

export const MAX_IMPORT_ROWS = 100;

export type ImportRow = {
  name: string;
  domain?: string | null;
  description?: string | null;
  why?: string | null;
  rolesOfInterest?: string | null;
  tier?: Tier | null;
  notes?: string | null;
};

type ExistingCompany = {
  id: string;
  name: string;
  domain: string | null;
  description: string | null;
  why: string | null;
  rolesOfInterest: string | null;
  tier: Tier | null;
  notes: string | null;
};

export type ImportPatch = Partial<Omit<ImportRow, "name">>;

export type ImportPlan = {
  creates: ImportRow[];
  updates: { id: string; name: string; patch: ImportPatch }[];
  skipped: { name: string; reason: string }[];
};

const SUFFIXES = /\b(incorporated|inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa)\b\.?/g;

/** "Ramp, Inc." / "ramp" / " RAMP  " → "ramp"; used to spot the same company written differently. */
export function companyKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const blank = (v: string | null | undefined) => !v || !v.trim();

function tidy(row: ImportRow): ImportRow {
  const t = (v: string | null | undefined) => (blank(v) ? null : v!.trim());
  return {
    name: row.name.trim().replace(/\s+/g, " "),
    domain: normalizeDomain(row.domain) ?? null,
    description: t(row.description),
    why: t(row.why),
    rolesOfInterest: t(row.rolesOfInterest),
    tier: row.tier ?? null,
    notes: t(row.notes),
  };
}

/**
 * New companies are created (status Researching). Companies you already have are matched by
 * name or website and only get fields that are empty today filled in — plus the tier when the
 * file gives one, since a ranked list is the point of importing. Duplicate rows are skipped.
 */
export function planImport(rows: ImportRow[], existing: ExistingCompany[]): ImportPlan {
  const plan: ImportPlan = { creates: [], updates: [], skipped: [] };
  const byKey = new Map(existing.map((c) => [companyKey(c.name), c]));
  const byDomain = new Map(existing.filter((c) => c.domain).map((c) => [c.domain!, c]));
  const seenKeys = new Set<string>();
  const seenDomains = new Set<string>();

  for (const raw of rows) {
    if (blank(raw.name)) continue;
    const row = tidy(raw);
    const key = companyKey(row.name);
    if (!key) {
      plan.skipped.push({ name: row.name, reason: "no usable name" });
      continue;
    }
    if (seenKeys.has(key) || (row.domain && seenDomains.has(row.domain))) {
      plan.skipped.push({ name: row.name, reason: "listed twice in the file" });
      continue;
    }
    seenKeys.add(key);
    if (row.domain) seenDomains.add(row.domain);

    const match = byKey.get(key) ?? (row.domain ? byDomain.get(row.domain) : undefined);
    if (!match) {
      plan.creates.push(row);
      continue;
    }
    const patch: ImportPatch = {};
    for (const f of ["domain", "description", "why", "rolesOfInterest", "notes"] as const) {
      if (row[f] && blank(match[f])) patch[f] = row[f];
    }
    if (row.tier && row.tier !== match.tier) patch.tier = row.tier;
    if (Object.keys(patch).length) plan.updates.push({ id: match.id, name: match.name, patch });
    else plan.skipped.push({ name: match.name, reason: "already up to date" });
  }
  return plan;
}

/** "Figma, Inc." → "Figma"; keeps "&" etc., which autocomplete matches better than "and". */
export function searchName(name: string): string {
  return name.replace(/[,\s]+\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|plc|gmbh)\b\.?\s*$/i, "").trim() || name.trim();
}

/** Only trust an autocomplete result whose name is the same company (avoids "Anthropic" → anthropics.com). */
export function pickSuggestion(name: string, suggestions: CompanySuggestion[]): CompanySuggestion | null {
  const key = companyKey(name);
  return suggestions.find((s) => companyKey(s.name) === key) ?? null;
}
