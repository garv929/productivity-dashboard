/** Company tiers: how attractive a target company is to the user (pure; safe on client and server). */

import { companyKey } from "./company-import";

export const COMPANY_TIERS = ["tier_1", "tier_2", "tier_3"] as const;
export type Tier = (typeof COMPANY_TIERS)[number];

export const TIER_LABEL: Record<Tier, string> = { tier_1: "Tier 1", tier_2: "Tier 2", tier_3: "Tier 3" };

/** One colour per tier, used everywhere tiers appear (Company Research and Applications). */
export const TIER_COLOR: Record<Tier, string> = {
  tier_1: "#c9a227", // gold
  tier_2: "#22a55b", // green
  tier_3: "#f2c94c", // yellow
};
export const UNRATED_LABEL = "Unrated";

export function tierLabel(tier: Tier | null | undefined): string {
  return tier ? TIER_LABEL[tier] : UNRATED_LABEL;
}

/** Tier 1 → 0 … Tier 3 → 2, unrated last. */
export function tierRank(tier: Tier | null | undefined): number {
  return tier ? COMPANY_TIERS.indexOf(tier) : COMPANY_TIERS.length;
}

/** Within a tier, companies you can act on come first and finished ones last. */
const STATUS_RANK: Record<string, number> = { ready_to_apply: 0, ready_to_reach_out: 1, researching: 2, done: 3 };

export function compareCompanies(
  a: { tier: Tier | null; status: string; name: string },
  b: { tier: Tier | null; status: string; name: string },
): number {
  return (
    tierRank(a.tier) - tierRank(b.tier) ||
    (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

/**
 * Tier of the company an application belongs to: the linked company if there is one,
 * otherwise a company whose name matches (case-insensitive). Null when unknown or unrated.
 */
export function tierForApplication(
  app: { companyId: string | null; companyName: string },
  companies: { id: string; name: string; tier: Tier | null }[],
): Tier | null {
  const linked = app.companyId ? companies.find((c) => c.id === app.companyId) : undefined;
  if (linked) return linked.tier;
  // Same matching as imports, so "Ramp, Inc." on an application finds "Ramp" in the company list.
  const key = companyKey(app.companyName);
  return companies.find((c) => companyKey(c.name) === key)?.tier ?? null;
}
