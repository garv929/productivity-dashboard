import { describe, expect, it } from "vitest";
import { compareCompanies, tierForApplication, tierLabel, type Tier } from "@/lib/domain/company-tier";

const co = (name: string, tier: Tier | null, status = "researching") => ({ name, tier, status });

describe("compareCompanies", () => {
  it("orders Tier 1 → Tier 3 with unrated last", () => {
    const sorted = [co("A", null), co("B", "tier_3"), co("C", "tier_1"), co("D", "tier_2")].sort(compareCompanies);
    expect(sorted.map((c) => c.name)).toEqual(["C", "D", "B", "A"]);
  });

  it("puts ready companies first and done ones last within a tier, then sorts by name", () => {
    const sorted = [
      co("Zeta", "tier_1", "done"),
      co("beta", "tier_1", "researching"),
      co("Alpha", "tier_1", "researching"),
      co("Ramp", "tier_1", "ready_to_reach_out"),
      co("Stripe", "tier_1", "ready_to_apply"),
    ].sort(compareCompanies);
    expect(sorted.map((c) => c.name)).toEqual(["Stripe", "Ramp", "Alpha", "beta", "Zeta"]);
  });
});

describe("tierForApplication", () => {
  const companies = [
    { id: "1", name: "Ramp", tier: "tier_1" as const },
    { id: "2", name: "Stripe", tier: null },
    { id: "3", name: "Notion", tier: "tier_3" as const },
  ];

  it("uses the linked company first", () => {
    expect(tierForApplication({ companyId: "3", companyName: "Ramp" }, companies)).toBe("tier_3");
  });

  it("falls back to a case-insensitive name match", () => {
    expect(tierForApplication({ companyId: null, companyName: " ramp " }, companies)).toBe("tier_1");
  });

  it("is null for unrated or unknown companies", () => {
    expect(tierForApplication({ companyId: null, companyName: "Stripe" }, companies)).toBeNull();
    expect(tierForApplication({ companyId: null, companyName: "Figma" }, companies)).toBeNull();
  });
});

describe("tierLabel", () => {
  it("labels tiers and unrated", () => {
    expect(tierLabel("tier_2")).toBe("Tier 2");
    expect(tierLabel(null)).toBe("Unrated");
  });
});
